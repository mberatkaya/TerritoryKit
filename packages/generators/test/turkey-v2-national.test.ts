import { createSquareZone } from "@territory-kit/shared-testkit";
import type {
  TerritoryAdminLevel,
  TerritoryDataset,
  TerritorySemanticAdminType,
  TerritorySourceClass,
  TerritoryZone
} from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  TURKEY_V2_NATIONAL_DATASET_ID,
  TURKEY_V2_NATIONAL_DATASET_VERSION,
  buildTurkeyV2NationalDataset,
  createTurkeyV2NationalArtifactPayloads,
  createTurkeyV2NationalSourceLock
} from "../src/turkey-adm3.js";

const BUILD_DATE = "2026-08-13T00:00:00.000Z";

describe("Turkey V2 national playable build", () => {
  it("creates a stable source lock for national ADM0-ADM2 and hybrid ADM3 inputs", () => {
    const first = sourceLock();
    const second = sourceLock();

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.adm0Adm2.levels.ADM1.actualFeatureCount).toBe(81);
    expect(first.adm0Adm2.levels.ADM2.expectedFeatureCount).toBe(973);
    expect(first.hybridPipeline.sourcePriority).toEqual(["official", "osm", "generated"]);
    expect(first.distribution.largeGeometryInNpmPackage).toBe(false);
  });

  it("builds generated national fallback coverage without embedding render artifacts", async () => {
    const result = await buildTurkeyV2NationalDataset({
      adm0Adm2Dataset: nationalFixture(),
      sourceLock: sourceLock(),
      buildDate: BUILD_DATE,
      datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
      generatedDefaults: generatedDefaults(),
      buildArtifacts: { adjacency: false, render: false, mvt: false }
    });
    const payloads = createTurkeyV2NationalArtifactPayloads({
      result,
      includeDataset: true,
      includeGeoJson: true,
      includeRender: false
    });

    expect(result.quality.ok).toBe(true);
    expect(result.coverage.provinceCount).toBe(81);
    expect(result.coverage.districtCount).toBe(2);
    expect(result.coverage.generatedZoneCount).toBeGreaterThan(0);
    expect(result.coverage.officialZoneCount).toBe(0);
    expect(result.coverage.finalCoveragePercent).toBeGreaterThanOrEqual(99.99);
    expect(result.registry.datasets[0].id).toBe(TURKEY_V2_NATIONAL_DATASET_ID);
    expect(payloads.json.has("dataset.json")).toBe(true);
    expect(payloads.json.has("levels/ADM3/full.geojson")).toBe(true);
    expect([...payloads.bytes.keys()]).toEqual([]);
  });

  it("applies official > OSM > generated priority in the national merge", async () => {
    const official = realAdm3Zone({
      id: "tr:adm3:official-a",
      parentId: "tr:adm2:01-a",
      sourceClass: "official",
      west: 0,
      south: 0,
      east: 0.4,
      north: 1
    });
    const osm = realAdm3Zone({
      id: "tr:adm3:osm-a",
      parentId: "tr:adm2:01-a",
      sourceClass: "osm",
      west: 0.3,
      south: 0,
      east: 0.7,
      north: 1
    });
    const result = await buildTurkeyV2NationalDataset({
      adm0Adm2Dataset: nationalFixture(),
      officialSources: { status: "artifact-loaded", zones: [official] },
      osmSources: { status: "artifact-loaded", zones: [osm] },
      sourceLock: sourceLock(),
      buildDate: BUILD_DATE,
      datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
      generatedDefaults: generatedDefaults(),
      buildArtifacts: { adjacency: false }
    });

    expect(result.quality.ok).toBe(true);
    expect(result.coverage.officialZoneCount).toBe(1);
    expect(result.coverage.osmZoneCount).toBe(1);
    expect(result.coverage.generatedZoneCount).toBeGreaterThan(0);
    expect(result.coverage.hybridDistricts).toContain("tr:adm2:01-a");
    expect(result.provenance.summary.sourceClasses).toMatchObject({
      official: 1,
      osm: 1
    });
    expect(result.distributionPolicy.policies.map((policy) => policy.license)).toContain(
      "ODbL-1.0"
    );
  });

  it("keeps national output deterministic when source district order changes", async () => {
    const first = await buildTurkeyV2NationalDataset({
      adm0Adm2Dataset: nationalFixture(),
      sourceLock: sourceLock(),
      buildDate: BUILD_DATE,
      datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
      generatedDefaults: generatedDefaults(),
      buildArtifacts: { adjacency: false }
    });
    const second = await buildTurkeyV2NationalDataset({
      adm0Adm2Dataset: nationalFixture({ reverseDistricts: true }),
      sourceLock: sourceLock(),
      buildDate: BUILD_DATE,
      datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
      generatedDefaults: generatedDefaults(),
      buildArtifacts: { adjacency: false }
    });

    expect(second.deterministicHash).toBe(first.deterministicHash);
    expect(second.levels.ADM3.zones.map((zone) => zone.id)).toEqual(
      first.levels.ADM3.zones.map((zone) => zone.id)
    );
  });
});

