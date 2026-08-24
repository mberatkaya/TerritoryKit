import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256Hex } from "@territory-kit/generators";
import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";

interface SimplificationCliPayload {
  data: {
    report: {
      ok: boolean;
      reportVersion: string;
      tiers: Array<{
        topologyAudit: {
          sharedSegmentCountBefore: number;
          sharedSegmentCountAfter: number;
          geometryValidation: {
            invalidFeatureCount: number;
          };
        };
      }>;
    };
  };
}

describe("territory cli", () => {
  it("validates a dataset file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-"));
    const filePath = join(tempDir, "dataset.json");
    const indexPath = join(tempDir, "dataset.tksi");

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
      await expect(
        captureCli(["index", "build", filePath, "--output", indexPath])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "index build",
          data: {
            magic: "TKSI",
            datasetId: "territorykit-sample",
            zoneCount: 5
          }
        }
      });
      await expect(captureCli(["index", "inspect", indexPath])).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "index inspect",
          data: { datasetId: "territorykit-sample", bboxRecordCount: 5 }
        }
      });
      await expect(
        captureCli(["index", "validate", indexPath, "--dataset", filePath])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "index validate",
          data: { geometryHash: "sample-fixture-v1" }
        }
      });
      expect((await readFile(indexPath)).byteLength).toBeGreaterThan(0);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("dry-runs legacy spatial migration mappings", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-cli-migrate-"));
    const datasetPath = join(tempDir, "dataset.json");
    const sourcePath = join(tempDir, "source-zones.json");
    const outputPath = join(tempDir, "migration-plan.json");

    await writeFile(datasetPath, JSON.stringify(createSampleTerritoryDataset()), "utf8");
    await writeFile(
      sourcePath,
      JSON.stringify([
        {
          h3Index: "legacy-cell-fatih",
          center: [28.95, 41.01],
          ownerId: "user-1",
          score: 12
        }
      ]),
      "utf8"
    );

    try {
      await expect(
        captureCli([
          "migrate-spatial",
          "--source",
          sourcePath,
          "--target-dataset",
          datasetPath,
          "--strategy",
          "centroid",
          "--target-level",
          "3",
          "--source-system",
          "rushandclaim-h3",
          "--build-date",
          "2026-08-24T00:00:00.000Z",
          "--output",
          outputPath
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "migrate-spatial",
          data: {
            outputPath,
            manifest: {
              targetDatasetId: "territorykit-sample",
              mappingStrategy: "centroid",
              summary: {
                sourceCount: 1,
                mappedCount: 1
              }
            }
          }
        }
      });

      await expect(readFile(outputPath, "utf8").then(JSON.parse)).resolves.toMatchObject({
        manifest: {
          sourceSystem: "rushandclaim-h3",
          dryRun: true
        },
        mappings: [
          {
            sourceSpatialId: "legacy-cell-fatih",
            targetTerritoryId: "tr:34:fatih",
            confidence: "HIGH"
          }
        ]
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("validates Turkey V2 datasets with the strict profile", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-tr-v2-cli-"));
    const validPath = join(tempDir, "tr-v2-valid.json");
    const invalidPath = join(tempDir, "tr-v2-invalid.json");

    await writeFile(validPath, JSON.stringify(createCliTurkeyV2Dataset()), "utf8");
    await writeFile(
      invalidPath,
      JSON.stringify(
        createCliTurkeyV2Dataset({
          official: false
        })
      ),
      "utf8"
    );

    try {
      await expect(
        captureCli(["validate", validPath, "--profile", "tr-v2"])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "validate",
          profile: "tr-v2",
          data: { issues: [] }
        }
      });
      await expect(
        captureCli(["validate", invalidPath, "--profile", "tr-v2", "--json"])
      ).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: false,
          command: "validate",
          profile: "tr-v2",
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: "SOURCE_FLAG_CONFLICT",
              datasetId: "territory-kit-tr-v2-cli",
              zoneId: "tr:adm3:34-003-official-1"
            })
          ])
        }
      });
      await expect(
        captureCli(["validate", validPath, "--profile", "unknown"])
      ).resolves.toMatchObject({
        code: 2,
        payload: {
          ok: false,
          issues: [expect.objectContaining({ code: "VALIDATION_PROFILE_UNSUPPORTED" })]
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

  it("builds topology-safe simplification tiers without publishing duplicate hashes", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-simplify-"));
    const filePath = join(tempDir, "dataset.json");
    const outputPath = join(tempDir, "simplified");
    const reportPath = join(tempDir, "simplification-report.json");

    await writeFile(filePath, JSON.stringify(createSharedBoundarySimplificationDataset()), "utf8");

    try {
      const result = await captureCli([
        "geometry",
        "simplify",
        filePath,
        "--strategy",
        "topology-safe",
        "--detail",
        "medium",
        "--output",
        outputPath,
        "--report",
        reportPath
      ]);

      expect(result).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "geometry simplify",
          data: {
            reportPath,
            report: {
              reportVersion: "2",
              ok: true,
              tiers: [
                expect.objectContaining({
                  detail: "medium",
                  status: "generated",
                  topologyAudit: expect.objectContaining({
                    ok: true,
                    sharedBoundaryMismatchCount: 0,
                    geometryValidation: expect.objectContaining({
                      ok: true,
                      invalidFeatureCount: 0,
                      errorCount: 0
                    })
                  })
                })
              ]
            }
          },
          issues: []
        }
      });
      const report = (result.payload as SimplificationCliPayload).data.report;
      const tier = report.tiers[0]!;
      expect(tier.topologyAudit.sharedSegmentCountAfter).toBeLessThan(
        tier.topologyAudit.sharedSegmentCountBefore
      );
      await expect(readFile(join(outputPath, "medium", "dataset.json"), "utf8")).resolves.toContain(
        '"geometryDetail": "medium"'
      );
      await expect(JSON.parse(await readFile(reportPath, "utf8"))).toMatchObject(report);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("returns a quality-failure exit code when simplified output is invalid", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-simplify-invalid-"));
    const filePath = join(tempDir, "dataset.json");
    const outputPath = join(tempDir, "simplified");
    const reportPath = join(tempDir, "simplification-report.json");

    await writeFile(filePath, JSON.stringify(createInvalidSimplificationDataset()), "utf8");

    try {
      const result = await captureCli([
        "geometry",
        "simplify",
        filePath,
        "--strategy",
        "topology-safe",
        "--detail",
        "high",
        "--output",
        outputPath,
        "--report",
        reportPath
      ]);

      expect(result).toMatchObject({
        code: 1,
        payload: {
          ok: false,
          command: "geometry simplify",
          data: {
            reportPath,
            report: {
              reportVersion: "2",
              ok: false,
              tiers: [
                expect.objectContaining({
                  detail: "high",
                  topologyAudit: expect.objectContaining({
                    ok: false,
                    geometryValidation: expect.objectContaining({
                      ok: false,
                      invalidFeatureCount: expect.any(Number),
                      errorCount: expect.any(Number)
                    })
                  })
                })
              ]
            }
          },
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: "SIMPLIFIED_GEOMETRY_INVALID",
              detail: "high",
              geometryIssueCode: "HOLE_OUTSIDE_SHELL",
              zoneId: "invalid-hole"
            })
          ])
        }
      });
      const report = (result.payload as SimplificationCliPayload).data.report;
      expect(report.tiers[0]!.topologyAudit.geometryValidation.invalidFeatureCount).toBeGreaterThan(
        0
      );
      await expect(JSON.parse(await readFile(reportPath, "utf8"))).toMatchObject(report);
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
      const metrics = isRecord(data) && isRecord(data.metrics) ? data.metrics : {};
      const benchmarkBudget = (metric: string): number => {
        const value = Number(metrics[metric]);

        return Number.isFinite(value) ? value + Math.max(1, value) : 1_000;
      };
      await writeFile(currentPath, JSON.stringify(data), "utf8");
      await writeFile(
        baselinePath,
        JSON.stringify({
          schemaVersion: "territorykit-benchmark-baseline@1",
          mode: "fixture",
          scenario: "smoke",
          minimumFeatureCount: 4,
          budgets: {
            datasetValidationMs: benchmarkBudget("datasetValidationMs"),
            engineConstructionMs: benchmarkBudget("engineConstructionMs"),
            getZoneByIdMeanMs: benchmarkBudget("getZoneByIdMeanMs"),
            latLngToZoneMeanMs: benchmarkBudget("latLngToZoneMeanMs"),
            getZonesInBoundsMeanMs: benchmarkBudget("getZonesInBoundsMeanMs")
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
          expect.objectContaining({ id: "hdx-cod-ab" }),
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
          },
          capabilities: expect.objectContaining({
            levels: expect.objectContaining({
              ADM2: expect.objectContaining({
                supported: true,
                status: "source-unavailable"
              })
            })
          })
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
              ADM0: { built: 228 },
              ADM1: {
                built: 5,
                "not-reviewed": 244
              },
              ADM2: {
                built: 5,
                "not-reviewed": 244
              },
              ADM3: {
                partial: 1,
                "not-reviewed": 248
              },
              ADM4: { "not-reviewed": 249 },
              ADM5: { "not-reviewed": 249 }
            },
            semanticReviewStatus: {
              ADM0: {
                reviewed: 249
              },
              ADM1: {
                "mapping-review-required": 244,
                reviewed: 5
              },
              ADM2: {
                "mapping-review-required": 244,
                reviewed: 5
              },
              ADM3: {
                "mapping-review-required": 248,
                reviewed: 1
              }
            },
            sourceStatus: {
              ADM1: {
                available: 5,
                "not-reviewed": 244
              },
              ADM2: {
                available: 5,
                "not-reviewed": 244
              },
              ADM3: {
                available: 1,
                "not-reviewed": 248
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
          "--levels",
          "ADM0,ADM1,ADM2",
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
      const build = await captureCli([
        "country",
        "build",
        "TR",
        "--source-lock",
        lockPath,
        "--levels",
        "ADM0,ADM1,ADM2",
        "--output",
        outputPath,
        "--build-adjacency",
        "--strict",
        "--profile",
        "--phase-timeout-ms",
        "300000",
        "--build-date",
        "2026-01-01T00:00:00.000Z"
      ]);
      expect(build).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "country build",
          data: {
            country: "TR",
            profilePath: join(outputPath, "build-performance-report.json"),
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
      const performanceReport = JSON.parse(
        await readFile(join(outputPath, "build-performance-report.json"), "utf8")
      ) as {
        summary: { featureCount: number; artifactCount: number; peakMemoryBytes: number };
        phases: Array<{ phase: string; durationMs: number; completedAt: string }>;
      };
      expect(performanceReport.summary.featureCount).toBe(7);
      expect(performanceReport.summary.artifactCount).toBeGreaterThan(0);
      expect(performanceReport.summary.peakMemoryBytes).toBeGreaterThan(0);
      expect(performanceReport.phases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ phase: "adjacency-generation" }),
          expect.objectContaining({ phase: "serialization" }),
          expect.objectContaining({ phase: "artifact-write" })
        ])
      );
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
    const hdxCodAbPath = join(tempDir, "tur_admin2.geojson");
    const hdxCodAbOutput = join(tempDir, "tr-adm2-hdx");
    await writeFile(geojsonPath, JSON.stringify(createGenericGeoJsonCliFixture()), "utf8");
    await writeFile(adjacentGeojsonPath, JSON.stringify(createAdjacentGeoJsonCliFixture()), "utf8");
    await writeFile(geoBoundariesPath, JSON.stringify(createGeoBoundariesCliFixture()), "utf8");
    await writeFile(hdxCodAbPath, JSON.stringify(createHdxCodAbCliFixture()), "utf8");

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
      await expect(
        captureCli([
          "import",
          "hdx-cod-ab",
          "--input",
          hdxCodAbPath,
          "--output",
          hdxCodAbOutput,
          "--country",
          "TR",
          "--admin-level",
          "ADM2",
          "--build-date",
          "2026-01-01T00:00:00.000Z"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "import hdx-cod-ab",
          data: { datasetId: "hdx-cod-ab-tr-adm2", zoneCount: 1 }
        }
      });
      await expect(readFile(join(hdxCodAbOutput, "dataset.json"), "utf8")).resolves.toContain(
        "tr:adm2:tr0116"
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

  it("shows spatial migration help", async () => {
    await expect(captureCliRaw(["migrate-spatial", "--help"])).resolves.toMatchObject({
      code: 0,
      output: expect.stringContaining("territory migrate-spatial --source")
    });
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
        releaseType: "hdx-cod-ab",
        sourceUrl,
        sourceVersion: "tr-cli-fixture-1",
        boundaryYearRepresented: "2026",
        license: "CC BY-IGO",
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
  const isAdm2 = shapeID.split("-").length > 2;

  return {
    type: "Feature",
    id,
    properties: {
      shapeID,
      ...(parentShapeID ? { parentShapeID } : {}),
      shapeName,
      shapeType,
      officialCode,
      adm0_pcode: parentShapeID ?? shapeID,
      adm0_name1: shapeName,
      adm1_pcode: isAdm2 && parentShapeID ? parentShapeID : shapeID,
      adm1_name1: shapeName,
      adm2_pcode: shapeID,
      adm2_name1: shapeName
    },
    geometry
  };
}

function createSharedBoundarySimplificationDataset(): unknown {
  return {
    manifest: {
      datasetId: "simplify-shared-boundary",
      datasetVersion: "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-01-01",
      geometryHash: "fixture",
      adminLevels: ["ADM2"],
      artifactChecksum: "fixture",
      attribution: "fixture",
      boundaryPolicy: "fixture",
      buildDate: "2026-01-01T00:00:00.000Z",
      countryCodes: ["tr"],
      crs: "EPSG:4326",
      disputedAreaPolicy: "fixture",
      geometryDetail: "source",
      license: "Apache-2.0",
      name: "Simplify shared boundary fixture",
      sourceProvider: "fixture",
      worldview: "fixture"
    },
    zones: [
      sharedBoundaryZone("left", [
        [0, 0],
        [1, 0],
        [1, 0.25],
        [1, 0.5],
        [1, 0.75],
        [1, 1],
        [0, 1],
        [0, 0]
      ]),
      sharedBoundaryZone("right", [
        [1, 0],
        [2, 0],
        [2, 1],
        [1, 1],
        [1, 0.75],
        [1, 0.5],
        [1, 0.25],
        [1, 0]
      ])
    ]
  };
}

function createInvalidSimplificationDataset(): unknown {
  return {
    manifest: {
      datasetId: "simplify-invalid-geometry",
      datasetVersion: "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-01-01",
      geometryHash: "fixture",
      adminLevels: ["ADM2"],
      artifactChecksum: "fixture",
      attribution: "fixture",
      boundaryPolicy: "fixture",
      buildDate: "2026-01-01T00:00:00.000Z",
      countryCodes: ["tr"],
      crs: "EPSG:4326",
      disputedAreaPolicy: "fixture",
      geometryDetail: "source",
      license: "Apache-2.0",
      name: "Invalid simplification fixture",
      sourceProvider: "fixture",
      worldview: "fixture"
    },
    zones: [
      polygonZoneWithRings(
        "invalid-hole",
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0]
        ],
        [
          [2, 2],
          [3, 2],
          [3, 3],
          [2, 3],
          [2, 2]
        ],
        "simplify-invalid-geometry"
      )
    ]
  };
}

function polygonZoneWithRings(
  id: string,
  shell: number[][],
  hole: number[][],
  datasetId: string
): unknown {
  const coordinates = [shell, hole];
  const points = coordinates.flat();
  const lngs = points.map((point) => point[0] ?? 0);
  const lats = points.map((point) => point[1] ?? 0);
  const bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)] as [
    number,
    number,
    number,
    number
  ];

  return {
    id,
    datasetId,
    countryCode: "TR",
    level: 2,
    sourceAdminLevel: "ADM2",
    semanticType: "district",
    name: id,
    neighborIds: [],
    geometry: { type: "Polygon", coordinates },
    center: [0.5, 0.5],
    bbox,
    properties: {
      name: id,
      territory: {
        adminLevel: "ADM2",
        sourceAdminLevel: "ADM2",
        semanticType: "district",
        coverageStatus: "generated"
      }
    }
  };
}

