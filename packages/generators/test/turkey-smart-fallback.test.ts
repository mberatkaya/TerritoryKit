import { computeGeometryBBox, computeGeometryCenter } from "@territory-kit/dataset";
import { validateTurkeyV2Dataset } from "@territory-kit/dataset/turkey-v2";
import type { LngLat, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { describe, expect, it } from "vitest";
import {
  TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
  buildTurkeySmartFallback,
  buildTurkeySmartFallbackWithAdjacency,
  createTurkeySmartFallbackDataset,
  normalizeTurkeySmartFallbackBarriers,
  resolveTurkeySmartFallbackConfiguration
} from "../src/turkey-adm3.js";

describe("Turkey ADM3 smart fallback boundary engine", () => {
  it("normalizes provider-neutral barriers with road hierarchy weighting", () => {
    const parent = districtZone("barrier-normalization", rectangle(0, 0, 1, 1));
    const barriers = normalizeTurkeySmartFallbackBarriers({
      parent,
      provinceCode: "01",
      districtCode: "barrier-normalization",
      profile: "custom",
      roads: lineCollection([
        lineFeature(
          "primary",
          [
            [0.25, 0],
            [0.25, 1]
          ],
          { highway: "primary", source: "openstreetmap" }
        ),
        lineFeature(
          "residential",
          [
            [0.5, 0],
            [0.5, 1]
          ],
          { highway: "residential" }
        ),
        lineFeature(
          "service",
          [
            [0.75, 0],
            [0.75, 1]
          ],
          { highway: "service" }
        )
      ]),
      railways: lineCollection([
        lineFeature(
          "rail",
          [
            [0, 0.6],
            [1, 0.6]
          ],
          { railway: "rail" }
        )
      ]),
      water: lineCollection([
        lineFeature(
          "river",
          [
            [0, 0.4],
            [1, 0.4]
          ],
          { waterway: "river" }
        )
      ])
    });

    expect(barriers.map((barrier) => barrier.sourceNativeId)).toEqual([
      "river",
      "primary",
      "rail",
      "residential"
    ]);
    expect(barriers.find((barrier) => barrier.sourceNativeId === "primary")).toMatchObject({
      barrierClass: "road",
      strengthClass: "strong",
      strength: 0.9
    });
    expect(barriers.find((barrier) => barrier.sourceNativeId === "residential")).toMatchObject({
      barrierClass: "road",
      strengthClass: "weak",
      strength: 0.15
    });
    expect(barriers.some((barrier) => barrier.sourceNativeId === "service")).toBe(false);
  });

  it("merges connected same-name OSM way fragments before scoring alignment", () => {
    const parent = districtZone("barrier-merge", rectangle(0, 0, 1, 1));
    const barriers = normalizeTurkeySmartFallbackBarriers({
      parent,
      provinceCode: "01",
      districtCode: "barrier-merge",
      profile: "custom",
      roads: lineCollection([
        lineFeature(
          "segment-a",
          [
            [0.5, 0],
            [0.5, 0.5]
          ],
          { highway: "primary", name: "Millet Caddesi", source: "openstreetmap" }
        ),
        lineFeature(
          "segment-b",
          [
            [0.5, 0.5],
            [0.5, 1]
          ],
          { highway: "primary", name: "Millet Caddesi", source: "openstreetmap" }
        )
      ])
    });

    expect(barriers).toHaveLength(1);
    expect(barriers[0]).toMatchObject({
      sourceNativeId: expect.stringMatching(/^merged:2:/),
      barrierClass: "road",
      strengthClass: "strong",
      coordinates: [
        [0.5, 0],
        [0.5, 0.5],
        [0.5, 1]
      ]
    });
  });

  it("rejects Turkey-shaped latitude-longitude parent geometries", () => {
    const parent = districtZone("swapped-coordinate-order", rectangle(40, 28, 41, 29));
    const result = buildTurkeySmartFallback({
      parent,
      provinceCode: "01",
      districtCode: "swapped-coordinate-order",
      profile: "custom",
      roads: lineCollection([
        lineFeature(
          "primary",
          [
            [40.5, 28],
            [40.5, 29]
          ],
          { highway: "primary", source: "openstreetmap" }
        )
      ]),
      options: twoZoneOptions()
    });

    expect(result.quality.ok).toBe(false);
    expect(result.status).toBe("rejected");
    expect(result.zones).toHaveLength(0);
    expect(result.reasonCodes).toContain("SMART_FALLBACK_COORDINATE_ORDER_INVALID");
  });

  it("does not infer dense-urban profile for large districts from seed count alone", () => {
    const parent = districtZone("large-rural-seeds", rectangle(36, 39, 36.25, 39.25));
    const seeds = Array.from({ length: 40 }, (_, index) => ({
      name: `Seed ${index + 1}`,
      coordinate: [36.02 + (index % 8) * 0.025, 39.02 + Math.floor(index / 8) * 0.04] as LngLat
    }));
    const resolution = resolveTurkeySmartFallbackConfiguration({
      parent,
      provinceCode: "01",
      districtCode: "large-rural-seeds",
      profile: "auto",
      localitySeeds: seeds,
      roads: lineCollection([
        lineFeature(
          "primary",
          [
            [36, 39.125],
            [36.25, 39.125]
          ],
          { highway: "primary", source: "openstreetmap" }
        )
      ])
    });

    expect(resolution.configuration.selectedProfile).toBe("rural");
    expect(resolution.configuration.targetTerritoryCount).toBeLessThan(100);
  });

  it("ignores ADM2 outer-edge barriers and reports smart input diagnostics", () => {
    const parent = districtZone("parent-edge-diagnostics", rectangle(0, 0, 1, 1));
    const result = buildTurkeySmartFallback({
      parent,
      provinceCode: "01",
      districtCode: "parent-edge-diagnostics",
      profile: "custom",
      roads: lineCollection([
        lineFeature(
          "outer-edge",
          [
            [0, 0],
            [1, 0]
          ],
          { highway: "primary", source: "openstreetmap" }
        ),
        lineFeature(
          "internal",
          [
            [0.5, 0],
            [0.5, 1]
          ],
          { highway: "primary", source: "openstreetmap" }
        )
      ]),
      options: twoZoneOptions()
    });

    expect(result.quality.ok).toBe(true);
    expect(result.quality.inputDiagnostics).toMatchObject({
      roadsRaw: 2,
      roadsNormalized: 1,
      majorRoadsRaw: 2,
      majorRoadsNormalized: 1,
      parentEdgeBarrierCount: 1,
      internalBarrierCount: 1
    });
    expect(result.quality.meanBarrierAlignment).toBe(1);
    expect(result.reasonCodes).toContain("SMART_FALLBACK_BARRIER_IGNORED");
  });

  it("generates TR V2-compatible derived territories on an urban road grid", async () => {
    const parent = districtZone("smart-grid", rectangle(0, 0, 1, 1));
    const result = await buildTurkeySmartFallbackWithAdjacency({
      parent,
      provinceCode: "01",
      districtCode: "smart-grid",
      profile: "custom",
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
      localitySeeds: [
        { name: "Southwest", coordinate: [0.25, 0.25] },
        { name: "Southeast", coordinate: [0.75, 0.25] },
        { name: "Northwest", coordinate: [0.25, 0.75] },
        { name: "Northeast", coordinate: [0.75, 0.75] }
      ],
      options: permissiveFourZoneOptions()
    });
    const dataset = createTurkeySmartFallbackDataset({
      parent,
      zones: result.zones,
      datasetId: "test-tr-smart-grid",
      includeParent: true
    });
    const validation = validateTurkeyV2Dataset(dataset);

    expect(result.quality.ok).toBe(true);
    expect(result.zones).toHaveLength(4);
    expect(result.quality.coveragePercent).toBe(100);
    expect(result.quality.meanBarrierAlignment).toBe(1);
    expect(result.quality.meanRealBarrierRatio).toBe(1);
    expect(result.quality.meanSyntheticBoundaryRatio).toBe(0);
    expect(result.quality.coverageComputation).toMatchObject({
      mode: "union",
      unionFailed: false,
      rawOverlapAreaKm2: 0,
      rawOutsideSpillKm2: 0,
      rawUncoveredInsideParentKm2: 0
    });
    expect(result.quality.coverageComputation.topologyToleranceKm2).toBeGreaterThan(0);
    expect(result.quality.inputDiagnostics).toMatchObject({
      roadsRaw: 2,
      roadsNormalized: 2,
      seedsRaw: 4,
      seedsNormalized: 4
    });
    expect(result.adjacency?.edges).toHaveLength(4);
    expect(validation.ok).toBe(true);
    expect(result.zones.map((zone) => zone.bbox)).toEqual([
      [0, 0, 0.5, 0.5],
      [0.5, 0, 1, 0.5],
      [0, 0.5, 0.5, 1],
      [0.5, 0.5, 1, 1]
    ]);

    for (const zone of result.zones) {
      const territory = zone.properties.territory as Record<string, unknown>;
      const generatedZone = territory.generatedZone as Record<string, unknown>;
      const smartFallback = territory.smartFallback as Record<string, unknown>;

      expect(territory.sourceClass).toBe("generated");
      expect(territory.boundaryKind).toBe("estimated");
      expect(territory.boundarySourceClass).toBe("smart-derived");
      expect(territory.administrative).toBe(false);
      expect(territory.official).toBe(false);
      expect(territory.generated).toBe(true);
      expect(territory.algorithmVersion).toBe(TURKEY_SMART_FALLBACK_ALGORITHM_VERSION);
      expect(territory.localTypeName).toBe("Smart derived territory");
      expect(generatedZone.algorithm).toBe("barrier-guided-smart-fallback");
      expect(smartFallback.administrative).toBe(false);
      expect(smartFallback.authoritative).toBe(false);
    }
  });

  it("uses river corridors as strong physical split barriers", () => {
    const parent = districtZone("river-split", rectangle(0, 0, 1, 1));
    const result = buildTurkeySmartFallback({
      parent,
      provinceCode: "01",
      districtCode: "river-split",
      profile: "custom",
      water: lineCollection([
        lineFeature(
          "river",
          [
            [0.5, 0],
            [0.5, 1]
          ],
          { waterway: "river", source: "openstreetmap" }
        )
      ]),
      options: twoZoneOptions()
    });

    expect(result.quality.ok).toBe(true);
    expect(result.zones).toHaveLength(2);
    expect(result.zones.every((zone) => zone.bbox[2] <= 0.5 || zone.bbox[0] >= 0.5)).toBe(true);
    expect(result.quality.meanBarrierAlignment).toBe(1);
  });

  it("combines motorway and railway barriers without creating authoritative boundaries", () => {
    const parent = districtZone("motorway-rail", rectangle(0, 0, 1, 1));
    const result = buildTurkeySmartFallback({
      parent,
      provinceCode: "01",
      districtCode: "motorway-rail",
      profile: "custom",
      roads: lineCollection([
        lineFeature(
          "motorway",
          [
            [0.5, 0],
            [0.5, 1]
          ],
          { highway: "motorway", source: "openstreetmap" }
        )
      ]),
      railways: lineCollection([
        lineFeature(
          "rail",
          [
            [0, 0.5],
            [1, 0.5]
          ],
          { railway: "rail", source: "openstreetmap" }
        )
      ]),
      options: permissiveFourZoneOptions()
    });

    expect(result.quality.ok).toBe(true);
    expect(result.zones).toHaveLength(4);
    expect(
      result.zones.every((zone) => {
        const territory = zone.properties.territory as Record<string, unknown>;
        return territory.official === false && territory.administrative === false;
      })
    ).toBe(true);
  });

  it("supports sparse rural districts with a lower-density profile", () => {
    const parent = districtZone("sparse-rural", rectangle(0, 0, 2, 1));
    const result = buildTurkeySmartFallback({
      parent,
      provinceCode: "01",
      districtCode: "sparse-rural",
      profile: "rural",
      roads: lineCollection([
        lineFeature(
          "primary-rural",
          [
            [0, 0.5],
            [2, 0.5]
          ],
          { highway: "primary", source: "openstreetmap" }
        )
      ]),
      options: {
        seed: "smart-test",
        targetTerritoryCount: 2,
        targetAreaKm2: 12000,
        minAreaKm2: 1,
        maxAreaKm2: 15000,
        minFragmentAreaKm2: 1,
        minMeanQualityScore: 0.3,
        minMeanBarrierAlignment: 0.1
      }
    });

    expect(result.selectedProfile).toBe("rural");
    expect(result.quality.ok).toBe(true);
    expect(result.zones).toHaveLength(2);
    expect(result.quality.meanBarrierAlignment).toBe(1);
  });

  it("rejects incomplete networks instead of silently publishing synthetic grids", () => {
    const parent = districtZone("insufficient", rectangle(0, 0, 1, 1));
    const result = buildTurkeySmartFallback({
      parent,
      provinceCode: "01",
      districtCode: "insufficient",
      profile: "custom",
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
      options: permissiveFourZoneOptions()
    });
    const codes = result.issues.map((issue) => issue.code);

    expect(result.quality.ok).toBe(false);
    expect(result.status).toBe("rejected");
    expect(codes).toContain("SMART_FALLBACK_INSUFFICIENT_BARRIERS");
    expect(codes).toContain("SMART_FALLBACK_SYNTHETIC_SPLIT_USED");
    expect(codes).not.toContain("SMART_FALLBACK_GENERATED");
  });

  it("keeps IDs, manifest hashes, and output hashes deterministic", () => {
    const parent = districtZone("deterministic", rectangle(0, 0, 1, 1));
    const input = {
      parent,
      provinceCode: "01",
      districtCode: "deterministic",
      profile: "custom" as const,
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
      options: permissiveFourZoneOptions()
    };
    const first = buildTurkeySmartFallback(input);
    const second = buildTurkeySmartFallback(input);

    expect(first.deterministicHash).toBe(second.deterministicHash);
    expect(first.manifest.contentHash).toBe(second.manifest.contentHash);
    expect(first.zones.map((zone) => zone.id)).toEqual(second.zones.map((zone) => zone.id));
  });
});

function permissiveFourZoneOptions() {
  return {
    seed: "smart-test",
    targetTerritoryCount: 4,
    targetAreaKm2: 3000,
    minAreaKm2: 1,
    maxAreaKm2: 5000,
    minFragmentAreaKm2: 1,
    minMeanQualityScore: 0.35,
    minMeanBarrierAlignment: 0.2
  };
}

function twoZoneOptions() {
  return {
    seed: "smart-test",
    targetTerritoryCount: 2,
    targetAreaKm2: 6000,
    minAreaKm2: 1,
    maxAreaKm2: 7000,
    minFragmentAreaKm2: 1,
    minMeanQualityScore: 0.3,
    minMeanBarrierAlignment: 0.1
  };
}

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