function sourceLock() {
  return createTurkeyV2NationalSourceLock({
    adm0Adm2: {
      provider: "hdx-cod-ab",
      sourceId: "cod-ab-tur",
      sourceUrl: "https://data.humdata.org/dataset/cod-ab-tur",
      downloadUrl: "https://data.humdata.org/dataset/cod-ab-tur/resource/fixture",
      sourceDate: "2026-01-26",
      retrievedAt: "2026-08-13T00:00:00.000Z",
      license: "CC BY-IGO",
      licenseUrl: "https://creativecommons.org/licenses/by/3.0/igo/",
      attribution: "OCHA COD-AB Türkiye",
      redistributionAllowed: true,
      commercialUseAllowed: true,
      modificationAllowed: true,
      sha256: "0".repeat(64),
      byteSize: 123,
      levels: {
        ADM0: levelLock("tur_admbnda_adm0.shp", 1, 1),
        ADM1: levelLock("tur_admbnda_adm1.shp", 81, 81),
        ADM2: levelLock("tur_admbnda_adm2.shp", 973, 2)
      }
    },
    buildDate: BUILD_DATE,
    datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
    generated: { seed: "national-test-seed" }
  });
}

function levelLock(
  archiveMember: string,
  expectedFeatureCount: number,
  actualFeatureCount: number
) {
  return {
    archiveMember,
    expectedFeatureCount,
    actualFeatureCount,
    sha256: "1".repeat(64),
    byteSize: expectedFeatureCount
  };
}

function generatedDefaults() {
  return {
    enabled: true,
    profile: "custom" as const,
    targetAreaKm2: 4000,
    minAreaKm2: 1,
    maxAreaKm2: 6000,
    maxZonesPerDistrict: 4,
    minFragmentAreaKm2: 1,
    seed: "national-test-seed"
  };
}

function nationalFixture(input: { reverseDistricts?: boolean } = {}): TerritoryDataset {
  const datasetId = "test-tr-national";
  const provinceIds = Array.from({ length: 81 }, (_, index) => provinceId(index + 1));
  const districtIds = ["tr:adm2:01-a", "tr:adm2:01-b"];
  const adm0 = admZone({
    id: "tr",
    datasetId,
    level: 0,
    sourceAdminLevel: "ADM0",
    semanticType: "country",
    name: "Turkiye",
    west: 0,
    south: 0,
    east: 90,
    north: 90,
    childIds: provinceIds,
    territory: {
      adminLevel: "ADM0",
      sourceAdminLevel: "ADM0",
      semanticType: "country",
      hierarchyDepth: 0,
      countryCode: "TR",
      localTypeName: "Ulke"
    }
  });
  const provinces = provinceIds.map((id, index) => {
    const code = String(index + 1).padStart(2, "0");
    const west = (index % 9) * 10;
    const south = Math.floor(index / 9) * 10;

    return admZone({
      id,
      datasetId,
      level: 1,
      sourceAdminLevel: "ADM1",
      semanticType: "province",
      name: `Province ${code}`,
      west,
      south,
      east: west + 10,
      north: south + 10,
      parentId: "tr",
      childIds: code === "01" ? districtIds : [],
      territory: {
        adminLevel: "ADM1",
        sourceAdminLevel: "ADM1",
        semanticType: "province",
        hierarchyDepth: 1,
        parentId: "tr",
        countryCode: "TR",
        provinceCode: code,
        localTypeName: "Il",
        codes: { source: `TR${code}` }
      }
    });
  });
  const districts = [
    admZone({
      id: "tr:adm2:01-a",
      datasetId,
      level: 2,
      sourceAdminLevel: "ADM2",
      semanticType: "district",
      name: "District A",
      west: 0,
      south: 0,
      east: 1,
      north: 1,
      parentId: "tr:adm1:tr-01",
      territory: districtTerritory("01", "001", "tr:adm1:tr-01")
    }),
    admZone({
      id: "tr:adm2:01-b",
      datasetId,
      level: 2,
      sourceAdminLevel: "ADM2",
      semanticType: "district",
      name: "District B",
      west: 1,
      south: 0,
      east: 2,
      north: 1,
      parentId: "tr:adm1:tr-01",
      territory: districtTerritory("01", "002", "tr:adm1:tr-01")
    })
  ];

  return {
    manifest: {
      datasetId,
      datasetVersion: "fixture",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-01-26",
      buildDate: BUILD_DATE,
      geometryHash: "fixture-tr-national",
      adminLevels: ["ADM0", "ADM1", "ADM2"],
      countryCodes: ["TR"],
      crs: "EPSG:4326",
      geometryDetail: "source",
      license: "CC BY-IGO",
      attribution: "Fixture"
    },
    zones: [adm0, ...provinces, ...(input.reverseDistricts ? [...districts].reverse() : districts)]
  };
}