function sharedBoundaryZone(
  id: string,
  ring: number[][],
  datasetId = "simplify-shared-boundary"
): unknown {
  const lngs = ring.map((point) => point[0] ?? 0);
  const lats = ring.map((point) => point[1] ?? 0);
  const bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)] as [
    number,
    number,
    number,
    number
  ];

  return {
    id,
    datasetId,
    countryCode: "TR",
    level: 2,
    sourceAdminLevel: "ADM2",
    semanticType: "district",
    name: id,
    neighborIds: [],
    geometry: { type: "Polygon", coordinates: [ring] },
    center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
    bbox,
    properties: {
      name: id,
      territory: {
        adminLevel: "ADM2",
        sourceAdminLevel: "ADM2",
        semanticType: "district",
        coverageStatus: "generated"
      }
    }
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

function createHdxCodAbCliFixture(): unknown {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "tur-adm2-fatih",
        properties: {
          adm2_pcode: "TR0116",
          adm2_name1: "Fatih",
          adm1_pcode: "TR01"
        },
        geometry: squareCli(28, 40)
      }
    ]
  };
}

function createCliTurkeyV2Dataset(options: { official?: boolean } = {}): unknown {
  const datasetId = "territory-kit-tr-v2-cli";
  const source = {
    provider: "fixture-official-provider",
    sourceClass: "official",
    sourceDatasetId: "fixture-official",
    sourceId: "official-1",
    sourceNativeId: "official-1",
    sourceUrl: "https://data.example.test/tr/adm3",
    sourceDate: "2026-08-01",
    license: "CC BY 4.0",
    attribution: "Fixture"
  };

  return {
    manifest: {
      datasetId,
      datasetVersion: "1.1.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-08-13",
      buildDate: "2026-08-13T00:00:00.000Z",
      geometryHash: "cli-tr-v2",
      adminLevels: ["ADM0", "ADM1", "ADM2", "ADM3"],
      countryCodes: ["TR"]
    },
    zones: [
      cliTurkeyV2Zone({
        datasetId,
        id: "tr",
        level: 0,
        semanticType: "country",
        childIds: ["tr:adm1:34"],
        territory: {
          adminLevel: "ADM0",
          sourceAdminLevel: "ADM0",
          semanticType: "country",
          hierarchyDepth: 0,
          countryCode: "TR",
          coverageStatus: "verified",
          semanticReviewStatus: "reviewed"
        }
      }),
      cliTurkeyV2Zone({
        datasetId,
        id: "tr:adm1:34",
        level: 1,
        semanticType: "province",
        parentId: "tr",
        childIds: ["tr:adm2:34-003"],
        territory: {
          adminLevel: "ADM1",
          sourceAdminLevel: "ADM1",
          semanticType: "province",
          hierarchyDepth: 1,
          parentId: "tr",
          countryCode: "TR",
          provinceCode: "34",
          coverageStatus: "verified",
          semanticReviewStatus: "reviewed"
        }
      }),
      cliTurkeyV2Zone({
        datasetId,
        id: "tr:adm2:34-003",
        level: 2,
        semanticType: "district",
        parentId: "tr:adm1:34",
        childIds: ["tr:adm3:34-003-official-1"],
        territory: {
          adminLevel: "ADM2",
          sourceAdminLevel: "ADM2",
          semanticType: "district",
          hierarchyDepth: 2,
          parentId: "tr:adm1:34",
          countryCode: "TR",
          provinceCode: "34",
          districtCode: "003",
          coverageStatus: "verified",
          semanticReviewStatus: "reviewed"
        }
      }),
      cliTurkeyV2Zone({
        datasetId,
        id: "tr:adm3:34-003-official-1",
        level: 3,
        semanticType: "neighbourhood",
        parentId: "tr:adm2:34-003",
        territory: {
          adminLevel: "ADM3",
          sourceAdminLevel: "ADM3",
          semanticType: "neighbourhood",
          localType: "neighbourhood",
          localTypeName: "Mahalle",
          hierarchyDepth: 3,
          parentId: "tr:adm2:34-003",
          countryCode: "TR",
          provinceCode: "34",
          districtCode: "003",
          sourceClass: "official",
          sourceProvider: source.provider,
          sourceDatasetId: source.sourceDatasetId,
          sourceNativeId: source.sourceNativeId,
          sourceDate: source.sourceDate,
          sourceUrl: source.sourceUrl,
          license: source.license,
          attribution: source.attribution,
          official: options.official ?? true,
          generated: false,
          coverageStatus: "verified",
          semanticReviewStatus: "reviewed",
          stableId: "tr:adm3:34-003-official-1",
          source
        }
      })
    ]
  };
}

function cliTurkeyV2Zone(input: {
  datasetId: string;
  id: string;
  level: number;
  semanticType: string;
  territory: Record<string, unknown>;
  parentId?: string;
  childIds?: string[];
}): unknown {
  return {
    id: input.id,
    datasetId: input.datasetId,
    countryCode: "TR",
    level: input.level,
    sourceAdminLevel: `ADM${input.level}`,
    semanticType: input.semanticType,
    name: input.id,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    ...(input.childIds ? { childIds: input.childIds } : {}),
    neighborIds: [],
    geometry: rectCli(28.9 + input.level * 0.01, 41, 29 + input.level * 0.01, 41.05),
    center: [28.95 + input.level * 0.01, 41.025],
    bbox: [28.9 + input.level * 0.01, 41, 29 + input.level * 0.01, 41.05],
    properties: {
      territory: input.territory
    }
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
