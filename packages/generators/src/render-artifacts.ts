import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
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
  TerritoryAdminLevel,
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
  mvtPolicy?: TerritoryMvtPolicyLimits;
  minZoom?: number;
  maxZoom?: number;
  buildDate?: string;
}

export interface TerritoryRenderBuildResult {
  manifest: TerritoryRenderArtifactManifest;
  queryArtifact: TerritoryQueryArtifact;
  files: Map<string, string | Uint8Array>;
  mvtReport?: TerritoryMvtPolicyReport;
}

export interface TerritoryRenderPathBuildOptions {
  inputPath: string;
  outputPath: string;
  format?: "mvt" | "geojson";
  layerId?: string;
  minZoom?: number;
  maxZoom?: number;
  policies?: readonly TerritoryRenderLevelPolicy[];
  mvtPolicy?: TerritoryMvtPolicyLimits;
  buildDate?: string;
  force?: boolean;
}

export interface TerritoryRenderValidateResult {
  ok: boolean;
  manifest?: TerritoryRenderArtifactManifest;
  issues: Array<{ code: string; message: string; severity: "error" | "warning" }>;
}

export interface TerritoryMvtPolicyLimits {
  maximumTileBytes?: number;
  maximumFeaturesPerTile?: number;
  maximumEmptyTileRatio?: number;
}

export interface TerritoryMvtLevelReport {
  level: TerritoryAdminLevel | "ALL";
  minZoom: number;
  maxZoom: number;
  candidateTileCount: number;
  generatedTileCount: number;
  emptyTileCount: number;
  skippedTileCount: number;
  duplicateTileCount: number;
  totalBytes: number;
  maximumTileBytes: number;
  averageTileBytes: number;
  maximumFeaturesPerTile: number;
  corruptTileCount: number;
  durationMs: number;
  missingZooms: number[];
}

export interface TerritoryMvtPolicyReport {
  reportVersion: "1";
  ok: boolean;
  generatedAt: string;
  policy: Required<TerritoryMvtPolicyLimits>;
  levels: TerritoryMvtLevelReport[];
  totals: {
    candidateTileCount: number;
    generatedTileCount: number;
    emptyTileCount: number;
    skippedTileCount: number;
    totalBytes: number;
    maximumTileBytes: number;
    maximumFeaturesPerTile: number;
    corruptTileCount: number;
    duplicateTileCount: number;
  };
  issues: Array<{
    code: string;
    severity: "error" | "warning";
    message: string;
    level?: TerritoryAdminLevel | "ALL";
    z?: number;
    x?: number;
    y?: number;
  }>;
}

