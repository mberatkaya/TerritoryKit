import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TERRITORY_RENDER_LEVEL_POLICY } from "@territory-kit/dataset";
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
    expect(result.mvtReport).toMatchObject({
      ok: true,
      totals: {
        generatedTileCount: 1,
        duplicateTileCount: expect.any(Number)
      }
    });
    expect(result.files.has("render/mvt-policy-report.json")).toBe(true);
  });

  it("bounds MVT candidates by ADM policy and feature bbox", () => {
    const result = buildTerritoryRenderArtifacts({
      dataset: createSampleTerritoryDataset(),
      format: "mvt",
      policies: DEFAULT_TERRITORY_RENDER_LEVEL_POLICY.filter((policy) =>
        ["ADM0", "ADM1", "ADM2"].includes(policy.adminLevel)
      ),
      buildDate: "2026-01-01T00:00:00.000Z"
    });

    expect(result.mvtReport?.levels.map((level) => level.level)).toEqual(["ADM0", "ADM1", "ADM2"]);
    expect(result.mvtReport?.levels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "ADM0", minZoom: 0, maxZoom: 4 }),
        expect.objectContaining({ level: "ADM1", minZoom: 5, maxZoom: 7 }),
        expect.objectContaining({ level: "ADM2", minZoom: 8, maxZoom: 11 })
      ])
    );
    expect(result.mvtReport?.totals.candidateTileCount).toBeLessThan(2 ** 12);
    expect(result.mvtReport?.totals.duplicateTileCount).toBeGreaterThanOrEqual(0);
    expect([...result.files.keys()].some((path) => path.startsWith("render/tiles/12/"))).toBe(
      false
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
      await expect(
        readFile(join(outputPath, "render", "mvt-policy-report.json"), "utf8")
      ).resolves.toContain("candidateTileCount");
      await expect(validateTerritoryRenderArtifactPath(outputPath)).resolves.toMatchObject({
        ok: true,
        manifest: { format: "mvt" }
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
