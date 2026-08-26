import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTerritoryDataset } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  TURKEY_ADM3_SOURCE_CATALOG_SCHEMA_VERSION,
  TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS,
  buildTerritoryCountryDatasetPath,
  createTerritoryCountrySourceLock,
  createTurkeyAdm3StableKey,
  createTurkeyAdm3TerritoryId,
  parseTurkeyGaziantepAdm3Kml,
  serializeJsonStable,
  sha256Hex,
  verifyTerritoryCountrySourceLock
} from "../src/index.js";
import type { TerritoryAdminLevel } from "@territory-kit/dataset";
import type { TurkeyAdm3SourceCatalog } from "../src/index.js";

const BUILD_DATE = "2026-07-28T00:00:00.000Z";

describe("Turkey ADM3 ingestion infrastructure", () => {
  it("locks and builds partial ADM3 coverage from two province providers", async () => {
    const fixture = await createTurkeyAdm3Fixture();

    try {
      const sourceLockPath = join(fixture.tempDir, "sources.lock.json");
      const outputPath = join(fixture.tempDir, "artifact");
      const lockResult = await createTerritoryCountrySourceLock({
        country: "TR",
        levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
        metadataPath: fixture.nationalMetadataPath,
        adm3CatalogPath: fixture.adm3CatalogPath,
        adm3Provinces: ["27", "54"],
        outputPath: sourceLockPath,
        buildDate: BUILD_DATE
      });

      expect(lockResult.issues).toEqual([]);
      expect(lockResult.lock?.extensions?.turkeyAdm3).toMatchObject({
        summary: {
          availableProvinceCount: 2,
          coverageStatus: "partial",
          sourceFeatureCount: 3
        }
      });
      expect(lockResult.lock?.levels.ADM3).toMatchObject({
        status: "available",
        sourceFeatureCount: 3,
        boundarySourceClass: "official-local",
        licenseState: "approved",
        sourceSnapshotChecksum: lockResult.lock?.levels.ADM3?.sha256
      });
      expect(lockResult.lock && (await verifyTerritoryCountrySourceLock(lockResult.lock)).ok).toBe(
        true
      );

      const build = await buildTerritoryCountryDatasetPath({
        country: "TR",
        sourceLockPath,
        outputPath,
        levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
        allowPartial: true,
        strict: true,
        buildDate: BUILD_DATE
      });

      const errorIssues = build.issues.filter((issue) => issue.severity === "error");
      expect(errorIssues).toEqual([]);
      expect(build.manifest.supportedLevels).toEqual(["ADM0", "ADM1", "ADM2", "ADM3"]);
      expect(build.manifest.featureCountByLevel.ADM3).toBe(3);
      expect(build.manifest.publishReady).toBe(true);

      const dataset = loadTerritoryDataset(
        JSON.parse(await readFile(join(outputPath, "dataset.json"), "utf8")) as unknown
      );
      const adm3 = dataset.zones.filter((zone) => zone.sourceAdminLevel === "ADM3");

      expect(adm3.map((zone) => zone.name).sort()).toEqual(["Ataturk", "Merkez", "Merkez"]);
      expect(new Set(adm3.map((zone) => zone.id)).size).toBe(3);
      expect(adm3.find((zone) => zone.name === "Ataturk")?.parentId).toBe("tr:adm2:tr54a");
      expect(
        adm3
          .filter((zone) => zone.name === "Merkez")
          .map((zone) => zone.parentId)
          .sort()
      ).toEqual(["tr:adm2:tr27a", "tr:adm2:tr27b"]);

      const coverage = JSON.parse(await readFile(join(outputPath, "coverage.json"), "utf8")) as {
        nationalCoverageClaim: boolean;
        provinces: Record<string, { featureCount: number; status: string; fallbackLevel: string }>;
      };

      expect(coverage.nationalCoverageClaim).toBe(false);
      expect(coverage.provinces["27"]).toMatchObject({
        featureCount: 2,
        status: "built",
        fallbackLevel: "ADM2"
      });
      expect(coverage.provinces["54"]).toMatchObject({
        featureCount: 1,
        status: "built",
        fallbackLevel: "ADM2"
      });
      await expect(
        readFile(join(outputPath, "adm3-source-provenance-report.json"), "utf8")
      ).resolves.toContain("fixture-provider-27");
      await expect(
        readFile(join(outputPath, "adm3-quality-gates.json"), "utf8")
      ).resolves.toContain("territorykit-tr-adm3-quality@1");
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("keeps ADM3 stable IDs deterministic across source and coordinate order changes", async () => {
    const first = await createTurkeyAdm3Fixture();
    const second = await createTurkeyAdm3Fixture({
      reverseAdm3FeatureOrder: true,
      reverseRings: true
    });

    try {
      const firstIds = await buildAdm3Ids(first);
      const secondIds = await buildAdm3Ids(second);

      expect(firstIds).toEqual(secondIds);
      expect(
        createTurkeyAdm3StableKey({
          provinceCode: "27",
          parentKey: "TR27A",
          sourceId: "1",
          name: "İstiklal"
        })
      ).toBe(
        createTurkeyAdm3StableKey({
          provinceCode: "TR-27",
          parentKey: "TR27A",
          sourceId: "1",
          name: "ISTIKLAL"
        })
      );
      expect(
        createTurkeyAdm3TerritoryId({
          provinceCode: "27",
          parentKey: "tr:adm2:tr27a",
          sourceId: "1",
          name: "Merkez"
        })
      ).toContain("tr:adm3:tr-il-27-adm2-tr27a-1");
    } finally {
      await rm(first.tempDir, { recursive: true, force: true });
      await rm(second.tempDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("serializes ADM3 source-lock metadata deterministically", async () => {
    const fixture = await createTurkeyAdm3Fixture();

    try {
      const first = await createTerritoryCountrySourceLock({
        country: "TR",
        levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
        metadataPath: fixture.nationalMetadataPath,
        adm3CatalogPath: fixture.adm3CatalogPath,
        adm3Provinces: ["27", "54"],
        buildDate: BUILD_DATE
      });
      const second = await createTerritoryCountrySourceLock({
        country: "TR",
        levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
        metadataPath: fixture.nationalMetadataPath,
        adm3CatalogPath: fixture.adm3CatalogPath,
        adm3Provinces: ["27", "54"],
        buildDate: BUILD_DATE
      });

      expect(first.issues).toEqual([]);
      expect(second.issues).toEqual([]);
      expect(first.lock).toBeDefined();
      expect(second.lock).toBeDefined();
      expect(serializeJsonStable(first.lock)).toBe(serializeJsonStable(second.lock));
      expect(first.lock?.levels.ADM3).toMatchObject({
        status: "available",
        boundarySourceClass: "official-local",
        licenseState: "approved",
        sourceSnapshotChecksum: first.lock?.levels.ADM3?.sha256
      });
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("fails strict builds when an ADM3 parent cannot be resolved", async () => {
    const fixture = await createTurkeyAdm3Fixture({ missingParentMapping: true });

    try {
      const sourceLockPath = join(fixture.tempDir, "sources.lock.json");
      await createTerritoryCountrySourceLock({
        country: "TR",
        levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
        metadataPath: fixture.nationalMetadataPath,
        adm3CatalogPath: fixture.adm3CatalogPath,
        adm3Provinces: ["27"],
        outputPath: sourceLockPath,
        buildDate: BUILD_DATE
      });

      await expect(
        buildTerritoryCountryDatasetPath({
          country: "TR",
          sourceLockPath,
          outputPath: join(fixture.tempDir, "artifact"),
          levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
          strict: true,
          buildDate: BUILD_DATE
        })
      ).resolves.toMatchObject({
        manifest: expect.any(Object),
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "TR_ADM3_PARENT_MAPPING_MISSING" })
        ])
      });
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("isolates unavailable provinces behind ADM2 fallback when --allow-partial is used", async () => {
    const fixture = await createTurkeyAdm3Fixture();

    try {
      const sourceLockPath = join(fixture.tempDir, "sources.lock.json");
      const outputPath = join(fixture.tempDir, "artifact");
      const lockResult = await createTerritoryCountrySourceLock({
        country: "TR",
        levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
        metadataPath: fixture.nationalMetadataPath,
        adm3CatalogPath: fixture.adm3CatalogPath,
        adm3Provinces: ["27", "99"],
        outputPath: sourceLockPath,
        buildDate: BUILD_DATE
      });

      expect(lockResult.issues).toEqual([
        expect.objectContaining({ code: "TR_ADM3_PROVINCE_SOURCE_NOT_FOUND" })
      ]);

      const build = await buildTerritoryCountryDatasetPath({
        country: "TR",
        sourceLockPath,
        outputPath,
        levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
        allowPartial: true,
        allowNonPublishReady: true,
        buildDate: BUILD_DATE
      });

      expect(build.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "TR_ADM3_PROVINCE_UNAVAILABLE",
            severity: "warning"
          })
        ])
      );
      const coverage = JSON.parse(await readFile(join(outputPath, "coverage.json"), "utf8")) as {
        provinces: Record<
          string,
          { status: string; featureCount: number; fallbackReason?: string }
        >;
      };

      expect(coverage.provinces["99"]).toMatchObject({
        status: "source-unavailable",
        featureCount: 0
      });
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("blocks source locks on checksum mismatch or missing production license metadata", async () => {
    const checksumFixture = await createTurkeyAdm3Fixture({ corruptAdm3Checksum: true });
    const licenseFixture = await createTurkeyAdm3Fixture({ omitAdm3License: true });

    try {
      await expect(
        createTerritoryCountrySourceLock({
          country: "TR",
          levels: ["ADM3"],
          adm3CatalogPath: checksumFixture.adm3CatalogPath,
          adm3Provinces: ["27"],
          buildDate: BUILD_DATE
        })
      ).resolves.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "TR_ADM3_SOURCE_CHECKSUM_MISMATCH" })
        ])
      });

      await expect(
        createTerritoryCountrySourceLock({
          country: "TR",
          levels: ["ADM3"],
          adm3CatalogPath: licenseFixture.adm3CatalogPath,
          adm3Provinces: ["27"],
          buildDate: BUILD_DATE
        })
      ).resolves.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "TR_ADM3_SOURCE_LICENSE_MISSING" })
        ])
      });
    } finally {
      await rm(checksumFixture.tempDir, { recursive: true, force: true });
      await rm(licenseFixture.tempDir, { recursive: true, force: true });
    }
  });

  it("reports blocker quality issues for broken ADM3 geometry", async () => {
    const fixture = await createTurkeyAdm3Fixture({ brokenGeometry: true });

    try {
      const sourceLockPath = join(fixture.tempDir, "sources.lock.json");
      await createTerritoryCountrySourceLock({
        country: "TR",
        levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
        metadataPath: fixture.nationalMetadataPath,
        adm3CatalogPath: fixture.adm3CatalogPath,
        adm3Provinces: ["27"],
        outputPath: sourceLockPath,
        buildDate: BUILD_DATE
      });

      const build = await buildTerritoryCountryDatasetPath({
        country: "TR",
        sourceLockPath,
        outputPath: join(fixture.tempDir, "artifact"),
        levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
        buildDate: BUILD_DATE
      });

      expect(build.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: expect.stringContaining("TR_ADM3_")
          })
        ])
      );
      expect(build.manifest.publishReady).toBe(false);
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("runs the Gaziantep KML pilot through the generic ADM3 catalog pipeline", async () => {
    const fixture = await createGaziantepGenericFixture();

    try {
      const sourceLockPath = join(fixture.tempDir, "sources.lock.json");
      const outputPath = join(fixture.tempDir, "artifact");
      await createTerritoryCountrySourceLock({
        country: "TR",
        levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
        metadataPath: fixture.nationalMetadataPath,
        adm3CatalogPath: fixture.adm3CatalogPath,
        adm3Provinces: ["27"],
        outputPath: sourceLockPath,
        buildDate: BUILD_DATE
      });

      const build = await buildTerritoryCountryDatasetPath({
        country: "TR",
        sourceLockPath,
        outputPath,
        levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
        allowPartial: true,
        strict: true,
        buildDate: BUILD_DATE
      });
      const adm3 = build.combinedDataset?.zones.filter((zone) => zone.sourceAdminLevel === "ADM3");

      expect(parseTurkeyGaziantepAdm3Kml(fixture.kml)).toHaveLength(2);
      expect(build.issues.filter((issue) => issue.severity === "error")).toEqual([]);
      expect(adm3?.map((zone) => zone.parentId)).toEqual([
        "tr:adm2:54988432b26387222249237",
        "tr:adm2:54988432b61004264745956"
      ]);
      const gaziantepTerritory = adm3?.[0]?.properties.territory as
        Record<string, unknown> | undefined;

      expect(gaziantepTerritory).toMatchObject({
        boundaryKind: "administrative",
        boundarySourceClass: "official-local",
        confidence: "authoritative",
        administrative: true,
        providerId: "gaziantep-open-data",
        sourceId: "100001",
        sourceVersion: "fixture",
        sourceSnapshotChecksum: expect.any(String),
        licenseState: "approved",
        geometryHash: expect.any(String)
      });
      expect(gaziantepTerritory?.source).toMatchObject({
        boundarySourceClass: "official-local",
        providerId: "gaziantep-open-data",
        sourceVersion: "fixture",
        sourceSnapshotChecksum: expect.any(String),
        licenseState: "approved"
      });
      await expect(readFile(join(outputPath, "coverage.json"), "utf8")).resolves.toContain('"27"');
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  }, 15_000);
});

