import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256Hex } from "@territory-kit/generators";
import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";

describe("territory cli", () => {
  it("validates a dataset file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-"));
    const filePath = join(tempDir, "dataset.json");

    await writeFile(filePath, JSON.stringify(createSampleTerritoryDataset()), "utf8");

    try {
      await expect(captureCli(["validate", filePath])).resolves.toMatchObject({
        code: 0,
        payload: { ok: true, command: "validate" }
      });
      await expect(captureCli(["index", filePath])).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "index",
          data: {
            datasetId: "territorykit-sample",
            zoneCount: 5
          }
        }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("builds a registry and installs dataset artifacts from local files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-cli-registry-"));
    const artifactRoot = join(tempDir, "artifacts", "sample");
    const registryPath = join(tempDir, "registry.json");
    const cacheDir = join(tempDir, "cache");

    try {
      await mkdir(join(artifactRoot, "levels", "ADM0"), { recursive: true });
      const dataset = createSampleTerritoryDataset();
      const files = new Map([
        [
          "manifest.json",
          `${JSON.stringify(
            {
              manifestVersion: "1",
              datasetId: "sample-cli",
              datasetVersion: "1.0.0",
              schemaVersion: "territory-schema@1",
              country: { alpha2: "SC", alpha3: "SCL", name: "Sample CLI" },
              sourceProvider: "fixture",
              supportedLevels: ["ADM0"],
              license: "Apache-2.0",
              attribution: "fixture"
            },
            null,
            2
          )}\n`
        ],
        ["levels/ADM0/dataset.json", `${JSON.stringify(dataset, null, 2)}\n`]
      ]);
      files.set(
        "checksums.json",
        `${JSON.stringify(
          {
            files: Object.fromEntries(
              [...files.entries()].map(([path, content]) => [path, sha256Hex(content)])
            )
          },
          null,
          2
        )}\n`
      );

      for (const [relativePath, content] of files.entries()) {
        const target = join(artifactRoot, relativePath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      }

      await expect(
        captureCli([
          "registry",
          "build",
          "--input",
          join(tempDir, "artifacts"),
          "--output",
          registryPath,
          "--base-url",
          `file://${join(tempDir, "artifacts")}/`,
          "--force"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: { ok: true, command: "registry build" }
      });
      await expect(captureCli(["registry", "validate", registryPath])).resolves.toMatchObject({
        code: 0,
        payload: { ok: true, command: "registry validate" }
      });
      await expect(
        captureCli([
          "dataset",
          "install",
          "sample-cli",
          "--registry",
          registryPath,
          "--cache-dir",
          cacheDir,
          "--levels",
          "ADM0"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "dataset install",
          data: { datasetId: "sample-cli", artifactCount: 3 }
        }
      });
      await expect(
        captureCli(["dataset", "list-installed", "--cache-dir", cacheDir])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          data: [expect.objectContaining({ datasetId: "sample-cli" })]
        }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("validates and safely repairs geometry datasets", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-geometry-"));
    const filePath = join(tempDir, "dataset.json");
    const reportPath = join(tempDir, "geometry-report.json");
    const repairReportPath = join(tempDir, "repair-report.json");
    const outputPath = join(tempDir, "repaired");

    await writeFile(filePath, JSON.stringify(createRepairableGeometryDataset()), "utf8");

    try {
      const validation = await captureCli([
        "geometry",
        "validate",
        filePath,
        "--checks",
        "basic",
        "--report",
        reportPath
      ]);

      expect(validation).toMatchObject({
        code: 1,
        payload: {
          ok: false,
          command: "geometry validate",
          issues: expect.arrayContaining([expect.objectContaining({ code: "RING_NOT_CLOSED" })])
        }
      });
      await expect(readFile(reportPath, "utf8")).resolves.toContain("RING_NOT_CLOSED");

      const repaired = await captureCli([
        "geometry",
        "repair",
        filePath,
        "--checks",
        "basic",
        "--output",
        outputPath,
        "--report",
        repairReportPath
      ]);

      expect(repaired).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "geometry repair",
          data: {
            repairSummary: {
              repairedFeatureCount: 1,
              rejectedFeatureCount: 0,
              revalidationOk: true
            }
          }
        }
      });
      await expect(readFile(repairReportPath, "utf8")).resolves.toContain("close-ring");
      const output = JSON.parse(await readFile(join(outputPath, "dataset.json"), "utf8")) as {
        zones: Array<{ id: string; geometry: { coordinates: number[][][] } }>;
      };
      const repairedZone = output.zones.find((zone) => zone.id === "tr:34:kadikoy");
      expect(repairedZone?.geometry.coordinates[0]).toEqual([
        [29, 40.97],
        [29.08, 40.97],
        [29.08, 41.02],
        [29, 41.02],
        [29, 40.97]
      ]);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("uses geometry CLI input-error exit codes for unavailable backends", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-geometry-"));
    const filePath = join(tempDir, "dataset.json");

    await writeFile(filePath, JSON.stringify(createSampleTerritoryDataset()), "utf8");

    try {
      await expect(
        captureCli(["geometry", "validate", filePath, "--backend", "postgis"])
      ).resolves.toMatchObject({
        code: 2,
        payload: {
          ok: false,
          issues: [expect.objectContaining({ code: "GEOMETRY_BACKEND_UNAVAILABLE" })]
        }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("builds, validates, and inspects polygon adjacency artifacts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-adjacency-"));
    const datasetPath = join(tempDir, "dataset.json");
    const outputPath = join(tempDir, "adjacency");

    await writeFile(datasetPath, JSON.stringify(createAdjacencyCliDataset()), "utf8");

    try {
      const build = await captureCli([
        "adjacency",
        "build",
        datasetPath,
        "--output",
        outputPath,
        "--include-point-touches",
        "--build-date",
        "2026-01-01T00:00:00.000Z"
      ]);

      expect(build).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "adjacency build",
          data: {
            statistics: {
              finalEdgeCount: 3,
              sharedBorderCount: 2,
              pointTouchCount: 1
            }
          }
        }
      });

      const artifact = JSON.parse(await readFile(join(outputPath, "adjacency.json"), "utf8")) as {
        generatedAt: string;
        statistics: { durationMs?: number };
      };
      expect(artifact.generatedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(artifact.statistics.durationMs).toBeUndefined();
      await expect(readFile(join(outputPath, "checksums.json"), "utf8")).resolves.toContain(
        "adjacency.json"
      );
      await expect(
        captureCli(["adjacency", "validate", datasetPath, outputPath])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "adjacency validate",
          data: { edgeCount: 3 }
        }
      });
      await expect(
        captureCli(["adjacency", "inspect", outputPath, "a", "--type", "point-touch", "--json"])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "adjacency inspect",
          data: {
            zoneId: "a",
            neighbors: ["c"],
            relations: [expect.objectContaining({ from: "a", to: "c", type: "point-touch" })]
          }
        }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("builds, validates, inspects, and compares render artifacts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-cli-render-"));
    const datasetPath = join(tempDir, "dataset.json");
    const outputPath = join(tempDir, "render");

    await writeFile(datasetPath, JSON.stringify(createSampleTerritoryDataset()), "utf8");

    try {
      await expect(
        captureCli([
          "render",
          "build",
          datasetPath,
          "--output",
          outputPath,
          "--format",
          "mvt",
          "--min-zoom",
          "0",
          "--max-zoom",
          "0",
          "--build-date",
          "2026-01-01T00:00:00.000Z"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: { ok: true, command: "render build", data: { format: "mvt" } }
      });
      await expect(captureCli(["render", "validate", outputPath])).resolves.toMatchObject({
        code: 0,
        payload: { ok: true, command: "render validate", data: { format: "mvt" } }
      });
      await expect(captureCli(["render", "inspect", outputPath])).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "render inspect",
          data: { tileTemplate: "tiles/{z}/{x}/{y}.mvt" }
        }
      });
      await expect(
        captureCli(["render", "compare", datasetPath, outputPath])
      ).resolves.toMatchObject({
        code: 0,
        payload: { ok: true, command: "render compare", issues: [] }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("runs and compares benchmark smoke results", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-cli-benchmark-"));
    const currentPath = join(tempDir, "current.json");
    const baselinePath = join(tempDir, "baseline.json");

    try {
      const run = await captureCli([
        "benchmark",
        "run",
        "--rows",
        "2",
        "--columns",
        "2",
        "--iterations",
        "10",
        "--build-date",
        "2026-01-01T00:00:00.000Z"
      ]);

      expect(run).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "benchmark run",
          data: {
            schemaVersion: "territorykit-benchmark-result@1",
            inputs: { featureCount: 4 }
          }
        }
      });

      const data = isRecord(run.payload) ? run.payload.data : undefined;
      await writeFile(currentPath, JSON.stringify(data), "utf8");
      await writeFile(
        baselinePath,
        JSON.stringify({
          schemaVersion: "territorykit-benchmark-baseline@1",
          mode: "fixture",
          scenario: "smoke",
          minimumFeatureCount: 4,
          budgets: {
            datasetValidationMs: 1_000,
            engineConstructionMs: 1_000,
            getZoneByIdMeanMs: 1,
            latLngToZoneMeanMs: 1,
            getZonesInBoundsMeanMs: 10
          }
        }),
        "utf8"
      );

      await expect(
        captureCli(["benchmark", "compare", "--baseline", baselinePath, "--current", currentPath])
      ).resolves.toMatchObject({
        code: 0,
        payload: { ok: true, command: "benchmark compare" }
      });
      await expect(
        captureCli(["benchmark", "run", "--mode", "local-real", "--allow-skip"])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          data: {
            skipped: [expect.stringContaining("No local real-world dataset path")]
          }
        }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("imports GeoJSON and generates deterministic datasets", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-"));
    const geojsonPath = join(tempDir, "zones.geojson");

    await writeFile(
      geojsonPath,
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "zone-a",
            properties: { level: 0 },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0]
                ]
              ]
            }
          }
        ]
      }),
      "utf8"
    );

    try {
      const imported = await captureCli([
        "import",
        geojsonPath,
        "--dataset-id",
        "cli-import",
        "--source-date",
        "2026-07"
      ]);

      expect(imported).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "import",
          data: {
            manifest: {
              datasetId: "cli-import",
              sourceDate: "2026-07"
            }
          }
        }
      });
      expect(readPayload(imported.payload, "$.data.manifest.geometryHash")).not.toBe(
        "import-pending"
      );
      await expect(
        captureCli([
          "generate",
          "--kind",
          "grid",
          "--dataset-id",
          "cli-grid",
          "--rows",
          "2",
          "--columns",
          "2"
        ])
      ).resolves.toMatchObject({ code: 0, payload: { ok: true, command: "generate" } });
      await expect(
        captureCli(["generate", "--kind", "weighted-voronoi", "--dataset-id", "cli-voronoi"])
      ).resolves.toMatchObject({ code: 0, payload: { ok: true, command: "generate" } });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("keeps JSON-first error output for invalid commands", async () => {
    await expect(captureCli(["generate", "--kind", "unknown"])).resolves.toMatchObject({
      code: 1,
      payload: {
        ok: false,
        command: "generate",
        issues: [expect.objectContaining({ code: "CLI_USAGE" })]
      }
    });
    await expect(
      captureCli(["generate", "--kind", "grid", "--rows", "0", "--columns", "1"])
    ).resolves.toMatchObject({
      code: 1,
      payload: {
        ok: false,
        command: "generate",
        issues: [expect.objectContaining({ message: expect.stringContaining("rows") })]
      }
    });
  });

  it("reports GeoJSON import errors with source path, feature id, and line context", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-"));
    const geojsonPath = join(tempDir, "broken-zones.geojson");

    await writeFile(
      geojsonPath,
      JSON.stringify(
        {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "bad-zone",
              properties: { level: "bad" },
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                    [0, 0]
                  ]
                ]
              }
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    try {
      const result = await captureCli(["import", geojsonPath]);

      expect(result).toMatchObject({
        code: 1,
        payload: {
          ok: false,
          command: "import",
          issues: expect.arrayContaining([
            expect.objectContaining({
              featureId: "bad-zone",
              line: expect.any(Number),
              path: "$.features[0].properties.level",
              sourcePath: geojsonPath
            })
          ])
        }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("shows dataset build help", async () => {
    await expect(captureCliRaw(["dataset", "--help"])).resolves.toMatchObject({
      code: 0,
      output: expect.stringContaining("territory dataset <command>")
    });
    await expect(captureCliRaw(["dataset", "build", "--help"])).resolves.toMatchObject({
      code: 0,
      output: expect.stringContaining("territory dataset build world-countries")
    });
  });

  it("builds world-countries artifacts from a local Natural Earth fixture", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-cli-"));
    const sourcePath = join(tempDir, "natural-earth.geojson");
    const outputPath = join(tempDir, "world-countries");
    const source = JSON.stringify(createNaturalEarthCliFixture());

    await writeFile(sourcePath, source, "utf8");

    try {
      const result = await captureCli([
        "dataset",
        "build",
        "world-countries",
        "--source",
        sourcePath,
        "--output",
        outputPath,
        "--source-version",
        "fixture-1",
        "--source-sha256",
        sha256Hex(source),
        "--build-date",
        "2026-01-01T00:00:00.000Z"
      ]);

      expect(result).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "dataset build",
          data: {
            datasetId: "world-countries",
            details: ["low", "medium", "high"],
            checksumsVerified: true
          }
        }
      });
      await expect(readFile(join(outputPath, "manifest.json"), "utf8")).resolves.toContain(
        "world-countries"
      );
      await expect(readFile(join(outputPath, "checksums.json"), "utf8")).resolves.toContain(
        "low/dataset.json"
      );
      await expect(readFile(join(outputPath, "build-report.json"), "utf8")).resolves.toContain(
        "fallbackIdCount"
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects invalid dataset build requests with JSON-first errors", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-cli-"));
    const invalidJsonPath = join(tempDir, "invalid.json");
    const invalidGeoJsonPath = join(tempDir, "invalid-geojson.json");
    const sourcePath = join(tempDir, "source.geojson");

    await writeFile(invalidJsonPath, "{", "utf8");
    await writeFile(invalidGeoJsonPath, JSON.stringify({ type: "Feature" }), "utf8");
    await writeFile(sourcePath, JSON.stringify(createNaturalEarthCliFixture()), "utf8");

    try {
      await expect(captureCli(["dataset", "build", "unknown"])).resolves.toMatchObject({
        code: 1,
        payload: { ok: false, issues: [expect.objectContaining({ code: "CLI_USAGE" })] }
      });
      await expect(captureCli(["dataset", "build", "world-countries"])).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: false,
          issues: [expect.objectContaining({ message: expect.stringContaining("--source") })]
        }
      });
      await expect(
        captureCli([
          "dataset",
          "build",
          "world-countries",
          "--source",
          join(tempDir, "missing.geojson"),
          "--output",
          join(tempDir, "out")
        ])
      ).resolves.toMatchObject({
        code: 1,
        payload: { ok: false, issues: [expect.objectContaining({ code: "SOURCE_NOT_FOUND" })] }
      });
      await expect(
        captureCli([
          "dataset",
          "build",
          "world-countries",
          "--source",
          invalidJsonPath,
          "--output",
          join(tempDir, "invalid-json-out")
        ])
      ).resolves.toMatchObject({
        code: 1,
        payload: { ok: false, issues: [expect.objectContaining({ code: "INVALID_JSON" })] }
      });
      await expect(
        captureCli([
          "dataset",
          "build",
          "world-countries",
          "--source",
          invalidGeoJsonPath,
          "--output",
          join(tempDir, "invalid-geojson-out")
        ])
      ).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: false,
          issues: expect.arrayContaining([
            expect.objectContaining({ code: "FEATURE_COLLECTION_SHAPE" })
          ])
        }
      });
      await expect(
        captureCli([
          "dataset",
          "build",
          "world-countries",
          "--source",
          sourcePath,
          "--output",
          join(tempDir, "invalid-detail-out"),
          "--detail",
          "tiny"
        ])
      ).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: false,
          issues: [
            expect.objectContaining({ message: expect.stringContaining("Invalid --detail") })
          ]
        }
      });
      await expect(
        captureCli([
          "dataset",
          "build",
          "world-countries",
          "--source",
          sourcePath,
          "--output",
          join(tempDir, "checksum-out"),
          "--source-sha256",
          "wrong"
        ])
      ).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: false,
          issues: [expect.objectContaining({ code: "SOURCE_CHECKSUM_MISMATCH" })]
        }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("supports strict mode and safe overwrite behavior", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-cli-"));
    const sourcePath = join(tempDir, "source.geojson");
    const outputPath = join(tempDir, "world-countries");

    await writeFile(sourcePath, JSON.stringify(createNaturalEarthCliFixture()), "utf8");
    await mkdir(outputPath);

    try {
      await expect(
        captureCli([
          "dataset",
          "build",
          "world-countries",
          "--source",
          sourcePath,
          "--output",
          outputPath
        ])
      ).resolves.toMatchObject({
        code: 1,
        payload: { ok: false, issues: [expect.objectContaining({ code: "OUTPUT_EXISTS" })] }
      });
      await expect(
        captureCli([
          "dataset",
          "build",
          "world-countries",
          "--source",
          sourcePath,
          "--output",
          outputPath,
          "--force",
          "--build-date",
          "2026-01-01T00:00:00.000Z"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: { ok: true, command: "dataset build" }
      });
      await expect(
        captureCli([
          "dataset",
          "build",
          "world-countries",
          "--source",
          sourcePath,
          "--output",
          join(tempDir, "strict-out"),
          "--strict"
        ])
      ).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: false,
          issues: expect.arrayContaining([
            expect.objectContaining({ code: "STRICT_FALLBACK_COUNTRY_CODE" })
          ])
        }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("lists and inspects source adapters", async () => {
    await expect(captureCliRaw(["source", "list"])).resolves.toMatchObject({
      code: 0,
      output: expect.stringContaining("natural-earth")
    });
    await expect(captureCli(["source", "list", "--json"])).resolves.toMatchObject({
      code: 0,
      payload: {
        ok: true,
        command: "source list",
        data: expect.arrayContaining([
          expect.objectContaining({ id: "geoboundaries" }),
          expect.objectContaining({ id: "geojson" }),
          expect.objectContaining({ id: "natural-earth" })
        ])
      }
    });
    await expect(captureCliRaw(["source", "info", "natural-earth"])).resolves.toMatchObject({
      code: 0,
      output: expect.stringContaining("Natural Earth")
    });
    await expect(
      captureCli([
        "sources",
        "inspect",
        "--provider",
        "geoboundaries",
        "--country",
        "TR",
        "--level",
        "ADM2",
        "--json"
      ])
    ).resolves.toMatchObject({
      code: 0,
      payload: {
        ok: true,
        command: "sources inspect",
        data: expect.objectContaining({
          id: "geoboundaries",
          request: {
            country: "TR",
            level: "ADM2"
          }
        })
      }
    });
    await expect(captureCli(["source", "info", "unknown"])).resolves.toMatchObject({
      code: 1,
      payload: {
        ok: false,
        issues: [expect.objectContaining({ code: "SOURCE_ADAPTER_NOT_FOUND" })]
      }
    });
  });

  it("prints the generated dataset coverage registry", async () => {
    await expect(captureCli(["dataset", "coverage", "--json"])).resolves.toMatchObject({
      code: 0,
      payload: {
        ok: true,
        command: "dataset coverage",
        data: {
          schemaVersion: "territorykit-coverage@2",
          summary: {
            totalCountries: 249,
            levels: {
              ADM0: { built: 236 },
              ADM1: {
                built: 197,
                "source-unavailable": 52
              },
              ADM2: {
                built: 179,
                "source-unavailable": 70
              },
              municipality: { "source-unavailable": 249 }
            },
            semanticReviewStatus: {
              ADM1: {
                "review-required": 244,
                reviewed: 5
              },
              ADM2: {
                "review-required": 244,
                reviewed: 5
              }
            },
            adjacencyStatus: {
              ADM1: {
                passed: 193,
                "not-run": 56
              },
              ADM2: {
                passed: 175,
                "not-run": 74
              }
            }
          }
        }
      }
    });
  });

  it("runs pilot country source lock, build, validate, and inspect commands", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-cli-country-"));
    const fixture = await createCountryCliFixture(tempDir);
    const lockPath = join(tempDir, "sources.lock.json");
    const outputPath = join(tempDir, "tr-artifact");

    try {
      await expect(captureCli(["country", "list", "--json"])).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "country list",
          data: expect.arrayContaining([expect.objectContaining({ country: "TR" })])
        }
      });
      await expect(captureCliRaw(["country", "info", "TR"])).resolves.toMatchObject({
        code: 0,
        output: expect.stringContaining("@territory-kit/data-tr")
      });
      await expect(
        captureCli([
          "country",
          "source",
          "lock",
          "TR",
          "--metadata",
          fixture.metadataPath,
          "--output",
          lockPath,
          "--build-date",
          "2026-01-01T00:00:00.000Z"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "country source lock",
          data: {
            country: "TR",
            outputPath: lockPath,
            lock: {
              country: { alpha2: "TR" }
            }
          }
        }
      });
      await expect(
        captureCli([
          "country",
          "source",
          "verify",
          lockPath,
          "--build-date",
          "2026-01-01T00:00:00.000Z"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: { ok: true, command: "country source verify" }
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
          "--build-adjacency",
          "--strict",
          "--build-date",
          "2026-01-01T00:00:00.000Z"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "country build",
          data: {
            country: "TR",
            manifest: {
              publishReady: true,
              featureCountByLevel: {
                ADM0: 1,
                ADM1: 2,
                ADM2: 4
              }
            },
            statistics: {
              adjacencyEdgeCountByLevel: {
                ADM1: 1,
                ADM2: 2
              }
            }
          }
        }
      });
      await expect(
        captureCli(["country", "validate", outputPath, "--strict"])
      ).resolves.toMatchObject({
        code: 0,
        payload: { ok: true, command: "country validate", issues: [] }
      });
      await expect(captureCli(["country", "inspect", outputPath])).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "country inspect",
          data: {
            country: "TR",
            publishReady: true,
            adjacency: {
              ADM1: 1,
              ADM2: 2
            }
          }
        }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("imports Natural Earth through the source pipeline", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-cli-source-"));
    const sourcePath = join(tempDir, "natural-earth.geojson");
    const outputPath = join(tempDir, "world-countries");
    const legacyOutputPath = join(tempDir, "world-countries-legacy");
    const source = JSON.stringify(createNaturalEarthCliFixture());
    await writeFile(sourcePath, source, "utf8");

    try {
      const result = await captureCli([
        "import",
        "natural-earth",
        "--input",
        sourcePath,
        "--output",
        outputPath,
        "--source-version",
        "fixture-1",
        "--source-sha256",
        sha256Hex(source),
        "--detail",
        "low,high",
        "--build-date",
        "2026-01-01T00:00:00.000Z"
      ]);

      expect(result).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "import natural-earth",
          data: {
            provider: "natural-earth",
            datasetId: "world-countries"
          }
        }
      });
      await expect(readFile(join(outputPath, "low", "dataset.json"), "utf8")).resolves.toContain(
        "world-countries"
      );
      await expect(readFile(join(outputPath, "high", "dataset.json"), "utf8")).resolves.toContain(
        "world-countries"
      );
      await expect(
        captureCli([
          "dataset",
          "build",
          "world-countries",
          "--source",
          sourcePath,
          "--output",
          legacyOutputPath,
          "--source-version",
          "fixture-1",
          "--source-sha256",
          sha256Hex(source),
          "--detail",
          "high",
          "--build-date",
          "2026-01-01T00:00:00.000Z"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: { ok: true, command: "dataset build" }
      });
      await expect(readFile(join(outputPath, "high", "dataset.json"), "utf8")).resolves.toBe(
        await readFile(join(legacyOutputPath, "high", "dataset.json"), "utf8")
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("imports generic GeoJSON and geoBoundaries source fixtures", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-cli-source-"));
    const geojsonPath = join(tempDir, "regions.geojson");
    const geojsonOutput = join(tempDir, "regions");
    const adjacentGeojsonPath = join(tempDir, "adjacent-regions.geojson");
    const adjacentGeojsonOutput = join(tempDir, "adjacent-regions");
    const geoBoundariesPath = join(tempDir, "geoBoundaries-TUR-ADM1.geojson");
    const geoBoundariesOutput = join(tempDir, "tr-adm1");
    await writeFile(geojsonPath, JSON.stringify(createGenericGeoJsonCliFixture()), "utf8");
    await writeFile(adjacentGeojsonPath, JSON.stringify(createAdjacentGeoJsonCliFixture()), "utf8");
    await writeFile(geoBoundariesPath, JSON.stringify(createGeoBoundariesCliFixture()), "utf8");

    try {
      await expect(
        captureCli([
          "import",
          "geojson",
          "--input",
          geojsonPath,
          "--output",
          geojsonOutput,
          "--country",
          "TR",
          "--admin-level",
          "ADM2",
          "--id-property",
          "region.code",
          "--name-property",
          "region.name",
          "--parent-property",
          "region.parent",
          "--license",
          "CC BY 4.0",
          "--attribution",
          "Synthetic fixture",
          "--build-date",
          "2026-01-01T00:00:00.000Z"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "import geojson",
          data: { datasetId: "geojson-tr-adm2", zoneCount: 2 }
        }
      });
      await expect(readFile(join(geojsonOutput, "dataset.json"), "utf8")).resolves.toContain(
        "tr:adm2:kadikoy"
      );
      await expect(
        captureCli([
          "import",
          "geojson",
          "--input",
          adjacentGeojsonPath,
          "--output",
          adjacentGeojsonOutput,
          "--country",
          "TR",
          "--admin-level",
          "ADM2",
          "--id-property",
          "region.code",
          "--name-property",
          "region.name",
          "--build-date",
          "2026-01-01T00:00:00.000Z",
          "--build-adjacency"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "import geojson",
          data: {
            adjacencyOutputPath: join(adjacentGeojsonOutput, "adjacency")
          }
        }
      });
      await expect(
        readFile(join(adjacentGeojsonOutput, "adjacency", "adjacency.json"), "utf8")
      ).resolves.toContain('"generatedAt": "2026-01-01T00:00:00.000Z"');
      await expect(
        captureCli([
          "import",
          "geoboundaries",
          "--input",
          geoBoundariesPath,
          "--output",
          geoBoundariesOutput,
          "--country",
          "TR",
          "--admin-level",
          "ADM1",
          "--release-type",
          "gbOpen",
          "--build-date",
          "2026-01-01T00:00:00.000Z"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "import geoboundaries",
          data: { datasetId: "geoboundaries-tr-adm1", zoneCount: 2 }
        }
      });
      await expect(readFile(join(geoBoundariesOutput, "dataset.json"), "utf8")).resolves.toContain(
        "CC BY 4.0"
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("reports source import errors with non-zero exit codes", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-cli-source-"));
    const geojsonPath = join(tempDir, "regions.geojson");
    await writeFile(geojsonPath, JSON.stringify(createGenericGeoJsonCliFixture()), "utf8");

    try {
      await expect(
        captureCli(["import", "unknown", "--input", geojsonPath, "--output", join(tempDir, "out")])
      ).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: false,
          issues: [expect.objectContaining({ code: "SOURCE_ADAPTER_NOT_FOUND" })]
        }
      });
      await expect(
        captureCli(["import", "geojson", "--input", geojsonPath])
      ).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: false,
          issues: [expect.objectContaining({ message: expect.stringContaining("--output") })]
        }
      });
      await expect(
        captureCli([
          "import",
          "geojson",
          "--input",
          geojsonPath,
          "--output",
          join(tempDir, "invalid-country"),
          "--country",
          "TUR",
          "--admin-level",
          "ADM2",
          "--name-property",
          "region.name"
        ])
      ).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: false,
          issues: [expect.objectContaining({ code: "SOURCE_OPTIONS_INVALID" })]
        }
      });
      await expect(
        captureCli([
          "import",
          "geojson",
          "--url",
          "ftp://example.com/regions.geojson",
          "--output",
          join(tempDir, "ftp"),
          "--country",
          "TR",
          "--admin-level",
          "ADM2",
          "--name-property",
          "region.name"
        ])
      ).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: false,
          issues: [expect.objectContaining({ code: "SOURCE_PROTOCOL_UNSUPPORTED" })]
        }
      });
      await expect(
        captureCli([
          "import",
          "geojson",
          "--input",
          geojsonPath,
          "--output",
          join(tempDir, "checksum"),
          "--country",
          "TR",
          "--admin-level",
          "ADM2",
          "--name-property",
          "region.name",
          "--source-sha256",
          "wrong"
        ])
      ).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: false,
          issues: [expect.objectContaining({ code: "SOURCE_CHECKSUM_MISMATCH" })]
        }
      });
      await expect(
        captureCli([
          "import",
          "geojson",
          "--input",
          geojsonPath,
          "--output",
          join(tempDir, "strict"),
          "--country",
          "TR",
          "--admin-level",
          "ADM2",
          "--id-property",
          "missing",
          "--name-property",
          "region.name",
          "--strict"
        ])
      ).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: false,
          issues: expect.arrayContaining([
            expect.objectContaining({ code: "STRICT_SOURCE_ID_FALLBACK" })
          ])
        }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

