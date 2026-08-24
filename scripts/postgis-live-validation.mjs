#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { Client } from "pg";
const { loadTerritoryDataset } = await import("../packages/dataset/dist/index.mjs");
const { createTurkeyAdm3DemoDataset } = await import("../packages/shared-testkit/dist/index.mjs");
const {
  POSTGIS_BOUNDS_SQL,
  POSTGIS_FIND_BY_ID_SQL,
  POSTGIS_HIERARCHY_SQL,
  POSTGIS_POINT_LOOKUP_SQL,
  POSTGIS_ROUTE_SQL,
  createPostgisTerritoryRepository
} = await import("../packages/nestjs/dist/index.mjs");

const args = parseArgs(process.argv.slice(2));
const databaseUrl =
  args.get("database-url") ??
  process.env.TERRITORYKIT_POSTGIS_URL ??
  process.env.POSTGIS_URL ??
  process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "Missing PostGIS database URL. Set TERRITORYKIT_POSTGIS_URL or pass --database-url."
  );
  process.exit(2);
}

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const dataset = await readBenchmarkDataset(args.get("dataset"));
  const level = Number(args.get("level") ?? selectBenchmarkLevel(dataset));
  const pgClient = {
    query(sql, values) {
      return client.query(sql, values);
    }
  };
  const repository = createPostgisTerritoryRepository(pgClient, {
    datasetId: dataset.manifest.datasetId,
    datasetVersion: dataset.manifest.datasetVersion,
    defaultLevel: level
  });
  const importResult = await repository.importDataset(dataset, {
    batchSize: Number(args.get("batch-size") ?? 500),
    ensureSchema: true
  });
  const environment = await readEnvironment();
  const indexes = await readIndexEvidence();
  const fixtures = createQueryFixtures(dataset, level);
  const correctness = await runCorrectness(repository, fixtures);
  const explain = await runExplain(dataset, level, fixtures);
  const benchmark = await runBenchmarks(repository, fixtures);
  const report = {
    schemaVersion: "territorykit-postgis-live-validation@1",
    generatedAt: new Date().toISOString(),
    environment,
    dataset: {
      datasetId: dataset.manifest.datasetId,
      datasetVersion: dataset.manifest.datasetVersion,
      geometryHash: dataset.manifest.geometryHash,
      zoneCount: dataset.zones.length,
      level
    },
    import: importResult,
    indexes,
    correctness,
    explain,
    benchmark
  };
  const failures = collectLiveValidationFailures(report, args);
  const outputPath = args.get("output");

  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(report, null, 2));

  if (failures.length > 0) {
    console.error(`PostGIS live validation failed:\n${failures.join("\n")}`);
    process.exitCode = 1;
  }
} finally {
  await client.end();
}

async function readBenchmarkDataset(datasetPath) {
  const candidates = [
    datasetPath,
    ".territory/build/TR/V2-national-benchmark/100/dataset.json",
    ".territory/build/TR/V2-national-smoke/dataset.json"
  ].filter(Boolean);
  const match = candidates.find((candidate) => existsSync(candidate));

  if (!match) {
    return createTurkeyAdm3DemoDataset();
  }

  return loadTerritoryDataset(JSON.parse(await readFile(match, "utf8")));
}

function selectBenchmarkLevel(dataset) {
  const levels = [...new Set(dataset.zones.map((zone) => zone.level))].sort(
    (left, right) => left - right
  );

  return levels.includes(3) ? 3 : (levels.at(-1) ?? 0);
}

function createQueryFixtures(dataset, level) {
  const zones = dataset.zones
    .filter((zone) => zone.level === level)
    .sort((left, right) => left.id.localeCompare(right.id));
  const istanbul =
    zones.find(
      (zone) => zone.id.includes(":34") || String(zone.properties.name ?? "").includes("Istanbul")
    ) ??
    zones[Math.floor(zones.length / 2)] ??
    dataset.zones[0];

  if (!istanbul) {
    throw new Error("PostGIS validation dataset must contain at least one zone.");
  }

  const [west, south, east, north] = istanbul.bbox;
  const point = { lng: istanbul.center[0], lat: istanbul.center[1] };
  const smallBounds = expandBounds(istanbul.bbox, 0.005);
  const districtBounds = expandBounds(istanbul.bbox, 0.03);
  const cityBounds = expandBounds(istanbul.bbox, 0.15);
  const largeBounds = expandBounds(istanbul.bbox, 0.5);
  const routeStart = [Math.max(-180, west - 0.01), (south + north) / 2];
  const routeEnd = [Math.min(180, east + 0.01), (south + north) / 2];
  const routeLongEndZone =
    zones[Math.min(zones.length - 1, Math.floor(zones.length * 0.75))] ?? istanbul;

  return {
    zone: istanbul,
    point,
    bounds: {
      street: smallBounds,
      district: districtBounds,
      city: cityBounds,
      large: largeBounds
    },
    routes: {
      short: {
        type: "LineString",
        coordinates: [routeStart, routeEnd]
      },
      medium: {
        type: "LineString",
        coordinates: [
          [Math.max(-180, west - 0.05), Math.max(-90, south - 0.02)],
          pointToLngLat(point),
          [Math.min(180, east + 0.08), Math.min(90, north + 0.03)]
        ]
      },
      long: {
        type: "LineString",
        coordinates: [pointToLngLat(point), routeLongEndZone.center]
      }
    }
  };
}

