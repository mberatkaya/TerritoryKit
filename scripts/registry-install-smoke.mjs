#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadTerritoryDataset } from "../packages/dataset/dist/index.mjs";
import { createNodeTerritoryRegistryClient } from "../packages/registry/dist/node.mjs";
import { createSyntheticGridDataset } from "../packages/shared-testkit/dist/index.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-registry-smoke-"));

try {
  const dataset = createSyntheticGridDataset({
    datasetId: "registry-smoke",
    rows: 4,
    columns: 4,
    cellSize: 0.1,
    withNeighbors: true
  });
  const datasetPath = join(tempDir, "dataset.json");
  const datasetContent = `${JSON.stringify(dataset, null, 2)}\n`;
  await writeFile(datasetPath, datasetContent, "utf8");
  const registry = {
    registryVersion: "1",
    generatedAt: "2026-07-14T00:00:00.000Z",
    baseUrl: pathToFileURL(tempDir).toString(),
    datasets: [
      {
        id: dataset.manifest.datasetId,
        displayName: "Registry smoke fixture",
        version: "1.0.0",
        schemaVersion: "territory-schema@1",
        levels: ["ADM0"],
        source: {
          provider: "fixture"
        },
        license: {
          id: "Apache-2.0",
          attribution: "TerritoryKit fixture"
        },
        artifacts: [
          {
            id: "query-json",
            purpose: "query",
            format: "territory-json",
            levels: ["ADM0"],
            path: "dataset.json",
            url: "dataset.json",
            sha256: sha256Hex(datasetContent),
            sizeBytes: Buffer.byteLength(datasetContent),
            compression: "none",
            contentType: "application/json"
          }
        ]
      }
    ]
  };
  const cacheDir = join(tempDir, "cache");
  const registryUrl = "inline://registry-smoke";
  const client = createNodeTerritoryRegistryClient({
    registry,
    registryUrl,
    cacheDir,
    now: () => new Date("2026-07-14T00:00:00.000Z")
  });
  const handle = await client.installDataset({ datasetId: dataset.manifest.datasetId });
  const text = await handle.readText("dataset.json");
  const loaded = loadTerritoryDataset(JSON.parse(text));
  const verified = await client.verifyInstalledDataset(dataset.manifest.datasetId);
  const offlineClient = createNodeTerritoryRegistryClient({
    registryUrl,
    cacheDir,
    offline: true
  });
  await offlineClient.loadRegistry();
  const offlineInstalled = await offlineClient.listInstalledDatasets();

  console.log(
    JSON.stringify(
      {
        ok: true,
        datasetId: loaded.manifest.datasetId,
        zoneCount: loaded.zones.length,
        installedArtifacts: handle.installedArtifacts.length,
        verified,
        offlineInstalled
      },
      null,
      2
    )
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}