async function captureCli(args: string[]): Promise<{ code: number; payload: unknown }> {
  const logs: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((message: unknown) => {
    logs.push(String(message));
  });

  try {
    const code = await runCli(args);
    const payload = JSON.parse(logs.at(-1) ?? "{}") as unknown;

    return { code, payload };
  } finally {
    spy.mockRestore();
  }
}

async function captureCliRaw(args: string[]): Promise<{ code: number; output: string }> {
  const logs: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((message: unknown) => {
    logs.push(String(message));
  });

  try {
    const code = await runCli(args);

    return { code, output: logs.join("\n") };
  } finally {
    spy.mockRestore();
  }
}

function readPayload(payload: unknown, path: string): unknown {
  if (path !== "$.data.manifest.geometryHash") {
    throw new Error(`Unsupported test payload path '${path}'.`);
  }

  return isRecord(payload) &&
    isRecord(payload.data) &&
    isRecord(payload.data.manifest) &&
    typeof payload.data.manifest.geometryHash === "string"
    ? payload.data.manifest.geometryHash
    : undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function createRepairableGeometryDataset(): ReturnType<typeof createSampleTerritoryDataset> {
  const dataset = createSampleTerritoryDataset();
  const zoneIndex = dataset.zones.findIndex((zone) => zone.id === "tr:34:kadikoy");
  const zone = dataset.zones[zoneIndex];

  if (!zone) {
    throw new Error("Fixture zone missing.");
  }

  dataset.zones[zoneIndex] = {
    ...zone,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [29, 40.97],
          [29.08, 40.97],
          [29.08, 40.97],
          [29.08, 41.02],
          [29, 41.02]
        ]
      ]
    },
    bbox: [0, 0, 0, 0],
    center: [0, 0]
  };

  return dataset;
}

