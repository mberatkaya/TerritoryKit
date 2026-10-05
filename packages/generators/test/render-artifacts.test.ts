import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TERRITORY_RENDER_LEVEL_POLICY } from "@territory-kit/dataset";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it } from "vitest";
import {
  buildTerritoryRenderArtifactPath,
  buildTerritoryRenderArtifacts,
  validateTerritoryRenderArtifactPath
} from "../src/render-artifacts.js";

describe("render artifacts", () => {
  it("encodes canonical ADM3 identity and source semantics into an MVT tile", () => {
    const dataset = createSampleTerritoryDataset();
    const zone = dataset.zones[0]!;
    zone.level = 3;
    delete zone.parentId;
    zone.properties.territory = {
      parentId: "adm2:parent",
      boundaryKind: "estimated",
      boundarySourceClass: "smart-derived",
      sourceClass: "generated",
      confidence: "low",
      administrative: false,
      authoritative: false,
      sourceVersion: "osm-v1",
      algorithmVersion: "smart-v1",
      geometryHash: "canonical-geometry"
    };
    dataset.zones = [zone];
    const result = buildTerritoryRenderArtifacts({
      dataset,
      format: "mvt",
      layerId: "territory_adm3",
      policies: [{ adminLevel: "ADM3", minZoom: 0, maxZoom: 0 }],
      minZoom: 0,
      maxZoom: 0
    });
    const tileBytes = result.files.get("render/tiles/0/0/0.mvt") as Uint8Array;
    const tile = new VectorTile(new PbfReader(tileBytes));
    const layer = tile.layers.territory_adm3!;
    expect(layer.length).toBe(1);
    expect(layer.feature(0).properties).toMatchObject({
      territoryId: zone.id,
      parentAdm2Id: "adm2:parent",
      boundaryKind: "estimated",
      boundarySourceClass: "smart-derived",
      confidence: "low",
      administrative: false,
      authoritative: false,
      sourceVersion: "osm-v1",
      datasetVersion: dataset.manifest.datasetVersion,
      generatorVersion: "smart-v1",
      geometryHash: "canonical-geometry"
    });
  });
  it("publishes the encoded custom layer and actual zoom overrides", () => {
    const dataset = createSampleTerritoryDataset();
    dataset.zones = dataset.zones.filter((zone) => zone.level === 2);
    const result = buildTerritoryRenderArtifacts({
      dataset,
      format: "mvt",
      layerId: "districts_custom",
      minZoom: 0,
      maxZoom: 1
    });
    expect(result.manifest.layers).toEqual([
      {
        id: "districts_custom",
        adminLevels: ["ADM2"],
        minZoom: 0,
        maxZoom: 1,
        featureCount: dataset.zones.length
      }
    ]);
    const published = JSON.parse(result.files.get("render/manifest.json") as string);
    expect(published.layers).toEqual(result.manifest.layers);
    const zooms = [
      ...new Set(
        [...result.files.keys()]
          .filter((path) => path.endsWith(".mvt"))
          .map((path) => Number(path.split("/")[2]))
      )
    ].sort();
    expect(zooms).toEqual([0, 1]);
    const tile = new VectorTile(
      new PbfReader(result.files.get("render/tiles/0/0/0.mvt") as Uint8Array)
    );
    expect(Object.keys(tile.layers)).toEqual([result.manifest.layers[0]!.id]);
  });
  it("can omit the duplicate query file for national rendering", () => {
    const result = buildTerritoryRenderArtifacts({
      dataset: createSampleTerritoryDataset(),
      format: "mvt",
      minZoom: 0,
      maxZoom: 0,
      includeQueryFile: false
    });
    expect(result.files.has("query/query-artifact.json")).toBe(false);
    expect(result.queryArtifact.zones.length).toBeGreaterThan(0);
    expect(result.files.has("render/manifest.json")).toBe(true);
  });

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
    const publishedReport = JSON.parse(result.files.get("render/mvt-policy-report.json") as string);
    expect(publishedReport.levels[0]).not.toHaveProperty("durationMs");
    expect(result.mvtReport?.levels[0]?.durationMs).toEqual(expect.any(Number));
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