async function runCorrectness(repository, fixtures) {
  const point = await repository.findAtPoint({
    coordinate: fixtures.point,
    level: fixtures.zone.level
  });
  const bounds = await repository.findInBounds({
    ...fixtures.bounds.district,
    level: fixtures.zone.level,
    limit: 200
  });
  const route = await repository.findAlongRoute({
    route: fixtures.routes.medium,
    level: fixtures.zone.level
  });
  const byId = await repository.findById(fixtures.zone.id);
  const hierarchy = await repository.getHierarchy(fixtures.zone.id);
  const adjacent = await repository.getAdjacentTerritories(fixtures.zone.id);

  return {
    point: {
      ok: point?.id === fixtures.zone.id,
      expected: fixtures.zone.id,
      actual: point?.id ?? null
    },
    bounds: {
      ok: bounds.some((zone) => zone.id === fixtures.zone.id),
      resultCount: bounds.length
    },
    route: {
      ok: route.territories.length > 0,
      resultCount: route.territories.length
    },
    byId: {
      ok: byId?.id === fixtures.zone.id
    },
    hierarchy: {
      ok: Boolean(hierarchy),
      ancestorCount: hierarchy?.ancestorIds.length ?? 0
    },
    adjacency: {
      ok: Array.isArray(adjacent),
      resultCount: adjacent.length
    }
  };
}

async function runExplain(dataset, level, fixtures) {
  const datasetId = dataset.manifest.datasetId;
  const datasetVersion = dataset.manifest.datasetVersion;
  const queryInputs = {
    point: [
      POSTGIS_POINT_LOOKUP_SQL,
      [datasetId, datasetVersion, level, fixtures.point.lng, fixtures.point.lat]
    ],
    bounds: [
      POSTGIS_BOUNDS_SQL,
      [
        datasetId,
        datasetVersion,
        level,
        fixtures.bounds.city.west,
        fixtures.bounds.city.south,
        fixtures.bounds.city.east,
        fixtures.bounds.city.north,
        500
      ]
    ],
    route: [
      POSTGIS_ROUTE_SQL,
      [datasetId, datasetVersion, level, JSON.stringify(fixtures.routes.medium)]
    ],
    byId: [POSTGIS_FIND_BY_ID_SQL, [datasetId, datasetVersion, fixtures.zone.id]],
    hierarchy: [POSTGIS_HIERARCHY_SQL, [datasetId, datasetVersion, fixtures.zone.id]]
  };
  const explain = {};

  for (const [name, [sql, values]] of Object.entries(queryInputs)) {
    const result = await client.query(`explain (analyze, buffers, format json) ${sql}`, values);
    const plan = result.rows[0]?.["QUERY PLAN"]?.[0];
    explain[name] = summarizePlan(plan);
  }

  return explain;
}

async function runBenchmarks(repository, fixtures) {
  const pointCounts = [100, 1000, 10000];
  const point = {};

  for (const count of pointCounts) {
    point[String(count)] = await measureRepeated(count, () =>
      repository.findAtPoint({
        coordinate: fixtures.point,
        level: fixtures.zone.level
      })
    );
  }

  const bounds = {};

  for (const [name, value] of Object.entries(fixtures.bounds)) {
    bounds[name] = await measureRepeated(100, () =>
      repository.findInBounds({
        ...value,
        level: fixtures.zone.level,
        limit: 1000
      })
    );
  }

  const route = {};

  for (const [name, value] of Object.entries(fixtures.routes)) {
    route[name] = await measureRepeated(50, () =>
      repository.findAlongRoute({
        route: value,
        level: fixtures.zone.level
      })
    );
  }

  return {
    point,
    bounds,
    route
  };
}

async function readEnvironment() {
  const version = await client.query("select version() as version", []);
  const postgis = await client.query("select postgis_full_version() as version", []);

  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    postgres: version.rows[0]?.version ?? "unknown",
    postgis: postgis.rows[0]?.version ?? "unknown"
  };
}

