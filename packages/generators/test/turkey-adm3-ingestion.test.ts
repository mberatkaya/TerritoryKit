import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTerritoryDataset } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  TURKEY_ADM3_SOURCE_CATALOG_SCHEMA_VERSION,
  TURKEY_ADM3_SOURCE_REGISTRY_SCHEMA_VERSION,
  TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS,
  buildTerritoryCountryDatasetPath,
  createTerritoryCountrySourceLock,
  createTurkeyAdm3StableKey,
  createTurkeyAdm3TerritoryId,
  parseTurkeyGaziantepAdm3Kml,
  parseTurkeyAdm3ProviderSource,
  readTurkeyAdm3SourceCatalog,
  serializeJsonStable,
  sha256Hex,
  verifyTerritoryCountrySourceLock
} from "../src/index.js";
import type { TerritoryAdminLevel } from "@territory-kit/dataset";
import type {
  TurkeyAdm3AdapterParseResult,
  TurkeyAdm3ProviderAdapterConfig,
  TurkeyAdm3RawProviderFeature,
  TurkeyAdm3SourceCatalog
} from "../src/index.js";

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
      const importReport = JSON.parse(
        await readFile(join(outputPath, "adm3-import-report.json"), "utf8")
      ) as { schemaVersion: string; summary: { acceptedCount: number; sourceCount: number } };
      const unresolvedReport = JSON.parse(
        await readFile(join(outputPath, "adm3-unresolved-report.json"), "utf8")
      ) as { records: unknown[]; summary: { unresolvedCount: number } };
      const repairReport = JSON.parse(
        await readFile(join(outputPath, "adm3-repair-report.json"), "utf8")
      ) as { featuresRejected: number };

      expect(importReport).toMatchObject({
        schemaVersion: "territorykit-tr-adm3-import-report@1",
        summary: { acceptedCount: 3, sourceCount: 2 }
      });
      expect(unresolvedReport.summary.unresolvedCount).toBe(0);
      expect(unresolvedReport.records).toEqual([]);
      expect(repairReport.featuresRejected).toBe(0);
    } finally {
      await rm(fixture.tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("parses provider transports with CRS handling and full-fidelity geometry", () => {
    const geoJson = parseAdm3Source(
      {
        provinceCode: "34",
        provinceName: "İstanbul",
        providerId: "fixture-geojson",
        format: "GeoJSON",
        crs: "EPSG:4326",
        adapter: propertyMapAdapter({
          id: "geojson-property-map",
          parentMappings: { TR34A: "tr:adm2:tr34a" }
        })
      },
      JSON.stringify(
        featureCollection([
          adm3Feature({
            sourceId: "geo-1",
            name: "Şişli",
            parentCode: "TR34A",
            geometry: {
              type: "MultiPolygon",
              coordinates: [
                [
                  [
                    [28.9, 41],
                    [28.92, 41],
                    [28.92, 41.02],
                    [28.9, 41.02],
                    [28.9, 41]
                  ]
                ],
                [
                  [
                    [28.93, 41.03],
                    [28.95, 41.03],
                    [28.95, 41.05],
                    [28.93, 41.05],
                    [28.93, 41.03]
                  ]
                ]
              ]
            }
          })
        ])
      )
    );
    const json = parseAdm3Source(
      {
        provinceCode: "34",
        provinceName: "İstanbul",
        providerId: "fixture-json",
        format: "JSON",
        crs: "EPSG:4326",
        adapter: {
          id: "json-feature-map",
          nameProperty: "attrs.ad",
          sourceIdProperty: "attrs.uid",
          parentProperty: "attrs.parent",
          featureArrayPath: "payload.items",
          geometryProperty: "geom",
          defaultSemanticType: "neighbourhood",
          defaultLocalType: "Mahalle",
          parentMappings: { TR34B: "tr:adm2:tr34b" }
        }
      },
      JSON.stringify({
        payload: {
          items: [
            {
              attrs: { ad: "Üsküdar", uid: "json-1", parent: "TR34B" },
              geom: square(29.01, 41.01, 29.03, 41.03)
            }
          ]
        }
      })
    );
    const kml = createKmlWithHoleFixture();
    const kmlResult = parseAdm3Source(
      {
        provinceCode: "34",
        provinceName: "İstanbul",
        providerId: "fixture-kml",
        format: "KML",
        crs: "EPSG:4326",
        adapter: fieldMapAdapter({
          id: "kml-description-table",
          parentMappings: { TR34C: "tr:adm2:tr34c" }
        })
      },
      kml
    );
    const kmzResult = parseAdm3Source(
      {
        provinceCode: "34",
        provinceName: "İstanbul",
        providerId: "fixture-kmz",
        format: "KMZ",
        crs: "EPSG:4326",
        adapter: fieldMapAdapter({
          id: "kmz-kml-description-table",
          parentMappings: { TR34C: "tr:adm2:tr34c" }
        })
      },
      createZipArchive([{ filename: "doc.kml", data: Buffer.from(kml, "utf8") }])
    );
    const arcGis = parseAdm3Source(
      {
        provinceCode: "34",
        provinceName: "İstanbul",
        providerId: "fixture-arcgis",
        format: "ArcGIS REST",
        crs: "EPSG:3857",
        adapter: fieldMapAdapter({
          id: "arcgis-rest-json",
          parentMappings: { TR34D: "tr:adm2:tr34d" }
        })
      },
      JSON.stringify({
        objectIdFieldName: "OBJECTID",
        spatialReference: { wkid: 3857 },
        features: [
          {
            attributes: {
              OBJECTID: 7,
              AD: "Güneşli",
              KIMLIKNO: "arc-1",
              ILCEID: "TR34D"
            },
            geometry: {
              rings: [webMercatorSquare(29.02, 41.02, 29.04, 41.04)],
              spatialReference: { wkid: 3857 }
            }
          }
        ]
      })
    );
    const wfs = parseAdm3Source(
      {
        provinceCode: "06",
        provinceName: "Ankara",
        providerId: "fixture-wfs",
        format: "WFS",
        crs: "EPSG:4326",
        adapter: propertyMapAdapter({
          id: "wfs-geojson-property-map",
          parentMappings: { TR06A: "tr:adm2:tr06a" }
        })
      },
      JSON.stringify(
        featureCollection([
          adm3Feature({
            sourceId: "wfs-1",
            name: "Kızılay",
            parentCode: "TR06A",
            geometry: square(32.85, 39.91, 32.87, 39.93)
          })
        ])
      )
    );
    const shapefile = parseAdm3Source(
      {
        provinceCode: "35",
        provinceName: "İzmir",
        providerId: "fixture-shapefile",
        format: "Shapefile ZIP",
        crs: "EPSG:4326",
        adapter: fieldMapAdapter({
          id: "shapefile-zip-property-map",
          parentMappings: { TR35A: "tr:adm2:tr35a" }
        })
      },
      createShapefileZip([
        {
          properties: { AD: "Çiğli", KIMLIKNO: "shp-1", ILCEID: "TR35A" },
          rings: [closedRing(26.95, 38.48, 26.97, 38.5)]
        }
      ])
    );

    for (const result of [geoJson, json, kmlResult, kmzResult, arcGis, wfs, shapefile]) {
      expect(errorIssueCodes(result)).toEqual([]);
      expect(result.report.acceptedFeatureCount).toBe(1);
    }

    expect(expectOnlyFeature(geoJson).geometry.type).toBe("MultiPolygon");
    expect(expectOnlyFeature(json).name).toBe("Üsküdar");
    const kmlFeature = expectOnlyFeature(kmlResult);

    expect(kmlFeature.name).toBe("Kağıthane");
    expect(kmlFeature.geometry.type).toBe("Polygon");
    if (kmlFeature.geometry.type !== "Polygon") {
      throw new Error("Expected KML fixture to parse as a Polygon.");
    }
    expect(kmlFeature.geometry.coordinates).toHaveLength(2);
    expect(expectOnlyFeature(kmzResult).effectiveGeometryHash).toBe(
      kmlFeature.effectiveGeometryHash
    );
    expect(arcGis.report.crsHandling).toMatchObject({
      sourceCrs: "EPSG:3857",
      operation: "reprojected"
    });
    const arcGisFeature = expectOnlyFeature(arcGis);

    if (arcGisFeature.geometry.type !== "Polygon") {
      throw new Error("Expected ArcGIS fixture to parse as a Polygon.");
    }
    expect(arcGisFeature.geometry.coordinates[0]?.[0]?.[0]).toBeCloseTo(29.02, 5);
    expect(expectOnlyFeature(wfs).name).toBe("Kızılay");
    expect(expectOnlyFeature(shapefile).sourceId).toBe("shp-1");
  });

  it("rejects unsupported CRS, unsafe XML, and unsupported geometry without fallback", () => {
    const unsupportedCrs = parseAdm3Source(
      {
        provinceCode: "34",
        provinceName: "İstanbul",
        providerId: "fixture-unsupported-crs",
        format: "GeoJSON",
        crs: "EPSG:5254",
        adapter: propertyMapAdapter({
          id: "geojson-property-map",
          parentMappings: { TR34A: "tr:adm2:tr34a" }
        })
      },
      JSON.stringify(
        featureCollection([
          adm3Feature({
            sourceId: "geo-1",
            name: "Şişli",
            parentCode: "TR34A",
            geometry: square(28.9, 41, 28.92, 41.02)
          })
        ])
      )
    );
    const unsafeKml = parseAdm3Source(
      {
        provinceCode: "34",
        provinceName: "İstanbul",
        providerId: "fixture-unsafe-kml",
        format: "KML",
        crs: "EPSG:4326",
        adapter: fieldMapAdapter({
          id: "kml-description-table",
          parentMappings: { TR34A: "tr:adm2:tr34a" }
        })
      },
      `<!DOCTYPE kml [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><kml><Document /></kml>`
    );
    const malformedKmz = parseAdm3Source(
      {
        provinceCode: "34",
        provinceName: "İstanbul",
        providerId: "fixture-malformed-kmz",
        format: "KMZ",
        crs: "EPSG:4326",
        adapter: fieldMapAdapter({
          id: "kmz-kml-description-table",
          parentMappings: { TR34A: "tr:adm2:tr34a" }
        })
      },
      createZipArchive([{ filename: "readme.txt", data: Buffer.from("not a KML", "utf8") }])
    );
    const unsupportedGeometry = parseAdm3Source(
      {
        provinceCode: "34",
        provinceName: "İstanbul",
        providerId: "fixture-linestring",
        format: "GeoJSON",
        crs: "EPSG:4326",
        adapter: propertyMapAdapter({
          id: "geojson-property-map",
          parentMappings: { TR34A: "tr:adm2:tr34a" }
        })
      },
      JSON.stringify(
        featureCollection([
          {
            type: "Feature",
            properties: {
              code: "line-1",
              name: "Levent",
              districtCode: "TR34A",
              semanticType: "neighbourhood"
            },
            geometry: {
              type: "LineString",
              coordinates: [
                [28.9, 41],
                [28.92, 41.02]
              ]
            }
          }
        ])
      )
    );

    expect(unsupportedCrs.features).toEqual([]);
    expect(errorIssueCodes(unsupportedCrs)).toContain("TR_ADM3_CRS_UNSUPPORTED");
    expect(errorIssueCodes(unsafeKml)).toContain("TR_ADM3_SOURCE_XML_UNSAFE");
    expect(errorIssueCodes(malformedKmz)).toContain("TR_ADM3_SOURCE_PARSE_FAILED");
    expect(unsupportedGeometry.features).toEqual([]);
    expect(unsupportedGeometry.issues.map((issue) => issue.code)).toContain(
      "TR_ADM3_UNSUPPORTED_GEOMETRY"
    );
  });

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

  it("uses the Sprint 2 registry as source of truth and blocks non-approved licenses", async () => {
    const fixture = await createTurkeyAdm3Fixture();
    const registryPath = join(fixture.tempDir, "source-registry.json");

    try {
      await writeJson(
        registryPath,
        createAdm3SourceRegistry({
          approvedProvince: {
            code: "27",
            name: "Gaziantep",
            registryEntryId: "registry-27-official",
            providerName: "Registry Gaziantep Municipality",
            sourceId: "fixture-provider-27-adm3",
            sourceUrl: "fixture://fixture-provider-27",
            format: "GeoJSON",
            featureCount: 2
          },
          reviewProvince: {
            code: "54",
            name: "Sakarya",
            registryEntryId: "registry-54-review",
            providerName: "Registry Sakarya Municipality",
            sourceId: "fixture-provider-54-adm3",
            sourceUrl: "fixture://fixture-provider-54",
            format: "GeoJSON"
          }
        })
      );

      const bridgedCatalog = await readTurkeyAdm3SourceCatalog({
        catalogPath: fixture.adm3CatalogPath,
        registryPath
      });

      expect(bridgedCatalog.provinces["27"]).toMatchObject({
        providerId: "registry-27-official",
        providerName: "Registry Gaziantep Municipality",
        registryEntryId: "registry-27-official",
        productionEligible: true,
        sourceLifecycle: "approved"
      });
      expect(bridgedCatalog.provinces["54"]).toMatchObject({
        providerId: "registry-54-review",
        productionEligible: false,
        licenseState: "pending"
      });

      const lockResult = await createTerritoryCountrySourceLock({
        country: "TR",
        levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
        metadataPath: fixture.nationalMetadataPath,
        adm3CatalogPath: fixture.adm3CatalogPath,
        adm3RegistryPath: registryPath,
        adm3Provinces: ["27", "54"],
        buildDate: BUILD_DATE
      });

      expect(lockResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "TR_ADM3_SOURCE_LICENSE_PENDING" }),
          expect.objectContaining({ code: "TR_ADM3_SOURCE_NOT_APPROVED_FOR_PRODUCTION" })
        ])
      );
      expect(lockResult.lock?.extensions?.turkeyAdm3?.provinces["27"]).toMatchObject({
        status: "available",
        providerId: "registry-27-official",
        registryEntryId: "registry-27-official",
        importerVersion: "territorykit-tr-adm3-importer@3"
      });
      expect(lockResult.lock?.extensions?.turkeyAdm3?.provinces["54"]).toMatchObject({
        status: "license-blocked",
        providerId: "registry-54-review",
        registryEntryId: "registry-54-review"
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

function parseAdm3Source(
  source: {
    provinceCode: string;
    provinceName: string;
    providerId: string;
    format: string;
    crs: string;
    adapter: TurkeyAdm3ProviderAdapterConfig;
  },
  input: string | Uint8Array
): TurkeyAdm3AdapterParseResult {
  return parseTurkeyAdm3ProviderSource(source, input);
}

function propertyMapAdapter(input: {
  id: TurkeyAdm3ProviderAdapterConfig["id"];
  parentMappings: Record<string, string>;
}): TurkeyAdm3ProviderAdapterConfig {
  return {
    id: input.id,
    nameProperty: "name",
    sourceIdProperty: "code",
    parentProperty: "districtCode",
    semanticTypeProperty: "semanticType",
    defaultSemanticType: "neighbourhood",
    defaultLocalType: "Mahalle",
    parentMappings: input.parentMappings
  };
}

function fieldMapAdapter(input: {
  id: TurkeyAdm3ProviderAdapterConfig["id"];
  parentMappings: Record<string, string>;
}): TurkeyAdm3ProviderAdapterConfig {
  return {
    id: input.id,
    nameField: "AD",
    sourceIdField: "KIMLIKNO",
    parentField: "ILCEID",
    defaultSemanticType: "neighbourhood",
    defaultLocalType: "Mahalle",
    parentMappings: input.parentMappings
  };
}

function expectOnlyFeature(result: TurkeyAdm3AdapterParseResult): TurkeyAdm3RawProviderFeature {
  expect(result.features).toHaveLength(1);
  const feature = result.features[0];

  if (!feature) {
    throw new Error("Expected one parsed ADM3 feature.");
  }

  return feature;
}

function errorIssueCodes(result: TurkeyAdm3AdapterParseResult): string[] {
  return result.issues
    .filter((issue) => issue.severity !== "warning")
    .map((issue) => issue.code)
    .sort();
}

function createKmlWithHoleFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark id="kml-1">
      <ExtendedData>
        <Data name="AD"><value>Kağıthane</value></Data>
        <Data name="KIMLIKNO"><value>kml-1</value></Data>
        <Data name="ILCEID"><value>TR34C</value></Data>
      </ExtendedData>
      <Polygon>
        <outerBoundaryIs><LinearRing><coordinates>
          28.96,41.07,0 28.99,41.07,0 28.99,41.10,0 28.96,41.10,0 28.96,41.07,0
        </coordinates></LinearRing></outerBoundaryIs>
        <innerBoundaryIs><LinearRing><coordinates>
          28.97,41.08,0 28.98,41.08,0 28.98,41.09,0 28.97,41.09,0 28.97,41.08,0
        </coordinates></LinearRing></innerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
}

function webMercatorSquare(
  west: number,
  south: number,
  east: number,
  north: number
): Array<[number, number]> {
  return closedRing(west, south, east, north).map(([lng, lat]) => lonLatToWebMercator(lng, lat));
}

function lonLatToWebMercator(lng: number, lat: number): [number, number] {
  const originShift = 20037508.34;
  const x = (lng * originShift) / 180;
  const y =
    ((Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * originShift) / 180;

  return [x, y];
}

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

interface RegistryFixtureProvince {
  code: string;
  name: string;
  registryEntryId: string;
  providerName: string;
  sourceId: string;
  sourceUrl: string;
  format: string;
  featureCount?: number;
}

function createAdm3SourceRegistry(input: {
  approvedProvince: RegistryFixtureProvince;
  reviewProvince: RegistryFixtureProvince;
}): unknown {
  return {
    schemaVersion: TURKEY_ADM3_SOURCE_REGISTRY_SCHEMA_VERSION,
    country: "TR",
    level: "ADM3",
    generatedAt: BUILD_DATE,
    provinces: [
      {
        code: input.approvedProvince.code,
        name: input.approvedProvince.name,
        status: "complete",
        sources: [registrySource(input.approvedProvince, "approved")]
      },
      {
        code: input.reviewProvince.code,
        name: input.reviewProvince.name,
        status: "needs-review",
        sources: [registrySource(input.reviewProvince, "review-required")]
      }
    ]
  };
}

function registrySource(
  province: RegistryFixtureProvince,
  licenseState: "approved" | "review-required"
): unknown {
  const approved = licenseState === "approved";

  return {
    id: province.registryEntryId,
    sourceId: province.sourceId,
    provider: {
      name: province.providerName,
      authorityType: "local-government",
      class: "official-local"
    },
    boundarySourceClass: "official-local",
    access: {
      type: "public-download",
      formats: [province.format],
      geometryAvailable: true,
      urls: {
        dataset: province.sourceUrl,
        license: "https://creativecommons.org/licenses/by/4.0/"
      }
    },
    license: {
      state: licenseState,
      redistribution: "allowed",
      commercialUse: "allowed",
      modification: "allowed",
      name: approved ? "CC BY 4.0" : "license pending review"
    },
    lifecycle: approved ? "approved" : "discovered",
    productionEligible: approved,
    sourceDate: approved ? "2026-07-28" : null,
    fields: {
      nameField: "name",
      sourceNativeIdField: "code",
      districtParentField: "districtCode"
    },
    verification: {
      checkedAt: BUILD_DATE,
      evidenceUrls: [province.sourceUrl],
      ...(province.featureCount !== undefined ? { featureCount: province.featureCount } : {}),
      sourceDate: approved ? "2026-07-28" : null
    },
    notes: []
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
  const ring = closedRing(west, south, east, north);

  return {
    type: "Polygon",
    coordinates: [reverseRing ? [...ring].reverse() : ring]
  };
}

function closedRing(
  west: number,
  south: number,
  east: number,
  north: number
): Array<[number, number]> {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ];
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

interface ZipEntryFixture {
  filename: string;
  data: Buffer;
}

function createZipArchive(entries: readonly ZipEntryFixture[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const filename = Buffer.from(entry.filename, "utf8");
    const localHeader = Buffer.alloc(30 + filename.byteLength);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(entry.data.byteLength, 18);
    localHeader.writeUInt32LE(entry.data.byteLength, 22);
    localHeader.writeUInt16LE(filename.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);
    filename.copy(localHeader, 30);
    localParts.push(localHeader, entry.data);

    const centralHeader = Buffer.alloc(46 + filename.byteLength);

    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(entry.data.byteLength, 20);
    centralHeader.writeUInt32LE(entry.data.byteLength, 24);
    centralHeader.writeUInt16LE(filename.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    filename.copy(centralHeader, 46);
    centralParts.push(centralHeader);
    offset += localHeader.byteLength + entry.data.byteLength;
  }

  const centralDirectoryOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);

  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.byteLength, 12);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

interface ShapefileFeatureFixture {
  properties: Record<string, string>;
  rings: Array<Array<[number, number]>>;
}

function createShapefileZip(features: readonly ShapefileFeatureFixture[]): Uint8Array {
  return createZipArchive([
    { filename: "neighbourhoods.shp", data: createShp(features) },
    { filename: "neighbourhoods.dbf", data: createDbf(features) },
    {
      filename: "neighbourhoods.prj",
      data: Buffer.from(
        'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433],AUTHORITY["EPSG",4326]]',
        "utf8"
      )
    }
  ]);
}

function createShp(features: readonly ShapefileFeatureFixture[]): Buffer {
  const records = features.map((feature, index) => createShpRecord(feature, index + 1));
  const body = Buffer.concat(records);
  const header = Buffer.alloc(100);
  const bounds = calculateBounds(features.flatMap((feature) => feature.rings.flat()));

  header.writeInt32BE(9994, 0);
  header.writeInt32BE((header.byteLength + body.byteLength) / 2, 24);
  header.writeInt32LE(1000, 28);
  header.writeInt32LE(5, 32);
  writeBounds(header, 36, bounds);

  return Buffer.concat([header, body]);
}

function createShpRecord(feature: ShapefileFeatureFixture, recordNumber: number): Buffer {
  const points = feature.rings.flat();
  const content = Buffer.alloc(44 + feature.rings.length * 4 + points.length * 16);
  const header = Buffer.alloc(8);
  const bounds = calculateBounds(points);
  let pointStart = 0;
  let pointOffset = 44 + feature.rings.length * 4;

  content.writeInt32LE(5, 0);
  writeBounds(content, 4, bounds);
  content.writeInt32LE(feature.rings.length, 36);
  content.writeInt32LE(points.length, 40);

  for (const [partIndex, ring] of feature.rings.entries()) {
    content.writeInt32LE(pointStart, 44 + partIndex * 4);
    pointStart += ring.length;
  }

  for (const [lng, lat] of points) {
    content.writeDoubleLE(lng, pointOffset);
    content.writeDoubleLE(lat, pointOffset + 8);
    pointOffset += 16;
  }

  header.writeInt32BE(recordNumber, 0);
  header.writeInt32BE(content.byteLength / 2, 4);

  return Buffer.concat([header, content]);
}

function createDbf(features: readonly ShapefileFeatureFixture[]): Buffer {
  const fieldNames = [...new Set(features.flatMap((feature) => Object.keys(feature.properties)))];
  const fields = fieldNames.map((name) => ({ name, length: 80 }));
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0);
  const buffer = Buffer.alloc(headerLength + features.length * recordLength + 1, 0);

  buffer[0] = 0x03;
  buffer[1] = 126;
  buffer[2] = 7;
  buffer[3] = 28;
  buffer.writeUInt32LE(features.length, 4);
  buffer.writeUInt16LE(headerLength, 8);
  buffer.writeUInt16LE(recordLength, 10);
  buffer[29] = 0x57;

  for (const [index, field] of fields.entries()) {
    const offset = 32 + index * 32;
    const name = Buffer.from(field.name, "ascii");

    name.copy(buffer, offset, 0, Math.min(name.byteLength, 10));
    buffer[offset + 11] = "C".charCodeAt(0);
    buffer[offset + 16] = field.length;
  }

  buffer[headerLength - 1] = 0x0d;

  for (const [rowIndex, feature] of features.entries()) {
    const rowOffset = headerLength + rowIndex * recordLength;
    let fieldOffset = rowOffset + 1;

    buffer.fill(0x20, rowOffset, rowOffset + recordLength);

    for (const field of fields) {
      const value = Buffer.from(feature.properties[field.name] ?? "", "utf8");

      value.copy(buffer, fieldOffset, 0, Math.min(value.byteLength, field.length));
      fieldOffset += field.length;
    }
  }

  buffer[buffer.byteLength - 1] = 0x1a;

  return buffer;
}

function calculateBounds(points: readonly [number, number][]): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const first = points[0] ?? [0, 0];

  return points.reduce(
    (bounds, [lng, lat]) => ({
      west: Math.min(bounds.west, lng),
      south: Math.min(bounds.south, lat),
      east: Math.max(bounds.east, lng),
      north: Math.max(bounds.north, lat)
    }),
    { west: first[0], south: first[1], east: first[0], north: first[1] }
  );
}

function writeBounds(
  buffer: Buffer,
  offset: number,
  bounds: { west: number; south: number; east: number; north: number }
): void {
  buffer.writeDoubleLE(bounds.west, offset);
  buffer.writeDoubleLE(bounds.south, offset + 8);
  buffer.writeDoubleLE(bounds.east, offset + 16);
  buffer.writeDoubleLE(bounds.north, offset + 24);
}

async function writeJson(path: string, input: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(input, null, 2)}\n`, "utf8");
}