function admZone(input: {
  id: string;
  datasetId: string;
  level: number;
  sourceAdminLevel: TerritoryAdminLevel;
  semanticType: TerritorySemanticAdminType;
  name: string;
  west: number;
  south: number;
  east: number;
  north: number;
  parentId?: string;
  childIds?: string[];
  territory: Record<string, unknown>;
}): TerritoryZone {
  return createSquareZone({
    id: input.id,
    datasetId: input.datasetId,
    countryCode: "TR",
    level: input.level,
    sourceAdminLevel: input.sourceAdminLevel,
    semanticType: input.semanticType,
    name: input.name,
    west: input.west,
    south: input.south,
    east: input.east,
    north: input.north,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    ...(input.childIds ? { childIds: input.childIds } : {}),
    properties: {
      territory: {
        semanticReviewStatus: "reviewed",
        coverageStatus: "verified",
        ...input.territory
      }
    }
  });
}

function districtTerritory(
  provinceCode: string,
  districtCode: string,
  parentId: string
): Record<string, unknown> {
  return {
    adminLevel: "ADM2",
    sourceAdminLevel: "ADM2",
    semanticType: "district",
    hierarchyDepth: 2,
    parentId,
    countryCode: "TR",
    provinceCode,
    districtCode,
    localTypeName: "Ilce",
    codes: { source: `TR${provinceCode}${districtCode}` }
  };
}

function provinceId(index: number): string {
  return `tr:adm1:tr-${String(index).padStart(2, "0")}`;
}

function realAdm3Zone(input: {
  id: string;
  parentId: string;
  sourceClass: TerritorySourceClass;
  west: number;
  south: number;
  east: number;
  north: number;
}): TerritoryZone {
  const isOsm = input.sourceClass === "osm";
  const providerId = isOsm ? "openstreetmap" : "fixture-official";
  const license = isOsm ? "ODbL-1.0" : "CC BY 4.0";
  const attribution = isOsm ? "OpenStreetMap contributors, ODbL 1.0" : "Fixture official source";

  return createSquareZone({
    id: input.id,
    datasetId: "test-tr-adm3",
    countryCode: "TR",
    level: 3,
    sourceAdminLevel: "ADM3",
    semanticType: "neighbourhood",
    name: input.id,
    parentId: input.parentId,
    west: input.west,
    south: input.south,
    east: input.east,
    north: input.north,
    properties: {
      territory: {
        adminLevel: "ADM3",
        sourceAdminLevel: "ADM3",
        semanticType: "neighbourhood",
        localType: "neighbourhood",
        localTypeName: "Mahalle",
        hierarchyDepth: 3,
        parentId: input.parentId,
        countryCode: "TR",
        provinceCode: "01",
        districtCode: "001",
        sourceClass: input.sourceClass,
        providerClass: input.sourceClass,
        providerId,
        providerName: providerId,
        sourceProvider: providerId,
        sourceDatasetId: providerId,
        sourceNativeId: input.id,
        sourceDate: "2026-08-01",
        sourceUrl: isOsm ? "https://www.openstreetmap.org/" : "https://data.example.test/tr/adm3",
        license,
        attribution,
        official: input.sourceClass === "official",
        generated: false,
        semanticReviewStatus: "reviewed",
        coverageStatus: "verified",
        stableId: input.id,
        redistributionPolicy: "allowed",
        commercialUsePolicy: "allowed",
        modificationPolicy: "allowed",
        source: {
          provider: providerId,
          sourceClass: input.sourceClass,
          sourceDatasetId: providerId,
          sourceId: input.id,
          sourceNativeId: input.id,
          sourceDate: "2026-08-01",
          sourceUrl: isOsm ? "https://www.openstreetmap.org/" : "https://data.example.test/tr/adm3",
          license,
          attribution
        }
      }
    }
  });
}
