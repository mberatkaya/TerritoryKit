import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { GeoJSONVT } from "@maplibre/geojson-vt";
import { fromGeojsonVt } from "@maplibre/vt-pbf";
import {
  createTerritoryQueryArtifact,
  createTerritoryRenderArtifactManifest,
  createTerritoryRenderFeatureCollection,
  loadTerritoryDataset,
  validateTerritoryQueryRenderCompatibility
} from "@territory-kit/dataset";
import type {
  TerritoryDataset,
  TerritoryQueryArtifact,
  TerritoryRenderArtifactManifest,
  TerritoryRenderLevelPolicy
} from "@territory-kit/dataset";
import { createDatasetGeometryHash, serializeJsonStable } from "./sources/utils.js";

export interface TerritoryRenderBuildOptions {
  dataset: TerritoryDataset;
  format?: "mvt" | "geojson";
  layerId?: string;
  policies?: readonly TerritoryRenderLevelPolicy[];
  minZoom?: number;
  maxZoom?: number;
  buildDate?: string;
}

export interface TerritoryRenderBuildResult {
  manifest: TerritoryRenderArtifactManifest;
  queryArtifact: TerritoryQueryArtifact;
  files: Map<string, string | Uint8Array>;
}

export interface TerritoryRenderPathBuildOptions {
  inputPath: string;
  outputPath: string;
  format?: "mvt" | "geojson";
  layerId?: string;
  minZoom?: number;
  maxZoom?: number;
  policies?: readonly TerritoryRenderLevelPolicy[];
  buildDate?: string;
  force?: boolean;
}

export interface TerritoryRenderValidateResult {
  ok: boolean;
  manifest?: TerritoryRenderArtifactManifest;
  issues: Array<{ code: string; message: string; severity: "error" | "warning" }>;
}

export function buildTerritoryRenderArtifacts(
  options: TerritoryRenderBuildOptions
): TerritoryRenderBuildResult {
  const format = options.format ?? "mvt";
  const layerId = options.layerId ?? "territory";
  const buildDate = options.buildDate ?? new Date(0).toISOString();
  const datasetContentHash = createDatasetGeometryHash(options.dataset);
  const queryArtifact = createTerritoryQueryArtifact(options.dataset, { datasetContentHash });
  const features = createTerritoryRenderFeatureCollection(options.dataset);
  const manifest = createTerritoryRenderArtifactManifest({
    dataset: options.dataset,
    datasetContentHash,
    format,
    generatedAt: buildDate,
    ...(format === "mvt" ? { tileTemplate: "tiles/{z}/{x}/{y}.mvt" } : {}),
    ...(options.policies ? { policies: options.policies } : {})
  });
  const files = new Map<string, string | Uint8Array>([
    ["query/query-artifact.json", serializeJsonStable(queryArtifact)],
    ["render/manifest.json", serializeJsonStable(manifest)]
  ]);

  if (format === "geojson") {
    files.set("render/features.geojson", serializeJsonStable(features));
  } else {
    for (const tile of buildMvtTiles({
      features,
      layerId,
      ...(options.minZoom !== undefined ? { minZoom: options.minZoom } : {}),
      ...(options.maxZoom !== undefined ? { maxZoom: options.maxZoom } : {}),
      ...(options.policies ? { policies: options.policies } : {})
    })) {
      files.set(`render/tiles/${tile.z}/${tile.x}/${tile.y}.mvt`, tile.bytes);
    }
  }

  return { manifest, queryArtifact, files };
}

export async function buildTerritoryRenderArtifactPath(
  options: TerritoryRenderPathBuildOptions
): Promise<TerritoryRenderBuildResult> {
  const dataset = loadTerritoryDataset(
    JSON.parse(await readFile(resolve(options.inputPath), "utf8")) as unknown
  );
  const result = buildTerritoryRenderArtifacts({
    dataset,
    ...(options.format ? { format: options.format } : {}),
    ...(options.layerId ? { layerId: options.layerId } : {}),
    ...(options.minZoom !== undefined ? { minZoom: options.minZoom } : {}),
    ...(options.maxZoom !== undefined ? { maxZoom: options.maxZoom } : {}),
    ...(options.policies ? { policies: options.policies } : {}),
    ...(options.buildDate ? { buildDate: options.buildDate } : {})
  });

  await writeRenderFilesAtomically(resolve(options.outputPath), result.files, {
    force: options.force ?? false
  });
  return result;
}