async function buildAdm3Ids(fixture: TurkeyAdm3Fixture): Promise<string[]> {
  const sourceLockPath = join(
    fixture.tempDir,
    `sources-${Math.random().toString(16).slice(2)}.json`
  );
  const outputPath = join(fixture.tempDir, `artifact-${Math.random().toString(16).slice(2)}`);

  await createTerritoryCountrySourceLock({
    country: "TR",
    levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
    metadataPath: fixture.nationalMetadataPath,
    adm3CatalogPath: fixture.adm3CatalogPath,
    adm3Provinces: ["27", "54"],
    outputPath: sourceLockPath,
    buildDate: BUILD_DATE
  });
  const build = await buildTerritoryCountryDatasetPath({
    country: "TR",
    sourceLockPath,
    outputPath,
    levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
    allowPartial: true,
    strict: true,
    buildDate: BUILD_DATE
  });

  return (
    build.combinedDataset?.zones
      .filter((zone) => zone.sourceAdminLevel === "ADM3")
      .map((zone) => zone.id)
      .sort() ?? []
  );
}

interface TurkeyAdm3Fixture {
  tempDir: string;
  nationalMetadataPath: string;
  adm3CatalogPath: string;
}

async function createTurkeyAdm3Fixture(
  options: {
    reverseAdm3FeatureOrder?: boolean;
    reverseRings?: boolean;
    missingParentMapping?: boolean;
    corruptAdm3Checksum?: boolean;
    omitAdm3License?: boolean;
    brokenGeometry?: boolean;
  } = {}
): Promise<TurkeyAdm3Fixture> {
  const tempDir = await mkdtemp(join(tmpdir(), "territory-tr-adm3-"));
  const adm0Path = join(tempDir, "adm0.geojson");
  const adm1Path = join(tempDir, "adm1.geojson");
  const adm2Path = join(tempDir, "adm2.geojson");
  const source27Path = join(tempDir, "adm3-27.geojson");
  const source54Path = join(tempDir, "adm3-54.geojson");
  const nationalMetadataPath = join(tempDir, "national-metadata.json");
  const adm3CatalogPath = join(tempDir, "adm3-catalog.json");
  const source27 = featureCollection([
    adm3Feature({
      sourceId: "27-1",
      name: "Merkez",
      parentCode: "TR27A",
      geometry: options.brokenGeometry
        ? bowtieGeometry(36.1, 36.1)
        : square(36.1, 36.1, 36.4, 36.4, options.reverseRings)
    }),
    adm3Feature({
      sourceId: "27-2",
      name: "Merkez",
      parentCode: "TR27B",
      geometry: square(37.1, 36.1, 37.4, 36.4, options.reverseRings)
    })
  ]);
  const ordered27 = options.reverseAdm3FeatureOrder
    ? { ...source27, features: [...source27.features].reverse() }
    : source27;
  const source54 = featureCollection([
    adm3Feature({
      sourceId: "54-1",
      name: "Ataturk",
      parentCode: "TR54A",
      geometry: square(30.1, 40.1, 30.4, 40.4, options.reverseRings)
    })
  ]);

  await writeJson(
    adm0Path,
    featureCollection([nationalFeature("ADM0", "TR", undefined, "Turkiye", square(25, 35, 46, 43))])
  );
  await writeJson(
    adm1Path,
    featureCollection([
      nationalFeature("ADM1", "TR27", "TR", "Gaziantep", square(36, 36, 39, 38)),
      nationalFeature("ADM1", "TR54", "TR", "Sakarya", square(29, 40, 31, 42))
    ])
  );
  await writeJson(
    adm2Path,
    featureCollection([
      nationalFeature("ADM2", "TR27A", "TR27", "District A", square(36, 36, 37, 37)),
      nationalFeature("ADM2", "TR27B", "TR27", "District B", square(37, 36, 38, 37)),
      nationalFeature("ADM2", "TR54A", "TR54", "District C", square(30, 40, 31, 41))
    ])
  );
  await writeJson(source27Path, ordered27);
  await writeJson(source54Path, source54);
  await writeJson(
    nationalMetadataPath,
    (["ADM0", "ADM1", "ADM2"] as TerritoryAdminLevel[]).map((adminLevel) => ({
      countryCodeAlpha3: "TUR",
      adminLevel,
      releaseType: "hdx-cod-ab",
      sourceUrl: adminLevel === "ADM0" ? adm0Path : adminLevel === "ADM1" ? adm1Path : adm2Path,
      sourceVersion: "fixture",
      sourceDate: "2026-07-28",
      boundaryYearRepresented: "2026",
      license: "CC BY-IGO",
      licenseDetail: "fixture://license",
      attribution: `Synthetic TR ${adminLevel} fixture`
    }))
  );
  await writeJson(
    adm3CatalogPath,
    createAdm3Catalog({
      source27Path,
      source54Path,
      source27: ordered27,
      source54,
      ...(options.missingParentMapping ? { missingParentMapping: true } : {}),
      ...(options.corruptAdm3Checksum ? { corruptAdm3Checksum: true } : {}),
      ...(options.omitAdm3License ? { omitAdm3License: true } : {})
    })
  );

  return { tempDir, nationalMetadataPath, adm3CatalogPath };
}

