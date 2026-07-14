import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
