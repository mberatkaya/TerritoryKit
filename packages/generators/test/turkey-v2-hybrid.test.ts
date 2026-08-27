import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import fc from "fast-check";
import { computeGeometryBBox, computeGeometryCenter } from "@territory-kit/dataset";
import type {
  LngLat,
  TerritoryGeometry,
  TerritorySourceClass,
  TerritoryZone
} from "@territory-kit/dataset";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { describe, expect, it } from "vitest";
import {
  TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
  TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
  buildTurkeyV2HybridBatch,
  buildTurkeyV2HybridDistrict,
  createTurkeyV2ZoneMigrationPlan
} from "../src/turkey-adm3.js";

const ROOT = resolve(__dirname, "../../..");

describe("Turkey V2 hybrid coverage pipeline", () => {
  it("applies official > OSM > generated priority and keeps real provenance", async () => {
    const district = districtZone("priority", rectangle(0, 0, 1, 1));
    const official = realZone({
      id: "tr:adm3:official-a",
      sourceClass: "official",
      sourceNativeId: "official-a",
      name: "Official A",
      geometry: rectangle(0, 0, 0.4, 1)
    });
    const osm = realZone({
      id: "tr:adm3:osm-a",
      sourceClass: "osm",
      sourceNativeId: "osm-way-1",
      name: "OSM A",
      geometry: rectangle(0.3, 0, 0.7, 1)
    });
    const result = await buildTurkeyV2HybridDistrict({
      district,
      provinceCode: "01",
      districtCode: "priority",
      officialZones: [official],
      osmZones: [osm],
      generated: {
        enabled: true,
        profile: "custom",
        targetAreaKm2: 4000,
        minAreaKm2: 1,
        maxAreaKm2: 6000,
        maxZonesPerDistrict: 4,
        minFragmentAreaKm2: 1,
        seed: "kaprota-v2"
      },
      buildDate: "2026-08-13T00:00:00.000Z"
    });

    expect(result.quality.ok).toBe(true);
    expect(result.coverage.finalCoveragePercent).toBeGreaterThanOrEqual(99.99);
    expect(result.coverage.officialEffectiveCount).toBe(1);
    expect(result.coverage.osmEffectiveCount).toBe(1);
    expect(result.coverage.generatedEffectiveCount).toBeGreaterThanOrEqual(1);
    expect(result.coverage.osmClippedByOfficialAreaKm2).toBeGreaterThan(0);
    expect(result.effective.osm[0]?.bbox[0]).toBeCloseTo(0.4, 6);
    expect(result.effective.generated.every((zone) => zone.bbox[0] >= 0.7)).toBe(true);
    expect(
      result.effective.zones.map(
        (zone) => (zone.properties.territory as Record<string, unknown>).sourceClass
      )
    ).toEqual(expect.arrayContaining(["official", "osm", "generated"]));
    expect(result.provenance.zones.find((zone) => zone.zoneId === official.id)).toMatchObject({
      sourceClass: "official",
      sourceNativeId: "official-a",
      license: "CC BY 4.0"
    });
    expect(result.attribution.text).toContain("OpenStreetMap contributors");
    expect(result.adjacency.edges.every((edge) => edge.from !== edge.to)).toBe(true);
    expect(result.quality.strictValidation.ok).toBe(true);
  });

  it("does not generate zones when real coverage fills the district", async () => {
    const district = districtZone("real-only", rectangle(0, 0, 1, 1));
    const official = realZone({
      id: "tr:adm3:official-full",
      sourceClass: "official",
      sourceNativeId: "official-full",
      name: "Official Full",
      geometry: rectangle(0, 0, 1, 1),
      parentId: district.id,
      districtCode: "real-only"
    });
    const result = await buildTurkeyV2HybridDistrict({
      district,
      provinceCode: "01",
      districtCode: "real-only",
      officialZones: [official],
      buildDate: "2026-08-13T00:00:00.000Z"
    });

    expect(result.quality.ok).toBe(true);
    expect(result.coverage.generatedEffectiveCount).toBe(0);
    expect(result.coverage.missingBeforeGeneratedAreaKm2).toBe(0);
    expect(result.coverage.finalCoveragePercent).toBe(100);
  });

  it("fails publish quality when generated fallback is disabled and a gap remains", async () => {
    const district = districtZone("gap", rectangle(0, 0, 1, 1));
    const official = realZone({
      id: "tr:adm3:official-half",
      sourceClass: "official",
      sourceNativeId: "official-half",
      name: "Official Half",
      geometry: rectangle(0, 0, 0.5, 1),
      parentId: district.id,
      districtCode: "gap"
    });
    const result = await buildTurkeyV2HybridDistrict({
      district,
      provinceCode: "01",
      districtCode: "gap",
      officialZones: [official],
      generated: { enabled: false },
      buildDate: "2026-08-13T00:00:00.000Z"
    });

    expect(result.quality.ok).toBe(false);
    expect(result.quality.gates.coverage).toBe(false);
    expect(result.coverage.remainingGapAreaKm2).toBeGreaterThan(0);
  });

  it("keeps runtime provider class separate from final official source class", async () => {
    const district = districtZone("runtime", rectangle(0, 0, 1, 1));
    const runtimeOfficial = realZone({
      id: "tr:adm3:runtime-official",
      sourceClass: "official",
      providerClass: "runtime",
      sourceNativeId: "runtime-1",
      name: "Runtime Official",
      geometry: rectangle(0, 0, 1, 1),
      parentId: district.id,
      districtCode: "runtime"
    });
    const result = await buildTurkeyV2HybridDistrict({
      district,
      provinceCode: "01",
      districtCode: "runtime",
      officialZones: [runtimeOfficial],
      buildDate: "2026-08-13T00:00:00.000Z"
    });
    const territory = result.effective.official[0]?.properties.territory as Record<string, unknown>;

    expect(territory.sourceClass).toBe("official");
    expect(territory.providerClass).toBe("runtime");
    expect(result.provenance.zones[0]).toMatchObject({
      sourceClass: "official",
      providerClass: "runtime",
      redistributionPolicy: "runtime-only"
    });
  });

  it("rejects experimental sources unless explicitly enabled", async () => {
    const district = districtZone("experimental", rectangle(0, 0, 1, 1));
    const experimental = realZone({
      id: "tr:adm3:experimental",
      sourceClass: "official",
      providerClass: "experimental",
      sourceNativeId: "experimental-1",
      name: "Experimental",
      geometry: rectangle(0, 0, 1, 1),
      parentId: district.id,
      districtCode: "experimental"
    });
    const blocked = await buildTurkeyV2HybridDistrict({
      district,
      provinceCode: "01",
      districtCode: "experimental",
      officialZones: [experimental],
      generated: { enabled: false },
      buildDate: "2026-08-13T00:00:00.000Z"
    });
    const allowed = await buildTurkeyV2HybridDistrict({
      district,
      provinceCode: "01",
      districtCode: "experimental",
      officialZones: [experimental],
      allowExperimental: true,
      buildDate: "2026-08-13T00:00:00.000Z"
    });

    expect(blocked.rejections.rejections[0]?.reason).toBe("experimental-not-enabled");
    expect(blocked.effective.official).toHaveLength(0);
    expect(allowed.effective.official).toHaveLength(1);
  });

  it("creates migration evidence for generated-to-real replacement and splits", () => {
    const oldGenerated = realZone({
      id: "tr:adm3:old-generated",
      sourceClass: "generated",
      sourceNativeId: "old-generated",
      name: "Generated",
      geometry: rectangle(0, 0, 1, 1)
    });
    const newOfficialA = realZone({
      id: "tr:adm3:new-official-a",
      sourceClass: "official",
      sourceNativeId: "official-a",
      name: "Official A",
      geometry: rectangle(0, 0, 0.5, 1)
    });
    const newOfficialB = realZone({
      id: "tr:adm3:new-official-b",
      sourceClass: "official",
      sourceNativeId: "official-b",
      name: "Official B",
      geometry: rectangle(0.5, 0, 1, 1)
    });
    const plan = createTurkeyV2ZoneMigrationPlan({
      buildDate: "2026-08-13T00:00:00.000Z",
      oldZones: [oldGenerated],
      newZones: [newOfficialA, newOfficialB]
    });

    expect(plan.records).toEqual([
      expect.objectContaining({
        changeType: "split",
        oldZoneIds: [oldGenerated.id],
        newZoneIds: [newOfficialA.id, newOfficialB.id],
        sourceClassBefore: "generated",
        sourceClassAfter: "official"
      })
    ]);
  });

  it("builds deterministic batch results independent of district order", async () => {
    const firstDistrict = districtZone("batch-a", rectangle(0, 0, 1, 1));
    const secondDistrict = districtZone("batch-b", rectangle(2, 0, 3, 1));
    const firstOfficial = realZone({
      id: "tr:adm3:batch-a-official",
      sourceClass: "official",
      sourceNativeId: "batch-a-official",
      name: "Batch A",
      geometry: rectangle(0, 0, 1, 1),
      parentId: firstDistrict.id,
      districtCode: "batch-a"
    });
    const secondOsm = realZone({
      id: "tr:adm3:batch-b-osm",
      sourceClass: "osm",
      sourceNativeId: "batch-b-osm",
      name: "Batch B",
      geometry: rectangle(2, 0, 2.5, 1),
      parentId: secondDistrict.id,
      districtCode: "batch-b"
    });
    const common = {
      sourcesByDistrict: {
        [firstDistrict.id]: { officialZones: [firstOfficial] },
        [secondDistrict.id]: { osmZones: [secondOsm] }
      },
      generatedDefaults: {
        enabled: true,
        profile: "custom",
        targetAreaKm2: 4000,
        minAreaKm2: 1,
        maxAreaKm2: 6000,
        maxZonesPerDistrict: 4,
        minFragmentAreaKm2: 1,
        seed: "kaprota-v2"
      } as const,
      buildDate: "2026-08-13T00:00:00.000Z"
    };
    const first = await buildTurkeyV2HybridBatch({
      ...common,
      districts: [firstDistrict, secondDistrict]
    });
    const second = await buildTurkeyV2HybridBatch({
      ...common,
      districts: [secondDistrict, firstDistrict]
    });

    expect(first.deterministicHash).toBe(second.deterministicHash);
    expect(first.coverage.successfulDistrictCount).toBe(2);
    expect(first.coverage.hybridRealGeneratedDistricts).toContain(secondDistrict.id);
  });

  it("keeps hybrid output invariant for candidate ordering and ring orientation", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (reverse) => {
        const districtGeometry = rectangle(0, 0, 1, 1);
        const district = districtZone(
          "property",
          reverse ? reverseGeometry(districtGeometry) : districtGeometry
        );
        const official = realZone({
          id: "tr:adm3:property-official",
          sourceClass: "official",
          sourceNativeId: "property-official",
          name: "Property Official",
          geometry: reverse ? reverseGeometry(rectangle(0, 0, 0.45, 1)) : rectangle(0, 0, 0.45, 1),
          parentId: district.id,
          districtCode: "property"
        });
        const osm = realZone({
          id: "tr:adm3:property-osm",
          sourceClass: "osm",
          sourceNativeId: "property-osm",
          name: "Property OSM",
          geometry: rectangle(0.35, 0, 0.75, 1),
          parentId: district.id,
          districtCode: "property"
        });
        const options = {
          district,
          provinceCode: "01",
          districtCode: "property",
          officialZones: reverse ? [official] : [official],
          osmZones: reverse ? [osm] : [osm],
          generated: {
            enabled: true,
            profile: "custom",
            targetAreaKm2: 4000,
            minAreaKm2: 1,
            maxAreaKm2: 6000,
            maxZonesPerDistrict: 4,
            minFragmentAreaKm2: 1,
            seed: "kaprota-v2"
          } as const,
          buildDate: "2026-08-13T00:00:00.000Z"
        };
        const first = await buildTurkeyV2HybridDistrict(options);
        const second = await buildTurkeyV2HybridDistrict({
          ...options,
          district: districtZone("property", districtGeometry),
          officialZones: [
            realZone({
              id: "tr:adm3:property-official",
              sourceClass: "official",
              sourceNativeId: "property-official",
              name: "Property Official",
              geometry: rectangle(0, 0, 0.45, 1),
              parentId: district.id,
              districtCode: "property"
            })
          ],
          osmZones: [osm]
        });

        expect(first.deterministicHash).toBe(second.deterministicHash);
        expect(first.effective.zones.map((zone) => zone.id)).toEqual(
          second.effective.zones.map((zone) => zone.id)
        );
      }),
      { numRuns: 8 }
    );
  });

  it("uses the Sprint 2 game-zone algorithm metadata for generated fallback", async () => {
    const district = districtZone("generated-only", rectangle(0, 0, 1, 1));
    const result = await buildTurkeyV2HybridDistrict({
      district,
      provinceCode: "01",
      districtCode: "generated-only",
      generated: {
        enabled: true,
        profile: "custom",
        targetAreaKm2: 4000,
        minAreaKm2: 1,
        maxAreaKm2: 6000,
        maxZonesPerDistrict: 4,
        minFragmentAreaKm2: 1,
        seed: "kaprota-v2"
      },
      buildDate: "2026-08-13T00:00:00.000Z"
    });

    expect(result.effective.generated.length).toBeGreaterThan(0);
    expect(
      result.effective.generated.every((zone) => {
        const territory = zone.properties.territory as Record<string, unknown>;
        return (
          territory.sourceClass === "generated" &&
          territory.algorithmVersion === TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION &&
          territory.localTypeName === "Generated game zone"
        );
      })
    ).toBe(true);
  });

  it("uses smart fallback as the generated source when barriers pass quality gates", async () => {
    const district = districtZone("smart-generated-only", rectangle(0, 0, 1, 1));
    const result = await buildTurkeyV2HybridDistrict({
      district,
      provinceCode: "01",
      districtCode: "smart-generated-only",
      generated: {
        enabled: true,
        strategy: "smart",
        profile: "custom",
        targetZoneCount: 4,
        targetAreaKm2: 3000,
        minAreaKm2: 1,
        maxAreaKm2: 5000,
        maxZonesPerDistrict: 6,
        minFragmentAreaKm2: 1,
        seed: "smart-test",
        smartFallback: {
          roads: lineCollection([
            lineFeature(
              "primary-v",
              [
                [0.5, 0],
                [0.5, 1]
              ],
              { highway: "primary", source: "openstreetmap" }
            ),
            lineFeature(
              "secondary-h",
              [
                [0, 0.5],
                [1, 0.5]
              ],
              { highway: "secondary", source: "openstreetmap" }
            )
          ]),
          options: {
            minMeanQualityScore: 0.35,
            minMeanBarrierAlignment: 0.2
          }
        }
      },
      buildDate: "2026-08-13T00:00:00.000Z"
    });

    expect(result.quality.ok).toBe(true);
    expect(result.coverage.generatedStrategy).toBe("smart");
    expect(result.coverage.algorithmVersion).toBe(TURKEY_SMART_FALLBACK_ALGORITHM_VERSION);
    expect(result.smartFallbackResult?.quality.ok).toBe(true);
    expect(result.generatedResult).toBeUndefined();
    expect(result.effective.generated).toHaveLength(4);
    expect(
      result.effective.generated.every((zone) => {
        const territory = zone.properties.territory as Record<string, unknown>;
        return (
          territory.algorithmVersion === TURKEY_SMART_FALLBACK_ALGORITHM_VERSION &&
          territory.localTypeName === "Smart derived territory" &&
          territory.administrative === false &&
          territory.official === false
        );
      })
    ).toBe(true);
    expect(result.provenance.zones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          algorithmVersion: TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
          providerId: "openstreetmap",
          license: "ODbL-1.0"
        })
      ])
    );
  });

  it("falls back to legacy generated zones when smart fallback is rejected", async () => {
    const district = districtZone("smart-rejected-legacy", rectangle(0, 0, 1, 1));
    const result = await buildTurkeyV2HybridDistrict({
      district,
      provinceCode: "01",
      districtCode: "smart-rejected-legacy",
      generated: {
        enabled: true,
        strategy: "smart",
        profile: "custom",
        targetZoneCount: 4,
        targetAreaKm2: 3000,
        minAreaKm2: 1,
        maxAreaKm2: 5000,
        maxZonesPerDistrict: 6,
        minFragmentAreaKm2: 1,
        seed: "smart-test",
        smartFallback: {
          roads: lineCollection([
            lineFeature(
              "service",
              [
                [0.5, 0],
                [0.5, 1]
              ],
              { highway: "service", source: "openstreetmap" }
            )
          ]),
          options: {
            minMeanQualityScore: 0.35,
            minMeanBarrierAlignment: 0.2
          }
        }
      },
      buildDate: "2026-08-13T00:00:00.000Z"
    });

    expect(result.smartFallbackResult?.quality.ok).toBe(false);
    expect(result.generatedResult?.quality.ok).toBe(true);
    expect(result.quality.ok).toBe(true);
    expect(result.coverage.generatedStrategy).toBe("legacy");
    expect(result.coverage.algorithmVersion).toBe(TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION);
    expect(
      result.effective.generated.every((zone) => {
        const territory = zone.properties.territory as Record<string, unknown>;
        return territory.algorithmVersion === TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION;
      })
    ).toBe(true);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TR_V2_HYBRID_LEGACY_FALLBACK_USED",
          severity: "warning"
        })
      ])
    );
  });

  it("preserves approved repository source metadata for real official and OSM records", async () => {
    const catalog = JSON.parse(
      await readFile(resolve(ROOT, "datasets/sources/TR/adm3-catalog.json"), "utf8")
    ) as {
      provinces: Record<
        string,
        {
          provinceCode: string;
          providerId: string;
          providerName: string;
          sourceUrl: string;
          license: string;
          attribution: string;
        }
      >;
    };
    const osmProviders = JSON.parse(
      await readFile(resolve(ROOT, "datasets/registry/tr-adm3-osm-providers.json"), "utf8")
    ) as {
      records: Array<{
        provinceCode: string;
        id: string;
        providerName: string;
        license: string;
        attribution: string;
        sourceUrl?: string;
      }>;
    };
    const bursa = catalog.provinces["16"];
    const bursaOsm = osmProviders.records.find((provider) => provider.provinceCode === "16");
    const district = districtZone("bursa-real-metadata", {
      type: "Polygon",
      coordinates: [
        [
          [29, 40],
          [29.16, 40.02],
          [29.12, 40.14],
          [28.98, 40.1],
          [29, 40]
        ]
      ]
    });

    expect(bursa).toBeDefined();
    expect(bursaOsm).toBeDefined();

    const official = withSourceMetadata(
      realZone({
        id: "tr:adm3:bursa-official-real-metadata",
        sourceClass: "official",
        sourceNativeId: "bursa-official-1",
        name: "Bursa official metadata",
        geometry: rectangle(29, 40, 29.07, 40.1),
        parentId: district.id,
        districtCode: "bursa-real-metadata"
      }),
      {
        providerClass: "official",
        providerId: bursa!.providerId,
        providerName: bursa!.providerName,
        sourceDatasetId: bursa!.providerId,
        sourceUrl: bursa!.sourceUrl,
        license: bursa!.license,
        attribution: bursa!.attribution
      }
    );
    const osm = withSourceMetadata(
      realZone({
        id: "tr:adm3:bursa-osm-real-metadata",
        sourceClass: "osm",
        sourceNativeId: "osm:relation:16",
        name: "Bursa OSM metadata",
        geometry: rectangle(29.05, 40, 29.12, 40.1),
        parentId: district.id,
        districtCode: "bursa-real-metadata"
      }),
      {
        providerClass: "osm",
        providerId: bursaOsm!.id,
        providerName: bursaOsm!.providerName,
        sourceDatasetId: bursaOsm!.id,
        sourceUrl: bursaOsm!.sourceUrl ?? "https://www.openstreetmap.org/",
        license: bursaOsm!.license,
        attribution: bursaOsm!.attribution
      }
    );
    const result = await buildTurkeyV2HybridDistrict({
      district,
      provinceCode: "16",
      districtCode: "bursa-real-metadata",
      officialZones: [official],
      osmZones: [osm],
      generated: {
        enabled: true,
        profile: "custom",
        targetAreaKm2: 4000,
        minAreaKm2: 1,
        maxAreaKm2: 6000,
        maxZonesPerDistrict: 4,
        minFragmentAreaKm2: 1,
        seed: "kaprota-v2"
      },
      buildDate: "2026-08-13T00:00:00.000Z"
    });

    expect(result.quality.ok).toBe(true);
    expect(result.provenance.zones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceClass: "official",
          providerId: bursa!.providerId,
          license: bursa!.license,
          attribution: bursa!.attribution
        }),
        expect.objectContaining({
          sourceClass: "osm",
          providerId: bursaOsm!.id,
          license: "ODbL-1.0"
        })
      ])
    );
    expect(result.distributionPolicy.policies.map((policy) => policy.license)).toContain(
      "ODbL-1.0"
    );
  });
});