async function createGaziantepGenericFixture(): Promise<TurkeyAdm3Fixture & { kml: string }> {
  const base = await createTurkeyAdm3Fixture();
  const kml = createGaziantepKmlFixture();
  const kmlPath = join(base.tempDir, "gaziantep.kml");
  await writeFile(kmlPath, kml, "utf8");
  await writeJson(
    base.nationalMetadataPath,
    (["ADM0", "ADM1", "ADM2"] as TerritoryAdminLevel[]).map((adminLevel) => ({
      countryCodeAlpha3: "TUR",
      adminLevel,
      releaseType: "hdx-cod-ab",
      sourceUrl:
        adminLevel === "ADM0"
          ? join(base.tempDir, "gaziantep-adm0.geojson")
          : adminLevel === "ADM1"
            ? join(base.tempDir, "gaziantep-adm1.geojson")
            : join(base.tempDir, "gaziantep-adm2.geojson"),
      sourceVersion: "fixture",
      sourceDate: "2026-07-28",
      boundaryYearRepresented: "2026",
      license: "CC BY-IGO",
      licenseDetail: "fixture://license",
      attribution: `Synthetic Gaziantep ${adminLevel} fixture`
    }))
  );
  await writeJson(
    join(base.tempDir, "gaziantep-adm0.geojson"),
    featureCollection([nationalFeature("ADM0", "TR", undefined, "Turkiye", square(25, 35, 46, 43))])
  );
  await writeJson(
    join(base.tempDir, "gaziantep-adm1.geojson"),
    featureCollection([nationalFeature("ADM1", "TR27", "TR", "Gaziantep", square(36, 36, 39, 39))])
  );
  await writeJson(
    join(base.tempDir, "gaziantep-adm2.geojson"),
    featureCollection(
      TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS.map((mapping) =>
        nationalFeature(
          "ADM2",
          mapping.territoryAdm2Id.replace(/^tr:adm2:/, "").toUpperCase(),
          "TR27",
          mapping.districtName,
          square(35, 35, 40, 40)
        )
      )
    )
  );
  await writeJson(base.adm3CatalogPath, createGaziantepCatalog(kmlPath, kml));

  return { ...base, kml };
}

