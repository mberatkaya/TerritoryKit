#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  buildTurkeyGameZones,
  TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION
} from "../packages/generators/dist/turkey-adm3.mjs";

const outputPath = readFlag("--output") ?? "reports/tr-adm3/game-zone-benchmark.json";
const smoke = process.argv.includes("--smoke");
const scenarios = [
  {
    name: "small-urban-district",
    profile: "urban",
    district: district("urban", rectangle(29, 41, 29.08, 41.06), "34", "001")
  },
  {
    name: "medium-suburban-district",
    profile: "suburban",
    district: district("suburban", rectangle(32, 39, 32.28, 39.22), "06", "002")
  },
  {
    name: "large-rural-district",
    profile: "rural",
    district: district("rural", rectangle(38, 39, 38.9, 39.7), "24", "003")
  },
  {
    name: "complex-multipolygon-coastal-district",
    profile: "suburban",
    district: district(
      "coastal",
      {
        type: "MultiPolygon",
        coordinates: [
          [rectangleRing(27, 38, 27.28, 38.18)],
          [rectangleRing(27.36, 38.04, 27.44, 38.1)]
        ]
      },
      "35",
      "004"
    )
  },
  {
    name: "partial-real-coverage-mask",
    profile: "auto",
    district: district("partial", rectangle(30, 40, 30.35, 40.22), "07", "005"),
    excludedOrOccupiedZones: [
      zone("partial-real-zone", rectangle(30.02, 40.02, 30.16, 40.12), "07", "005")
    ]
  }
];

if (!smoke) {
  scenarios.push({
    name: "ten-district-batch",
    profile: "auto",
    batch: createBatch(10)
  });
  scenarios.push({
    name: "hundred-district-batch",
    profile: "auto",
    batch: createBatch(100)
  });
}

const startedAt = performance.now();
const results = [];

for (const scenario of scenarios) {
  const districts = scenario.batch ?? [scenario.district];
  const scenarioStarted = performance.now();
  let producedZoneCount = 0;
  let minCoverage = 100;
  let maxBuildTimeMs = 0;
  const hashes = [];

  for (const item of districts) {
    const districtStarted = performance.now();
    const result = buildTurkeyGameZones({
      district: item,
      provinceCode: provinceCodeFor(item),
      districtCode: districtCodeFor(item),
      profile: scenario.profile,
      seed: "kaprota-v2",
      ...(scenario.excludedOrOccupiedZones
        ? { excludedOrOccupiedZones: scenario.excludedOrOccupiedZones }
        : {})
    });
    const durationMs = Math.round(performance.now() - districtStarted);

    producedZoneCount += result.zones.length;
    minCoverage = Math.min(minCoverage, result.coverage.finalCoveragePercent);
    maxBuildTimeMs = Math.max(maxBuildTimeMs, durationMs);
    hashes.push(result.deterministicHash);

    if (
      result.coverage.finalCoveragePercent < 99.99 ||
      result.quality.overlapCount !== 0 ||
      result.quality.parentContainmentErrorCount !== 0 ||
      result.quality.invalidGeometryCount !== 0
    ) {
      throw new Error(`Turkey game-zone scenario '${scenario.name}' failed quality gates.`);
    }
  }

  results.push({
    scenario: scenario.name,
    profile: scenario.profile,
    districtCount: districts.length,
    producedZoneCount,
    minCoveragePercent: minCoverage,
    maxDistrictBuildTimeMs: maxBuildTimeMs,
    durationMs: Math.round(performance.now() - scenarioStarted),
    deterministicHash: sha256(hashes.sort().join(":")),
    peakRssBytes: process.memoryUsage().rss
  });
}

const report = {
  schemaVersion: "territorykit-tr-adm3-game-zone-benchmark@1",
  algorithmVersion: TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
  generatedAt: new Date(0).toISOString(),
  mode: smoke ? "smoke" : "benchmark",
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch
  },
  durationMs: Math.round(performance.now() - startedAt),
  scenarios: results
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, outputPath, report }, null, 2));

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function createBatch(count) {
  return Array.from({ length: count }, (_, index) => {
    const column = index % 10;
    const row = Math.floor(index / 10);
    const west = 26 + column * 0.22;
    const south = 36 + row * 0.18;
    return district(
      `batch-${String(index + 1).padStart(3, "0")}`,
      rectangle(west, south, west + 0.16, south + 0.12),
      "01",
      String(index + 1).padStart(3, "0")
    );
  });
}

function district(idSuffix, geometry, provinceCode, districtCode) {
  return {
    id: `tr:adm2:${idSuffix}`,
    datasetId: "benchmark-tr-adm2",
    countryCode: "TR",
    level: 2,
    sourceAdminLevel: "ADM2",
    semanticType: "district",
    name: idSuffix,
    neighborIds: [],
    geometry,
    center: center(geometry),
    bbox: bbox(geometry),
    properties: {
      territory: {
        countryCode: "TR",
        provinceCode,
        districtCode,
        adminLevel: "ADM2",
        sourceAdminLevel: "ADM2"
      }
    }
  };
}

function zone(idSuffix, geometry, provinceCode, districtCode) {
  return {
    ...district(idSuffix, geometry, provinceCode, districtCode),
    id: `tr:adm3:${idSuffix}`,
    level: 3,
    sourceAdminLevel: "ADM3",
    semanticType: "neighbourhood",
    parentId: `tr:adm2:${idSuffix}`,
    properties: {
      territory: {
        countryCode: "TR",
        provinceCode,
        districtCode,
        adminLevel: "ADM3",
        sourceAdminLevel: "ADM3",
        sourceClass: "official"
      }
    }
  };
}

function rectangle(west, south, east, north) {
  return { type: "Polygon", coordinates: [rectangleRing(west, south, east, north)] };
}

function rectangleRing(west, south, east, north) {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ];
}

function bbox(geometry) {
  const points = collectPoints(geometry.coordinates);
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function collectPoints(input) {
  if (typeof input?.[0] === "number" && typeof input?.[1] === "number") {
    return [input];
  }

  return Array.isArray(input) ? input.flatMap((entry) => collectPoints(entry)) : [];
}

function center(geometry) {
  const box = bbox(geometry);
  return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}

function provinceCodeFor(item) {
  return item.properties.territory.provinceCode;
}

function districtCodeFor(item) {
  return item.properties.territory.districtCode;
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}