function createAdjacencyCliDataset(): unknown {
  return {
    manifest: {
      datasetId: "adjacency-cli",
      datasetVersion: "0.1.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-07",
      geometryHash: "adjacency-cli-hash"
    },
    zones: [
      {
        ...adjacencyCliZone("root", 0, 0, 0, 4, 2),
        childIds: ["a", "b", "c", "d"]
      },
      adjacencyCliZone("a", 1, 0, 0, 1, 1, "root"),
      adjacencyCliZone("b", 1, 1, 0, 2, 1, "root"),
      adjacencyCliZone("c", 1, 1, 1, 2, 2, "root"),
      adjacencyCliZone("d", 1, 3, 0, 4, 1, "root")
    ]
  };
}

function adjacencyCliZone(
  id: string,
  level: number,
  west: number,
  south: number,
  east: number,
  north: number,
  parentId?: string
): Record<string, unknown> {
  return {
    id,
    datasetId: "adjacency-cli",
    level,
    ...(parentId ? { parentId } : {}),
    neighborIds: [],
    geometry: {
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
    },
    center: [(west + east) / 2, (south + north) / 2],
    bbox: [west, south, east, north],
    properties: {}
  };
}

async function createCountryCliFixture(tempDir: string): Promise<{ metadataPath: string }> {
  const adm0Path = join(tempDir, "tr-adm0.geojson");
  const adm1Path = join(tempDir, "tr-adm1.geojson");
  const adm2Path = join(tempDir, "tr-adm2.geojson");
  const metadataPath = join(tempDir, "metadata.json");

  await writeFile(
    adm0Path,
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        countryCliFeature(
          "TR-ADM0",
          "TR",
          undefined,
          "Turkiye",
          "country",
          "TR",
          rectCli(0, 0, 2, 2)
        )
      ]
    }),
    "utf8"
  );
  await writeFile(
    adm1Path,
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        countryCliFeature(
          "TR-ADM1-1",
          "TR-01",
          "TR",
          "Alpha",
          "province",
          "TR-01",
          rectCli(0, 0, 1, 2)
        ),
        countryCliFeature(
          "TR-ADM1-2",
          "TR-02",
          "TR",
          "Beta",
          "province",
          "TR-02",
          rectCli(1, 0, 2, 2)
        )
      ]
    }),
    "utf8"
  );
  await writeFile(
    adm2Path,
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        countryCliFeature(
          "TR-ADM2-1",
          "TR-01-A",
          "TR-01",
          "Alpha North",
          "district",
          "TR-01-A",
          rectCli(0, 0, 1, 1)
        ),
        countryCliFeature(
          "TR-ADM2-2",
          "TR-01-B",
          "TR-01",
          "Alpha South",
          "district",
          "TR-01-B",
          rectCli(0, 1, 1, 2)
        ),
        countryCliFeature(
          "TR-ADM2-3",
          "TR-02-A",
          "TR-02",
          "Beta North",
          "district",
          "TR-02-A",
          rectCli(1, 0, 2, 1)
        ),
        countryCliFeature(
          "TR-ADM2-4",
          "TR-02-B",
          "TR-02",
          "Beta South",
          "district",
          "TR-02-B",
          rectCli(1, 1, 2, 2)
        )
      ]
    }),
    "utf8"
  );
  await writeFile(
    metadataPath,
    JSON.stringify(
      [
        ["ADM0", adm0Path],
        ["ADM1", adm1Path],
        ["ADM2", adm2Path]
      ].map(([adminLevel, sourceUrl]) => ({
        countryCodeAlpha3: "TUR",
        adminLevel,
        releaseType: "gbOpen",
        sourceUrl,
        sourceVersion: "tr-cli-fixture-1",
        boundaryYearRepresented: "2026",
        license: "CC BY 4.0",
        attribution: `Synthetic TR ${adminLevel} fixture`
      }))
    ),
    "utf8"
  );

  return { metadataPath };
}