function createAdm3Catalog(input: {
  source27Path: string;
  source54Path: string;
  source27: ReturnType<typeof featureCollection>;
  source54: ReturnType<typeof featureCollection>;
  missingParentMapping?: boolean;
  corruptAdm3Checksum?: boolean;
  omitAdm3License?: boolean;
}): TurkeyAdm3SourceCatalog {
  return {
    schemaVersion: TURKEY_ADM3_SOURCE_CATALOG_SCHEMA_VERSION,
    country: "TR",
    provinces: {
      "27": adm3CatalogEntry({
        provinceCode: "27",
        provinceName: "Gaziantep",
        providerId: "fixture-provider-27",
        sourcePath: input.source27Path,
        source: input.source27,
        ...(input.corruptAdm3Checksum ? { corruptChecksum: true } : {}),
        ...(input.omitAdm3License ? { omitLicense: true } : {}),
        parentMappings: input.missingParentMapping
          ? { TR27B: "tr:adm2:tr27b" }
          : {
              TR27A: "tr:adm2:tr27a",
              TR27B: "tr:adm2:tr27b"
            }
      }),
      "54": adm3CatalogEntry({
        provinceCode: "54",
        provinceName: "Sakarya",
        providerId: "fixture-provider-54",
        sourcePath: input.source54Path,
        source: input.source54,
        parentMappings: { TR54A: "tr:adm2:tr54a" }
      })
    }
  };
}