const DEFAULT_MVT_POLICY_LIMITS: Required<TerritoryMvtPolicyLimits> = {
  maximumTileBytes: 500_000,
  maximumFeaturesPerTile: 5_000,
  maximumEmptyTileRatio: 0.5
};

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
  let mvtReport: TerritoryMvtPolicyReport | undefined;

  if (format === "geojson") {
    files.set("render/features.geojson", serializeJsonArtifact(features));
  } else {
    const mvt = buildMvtTiles({
      features,
      layerId,
      ...(options.minZoom !== undefined ? { minZoom: options.minZoom } : {}),
      ...(options.maxZoom !== undefined ? { maxZoom: options.maxZoom } : {}),
      ...(policies ? { policies } : {}),
      ...(options.mvtPolicy ? { mvtPolicy: options.mvtPolicy } : {}),
      buildDate
    });
    mvtReport = mvt.report;

    for (const tile of mvt.tiles) {
      files.set(`render/tiles/${tile.z}/${tile.x}/${tile.y}.mvt`, tile.bytes);
    }

    files.set("render/mvt-policy-report.json", serializeJsonStable(mvt.report));
  }

  return { manifest, queryArtifact, files, ...(mvtReport ? { mvtReport } : {}) };
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
    ...(options.mvtPolicy ? { mvtPolicy: options.mvtPolicy } : {}),
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
  mvtPolicy?: TerritoryMvtPolicyLimits;
  buildDate: string;
}): {
  tiles: Array<{ z: number; x: number; y: number; bytes: Uint8Array }>;
  report: TerritoryMvtPolicyReport;
} {
  const policy = normalizeMvtPolicyLimits(input.mvtPolicy);
  const featureGroups = createMvtFeatureGroups(input.features, {
    ...(input.minZoom !== undefined ? { minZoom: input.minZoom } : {}),
    ...(input.maxZoom !== undefined ? { maxZoom: input.maxZoom } : {}),
    ...(input.policies ? { policies: input.policies } : {})
  });
  const tiles = new Map<string, { z: number; x: number; y: number; bytes: Uint8Array }>();
  const levelReports: TerritoryMvtLevelReport[] = [];
  const issues: TerritoryMvtPolicyReport["issues"] = [];

  for (const group of featureGroups) {
    const startedAt = performance.now();
    const tileIndex = new GeoJSONVT(group.features, {
      maxZoom: group.maxZoom,
      indexMaxZoom: group.maxZoom,
      tolerance: 3,
      extent: 4096,
      buffer: 64
    });
    const candidates = collectCandidateTileCoordinates(
      group.features,
      group.minZoom,
      group.maxZoom,
      tileIndex
    );
    let generatedTileCount = 0;
    let emptyTileCount = 0;
    let skippedTileCount = 0;
    let totalBytes = 0;
    let maximumTileBytes = 0;
    let maximumFeaturesPerTile = 0;
    let corruptTileCount = 0;
    const generatedZooms = new Set<number>();

    for (const coordinates of candidates.coordinates) {
      const tile = tileIndex.getTile(coordinates.z, coordinates.x, coordinates.y);

      if (!tile || tile.features.length === 0) {
        emptyTileCount += 1;
        continue;
      }

      const bytes = fromGeojsonVt({ [input.layerId]: tile }, { version: 2, extent: 4096 });
      const featureCount = tile.features.length;
      const tileKey = `${coordinates.z}/${coordinates.x}/${coordinates.y}`;
      maximumTileBytes = Math.max(maximumTileBytes, bytes.byteLength);
      maximumFeaturesPerTile = Math.max(maximumFeaturesPerTile, featureCount);

      if (bytes.byteLength === 0) {
        corruptTileCount += 1;
        issues.push({
          code: "MVT_TILE_CORRUPT",
          severity: "error",
          message: `Encoded MVT tile ${tileKey} is empty.`,
          level: group.level,
          z: coordinates.z,
          x: coordinates.x,
          y: coordinates.y
        });
        continue;
      }

      if (bytes.byteLength > policy.maximumTileBytes) {
        skippedTileCount += 1;
        issues.push({
          code: "MVT_TILE_BYTES_EXCEEDED",
          severity: "error",
          message: `MVT tile ${tileKey} is ${bytes.byteLength} bytes, above ${policy.maximumTileBytes}.`,
          level: group.level,
          z: coordinates.z,
          x: coordinates.x,
          y: coordinates.y
        });
        continue;
      }

      if (featureCount > policy.maximumFeaturesPerTile) {
        skippedTileCount += 1;
        issues.push({
          code: "MVT_TILE_FEATURES_EXCEEDED",
          severity: "error",
          message: `MVT tile ${tileKey} contains ${featureCount} features, above ${policy.maximumFeaturesPerTile}.`,
          level: group.level,
          z: coordinates.z,
          x: coordinates.x,
          y: coordinates.y
        });
        continue;
      }

      if (tiles.has(tileKey)) {
        skippedTileCount += 1;
        issues.push({
          code: "MVT_TILE_DUPLICATE",
          severity: "error",
          message: `MVT tile ${tileKey} was generated more than once.`,
          level: group.level,
          z: coordinates.z,
          x: coordinates.x,
          y: coordinates.y
        });
        continue;
      }

      tiles.set(tileKey, {
        z: coordinates.z,
        x: coordinates.x,
        y: coordinates.y,
        bytes
      });
      generatedTileCount += 1;
      totalBytes += bytes.byteLength;
      generatedZooms.add(coordinates.z);
    }

    const missingZooms = [];

    for (let z = group.minZoom; z <= group.maxZoom; z += 1) {
      if (!generatedZooms.has(z)) {
        missingZooms.push(z);
      }
    }

    if (missingZooms.length > 0) {
      issues.push({
        code: "MVT_ZOOM_MISSING",
        severity: "error",
        message: `${group.level} did not generate tiles for zoom(s) ${missingZooms.join(", ")}.`,
        level: group.level
      });
    }

    const emptyTileRatio =
      candidates.coordinates.length === 0 ? 0 : emptyTileCount / candidates.coordinates.length;

    if (emptyTileRatio > policy.maximumEmptyTileRatio) {
      issues.push({
        code: "MVT_EMPTY_TILE_RATIO_EXCEEDED",
        severity: "warning",
        message: `${group.level} empty tile ratio ${roundRatio(emptyTileRatio)} exceeds ${policy.maximumEmptyTileRatio}.`,
        level: group.level
      });
    }

    levelReports.push({
      level: group.level,
      minZoom: group.minZoom,
      maxZoom: group.maxZoom,
      candidateTileCount: candidates.coordinates.length,
      generatedTileCount,
      emptyTileCount,
      skippedTileCount,
      duplicateTileCount: candidates.duplicateTileCount,
      totalBytes,
      maximumTileBytes,
      averageTileBytes: generatedTileCount === 0 ? 0 : Math.round(totalBytes / generatedTileCount),
      maximumFeaturesPerTile,
      corruptTileCount,
      durationMs: Math.round(performance.now() - startedAt),
      missingZooms
    });
  }

  const sortedTiles = [...tiles.values()].sort(
    (left, right) => left.z - right.z || left.x - right.x || left.y - right.y
  );
  const totals = {
    candidateTileCount: levelReports.reduce((sum, report) => sum + report.candidateTileCount, 0),
    generatedTileCount: levelReports.reduce((sum, report) => sum + report.generatedTileCount, 0),
    emptyTileCount: levelReports.reduce((sum, report) => sum + report.emptyTileCount, 0),
    skippedTileCount: levelReports.reduce((sum, report) => sum + report.skippedTileCount, 0),
    totalBytes: levelReports.reduce((sum, report) => sum + report.totalBytes, 0),
    maximumTileBytes: levelReports.reduce(
      (maximum, report) => Math.max(maximum, report.maximumTileBytes),
      0
    ),
    maximumFeaturesPerTile: levelReports.reduce(
      (maximum, report) => Math.max(maximum, report.maximumFeaturesPerTile),
      0
    ),
    corruptTileCount: levelReports.reduce((sum, report) => sum + report.corruptTileCount, 0),
    duplicateTileCount: levelReports.reduce((sum, report) => sum + report.duplicateTileCount, 0)
  };

  return {
    tiles: sortedTiles,
    report: {
      reportVersion: "1",
      ok: issues.every((issue) => issue.severity !== "error"),
      generatedAt: input.buildDate,
      policy,
      levels: levelReports.sort(
        (left, right) => left.minZoom - right.minZoom || left.level.localeCompare(right.level)
      ),
      totals,
      issues: issues.sort(
        (left, right) =>
          (left.level ?? "").localeCompare(right.level ?? "") ||
          (left.z ?? -1) - (right.z ?? -1) ||
          left.code.localeCompare(right.code)
      )
    }
  };
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

function normalizeMvtPolicyLimits(
  input: TerritoryMvtPolicyLimits | undefined
): Required<TerritoryMvtPolicyLimits> {
  return {
    maximumTileBytes: readPositiveInteger(
      input?.maximumTileBytes,
      DEFAULT_MVT_POLICY_LIMITS.maximumTileBytes
    ),
    maximumFeaturesPerTile: readPositiveInteger(
      input?.maximumFeaturesPerTile,
      DEFAULT_MVT_POLICY_LIMITS.maximumFeaturesPerTile
    ),
    maximumEmptyTileRatio: readRatio(
      input?.maximumEmptyTileRatio,
      DEFAULT_MVT_POLICY_LIMITS.maximumEmptyTileRatio
    )
  };
}

function createMvtFeatureGroups(
  features: ReturnType<typeof createTerritoryRenderFeatureCollection>,
  options: {
    minZoom?: number;
    maxZoom?: number;
    policies?: readonly TerritoryRenderLevelPolicy[];
  }
): Array<{
  level: TerritoryAdminLevel | "ALL";
  minZoom: number;
  maxZoom: number;
  features: ReturnType<typeof createTerritoryRenderFeatureCollection>;
}> {
  const minZoomOverride = options.minZoom;
  const maxZoomOverride = options.maxZoom;

  if (!options.policies || options.policies.length === 0) {
    const minZoom = minZoomOverride ?? 0;
    const maxZoom = maxZoomOverride ?? inferMaxZoom(options.policies);

    if (features.features.length === 0 || minZoom > maxZoom) {
      return [];
    }

    return [{ level: "ALL", minZoom, maxZoom, features }];
  }

  return options.policies.flatMap((policy) => {
    const minZoom = Math.max(policy.minZoom, minZoomOverride ?? policy.minZoom);
    const maxZoom = Math.min(policy.maxZoom, maxZoomOverride ?? policy.maxZoom);
    const levelFeatures = {
      type: "FeatureCollection" as const,
      features: features.features.filter(
        (feature) => feature.properties?.adminLevel === policy.adminLevel
      )
    };

    if (levelFeatures.features.length === 0 || minZoom > maxZoom) {
      return [];
    }

    return [
      {
        level: policy.adminLevel,
        minZoom,
        maxZoom,
        features: levelFeatures
      }
    ];
  });
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
  maxZoom: number,
  tileIndex: GeoJSONVTInstance
): {
  coordinates: Array<{ z: number; x: number; y: number }>;
  duplicateTileCount: number;
} {
  const coordinates = new Map<string, { z: number; x: number; y: number }>();
  let duplicateTileCount = 0;
  const addCoordinate = (coordinate: { z: number; x: number; y: number }) => {
    const key = `${coordinate.z}/${coordinate.x}/${coordinate.y}`;

    if (coordinates.has(key)) {
      duplicateTileCount += 1;
      return;
    }

    coordinates.set(key, coordinate);
  };

  for (const indexed of readIndexedTileCoordinates(tileIndex)) {
    if (indexed.z >= minZoom && indexed.z <= maxZoom) {
      addCoordinate(indexed);
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
          addCoordinate({ z, x, y });
        }
      }
    }
  }

  return {
    coordinates: [...coordinates.values()].sort(
      (left, right) => left.z - right.z || left.x - right.x || left.y - right.y
    ),
    duplicateTileCount
  };
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

function readPositiveInteger(input: number | undefined, fallback: number): number {
  return Number.isInteger(input) && input !== undefined && input > 0 ? input : fallback;
}

function readRatio(input: number | undefined, fallback: number): number {
  return Number.isFinite(input) && input !== undefined && input >= 0 && input <= 1
    ? input
    : fallback;
}

function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
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
