#!/usr/bin/env node
/**
 * Sprint 4 — render MVT + local registry/delivery from playable-v3 candidate (no geometry rebuild).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTerritoryRenderArtifactPath,
  inspectTerritoryRenderArtifactPath,
  validateTerritoryRenderArtifactPath
} from "../packages/generators/dist/index.mjs";
import { createTurkeyV2DeliveryManifest } from "../packages/generators/dist/turkey-adm3.mjs";
import {
  createTerritoryRenderFeatureCollection,
  loadTerritoryDataset
} from "../packages/dataset/dist/index.mjs";
import { writeReportJson } from "./lib/write-report-json.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CANDIDATE = path.join(ROOT, ".territory/sprint-3/playable-v3/candidate");
const DEFAULT_RENDER_OUT = path.join(ROOT, ".territory/sprint-4/playable-v3/render");
const REPORT_DIR = path.join(ROOT, "reports/tr-adm3/sprint-4-national-playable-map");
const LOCAL_PLAYABLE_CANDIDATE_MOUNT = "/territory-candidate";

function parseArgs(argv) {
  const options = {
    candidateRoot: DEFAULT_CANDIDATE,
    renderOut: DEFAULT_RENDER_OUT,
    skipMvt: false,
    force: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--candidate") options.candidateRoot = path.resolve(ROOT, argv[++i]);
    else if (arg === "--render-out") options.renderOut = path.resolve(argv[++i]);
    else if (arg === "--skip-mvt") options.skipMvt = true;
    else if (arg === "--force") options.force = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function sha256File(absolutePath) {
  const bytes = await readFile(absolutePath);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.byteLength
  };
}

async function walkFiles(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(absolute, rel)));
    else files.push({ relativePath: rel.replaceAll("\\", "/"), absolute });
  }
  return files;
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeRegistryArtifactUrl(relativePath) {
  return String(relativePath).replace(/^\.?\//, "");
}

function localPlayableRegistryBaseUrl() {
  const origin = (
    process.env.TERRITORY_PLAYABLE_MAP_DEV_ORIGIN ??
    process.env.VITE_TERRITORY_LOCAL_DEV_ORIGIN ??
    "http://127.0.0.1:5173"
  ).replace(/\/$/, "");
  return `${origin}${LOCAL_PLAYABLE_CANDIDATE_MOUNT}/`;
}

async function writeLevelGeojsonRenders(candidateRoot) {
  const levels = ["ADM0", "ADM1", "ADM2"];
  const written = [];
  for (const level of levels) {
    const datasetPath = path.join(candidateRoot, `levels/${level}/dataset.json`);
    if (!existsSync(datasetPath)) throw new Error(`Missing ${datasetPath}`);
    const dataset = loadTerritoryDataset(JSON.parse(await readFile(datasetPath, "utf8")));
    const features = createTerritoryRenderFeatureCollection(dataset);
    const outPath = path.join(candidateRoot, `render/levels/${level}.geojson`);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, serializeJson(features));
    written.push(`render/levels/${level}.geojson`);
  }
  return written;
}

async function mergeRenderIntoCandidate(candidateRoot, renderOut) {
  if (!existsSync(renderOut)) throw new Error(`Render output missing: ${renderOut}`);
  const renderFiles = await walkFiles(renderOut);
  for (const file of renderFiles) {
    const target = path.join(candidateRoot, file.relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file.absolute, target);
  }
}

async function patchChecksums(candidateRoot, relativePaths) {
  const checksumsPath = path.join(candidateRoot, "checksums.json");
  const checksums = JSON.parse(await readFile(checksumsPath, "utf8"));
  if (!checksums.files || typeof checksums.files !== "object") {
    throw new Error("checksums.json is missing files map.");
  }
  for (const rel of relativePaths) {
    const absolute = path.join(candidateRoot, rel);
    if (!existsSync(absolute)) throw new Error(`Cannot checksum missing file: ${rel}`);
    checksums.files[rel] = await sha256File(absolute);
  }
  await writeFile(checksumsPath, serializeJson(checksums));
  return checksums;
}

function renderArtifactsFromEntry(entryDataset, checksums) {
  const artifacts = [...entryDataset.artifacts];
  const push = (artifact) => {
    const idx = artifacts.findIndex((item) => item.id === artifact.id);
    if (idx >= 0) artifacts[idx] = artifact;
    else artifacts.push(artifact);
  };
  for (const level of ["ADM0", "ADM1", "ADM2"]) {
    const rel = `render/levels/${level}.geojson`;
    const sum = checksums.files[rel];
    if (!sum) continue;
    push({
      id: `render-${level.toLowerCase()}`,
      purpose: "render",
      format: "geojson",
      levels: [level],
      path: rel,
      url: normalizeRegistryArtifactUrl(rel),
      sha256: sum.sha256,
      sizeBytes: sum.byteSize,
      compression: "none",
      sourceClass: "official"
    });
  }
  const manifestRel = "render/manifest.json";
  const manifestSum = checksums.files[manifestRel];
  if (manifestSum) {
    push({
      id: "adm3-render-manifest",
      purpose: "render",
      format: "mvt",
      levels: ["ADM3"],
      path: manifestRel,
      url: normalizeRegistryArtifactUrl(manifestRel),
      sha256: manifestSum.sha256,
      sizeBytes: manifestSum.byteSize,
      compression: "none",
      layer: "territory_adm3",
      tileUrlTemplate: "tiles/{z}/{x}/{y}.mvt",
      minZoom: 10,
      maxZoom: 12,
      sourceClass: "generated"
    });
  }
  return artifacts;
}

async function writeRegistry(candidateRoot) {
  const entryPath = path.join(candidateRoot, "registry-entry.json");
  const entry = JSON.parse(await readFile(entryPath, "utf8"));
  const checksums = JSON.parse(await readFile(path.join(candidateRoot, "checksums.json"), "utf8"));
  const dataset = entry.datasets[0];
  dataset.artifacts = renderArtifactsFromEntry(dataset, checksums).map((artifact) => ({
    ...artifact,
    ...(artifact.url ? { url: normalizeRegistryArtifactUrl(artifact.url) } : {}),
    ...(artifact.path ? { path: artifact.path.replace(/^\.?\//, "") } : {})
  }));
  const registry = {
    registryVersion: "1",
    generatedAt: new Date().toISOString(),
    baseUrl: localPlayableRegistryBaseUrl(),
    datasets: [dataset]
  };
  await writeFile(path.join(candidateRoot, "registry.json"), serializeJson(registry));
  return registry;
}

async function writeDeliveryManifest(candidateRoot) {
  const read = async (rel) => JSON.parse(await readFile(path.join(candidateRoot, rel), "utf8"));
  const [canonical, sourceLock, render, checksums, shards, adm2Dataset] = await Promise.all([
    read("manifest.json"),
    read("source-lock.json"),
    read("render/manifest.json"),
    read("checksums.json"),
    read("shards.json"),
    read("levels/ADM2/dataset.json")
  ]);
  const manifest = createTurkeyV2DeliveryManifest({
    canonical,
    sourceLock,
    render,
    checksums,
    shards,
    adm2Ids: Array.isArray(adm2Dataset.zones) ? adm2Dataset.zones.map((zone) => zone.id) : []
  });
  await writeFile(path.join(candidateRoot, "delivery-manifest.json"), serializeJson(manifest));
  return manifest;
}

async function collectMvtMetrics(renderRoot) {
  const tilesDir = path.join(renderRoot, "render", "tiles");
  if (!existsSync(tilesDir)) return null;
  const tiles = await walkFiles(tilesDir, "render/tiles");
  let totalBytes = 0;
  let maxBytes = 0;
  const samples = [];
  for (const tile of tiles) {
    const byteSize = (await stat(tile.absolute)).size;
    totalBytes += byteSize;
    maxBytes = Math.max(maxBytes, byteSize);
    if (samples.length < 12) {
      samples.push({ path: tile.relativePath, byteSize });
    }
  }
  samples.sort((a, b) => b.byteSize - a.byteSize);
  return {
    tileCount: tiles.length,
    totalBytes,
    maxTileBytes: maxBytes,
    largestSamples: samples.slice(0, 10)
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const candidateRoot = options.candidateRoot;
  const manifest = JSON.parse(await readFile(path.join(candidateRoot, "manifest.json"), "utf8"));
  const coverage = JSON.parse(await readFile(path.join(candidateRoot, "coverage.json"), "utf8"));

  let mvtInspection;
  let mvtValidation;
  if (!options.skipMvt) {
    const buildDate = manifest.buildDate ?? "2026-10-18T12:00:00.000Z";
    await mkdir(path.dirname(options.renderOut), { recursive: true });
    await buildTerritoryRenderArtifactPath({
      inputPath: path.join(candidateRoot, "levels/ADM3/dataset.json"),
      outputPath: options.renderOut,
      format: "mvt",
      layerId: "territory_adm3",
      minZoom: 10,
      maxZoom: 12,
      buildDate,
      includeQueryFile: false,
      force: options.force
    });
    mvtValidation = await validateTerritoryRenderArtifactPath(options.renderOut);
    mvtInspection = await inspectTerritoryRenderArtifactPath(options.renderOut);
    if (!mvtValidation.ok) {
      throw new Error(`MVT validation failed: ${JSON.stringify(mvtValidation.issues)}`);
    }
    await mergeRenderIntoCandidate(candidateRoot, options.renderOut);
  } else if (!existsSync(path.join(candidateRoot, "render/manifest.json"))) {
    throw new Error("MVT render missing; run without --skip-mvt first.");
  } else {
    mvtValidation = await validateTerritoryRenderArtifactPath(candidateRoot);
    mvtInspection = await inspectTerritoryRenderArtifactPath(candidateRoot);
    if (!mvtValidation.ok) {
      throw new Error(
        `MVT validation failed on existing artifacts: ${JSON.stringify(mvtValidation.issues)}`
      );
    }
  }

  const geojsonPaths = await writeLevelGeojsonRenders(candidateRoot);
  const renderManifestRel = "render/manifest.json";
  const patched = await patchChecksums(candidateRoot, [
    ...geojsonPaths,
    renderManifestRel,
    ...(await walkFiles(path.join(candidateRoot, "render/tiles"), "render/tiles")).map(
      (f) => f.relativePath
    )
  ]);

  await writeRegistry(candidateRoot);
  const delivery = await writeDeliveryManifest(candidateRoot);
  const mvtMetrics = await collectMvtMetrics(candidateRoot);

  const encodedLayer =
    mvtInspection?.manifest?.layers?.[0]?.sourceLayer ??
    mvtInspection?.manifest?.layers?.[0]?.id ??
    "territory_adm3";

  const report = {
    schemaVersion: "territorykit-tr-sprint-4-national-playable-map@1",
    generatedAt: new Date().toISOString(),
    candidateRoot: path.relative(ROOT, candidateRoot),
    datasetVersion: manifest.datasetVersion,
    geometryHash: manifest.geometryHash,
    coverage: {
      provinceCount: coverage.provinceCount,
      districtCount: coverage.districtCount,
      adm3FinalZoneCount: coverage.adm3FinalZoneCount
    },
    mvt: {
      consumerSourceLayerContract: "territory_adm3",
      encodedProtobufLayer: encodedLayer,
      validationOk: mvtValidation?.ok === true,
      validationSkippedBuild: options.skipMvt,
      metrics: mvtMetrics
    },
    deliveryManifest: {
      contentHash: delivery.contentHash,
      tileCount: delivery.mvt?.tileCount ?? null,
      sourceLayer: delivery.mvt?.sourceLayer ?? null
    },
    localPreview: {
      registryPath: `${path.relative(ROOT, candidateRoot)}/registry.json`,
      deliveryManifestPath: `${path.relative(ROOT, candidateRoot)}/delivery-manifest.json`,
      devCommand: "pnpm dev:tr:national-playable-map"
    },
    checksumFilesPatched: Object.keys(patched.files).filter((key) => key.startsWith("render/"))
      .length
  };

  await mkdir(REPORT_DIR, { recursive: true });
  await writeReportJson(path.join(REPORT_DIR, "bootstrap-metrics.json"), report);

  console.log(JSON.stringify({ ok: true, report }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