function createGaziantepCatalog(sourcePath: string, kml: string): TurkeyAdm3SourceCatalog {
  return {
    schemaVersion: TURKEY_ADM3_SOURCE_CATALOG_SCHEMA_VERSION,
    country: "TR",
    provinces: {
      "27": {
        provinceCode: "27",
        provinceName: "Gaziantep",
        providerId: "gaziantep-open-data",
        providerName: "Gaziantep Büyükşehir Belediyesi Open Data",
        sourceId: "gaziantep-fixture",
        sourceUrl: "fixture://gaziantep",
        sourcePath,
        sourceDate: "2026-02-18T13:52:03Z",
        sourceVersion: "fixture",
        license: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        attribution: "Gaziantep fixture",
        redistributionStatus: "allowed",
        commercialUseStatus: "allowed",
        modificationStatus: "allowed",
        crs: "EPSG:4326",
        format: "KML",
        expectedSha256: sha256Hex(kml),
        expectedByteSize: Buffer.byteLength(kml),
        expectedFeatureCount: 2,
        adapter: {
          id: "kml-description-table",
          nameField: "AD",
          sourceIdField: "KIMLIKNO",
          parentField: "ILCEID",
          defaultSemanticType: "neighbourhood",
          defaultLocalType: "Mahalle",
          parentMappings: Object.fromEntries(
            TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS.map((mapping) => [
              mapping.sourceDistrictId,
              mapping.territoryAdm2Id
            ])
          )
        }
      }
    }
  };
}