async function readIndexEvidence() {
  const result = await client.query(
    `
select indexname, indexdef
from pg_indexes
where schemaname = current_schema()
  and tablename = 'territory_zones'
order by indexname asc
`,
    []
  );
  const indexes = result.rows;
  const byName = new Map(indexes.map((row) => [row.indexname, row.indexdef]));

  return {
    indexes,
    checks: {
      identity: byName.has("territory_zones_identity_idx"),
      datasetVersion: byName.has("territory_zones_dataset_level_idx"),
      parent: byName.has("territory_zones_parent_idx"),
      geometryGist: String(byName.get("territory_zones_geometry_gist_idx") ?? "").includes("gist"),
      bboxGist: String(byName.get("territory_zones_bbox_gist_idx") ?? "").includes("gist")
    }
  };
}

async function measureRepeated(iterations, callback) {
  const durations = [];
  let resultCount = 0;

  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    const value = await callback();
    durations.push(performance.now() - started);

    if (Array.isArray(value)) {
      resultCount = value.length;
    } else if (Array.isArray(value?.territories)) {
      resultCount = value.territories.length;
    } else if (value) {
      resultCount = 1;
    }
  }

  durations.sort((left, right) => left - right);

  return {
    iterations,
    resultCount,
    meanMs: roundMetric(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99)
  };
}

function summarizePlan(explainJson) {
  const plan = explainJson?.Plan;
  const nodes = [];
  collectPlanNodes(plan, nodes);

  return {
    executionTimeMs: roundMetric(Number(explainJson?.["Execution Time"] ?? 0)),
    planningTimeMs: roundMetric(Number(explainJson?.["Planning Time"] ?? 0)),
    nodeTypes: [...new Set(nodes.map((node) => node.nodeType))],
    indexNames: [...new Set(nodes.map((node) => node.indexName).filter(Boolean))],
    hasSeqScan: nodes.some((node) => node.nodeType === "Seq Scan"),
    hasIndexScan: nodes.some((node) => /Index Scan|Bitmap Index Scan/.test(node.nodeType)),
    hasGistIndex: nodes.some((node) => String(node.indexName ?? "").includes("_gist_idx")),
    sharedHitBlocks: nodes.reduce((sum, node) => sum + Number(node.sharedHitBlocks ?? 0), 0),
    rows: Number(plan?.["Actual Rows"] ?? 0)
  };
}

function collectLiveValidationFailures(report, args) {
  const failures = [];
  const indexChecks = report.indexes.checks;
  const requireIndexPlans =
    args.get("require-index-plans") === "true" ||
    report.dataset.zoneCount >= Number(args.get("index-plan-min-zones") ?? 1000);

  for (const [name, ok] of Object.entries(indexChecks)) {
    if (!ok) {
      failures.push(`missing required index evidence: ${name}`);
    }
  }

  for (const [name, result] of Object.entries(report.correctness)) {
    if (!result.ok) {
      failures.push(`correctness probe failed: ${name}`);
    }
  }

  if (requireIndexPlans) {
    for (const name of ["point", "bounds", "route"]) {
      const plan = report.explain[name];

      if (plan.hasSeqScan || !plan.hasIndexScan || !plan.hasGistIndex) {
        failures.push(`spatial query plan did not use GiST index cleanly: ${name}`);
      }
    }

    for (const name of ["byId", "hierarchy"]) {
      const plan = report.explain[name];

      if (plan.hasSeqScan || !plan.hasIndexScan) {
        failures.push(`identity query plan did not use an index cleanly: ${name}`);
      }
    }
  }

  return failures;
}

function collectPlanNodes(plan, nodes) {
  if (!plan) {
    return;
  }

  nodes.push({
    nodeType: plan["Node Type"],
    indexName: plan["Index Name"],
    relationName: plan["Relation Name"],
    sharedHitBlocks: plan["Shared Hit Blocks"]
  });

  for (const child of plan.Plans ?? []) {
    collectPlanNodes(child, nodes);
  }
}

function expandBounds(bbox, amount) {
  return {
    west: Math.max(-180, bbox[0] - amount),
    south: Math.max(-90, bbox[1] - amount),
    east: Math.min(180, bbox[2] + amount),
    north: Math.min(90, bbox[3] + amount)
  };
}

function pointToLngLat(point) {
  return [point.lng, point.lat];
}

function percentile(sortedDurations, quantile) {
  if (sortedDurations.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedDurations.length - 1,
    Math.ceil(sortedDurations.length * quantile) - 1
  );
  return roundMetric(sortedDurations[index] ?? 0);
}

function roundMetric(value) {
  return Number(value.toFixed(6));
}

function parseArgs(values) {
  const flags = new Map();

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === "--") {
      continue;
    }

    if (!value?.startsWith("--")) {
      continue;
    }

    const key = value.slice(2);
    const next = values[index + 1];

    if (!next || next.startsWith("--")) {
      flags.set(key, "true");
      continue;
    }

    flags.set(key, next);
    index += 1;
  }

  return flags;
}
