import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { createTerritoryEngine } from "../packages/core/dist/index.mjs";
import { loadTerritoryDataset } from "../packages/dataset/dist/index.mjs";
import { createSyntheticGridDataset } from "../packages/shared-testkit/dist/index.mjs";

export const BENCHMARK_RESULT_SCHEMA = "territorykit-benchmark-result@1";
export const BENCHMARK_BASELINE_SCHEMA = "territorykit-benchmark-baseline@1";

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function runFixtureBenchmark(options = {}) {
  const rows = positiveInteger(options.rows, 50);
  const columns = positiveInteger(options.columns, 50);
  const cellSize = positiveNumber(options.cellSize, 0.01);
  const iterations = positiveInteger(options.iterations, 5_000);
  const dataset = createSyntheticGridDataset({
    datasetId: options.datasetId ?? "territorykit-fixture-benchmark",
    rows,
    columns,
    cellSize,
    withNeighbors: true
  });

  return measureDatasetBenchmark({
    dataset,
    mode: "fixture",
    scenario: options.scenario ?? "smoke",
    iterations,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    source: {
      type: "synthetic-grid",
      rows,
      columns,
      cellSize
    }
  });
}

export async function runLocalRealBenchmark(options = {}) {
  if (!options.datasetPath) {
    return {
      schemaVersion: BENCHMARK_RESULT_SCHEMA,
      mode: "local-real",
      scenario: options.scenario ?? "smoke",
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      runtime: createRuntimeInfo(),
      source: {
        type: "local-real"
      },
      inputs: {
        datasetId: undefined,
        datasetVersion: undefined,
        featureCount: 0
      },
      metrics: {},
      skipped: [
        "No local real-world dataset path was provided. Pass --dataset <dataset.json> to run this mode."
      ]
    };
  }

  const raw = await readJson(options.datasetPath);
  const parseStart = performance.now();
  const dataset = loadTerritoryDataset(raw);
  const datasetLoadMs = performance.now() - parseStart;
  const result = measureDatasetBenchmark({
    dataset,
    mode: "local-real",
    scenario: options.scenario ?? "smoke",
    iterations: positiveInteger(options.iterations, 5_000),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    source: {
      type: "local-real",
      datasetPath: options.datasetPath
    }
  });

  return {
    ...result,
    metrics: {
      ...result.metrics,
      datasetLoadMs
    }
  };
}

export function compareBenchmarkResult(current, baseline) {
  const issues = [];

  if (baseline.schemaVersion !== BENCHMARK_BASELINE_SCHEMA) {
    issues.push(`Unsupported baseline schema '${baseline.schemaVersion}'.`);
  }

  if (current.schemaVersion !== BENCHMARK_RESULT_SCHEMA) {
    issues.push(`Unsupported benchmark result schema '${current.schemaVersion}'.`);
  }

  if (baseline.mode && current.mode !== baseline.mode) {
    issues.push(`Expected mode '${baseline.mode}', got '${current.mode}'.`);
  }

  if (baseline.scenario && current.scenario !== baseline.scenario) {
    issues.push(`Expected scenario '${baseline.scenario}', got '${current.scenario}'.`);
  }

  const minimumFeatureCount = baseline.minimumFeatureCount;

  if (
    Number.isFinite(minimumFeatureCount) &&
    Number(current.inputs?.featureCount ?? 0) < minimumFeatureCount
  ) {
    issues.push(
      `Expected at least ${minimumFeatureCount} features, got ${current.inputs?.featureCount ?? 0}.`
    );
  }

  for (const [metric, maxValue] of Object.entries(baseline.budgets ?? {})) {
    const value = current.metrics?.[metric];

    if (!Number.isFinite(value)) {
      issues.push(`Missing numeric benchmark metric '${metric}'.`);
      continue;
    }

    if (value > maxValue) {
      issues.push(`Metric '${metric}' exceeded budget ${maxValue}; got ${value}.`);
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

function measureDatasetBenchmark(options) {
  const validation = measureOnce(() => loadTerritoryDataset(options.dataset));
  const engineConstruction = measureOnce(() => createTerritoryEngine({ dataset: options.dataset }));
  const engine = engineConstruction.value;
  const lookupZone = options.dataset.zones[Math.floor(options.dataset.zones.length / 2)];

  if (!lookupZone) {
    throw new Error("Benchmark dataset must contain at least one zone.");
  }

  const [lng, lat] = lookupZone.center;
  const bbox = lookupZone.bbox;
  const bounds = {
    west: Math.max(-180, bbox[0] - 0.01),
    south: Math.max(-90, bbox[1] - 0.01),
    east: Math.min(180, bbox[2] + 0.01),
    north: Math.min(90, bbox[3] + 0.01),
    level: lookupZone.level
  };
  const getZoneById = measureRepeated(options.iterations, () => engine.getZoneById(lookupZone.id));
  const latLngToZone = measureRepeated(options.iterations, () =>
    engine.latLngToZone({ lat, lng }, { level: lookupZone.level })
  );
  const getZonesInBounds = measureRepeated(options.iterations, () =>
    engine.getZonesInBounds(bounds)
  );

  return {
    schemaVersion: BENCHMARK_RESULT_SCHEMA,
    mode: options.mode,
    scenario: options.scenario,
    generatedAt: options.generatedAt,
    runtime: createRuntimeInfo(),
    source: options.source,
    inputs: {
      datasetId: options.dataset.manifest.datasetId,
      datasetVersion: options.dataset.manifest.datasetVersion,
      featureCount: options.dataset.zones.length,
      iterations: options.iterations
    },
    metrics: {
      datasetValidationMs: roundMetric(validation.durationMs),
      engineConstructionMs: roundMetric(engineConstruction.durationMs),
      getZoneByIdMeanMs: roundMetric(getZoneById.meanMs),
      latLngToZoneMeanMs: roundMetric(latLngToZone.meanMs),
      getZonesInBoundsMeanMs: roundMetric(getZonesInBounds.meanMs)
    }
  };
}

function measureOnce(callback) {
  const start = performance.now();
  const value = callback();
  return {
    value,
    durationMs: performance.now() - start
  };
}

function measureRepeated(iterations, callback) {
  const start = performance.now();
  let guard = 0;

  for (let index = 0; index < iterations; index += 1) {
    const value = callback();

    if (Array.isArray(value)) {
      guard += value.length;
    } else if (value) {
      guard += 1;
    }
  }

  return {
    guard,
    meanMs: (performance.now() - start) / iterations
  };
}

function createRuntimeInfo() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch
  };
}

function positiveInteger(value, fallback) {
  const parsed = value === undefined ? fallback : Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Expected a positive integer benchmark option.");
  }

  return parsed;
}

function positiveNumber(value, fallback) {
  const parsed = value === undefined ? fallback : Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Expected a positive numeric benchmark option.");
  }

  return parsed;
}

function roundMetric(value) {
  return Number(value.toFixed(6));
}
