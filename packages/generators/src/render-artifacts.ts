import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { GeoJSONVT as GeoJSONVTImport } from "@maplibre/geojson-vt";
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

type GeoJSONVTConstructor = typeof GeoJSONVTImport;
type GeoJSONVTInstance = InstanceType<GeoJSONVTConstructor>;

const GeoJSONVT = resolveGeoJSONVTConstructor(GeoJSONVTImport);

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
  const policies = filterPoliciesForDataset(options.policies, options.dataset);
  const manifest = createTerritoryRenderArtifactManifest({
    dataset: options.dataset,
    datasetContentHash,
    format,
    generatedAt: buildDate,
    ...(format === "mvt" ? { tileTemplate: "tiles/{z}/{x}/{y}.mvt" } : {}),
    ...(policies ? { policies } : {})
  });
  const files = new Map<string, string | Uint8Array>([
    ["query/query-artifact.json", serializeJsonArtifact(queryArtifact)],
    ["render/manifest.json", serializeJsonStable(manifest)]
  ]);

  if (format === "geojson") {
    files.set("render/features.geojson", serializeJsonArtifact(features));
  } else {
    for (const tile of buildMvtTiles({
      features,
      layerId,
      ...(options.minZoom !== undefined ? { minZoom: options.minZoom } : {}),
      ...(options.maxZoom !== undefined ? { maxZoom: options.maxZoom } : {}),
      ...(policies ? { policies } : {})
    })) {
      files.set(`render/tiles/${tile.z}/${tile.x}/${tile.y}.mvt`, tile.bytes);
    }
  }

  return { manifest, queryArtifact, files };
}

function serializeJsonArtifact(input: unknown): string {
  return `${JSON.stringify(input, null, 2)}\n`;
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
  const tileCoordinates = collectCandidateTileCoordinates(input.features, minZoom, maxZoom);

  for (const coordinates of tileCoordinates) {
    const tile = tileIndex.getTile(coordinates.z, coordinates.x, coordinates.y);

    if (!tile || tile.features.length === 0) {
      continue;
    }

    tiles.push({
      z: coordinates.z,
      x: coordinates.x,
      y: coordinates.y,
      bytes: fromGeojsonVt({ [input.layerId]: tile }, { version: 2, extent: 4096 })
    });
  }

  return tiles.sort((left, right) => left.z - right.z || left.x - right.x || left.y - right.y);
}

function filterPoliciesForDataset(
  policies: readonly TerritoryRenderLevelPolicy[] | undefined,
  dataset: TerritoryDataset
): readonly TerritoryRenderLevelPolicy[] | undefined {
  if (!policies) {
    return undefined;
  }

  const levels = new Set(dataset.zones.map((zone) => `ADM${zone.level}`));
  return policies.filter((policy) => levels.has(policy.adminLevel));
}

function inferMaxZoom(policies: readonly TerritoryRenderLevelPolicy[] | undefined): number {
  if (!policies || policies.length === 0) {
    return 0;
  }

  return Math.max(...policies.map((policy) => policy.maxZoom));
}

function readIndexedTileCoordinates(
  tileIndex: GeoJSONVTInstance
): Array<{ z: number; x: number; y: number }> {
  const value =
    (tileIndex as unknown as { tileCoords?: unknown }).tileCoords ??
    (tileIndex as unknown as { tileIndex?: { tileCoords?: unknown } }).tileIndex?.tileCoords;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): Array<{ z: number; x: number; y: number }> => {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { z?: unknown }).z === "number" &&
      typeof (item as { x?: unknown }).x === "number" &&
      typeof (item as { y?: unknown }).y === "number"
    ) {
      const { z, x, y } = item as { z: number; x: number; y: number };
      return [{ z, x, y }];
    }

    return [];
  });
}

function resolveGeoJSONVTConstructor(candidate: unknown): GeoJSONVTConstructor {
  if (typeof candidate === "function") {
    return candidate as GeoJSONVTConstructor;
  }

  if (
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as { readonly GeoJSONVT?: unknown }).GeoJSONVT === "function"
  ) {
    return (candidate as { readonly GeoJSONVT: GeoJSONVTConstructor }).GeoJSONVT;
  }

  const nodeRequire = createRequire(import.meta.url);
  const entryPath = nodeRequire.resolve("@maplibre/geojson-vt");
  const modulePath = entryPath.endsWith(".js") ? `${entryPath.slice(0, -3)}.mjs` : entryPath;
  const loaded = nodeRequire(modulePath) as unknown;

  if (
    loaded &&
    typeof loaded === "object" &&
    typeof (loaded as { readonly GeoJSONVT?: unknown }).GeoJSONVT === "function"
  ) {
    return (loaded as { readonly GeoJSONVT: GeoJSONVTConstructor }).GeoJSONVT;
  }

  throw new TypeError("Unable to resolve the GeoJSONVT constructor.");
}

function collectCandidateTileCoordinates(
  features: ReturnType<typeof createTerritoryRenderFeatureCollection>,
  minZoom: number,
  maxZoom: number
): Array<{ z: number; x: number; y: number }> {
  const coordinates = new Map<string, { z: number; x: number; y: number }>();

  for (const indexed of readIndexedTileCoordinates(
    new GeoJSONVT(features, { maxZoom, indexMaxZoom: maxZoom })
  )) {
    if (indexed.z >= minZoom && indexed.z <= maxZoom) {
      coordinates.set(`${indexed.z}/${indexed.x}/${indexed.y}`, indexed);
    }
  }

  for (const feature of features.features) {
    const bbox = geometryBbox(feature.geometry);

    for (let z = minZoom; z <= maxZoom; z += 1) {
      const west = lonLatToTile(bbox[0], bbox[3], z);
      const east = lonLatToTile(bbox[2], bbox[1], z);
      const minX = Math.min(west.x, east.x);
      const maxX = Math.max(west.x, east.x);
      const minY = Math.min(west.y, east.y);
      const maxY = Math.max(west.y, east.y);

      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          coordinates.set(`${z}/${x}/${y}`, { z, x, y });
        }
      }
    }
  }

  return [...coordinates.values()].sort(
    (left, right) => left.z - right.z || left.x - right.x || left.y - right.y
  );
}

function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);

  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y))
  };
}

function geometryBbox(
  geometry: ReturnType<
    typeof createTerritoryRenderFeatureCollection
  >["features"][number]["geometry"]
): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const extend = (coordinate: readonly number[]) => {
    const lng = coordinate[0];
    const lat = coordinate[1];

    if (lng === undefined || lat === undefined) {
      return;
    }

    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
  };

  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) {
      for (const coordinate of ring) {
        extend(coordinate);
      }
    }
  } else {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        for (const coordinate of ring) {
          extend(coordinate);
        }
      }
    }
  }

  if (
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north)
  ) {
    return [0, 0, 0, 0];
  }

  return [west, south, east, north];
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
