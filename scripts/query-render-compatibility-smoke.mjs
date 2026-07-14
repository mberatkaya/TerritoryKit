#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTerritoryRenderArtifactPath,
  compareTerritoryQueryRenderArtifacts,
  inspectTerritoryRenderArtifactPath,
  validateTerritoryRenderArtifactPath
} from "../packages/generators/dist/index.mjs";
import { createSyntheticGridDataset } from "../packages/shared-testkit/dist/index.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-query-render-smoke-"));

try {
  const dataset = createSyntheticGridDataset({
    datasetId: "query-render-smoke",
    rows: 3,
    columns: 3,
    cellSize: 0.25,
    withNeighbors: true
  });
  const datasetPath = join(tempDir, "dataset.json");
  const renderPath = join(tempDir, "artifact");

  await writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  await buildTerritoryRenderArtifactPath({
    inputPath: datasetPath,
    outputPath: renderPath,
    format: "mvt",
    minZoom: 0,
    maxZoom: 0,
    buildDate: "2026-07-14T00:00:00.000Z",
    force: true
  });

  const validation = await validateTerritoryRenderArtifactPath(renderPath);
  const comparison = await compareTerritoryQueryRenderArtifacts({
    queryDatasetPath: datasetPath,
    renderArtifactPath: renderPath
  });
  const inspection = await inspectTerritoryRenderArtifactPath(renderPath);
  const ok = validation.ok && comparison.ok;

  console.log(
    JSON.stringify(
      {
        ok,
        validation,
        comparison,
        inspection
      },
      null,
      2
    )
  );

  if (!ok) {
    process.exit(1);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