function countryCliFeature(
  id: string,
  shapeID: string,
  parentShapeID: string | undefined,
  shapeName: string,
  shapeType: string,
  officialCode: string,
  geometry: unknown
): unknown {
  return {
    type: "Feature",
    id,
    properties: {
      shapeID,
      ...(parentShapeID ? { parentShapeID } : {}),
      shapeName,
      shapeType,
      officialCode
    },
    geometry
  };
}

function createNaturalEarthCliFixture(): unknown {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "TUR",
        properties: {
          ISO_A2: "TR",
          ADM0_A3: "TUR",
          NAME: "Turkiye",
          NAME_EN: "Turkey"
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [25, 36],
              [45, 36],
              [45, 42],
              [25, 42],
              [25, 36]
            ]
          ]
        }
      },
      {
        type: "Feature",
        id: "ISL",
        properties: {
          ISO_A2: "IS",
          ADM0_A3: "ISL",
          NAME: "Islandia",
          NAME_EN: "Islandia"
        },
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [-20, 60],
                [-19, 60],
                [-19, 61],
                [-20, 61],
                [-20, 60]
              ]
            ],
            [
              [
                [-18, 60],
                [-17, 60],
                [-17, 61],
                [-18, 61],
                [-18, 60]
              ]
            ]
          ]
        }
      },
      {
        type: "Feature",
        id: "XAA",
        properties: {
          ISO_A2: "-99",
          ISO_A2_EH: "XA",
          ADM0_A3: "XAA",
          NAME: "Fallbackland"
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [60, 10],
              [61, 10],
              [61, 11],
              [60, 11],
              [60, 10]
            ]
          ]
        }
      }
    ]
  };
}

