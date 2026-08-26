import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { computeGeometryBBox, validateGeometryDataset } from "@territory-kit/dataset";
import { createSquareZone } from "@territory-kit/shared-testkit";
import type {
  TerritoryAdminLevel,
  TerritoryDataset,
  TerritoryGeometry,
  TerritorySemanticAdminType,
  TerritorySourceClass,
  TerritoryZone
} from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  TURKEY_V2_ADM0_EXPECTED_COUNT,
  TURKEY_V2_ADM1_EXPECTED_COUNT,
  TURKEY_V2_ADM2_EXPECTED_COUNT,
  TURKEY_V2_NATIONAL_DATASET_ID,
  TURKEY_V2_NATIONAL_DATASET_VERSION,
  buildTurkeyV2NationalDataset,
  createTurkeyV2NationalArtifactPayloads,
  createTurkeyV2NationalSourceLock,
  validateTurkeyV2NationalArtifactIntegrity,
  validateTurkeyV2NationalCompleteness
} from "../src/turkey-adm3.js";

const BUILD_DATE = "2026-08-22T00:00:00.000Z";

describe("Turkey V2 national playable build", () => {
  describe("National completeness constants", () => {
    it("defines correct ADM0 expected count", () => {
      expect(TURKEY_V2_ADM0_EXPECTED_COUNT).toBe(1);
    });

    it("defines correct ADM1 expected count", () => {
      expect(TURKEY_V2_ADM1_EXPECTED_COUNT).toBe(81);
    });

    it("defines correct ADM2 expected count", () => {
      expect(TURKEY_V2_ADM2_EXPECTED_COUNT).toBe(973);
    });
  });

  describe("Build mode determination", () => {
    it("sets buildMode to 'partial' when districtLimit is provided", async () => {
      const result = await buildTurkeyV2NationalDataset({
        adm0Adm2Dataset: nationalFixture(),
        sourceLock: sourceLock(),
        buildDate: BUILD_DATE,
        datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
        generatedDefaults: generatedDefaults(),
        buildArtifacts: { adjacency: false, render: false, mvt: false },
        districtLimit: 50
      });

      expect(result.quality.buildMode).toBe("partial");
    });

    it("keeps normal generator builds in diagnostic partial mode", async () => {
      const result = await buildTurkeyV2NationalDataset({
        adm0Adm2Dataset: nationalFixture(),
        sourceLock: sourceLock(),
        buildDate: BUILD_DATE,
        datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
        generatedDefaults: generatedDefaults(),
        buildArtifacts: { adjacency: false, render: false, mvt: false }
      });

      expect(result.quality.buildMode).toBe("partial");
      expect(result.quality.ok).toBe(true);
      expect(result.quality.publishReady).toBe(false);
    });

    it("runs strict publish-ready gates only for uncapped publish-ready builds", async () => {
      const result = await buildTurkeyV2NationalDataset({
        adm0Adm2Dataset: nationalFixture(),
        sourceLock: sourceLock(),
        buildDate: BUILD_DATE,
        datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
        generatedDefaults: generatedDefaults(),
        outputMode: "publish-ready",
        buildArtifacts: { adjacency: false, render: false, mvt: false }
      });

      expect(result.quality.buildMode).toBe("publish-ready");
      expect(result.quality.ok).toBe(true);
      expect(result.quality.publishReady).toBe(false);
      expect(result.quality.publishReadyGateFailures).toContain("nationalCompleteness");
    });
  });

  describe("Constants usage in validation logic", () => {
    it("uses TURKEY_V2_ADM0_EXPECTED_COUNT in adm0Count gate validation", async () => {
      const result = await buildTurkeyV2NationalDataset({
        adm0Adm2Dataset: nationalFixture(),
        sourceLock: sourceLock(),
        buildDate: BUILD_DATE,
        datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
        generatedDefaults: generatedDefaults(),
        buildArtifacts: { adjacency: false, render: false, mvt: false }
      });

      expect(result.quality.gates.adm0Count).toBe(true);
      expect(result.quality.summary.adm0Count).toBe(TURKEY_V2_ADM0_EXPECTED_COUNT);
    });

    it("uses TURKEY_V2_ADM1_EXPECTED_COUNT in adm1Count gate validation", async () => {
      const result = await buildTurkeyV2NationalDataset({
        adm0Adm2Dataset: nationalFixture(),
        sourceLock: sourceLock(),
        buildDate: BUILD_DATE,
        datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
        generatedDefaults: generatedDefaults(),
        buildArtifacts: { adjacency: false, render: false, mvt: false }
      });

      expect(result.quality.gates.adm1Count).toBe(true);
      expect(result.coverage.provinceCount).toBe(TURKEY_V2_ADM1_EXPECTED_COUNT);
    });

    it("accepts exactly 1/81/973 in strict national completeness validation", () => {
      const validation = validateTurkeyV2NationalCompleteness({
        coverage: coverageFixture({
          adm0Count: 1,
          provinceCount: 81,
          districtCount: 973,
          successfulDistrictCount: 973,
          failedDistrictCount: 0
        }),
        quality: { ok: true, buildMode: "publish-ready", publishReady: true },
        sourceLock: sourceLockWithDistrictCount(973),
        strictPublishReady: true
      });

      expect(validation.ok).toBe(true);
    });

    it("rejects 972 or 974 ADM2 records in strict national completeness validation", () => {
      for (const districtCount of [972, 974]) {
        const validation = validateTurkeyV2NationalCompleteness({
          coverage: coverageFixture({
            adm0Count: 1,
            provinceCount: 81,
            districtCount,
            successfulDistrictCount: districtCount,
            failedDistrictCount: 0
          }),
          quality: { ok: true, buildMode: "publish-ready", publishReady: true },
          sourceLock: sourceLockWithDistrictCount(districtCount),
          strictPublishReady: true
        });

        expect(validation.ok).toBe(false);
        expect(validation.errors.map((error) => error.code)).toContain(
          "NATIONAL_ADM2_COUNT_MISMATCH"
        );
      }
    });

    it("rejects failed districts, source-lock mismatches, uncovered districts, and partial builds", () => {
      const failedDistrict = validateTurkeyV2NationalCompleteness({
        coverage: coverageFixture({
          adm0Count: 1,
          provinceCount: 81,
          districtCount: 973,
          successfulDistrictCount: 972,
          failedDistrictCount: 1
        }),
        quality: { ok: true, buildMode: "publish-ready", publishReady: true },
        sourceLock: sourceLockWithDistrictCount(973),
        strictPublishReady: true
      });

      const sourceLockMismatch = validateTurkeyV2NationalCompleteness({
        coverage: coverageFixture({
          adm0Count: 1,
          provinceCount: 81,
          districtCount: 973,
          successfulDistrictCount: 973,
          failedDistrictCount: 0
        }),
        quality: { ok: true, buildMode: "publish-ready", publishReady: true },
        sourceLock: sourceLockWithDistrictCount(972),
        strictPublishReady: true
      });

      const noAdm3 = validateTurkeyV2NationalCompleteness({
        coverage: coverageFixture({
          adm0Count: 1,
          provinceCount: 81,
          districtCount: 973,
          successfulDistrictCount: 973,
          failedDistrictCount: 0,
          districts: [{ districtId: "tr:adm2:01-a", zoneCount: 0, finalCoveragePercent: 100 }]
        }),
        quality: { ok: true, buildMode: "publish-ready", publishReady: true },
        sourceLock: sourceLockWithDistrictCount(973),
        strictPublishReady: true
      });

      const partial = validateTurkeyV2NationalCompleteness({
        coverage: coverageFixture({
          adm0Count: 1,
          provinceCount: 81,
          districtCount: 2,
          successfulDistrictCount: 2,
          failedDistrictCount: 0
        }),
        quality: { ok: true, buildMode: "partial", publishReady: false },
        sourceLock: sourceLock(),
        strictPublishReady: true
      });

      expect(failedDistrict.errors.map((error) => error.code)).toEqual(
        expect.arrayContaining([
          "NATIONAL_SUCCESSFUL_ADM2_COUNT_MISMATCH",
          "NATIONAL_FAILED_DISTRICT_COUNT_NONZERO"
        ])
      );
      expect(sourceLockMismatch.errors.map((error) => error.code)).toContain(
        "NATIONAL_SOURCE_LOCK_ACTUAL_COUNT_MISMATCH"
      );
      expect(noAdm3.errors.map((error) => error.code)).toContain("NATIONAL_DISTRICT_WITHOUT_ADM3");
      expect(partial.errors.map((error) => error.code)).toContain("NATIONAL_PARTIAL_BUILD");
    });
  });

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
      buildArtifacts: { adjacency: false, render: false, mvt: false },
      districtLimit: 2
    });
    const payloads = createTurkeyV2NationalArtifactPayloads({
      result,
      includeDataset: true,
      includeGeoJson: true,
      includeRender: false
    });

    expect(result.quality.ok).toBe(true);
    expect(result.quality.publishReady).toBe(false);
    expect(result.coverage.provinceCount).toBe(81);
    expect(result.coverage.districtCount).toBe(2);
    expect(result.coverage.generatedZoneCount).toBeGreaterThan(0);
    expect(result.coverage.districts.map((district) => district.availabilityStatus)).toEqual([
      "estimated",
      "estimated"
    ]);
    expect(result.coverage.districts.map((district) => district.availabilityReasonCode)).toEqual([
      "smart-derived-fallback",
      "smart-derived-fallback"
    ]);
    expect(result.coverage.provinces[0]).toMatchObject({
      availabilityStatus: "estimated",
      availabilityReasonCodes: ["smart-derived-fallback"],
      adm2AvailabilityStatusCounts: expect.objectContaining({ estimated: 2 })
    });
    expect(result.levels.ADM3.zones[0]?.properties.territory).toMatchObject({
      boundaryKind: "estimated",
      boundarySourceClass: "smart-derived",
      confidence: "medium",
      administrative: false,
      licenseState: "approved",
      sourceSnapshotChecksum: expect.any(String)
    });
    expect(result.coverage.officialZoneCount).toBe(0);
    expect(result.coverage.finalCoveragePercent).toBeGreaterThanOrEqual(99.99);
    expect(result.coverage.districts.every((district) => district.qualityStatus === "ok")).toBe(
      true
    );
    expect(result.coverage.provinces.every((province) => province.qualityStatus === "ok")).toBe(
      true
    );
    expect(
      result.coverage.provinces.every(
        (province) => province.successfulDistrictCount === province.districtCount
      )
    ).toBe(true);
    expect(
      Object.values(result.levels).every((levelDataset) =>
        levelDataset.zones.every((zone) => zone.datasetId === levelDataset.manifest.datasetId)
      )
    ).toBe(true);
    expect(
      Object.values(result.levels).every((levelDataset) =>
        levelDataset.zones.every((zone) => !zone.parentId && !zone.childIds)
      )
    ).toBe(true);
    expect(result.registry.datasets[0].id).toBe(TURKEY_V2_NATIONAL_DATASET_ID);
    expect(result.registry.datasets[0]).toMatchObject({
      version: "2.0.0",
      prerelease: false
    });
    expect(payloads.json.has("dataset.json")).toBe(true);
    expect(payloads.json.has("levels/ADM3/full.geojson")).toBe(true);
    expect([...payloads.bytes.keys()]).toEqual([]);
    expect(result.registry.datasets[0].artifacts.map((artifact) => artifact.id)).not.toContain(
      "adm3-render-manifest"
    );
    expect(result.registry.datasets[0].artifacts.map((artifact) => artifact.id)).not.toContain(
      "adm3-adjacency"
    );
    expect(
      result.registry.datasets[0].artifacts.every(
        (artifact) => /^[a-f0-9]{64}$/.test(artifact.sha256) && artifact.sizeBytes > 0
      )
    ).toBe(true);

    const qualityPayload = payloads.json.get("quality-report.json");
    const qualityBytes = `${JSON.stringify(qualityPayload, null, 2)}\n`;
    expect(result.checksums.files["quality-report.json"]).toEqual({
      sha256: sha256(qualityBytes),
      byteSize: Buffer.byteLength(qualityBytes)
    });
  });

  it("derives registry prerelease metadata from dataset semver", async () => {
    const result = await buildTurkeyV2NationalDataset({
      adm0Adm2Dataset: nationalFixture(),
      sourceLock: sourceLock({ datasetVersion: "2.0.1-rc.1" }),
      buildDate: BUILD_DATE,
      datasetVersion: "2.0.1-rc.1",
      generatedDefaults: generatedDefaults(),
      buildArtifacts: { adjacency: false, render: false, mvt: false },
      districtLimit: 1
    });

    expect(result.registry.datasets[0]).toMatchObject({
      version: "2.0.1-rc.1",
      prerelease: true
    });
  });

  it("uses representative centers covered by concave national and generated geometries", async () => {
    const fixture = nationalFixture({ donutDistrict: true });
    const result = await buildTurkeyV2NationalDataset({
      adm0Adm2Dataset: fixture,
      sourceLock: sourceLock(),
      buildDate: BUILD_DATE,
      datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
      generatedDefaults: {
        ...generatedDefaults(),
        targetAreaKm2: 500,
        maxAreaKm2: 2000,
        maxZonesPerDistrict: 2
      },
      buildArtifacts: { adjacency: false, render: false, mvt: false },
      districtLimit: 1
    });
    const centerValidation = validateGeometryDataset(result.dataset, {
      checks: {
        coordinates: false,
        rings: false,
        selfIntersections: false,
        holes: false,
        bbox: true,
        center: true,
        antimeridian: false,
        parentContainment: false,
        siblingOverlaps: false
      }
    });

    expect(centerValidation.issues).toEqual([]);
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
      buildArtifacts: { adjacency: false },
      districtLimit: 2
    });

    expect(result.quality.ok).toBe(true);
    expect(result.coverage.officialZoneCount).toBe(1);
    expect(result.coverage.osmZoneCount).toBe(1);
    expect(result.coverage.generatedZoneCount).toBeGreaterThan(0);
    expect(result.coverage.hybridDistricts).toContain("tr:adm2:01-a");
    expect(
      result.coverage.districts.find((district) => district.districtId === "tr:adm2:01-a")
    ).toMatchObject({
      availabilityStatus: "mixed",
      availabilityReasonCode: "mixed-source-priority"
    });
    expect(result.provenance.summary.sourceClasses).toMatchObject({
      official: 1,
      osm: 1
    });
    expect(result.provenance.zones.find((zone) => zone.sourceClass === "official")).toMatchObject({
      boundaryKind: "administrative",
      boundarySourceClass: "official-local",
      confidence: "authoritative",
      licenseState: "approved"
    });
    expect(result.provenance.zones.find((zone) => zone.sourceClass === "osm")).toMatchObject({
      boundaryKind: "administrative",
      boundarySourceClass: "osm-administrative",
      confidence: "high",
      licenseState: "approved"
    });
    expect(result.distributionPolicy.policies.map((policy) => policy.license)).toContain(
      "ODbL-1.0"
    );
  });

  it("validates generated registry artifacts against the filesystem", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-generator-tr-v2-integrity-"));

    try {
      const result = await buildTurkeyV2NationalDataset({
        adm0Adm2Dataset: nationalFixture(),
        sourceLock: sourceLock(),
        buildDate: BUILD_DATE,
        datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
        generatedDefaults: generatedDefaults(),
        buildArtifacts: { adjacency: false, render: false, mvt: false },
        districtLimit: 2
      });
      await writePayloads(
        tempDir,
        createTurkeyV2NationalArtifactPayloads({
          result,
          includeDataset: true,
          includeGeoJson: true,
          includeRender: false
        })
      );

      const valid = await validateTurkeyV2NationalArtifactIntegrity({
        registry: result.registry,
        checksums: result.checksums,
        outputRoot: tempDir,
        mandatoryArtifactIds: ["dataset", "coverage", "quality", "query", "adm3"]
      });
      expect(valid.ok).toBe(true);

      await writeFile(join(tempDir, "dataset.json"), '{"tampered":true}\n', "utf8");
      const tampered = await validateTurkeyV2NationalArtifactIntegrity({
        registry: result.registry,
        checksums: result.checksums,
        outputRoot: tempDir,
        mandatoryArtifactIds: ["dataset", "coverage", "quality", "query", "adm3"]
      });
      expect(tampered.errors.map((error) => error.code)).toContain("CHECKSUM_MISMATCH");

      await rm(join(tempDir, "coverage.json"), { force: true });
      const missing = await validateTurkeyV2NationalArtifactIntegrity({
        registry: result.registry,
        checksums: result.checksums,
        outputRoot: tempDir,
        mandatoryArtifactIds: ["dataset", "coverage", "quality", "query", "adm3"]
      });
      expect(missing.errors.map((error) => error.code)).toContain("MISSING_ARTIFACT");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects duplicate, unsafe, missing-checksum, and zero-byte registry metadata", async () => {
    const result = await buildTurkeyV2NationalDataset({
      adm0Adm2Dataset: nationalFixture(),
      sourceLock: sourceLock(),
      buildDate: BUILD_DATE,
      datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
      generatedDefaults: generatedDefaults(),
      buildArtifacts: { adjacency: false, render: false, mvt: false },
      districtLimit: 2
    });
    const duplicate = {
      ...result.registry,
      datasets: [
        {
          ...result.registry.datasets[0],
          artifacts: [
            ...result.registry.datasets[0].artifacts,
            { ...result.registry.datasets[0].artifacts[0]!, path: "../escape.json" },
            {
              ...result.registry.datasets[0].artifacts[1]!,
              id: result.registry.datasets[0].artifacts[0]!.id
            },
            { ...result.registry.datasets[0].artifacts[2]!, sha256: "", sizeBytes: 0 }
          ]
        }
      ]
    };
    const validation = await validateTurkeyV2NationalArtifactIntegrity({
      registry: duplicate,
      checksums: result.checksums,
      mandatoryArtifactIds: ["dataset", "coverage", "quality", "query", "adm3"]
    });

    expect(validation.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_ARTIFACT_ID",
        "DUPLICATE_ARTIFACT_PATH",
        "UNSAFE_ARTIFACT_PATH",
        "MISSING_CHECKSUM",
        "EMPTY_ARTIFACT"
      ])
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

function sourceLock(input: { datasetVersion?: string } = {}) {
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
    datasetVersion: input.datasetVersion ?? TURKEY_V2_NATIONAL_DATASET_VERSION,
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

function nationalFixture(
  input: { reverseDistricts?: boolean; donutDistrict?: boolean } = {}
): TerritoryDataset {
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
  const donut = donutGeometry();
  const provinces = provinceIds.map((id, index) => {
    const code = String(index + 1).padStart(2, "0");
    const west = (index % 9) * 10;
    const south = Math.floor(index / 9) * 10;

    const zone = admZone({
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

    return input.donutDistrict && code === "01" ? withGeometry(zone, donut) : zone;
  });
  const districtA = admZone({
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
  });
  const districts = [
    input.donutDistrict ? withGeometry(districtA, donut) : districtA,
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

function withGeometry(zone: TerritoryZone, geometry: TerritoryGeometry): TerritoryZone {
  return {
    ...zone,
    geometry,
    bbox: computeGeometryBBox(geometry)
  };
}

function donutGeometry(): TerritoryGeometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [0, 0]
      ],
      [
        [1, 1],
        [1, 3],
        [3, 3],
        [3, 1],
        [1, 1]
      ]
    ]
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

function coverageFixture(input: {
  adm0Count: number;
  provinceCount: number;
  districtCount: number;
  successfulDistrictCount: number;
  failedDistrictCount: number;
  districts?: Array<{ districtId: string; zoneCount: number; finalCoveragePercent: number }>;
}) {
  return {
    schemaVersion: "territorykit-tr-v2-national-coverage@1",
    datasetId: TURKEY_V2_NATIONAL_DATASET_ID,
    datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
    buildDate: BUILD_DATE,
    sourceLockHash: sourceLockWithDistrictCount(input.districtCount).contentHash,
    deterministicHash: "fixture",
    adm0Count: input.adm0Count,
    provinceCount: input.provinceCount,
    districtCount: input.districtCount,
    successfulDistrictCount: input.successfulDistrictCount,
    failedDistrictCount: input.failedDistrictCount,
    finalCoveragePercent: 100,
    districts: input.districts ?? []
  };
}

async function writePayloads(
  root: string,
  payloads: ReturnType<typeof createTurkeyV2NationalArtifactPayloads>
): Promise<void> {
  for (const [path, payload] of payloads.json.entries()) {
    await writeFixtureFile(join(root, path), `${JSON.stringify(payload, null, 2)}\n`);
  }
  for (const [path, payload] of payloads.text.entries()) {
    await writeFixtureFile(join(root, path), payload.endsWith("\n") ? payload : `${payload}\n`);
  }
  for (const [path, payload] of payloads.bytes.entries()) {
    await writeFixtureFile(join(root, path), payload);
  }
}

async function writeFixtureFile(path: string, payload: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, payload);
}

function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Helper to create a source lock with a specific district count.
 */
function sourceLockWithDistrictCount(districtCount: number) {
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
        ADM2: levelLock("tur_admbnda_adm2.shp", districtCount, districtCount)
      }
    },
    buildDate: BUILD_DATE,
    datasetVersion: TURKEY_V2_NATIONAL_DATASET_VERSION,
    generated: { seed: "national-test-seed" }
  });
}
