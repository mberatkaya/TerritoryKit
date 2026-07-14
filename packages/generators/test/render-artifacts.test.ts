import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it } from "vitest";
import {
  buildTerritoryRenderArtifactPath,
  buildTerritoryRenderArtifacts,
  validateTerritoryRenderArtifactPath
} from "../src/render-artifacts.js";

describe("render artifacts", () => {
  it("builds deterministic MVT directory artifacts", async () => {
    const dataset = createSampleTerritoryDataset();
    const result = buildTerritoryRenderArtifacts({
      dataset,
      format: "mvt",
      minZoom: 0,
      maxZoom: 0,
      buildDate: "2026-01-01T00:00:00.000Z"
    });

    expect(result.manifest.format).toBe("mvt");
    expect(result.files.get("render/tiles/0/0/0.mvt")).toBeInstanceOf(Uint8Array);
    expect((result.files.get("render/tiles/0/0/0.mvt") as Uint8Array).byteLength).toBeGreaterThan(
      0
    );
  });

  it("writes and validates render artifact directories", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-render-"));
    const datasetPath = join(tempDir, "dataset.json");
    const outputPath = join(tempDir, "render-output");

    await writeFile(datasetPath, JSON.stringify(createSampleTerritoryDataset()), "utf8");

    try {
      await buildTerritoryRenderArtifactPath({
        inputPath: datasetPath,
        outputPath,
        format: "mvt",
        minZoom: 0,
        maxZoom: 0,
        buildDate: "2026-01-01T00:00:00.000Z"
      });

      await expect(
        readFile(join(outputPath, "render", "manifest.json"), "utf8")
      ).resolves.toContain("tileTemplate");
      await expect(validateTerritoryRenderArtifactPath(outputPath)).resolves.toMatchObject({
        ok: true,
        manifest: { format: "mvt" }
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