function districtZone(idSuffix: string, geometry: TerritoryGeometry): TerritoryZone {
  return {
    id: `tr:adm2:${idSuffix}`,
    datasetId: "test-tr-adm2",
    countryCode: "TR",
    level: 2,
    sourceAdminLevel: "ADM2",
    semanticType: "district",
    name: idSuffix,
    neighborIds: [],
    geometry,
    center: computeGeometryCenter(geometry),
    bbox: computeGeometryBBox(geometry),
    properties: {
      territory: {
        adminLevel: "ADM2",
        sourceAdminLevel: "ADM2",
        semanticType: "district",
        countryCode: "TR",
        provinceCode: "01",
        districtCode: idSuffix,
        semanticReviewStatus: "reviewed",
        coverageStatus: "verified"
      }
    }
  };
}

function realZone(options: {
  id: string;
  sourceClass: TerritorySourceClass;
  sourceNativeId: string;
  name: string;
  geometry: TerritoryGeometry;
  providerClass?: "official" | "runtime" | "experimental" | "osm" | "generated";
  parentId?: string;
  districtCode?: string;
}): TerritoryZone {
  const isGenerated = options.sourceClass === "generated";
  const providerId =
    options.sourceClass === "osm"
      ? "openstreetmap"
      : isGenerated
        ? "territory-kit-generated"
        : "fixture-official";
  const license =
    options.sourceClass === "osm" ? "ODbL-1.0" : isGenerated ? "Apache-2.0" : "CC BY 4.0";
  const attribution =
    options.sourceClass === "osm"
      ? "OpenStreetMap contributors, ODbL 1.0"
      : isGenerated
        ? "TerritoryKit generated game zones from ADM2 boundaries"
        : "Fixture official source";

  return {
    id: options.id,
    datasetId: "test-tr-adm3",
    countryCode: "TR",
    level: 3,
    sourceAdminLevel: "ADM3",
    semanticType: isGenerated ? "generated-zone" : "neighbourhood",
    name: options.name,
    parentId: options.parentId ?? "tr:adm2:priority",
    neighborIds: [],
    geometry: options.geometry,
    center: computeGeometryCenter(options.geometry),
    bbox: computeGeometryBBox(options.geometry),
    properties: {
      territory: {
        adminLevel: "ADM3",
        sourceAdminLevel: "ADM3",
        semanticType: isGenerated ? "generated-zone" : "neighbourhood",
        localType: isGenerated ? "generated-zone" : "neighbourhood",
        localTypeName: isGenerated ? "Generated game zone" : "Mahalle",
        hierarchyDepth: 3,
        parentId: options.parentId ?? "tr:adm2:priority",
        countryCode: "TR",
        provinceCode: "01",
        districtCode: options.districtCode ?? "priority",
        sourceClass: options.sourceClass,
        providerClass: options.providerClass ?? options.sourceClass,
        providerId,
        providerName: providerId,
        sourceProvider: providerId,
        sourceDatasetId: options.sourceClass === "osm" ? "openstreetmap" : "fixture-official",
        sourceNativeId: options.sourceNativeId,
        sourceDate: "2026-08-01",
        sourceUrl:
          options.sourceClass === "osm"
            ? "https://www.openstreetmap.org/"
            : "https://data.example.test/tr/adm3",
        license,
        attribution,
        official: options.sourceClass === "official",
        generated: isGenerated,
        ...(isGenerated ? { algorithmVersion: TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION } : {}),
        semanticReviewStatus: isGenerated ? "not-applicable" : "reviewed",
        coverageStatus: isGenerated ? "generated" : "verified",
        stableId: options.id,
        redistributionPolicy: options.providerClass === "runtime" ? "runtime-only" : "allowed",
        commercialUsePolicy: "allowed",
        modificationPolicy: "allowed",
        source: {
          provider: providerId,
          sourceClass: options.sourceClass,
          sourceDatasetId: options.sourceClass === "osm" ? "openstreetmap" : "fixture-official",
          sourceId: options.sourceNativeId,
          sourceNativeId: options.sourceNativeId,
          sourceDate: "2026-08-01",
          sourceUrl:
            options.sourceClass === "osm"
              ? "https://www.openstreetmap.org/"
              : "https://data.example.test/tr/adm3",
          license,
          attribution
        }
      }
    }
  };
}

