import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

describe("territory cli", () => {
  it("validates a dataset file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-"));
    const filePath = join(tempDir, "dataset.json");

    await writeFile(filePath, JSON.stringify(createSampleTerritoryDataset()), "utf8");

    try {
      await expect(runCli(["validate", filePath])).resolves.toBe(0);
      await expect(runCli(["index", filePath])).resolves.toBe(0);
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
      await expect(
        runCli(["import", geojsonPath, "--dataset-id", "cli-import", "--source-date", "2026-07"])
      ).resolves.toBe(0);
      await expect(
        runCli([
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
      ).resolves.toBe(0);
      await expect(
        runCli(["generate", "--kind", "weighted-voronoi", "--dataset-id", "cli-voronoi"])
      ).resolves.toBe(0);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