function adm3CatalogEntry(input: {
  provinceCode: string;
  provinceName: string;
  providerId: string;
  sourcePath: string;
  source: ReturnType<typeof featureCollection>;
  parentMappings: Record<string, string>;
  corruptChecksum?: boolean;
  omitLicense?: boolean;
}): TurkeyAdm3SourceCatalog["provinces"][string] {
  const sourceText = `${JSON.stringify(input.source, null, 2)}\n`;

  return {
    provinceCode: input.provinceCode,
    provinceName: input.provinceName,
    providerId: input.providerId,
    providerName: input.providerId,
    sourceId: `${input.providerId}-adm3`,
    sourceUrl: `fixture://${input.providerId}`,
    sourcePath: input.sourcePath,
    sourceDate: "2026-07-28",
    sourceVersion: "fixture",
    license: input.omitLicense ? "unknown" : "CC BY 4.0",
    attribution: `${input.providerId} fixture`,
    redistributionStatus: "allowed",
    commercialUseStatus: "allowed",
    modificationStatus: "allowed",
    crs: "EPSG:4326",
    format: "GeoJSON",
    expectedSha256: input.corruptChecksum ? "0".repeat(64) : sha256Hex(sourceText),
    expectedByteSize: Buffer.byteLength(sourceText),
    expectedFeatureCount: input.source.features.length,
    adapter: {
      id: "geojson-property-map",
      nameProperty: "name",
      sourceIdProperty: "code",
      parentProperty: "districtCode",
      semanticTypeProperty: "semanticType",
      defaultSemanticType: "neighbourhood",
      defaultLocalType: "Mahalle",
      parentMappings: input.parentMappings
    }
  };
}