function rectangle(west: number, south: number, east: number, north: number): TerritoryGeometry {
  return {
    type: "Polygon",
    coordinates: [rectangleRing(west, south, east, north)]
  };
}

function rectangleRing(west: number, south: number, east: number, north: number): LngLat[] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ];
}

function reverseGeometry(geometry: TerritoryGeometry): TerritoryGeometry {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) => [...ring].reverse())
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => [...ring].reverse()))
  };
}

function withSourceMetadata(
  zone: TerritoryZone,
  metadata: {
    providerClass: "official" | "osm";
    providerId: string;
    providerName: string;
    sourceDatasetId: string;
    sourceUrl: string;
    license: string;
    attribution: string;
  }
): TerritoryZone {
  const territory = zone.properties.territory as Record<string, unknown>;
  const source = territory.source as Record<string, unknown>;

  return {
    ...zone,
    properties: {
      ...zone.properties,
      territory: {
        ...territory,
        ...metadata,
        sourceProvider: metadata.providerId,
        source: {
          ...source,
          provider: metadata.providerId,
          sourceDatasetId: metadata.sourceDatasetId,
          sourceUrl: metadata.sourceUrl,
          license: metadata.license,
          attribution: metadata.attribution
        }
      }
    }
  };
}

function lineCollection(features: Feature<LineString>[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features
  };
}

function lineFeature(
  id: string,
  coordinates: LngLat[],
  properties: Record<string, string>
): Feature<LineString> {
  return {
    type: "Feature",
    id,
    properties,
    geometry: {
      type: "LineString",
      coordinates
    }
  };
}
