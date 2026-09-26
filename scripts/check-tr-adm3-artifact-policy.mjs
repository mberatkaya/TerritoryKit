#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const ROOT = resolve(import.meta.dirname, "..");
const ARTIFACT_ROOT = resolve(ROOT, "datasets/generated/countries/TR/levels/ADM3");
const POLICY_PATH = join(ARTIFACT_ROOT, "artifact-policy.json");
const execFileAsync = promisify(execFile);

const policy = JSON.parse(await readFile(POLICY_PATH, "utf8"));
const files = await listFiles(ARTIFACT_ROOT);
const entries = await Promise.all(
  files.map(async (path) => {
    const bytes = await readFile(join(ARTIFACT_ROOT, path));

    return {
      path,
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  })
);
const failures = [];
const totalSizeBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
const trackedPbfFiles = await listTrackedOsmPbfFiles();

for (const path of trackedPbfFiles) {
  failures.push(`Raw OSM PBF snapshot must not be tracked in Git: ${path}.`);
}

if (totalSizeBytes > policy.maxTotalSizeBytes) {
  failures.push(
    `TR ADM3 artifacts use ${totalSizeBytes} bytes, above budget ${policy.maxTotalSizeBytes}.`
  );
}

const geojsonEntries = entries.filter((entry) => entry.path.endsWith(".geojson"));
const duplicateGeojsonHashes = findDuplicateHashes(geojsonEntries);

if (policy.disallowDuplicateGeojsonTierHashes && duplicateGeojsonHashes.length > 0) {
  for (const duplicate of duplicateGeojsonHashes) {
    failures.push(
      `GeoJSON artifacts share checksum ${duplicate.sha256}: ${duplicate.paths.join(", ")}.`
    );
  }
}

for (const entry of entries.filter((item) => item.path.endsWith("report.json"))) {
  if (entry.sizeBytes > policy.maxSingleReportSizeBytes) {
    failures.push(
      `${entry.path} is ${entry.sizeBytes} bytes, above report budget ${policy.maxSingleReportSizeBytes}.`
    );
  }
}

const tileEntries = entries.filter((entry) => entry.path.endsWith(".mvt"));

if (tileEntries.length > policy.maxTileCount) {
  failures.push(`TR ADM3 emits ${tileEntries.length} tiles, above budget ${policy.maxTileCount}.`);
}

for (const entry of tileEntries) {
  if (entry.sizeBytes > policy.maxTileSizeBytes) {
    failures.push(
      `${entry.path} is ${entry.sizeBytes} bytes, above tile budget ${policy.maxTileSizeBytes}.`
    );
  }
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        ok: true,
        totalSizeBytes,
        fileCount: entries.length,
        tileCount: tileEntries.length,
        largestTileBytes: Math.max(0, ...tileEntries.map((entry) => entry.sizeBytes))
      },
      null,
      2
    )
  );
}

async function listFiles(root, prefix = "") {
  const rows = await readdir(join(root, prefix), { withFileTypes: true });
  const nested = await Promise.all(
    rows.map(async (row) => {
      const path = prefix ? `${prefix}/${row.name}` : row.name;

      if (row.isDirectory()) {
        return listFiles(root, path);
      }

      if (row.isFile()) {
        const fileStat = await stat(join(root, path));
        return fileStat.isFile() ? [path] : [];
      }

      return [];
    })
  );

  return nested.flat().sort();
}

function findDuplicateHashes(entries) {
  const pathsByHash = new Map();

  for (const entry of entries) {
    pathsByHash.set(entry.sha256, [...(pathsByHash.get(entry.sha256) ?? []), entry.path]);
  }

  return [...pathsByHash.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([sha256, paths]) => ({ sha256, paths: paths.sort() }))
    .sort((left, right) => left.sha256.localeCompare(right.sha256));
}

async function listTrackedOsmPbfFiles() {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "*.osm.pbf"], { cwd: ROOT });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .sort();
  } catch {
    failures.push("Unable to inspect tracked files for raw OSM PBF snapshots.");
    return [];
  }
}