function createGenericGeoJsonCliFixture(): unknown {
  return {
    type: "FeatureCollection",
    features: [
      genericCliFeature("b", "USKUDAR", "Uskudar", "IST"),
      genericCliFeature("a", "KADIKOY", "Kadikoy", "IST")
    ]
  };
}

function createAdjacentGeoJsonCliFixture(): unknown {
  return {
    type: "FeatureCollection",
    features: [
      genericCliFeature("left", "LEFT", "Left", "IST", squareCli(0, 0)),
      genericCliFeature("right", "RIGHT", "Right", "IST", squareCli(1, 0))
    ]
  };
}

function genericCliFeature(
  id: string,
  code: string,
  name: string,
  parent: string,
  geometry: unknown = squareCli(29, 40)
): unknown {
  return {
    type: "Feature",
    id,
    properties: { region: { code, name, parent } },
    geometry
  };
}

function createGeoBoundariesCliFixture(): unknown {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "gb-2",
        properties: {
          shapeID: "TUR-ADM1-2",
          shapeName: "Ankara",
          shapeGroup: "TR",
          shapeType: "ADM1"
        },
        geometry: squareCli(32, 39)
      },
      {
        type: "Feature",
        id: "gb-1",
        properties: {
          shapeID: "TUR-ADM1-1",
          shapeName: "Istanbul",
          shapeGroup: "TR",
          shapeType: "ADM1"
        },
        geometry: squareCli(28, 40)
      }
    ]
  };
}

function squareCli(west: number, south: number): unknown {
  return rectCli(west, south, west + 1, south + 1);
}

function rectCli(west: number, south: number, east: number, north: number): unknown {
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