export async function validateTerritoryRenderArtifactPath(
  inputPath: string
): Promise<TerritoryRenderValidateResult> {
  const root = resolve(inputPath);
  const issues: TerritoryRenderValidateResult["issues"] = [];
  const manifestPath = join(root, "render", "manifest.json");

  try {
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as TerritoryRenderArtifactManifest;

    if (manifest.renderArtifactVersion !== "1") {
      issues.push({
        code: "RENDER_MANIFEST_VERSION",
        severity: "error",
        message: "renderArtifactVersion must be '1'."
      });
    }

    if (manifest.format === "mvt") {
      const tilesRoot = join(root, "render", "tiles");
      const hasTiles = await directoryHasFiles(tilesRoot, ".mvt");

      if (!hasTiles) {
        issues.push({
          code: "RENDER_TILES_MISSING",
          severity: "error",
          message: "MVT render artifact must include at least one .mvt tile."
        });
      }
    }

    return {
      ok: issues.every((issue) => issue.severity !== "error"),
      manifest,
      issues
    };
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: "RENDER_MANIFEST_INVALID",
          severity: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      ]
    };
  }
}

export async function inspectTerritoryRenderArtifactPath(
  inputPath: string
): Promise<TerritoryRenderArtifactManifest> {
  return JSON.parse(
    await readFile(resolve(inputPath, "render", "manifest.json"), "utf8")
  ) as TerritoryRenderArtifactManifest;
}

export async function compareTerritoryQueryRenderArtifacts(options: {
  queryDatasetPath: string;
  renderArtifactPath: string;
}): Promise<ReturnType<typeof validateTerritoryQueryRenderCompatibility>> {
  const dataset = loadTerritoryDataset(
    JSON.parse(await readFile(resolve(options.queryDatasetPath), "utf8")) as unknown
  );
  const manifest = await inspectTerritoryRenderArtifactPath(options.renderArtifactPath);
  const datasetContentHash = createDatasetGeometryHash(dataset);
  const query = createTerritoryQueryArtifact(dataset, { datasetContentHash });
  const features = createTerritoryRenderFeatureCollection(dataset);

  return validateTerritoryQueryRenderCompatibility(query, {
    manifest,
    features
  });
}

function buildMvtTiles(input: {
  features: ReturnType<typeof createTerritoryRenderFeatureCollection>;
  layerId: string;
  minZoom?: number;
  maxZoom?: number;
  policies?: readonly TerritoryRenderLevelPolicy[];
}): Array<{ z: number; x: number; y: number; bytes: Uint8Array }> {
  const minZoom = input.minZoom ?? 0;
  const maxZoom = input.maxZoom ?? inferMaxZoom(input.policies);
  const tileIndex = new GeoJSONVT(input.features, {
    maxZoom,
    indexMaxZoom: maxZoom,
    tolerance: 3,
    extent: 4096,
    buffer: 64
  });
  const tiles = [];

  for (let z = minZoom; z <= maxZoom; z += 1) {
    const tileCount = 2 ** z;

    for (let x = 0; x < tileCount; x += 1) {
      for (let y = 0; y < tileCount; y += 1) {
        const tile = tileIndex.getTile(z, x, y);

        if (!tile || tile.features.length === 0) {
          continue;
        }

        tiles.push({
          z,
          x,
          y,
          bytes: fromGeojsonVt({ [input.layerId]: tile }, { version: 2, extent: 4096 })
        });
      }
    }
  }

  return tiles.sort((left, right) => left.z - right.z || left.x - right.x || left.y - right.y);
}

function inferMaxZoom(policies: readonly TerritoryRenderLevelPolicy[] | undefined): number {
  if (!policies || policies.length === 0) {
    return 0;
  }

  return Math.min(4, Math.max(...policies.map((policy) => policy.maxZoom)));
}

async function writeRenderFilesAtomically(
  outputPath: string,
  files: ReadonlyMap<string, string | Uint8Array>,
  options: { force: boolean }
): Promise<void> {
  if (await pathExists(outputPath)) {
    if (!options.force) {
      throw new Error(`Output path '${outputPath}' already exists.`);
    }
  }

  const tempPath = await mkdtemp(join(dirname(outputPath), `.${basename(outputPath)}-tmp-`));

  try {
    for (const [relativePath, content] of [...files.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      const targetPath = join(tempPath, relativePath);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content);
    }

    await rm(outputPath, { recursive: true, force: true });
    await mkdir(dirname(outputPath), { recursive: true });
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { recursive: true, force: true });
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function directoryHasFiles(root: string, extension: string): Promise<boolean> {
  try {
    const entries = await import("node:fs/promises").then(({ readdir }) =>
      readdir(root, { withFileTypes: true })
    );

    for (const entry of entries) {
      const path = join(root, entry.name);

      if (entry.isDirectory() && (await directoryHasFiles(path, extension))) {
        return true;
      }

      if (entry.isFile() && entry.name.endsWith(extension)) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

export async function sha256RenderFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
