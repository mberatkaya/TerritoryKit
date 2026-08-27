import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "@territory-kit/generators";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";

describe("territory cli Turkey ADM3 ingestion", () => {
  it("passes ADM3 province catalog flags through source lock and partial build", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-cli-tr-adm3-"));
    const fixture = await createFixture(tempDir);
    const lockPath = join(tempDir, "sources.lock.json");
    const outputPath = join(tempDir, "artifact");

    try {
      await expect(
        captureCli([
          "country",
          "source",
          "lock",
          "TR",
          "--levels",
          "ADM0,ADM1,ADM2,ADM3",
          "--metadata",
          fixture.metadataPath,
          "--adm3-catalog",
          fixture.catalogPath,
          "--adm3-registry",
          fixture.registryPath,
          "--adm3-provinces",
          "27",
          "--output",
          lockPath,
          "--build-date",
          "2026-07-28T00:00:00.000Z"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "country source lock",
          data: {
            lock: {
              extensions: {
                turkeyAdm3: {
                  summary: {
                    availableProvinceCount: 1,
                    sourceFeatureCount: 1
                  },
                  provinces: {
                    "27": {
                      providerId: "cli-registry-provider",
                      registryEntryId: "cli-registry-provider"
                    }
                  }
                }
              }
            }
          }
        }
      });

      await expect(
        captureCli([
          "country",
          "build",
          "TR",
          "--source-lock",
          lockPath,
          "--output",
          outputPath,
          "--levels",
          "ADM0,ADM1,ADM2,ADM3",
          "--allow-partial",
          "--strict",
          "--build-date",
          "2026-07-28T00:00:00.000Z"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "country build",
          data: {
            manifest: {
              supportedLevels: ["ADM0", "ADM1", "ADM2", "ADM3"],
              featureCountByLevel: {
                ADM3: 1
              }
            }
          }
        }
      });

      await expect(readFile(join(outputPath, "coverage.json"), "utf8")).resolves.toContain(
        "territorykit-tr-adm3-coverage@1"
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);
});

async function captureCli(args: string[]): Promise<{ code: number; payload: unknown }> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

  try {
    const code = await runCli(args);
    const payload = JSON.parse(spy.mock.calls.at(-1)?.[0] ?? "{}") as unknown;

    return { code, payload };
  } finally {
    spy.mockRestore();
  }
}

async function createFixture(
  tempDir: string
): Promise<{ metadataPath: string; catalogPath: string; registryPath: string }> {
  const adm0Path = join(tempDir, "adm0.geojson");
  const adm1Path = join(tempDir, "adm1.geojson");
  const adm2Path = join(tempDir, "adm2.geojson");
  const adm3Path = join(tempDir, "adm3.geojson");
  const metadataPath = join(tempDir, "metadata.json");
  const catalogPath = join(tempDir, "adm3-catalog.json");
  const registryPath = join(tempDir, "adm3-source-registry.json");
  const adm3 = featureCollection([
    {
      type: "Feature",
      id: "n-1",
      properties: {
        code: "N1",
        name: "Merkez",
        districtCode: "TR27A",
        semanticType: "neighbourhood"
      },
      geometry: square(36.1, 36.1, 36.4, 36.4)
    }
  ]);
  const adm3Text = `${JSON.stringify(adm3, null, 2)}\n`;

  await writeJson(
    adm0Path,
    featureCollection([feature("ADM0", "TR", undefined, "Turkiye", square(25, 35, 46, 43))])
  );
  await writeJson(
    adm1Path,
    featureCollection([feature("ADM1", "TR27", "TR", "Gaziantep", square(36, 36, 39, 38))])
  );
  await writeJson(
    adm2Path,
    featureCollection([feature("ADM2", "TR27A", "TR27", "District A", square(36, 36, 37, 37))])
  );
  await writeFile(adm3Path, adm3Text, "utf8");
  await writeJson(
    metadataPath,
    ["ADM0", "ADM1", "ADM2"].map((adminLevel) => ({
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
  await writeJson(catalogPath, {
    schemaVersion: "territorykit-tr-adm3-source-catalog@1",
    country: "TR",
    provinces: {
      "27": {
        provinceCode: "27",
        provinceName: "Gaziantep",
        providerId: "cli-fixture-provider",
        providerName: "CLI Fixture Provider",
        sourceId: "cli-fixture-adm3",
        sourceUrl: "fixture://cli-adm3",
        sourcePath: adm3Path,
        sourceDate: "2026-07-28",
        sourceVersion: "fixture",
        license: "CC BY 4.0",
        attribution: "CLI fixture provider",
        redistributionStatus: "allowed",
        commercialUseStatus: "allowed",
        modificationStatus: "allowed",
        crs: "EPSG:4326",
        format: "GeoJSON",
        expectedSha256: sha256Hex(adm3Text),
        expectedByteSize: Buffer.byteLength(adm3Text),
        expectedFeatureCount: 1,
        adapter: {
          id: "geojson-property-map",
          nameProperty: "name",
          sourceIdProperty: "code",
          parentProperty: "districtCode",
          semanticTypeProperty: "semanticType",
          defaultSemanticType: "neighbourhood",
          defaultLocalType: "Mahalle",
          parentMappings: {
            TR27A: "tr:adm2:tr27a"
          }
        }
      }
    }
  });
  await writeJson(registryPath, {
    schemaVersion: "territorykit-tr-adm3-source-registry@1",
    country: "TR",
    level: "ADM3",
    generatedAt: "2026-07-28T00:00:00.000Z",
    provinces: [
      {
        code: "27",
        name: "Gaziantep",
        status: "complete",
        sources: [
          {
            id: "cli-registry-provider",
            sourceId: "cli-fixture-adm3",
            provider: {
              name: "CLI Registry Provider",
              authorityType: "local-government",
              class: "official-local"
            },
            boundarySourceClass: "official-local",
            access: {
              type: "public-download",
              formats: ["GeoJSON"],
              geometryAvailable: true,
              urls: {
                dataset: "fixture://cli-adm3",
                license: "https://creativecommons.org/licenses/by/4.0/"
              }
            },
            license: {
              state: "approved",
              redistribution: "allowed",
              commercialUse: "allowed",
              modification: "allowed",
              name: "CC BY 4.0"
            },
            lifecycle: "approved",
            productionEligible: true,
            sourceDate: "2026-07-28",
            fields: {
              nameField: "name",
              sourceNativeIdField: "code",
              districtParentField: "districtCode"
            },
            verification: {
              checkedAt: "2026-07-28T00:00:00.000Z",
              evidenceUrls: ["fixture://cli-adm3"],
              featureCount: 1,
              sourceDate: "2026-07-28"
            },
            notes: []
          }
        ]
      }
    ]
  });

  return { metadataPath, catalogPath, registryPath };
}

function feature(
  level: string,
  code: string,
  parentCode: string | undefined,
  name: string,
  geometry: unknown
): unknown {
  return {
    type: "Feature",
    id: code,
    properties: {
      shapeID: code,
      shapeName: name,
      shapeType: level,
      adm0_pcode: level === "ADM0" ? code : parentCode,
      adm0_name1: name,
      adm1_pcode: level === "ADM1" ? code : parentCode,
      adm1_name1: name,
      adm2_pcode: level === "ADM2" ? code : undefined,
      adm2_name1: name
    },
    geometry
  };
}

function featureCollection(features: unknown[]): {
  type: "FeatureCollection";
  features: unknown[];
} {
  return { type: "FeatureCollection", features };
}

function square(west: number, south: number, east: number, north: number): unknown {
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south]
      ]
    ]
  };
}

async function writeJson(path: string, input: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(input, null, 2)}\n`, "utf8");
}
