import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