function nationalFeature(
  level: TerritoryAdminLevel,
  code: string,
  parentCode: string | undefined,
  name: string,
  geometry: unknown
): unknown {
  const properties: Record<string, unknown> = {
    shapeID: code,
    shapeName: name,
    shapeType: level,
    adm0_pcode: level === "ADM0" ? code : parentCode,
    adm0_name1: name,
    adm1_pcode: level === "ADM1" ? code : parentCode,
    adm1_name1: name,
    adm2_pcode: level === "ADM2" ? code : undefined,
    adm2_name1: name
  };

  return {
    type: "Feature",
    id: code,
    properties,
    geometry
  };
}

function adm3Feature(input: {
  sourceId: string;
  name: string;
  parentCode: string;
  geometry: unknown;
}): unknown {
  return {
    type: "Feature",
    id: input.sourceId,
    properties: {
      code: input.sourceId,
      name: input.name,
      districtCode: input.parentCode,
      semanticType: "neighbourhood"
    },
    geometry: input.geometry
  };
}

function featureCollection(features: unknown[]): {
  type: "FeatureCollection";
  features: unknown[];
} {
  return { type: "FeatureCollection", features };
}

function square(
  west: number,
  south: number,
  east: number,
  north: number,
  reverseRing = false
): unknown {
  const ring = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ];

  return {
    type: "Polygon",
    coordinates: [reverseRing ? [...ring].reverse() : ring]
  };
}

function bowtieGeometry(west: number, south: number): unknown {
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [west + 0.3, south + 0.3],
        [west, south + 0.3],
        [west + 0.3, south],
        [west, south]
      ]
    ]
  };
}

function createGaziantepKmlFixture(): string {
  const first = TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS.find(
    (mapping) => mapping.districtName === "Şahinbey"
  )!;
  const second = TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS.find(
    (mapping) => mapping.districtName === "Şehitkamil"
  )!;

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    ${placemark("ID_00001", "İSTİKLAL", "100001", first.sourceDistrictId, 36.01, 36.01)}
    ${placemark("ID_00002", "İSTİKLAL", "100002", second.sourceDistrictId, 36.51, 36.51)}
  </Document>
</kml>`;
}

function placemark(
  id: string,
  name: string,
  code: string,
  districtId: string,
  west: number,
  south: number
): string {
  return `<Placemark id="${id}">
  <description><![CDATA[
    <table>
      <tr><td>FID</td><td>${id}</td></tr>
      <tr><td>AD</td><td>${name}</td></tr>
      <tr><td>KIMLIKNO</td><td>${code}</td></tr>
      <tr><td>ILCEID</td><td>${districtId}</td></tr>
    </table>
  ]]></description>
  <Polygon>
    <outerBoundaryIs><LinearRing><coordinates>
      ${west},${south},0 ${west + 0.02},${south},0 ${west + 0.02},${south + 0.02},0 ${west},${south + 0.02},0 ${west},${south},0
    </coordinates></LinearRing></outerBoundaryIs>
  </Polygon>
</Placemark>`;
}

async function writeJson(path: string, input: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(input, null, 2)}\n`, "utf8");
}
