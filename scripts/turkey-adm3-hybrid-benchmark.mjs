#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import {
  TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
  buildTurkeyV2HybridBatch,
  buildTurkeyV2HybridDistrict
} from "../packages/generators/dist/turkey-adm3.mjs";

const outputPath = readFlag("--output") ?? "reports/tr-adm3/hybrid-benchmark.json";
const smoke = process.argv.includes("--smoke");
const buildDate = "2026-08-13T00:00:00.000Z";
const generated = {
  enabled: true,
  profile: "custom",
  targetAreaKm2: 250,
  minAreaKm2: 0.5,
  maxAreaKm2: 600,
  maxZonesPerDistrict: 16,
  minFragmentAreaKm2: 0.25,
  seed: "kaprota-v2"
};
const scenarios = [
  {
    name: "official-only-district",
    district: district("official-only", rectangle(29, 41, 29.08, 41.06), "34", "001"),
    officialZones: [
      realZone("official-only-a", "official", rectangle(29, 41, 29.08, 41.06), "official-only")
    ]
  },
  {
    name: "generated-only-district",
    district: district("generated-only", rectangle(32, 39, 32.1, 39.08), "06", "002")
  },
  {
    name: "official-generated-district",
    district: district("official-generated", rectangle(30, 40, 30.14, 40.1), "07", "003"),
    officialZones: [
      realZone(
        "official-generated-a",
        "official",
        rectangle(30, 40, 30.07, 40.1),
        "official-generated"
      )
    ]
  },
  {
    name: "official-osm-generated-district",
    district: district("hybrid", rectangle(27, 38, 27.18, 38.12), "35", "004"),
    officialZones: [
      realZone("hybrid-official", "official", rectangle(27, 38, 27.07, 38.12), "hybrid")
    ],
    osmZones: [realZone("hybrid-osm", "osm", rectangle(27.05, 38, 27.13, 38.12), "hybrid")]
  },
  {
    name: "complex-multipolygon-district",
    district: district(
      "complex",
      {
        type: "MultiPolygon",
        coordinates: [
          [rectangleRing(26, 39, 26.16, 39.12)],
          [rectangleRing(26.22, 39.02, 26.29, 39.09)]
        ]
      },
      "10",
      "005"
    ),
    officialZones: [
      realZone("complex-official", "official", rectangle(26, 39, 26.08, 39.12), "complex")
    ]
  }
];

const startedAt = performance.now();
const scenarioResults = [];

for (const scenario of scenarios) {
  const scenarioStarted = performance.now();
  const result = await buildTurkeyV2HybridDistrict({
    district: scenario.district,
    provinceCode: provinceCodeFor(scenario.district),
    districtCode: districtCodeFor(scenario.district),
    officialZones: scenario.officialZones ?? [],
    osmZones: scenario.osmZones ?? [],
    generated,
    buildDate
  });

  assertHybridQuality(result, scenario.name);
  scenarioResults.push({
    scenario: scenario.name,
    districtCount: 1,
    candidateCounts: {
      official: scenario.officialZones?.length ?? 0,
      osm: scenario.osmZones?.length ?? 0
    },
    effectiveCounts: result.coverage.sourceCounts,
    vertexCount: countVertices(result.dataset.zones),
    sourceCoveragePercent: {
      official: result.coverage.officialCoveragePercent,
      osm: result.coverage.osmCoveragePercent,
      generated: result.coverage.generatedCoveragePercent
    },
    generatedCount: result.coverage.generatedEffectiveCount,
    finalCoveragePercent: result.coverage.finalCoveragePercent,
    qualityOk: result.quality.ok,
    durationMs: Math.round(performance.now() - scenarioStarted),
    deterministicHash: result.deterministicHash,
    peakRssBytes: process.memoryUsage().rss
  });
}

if (!smoke) {
  for (const count of [10, 100]) {
    const batchStarted = performance.now();
    const batchDistricts = createBatchDistricts(count);
    const sourcesByDistrict = Object.fromEntries(
      batchDistricts.map((item, index) => [
        item.id,
        index % 3 === 0
          ? {
              officialZones: [
                realZone(`${item.id}-official`, "official", leftHalf(item.geometry), item.id)
              ]
            }
          : index % 3 === 1
            ? { osmZones: [realZone(`${item.id}-osm`, "osm", leftHalf(item.geometry), item.id)] }
            : {}
      ])
    );
    const result = await buildTurkeyV2HybridBatch({
      districts: batchDistricts,
      sourcesByDistrict,
      generatedDefaults: generated,
      buildDate
    });

    if (!result.quality.ok) {
      throw new Error(`Hybrid benchmark batch ${count} failed quality gates.`);
    }

    scenarioResults.push({
      scenario: `${count}-district-batch`,
      districtCount: count,
      candidateCounts: {
        official: Object.values(sourcesByDistrict).filter((entry) => entry.officialZones).length,
        osm: Object.values(sourcesByDistrict).filter((entry) => entry.osmZones).length
      },
      effectiveCounts: {
        official: sumDistrictSourceCount(result, "official"),
        osm: sumDistrictSourceCount(result, "osm"),
        generated: sumDistrictSourceCount(result, "generated")
      },
      vertexCount: countVertices(result.dataset.zones),
      sourceCoveragePercent: {
        final: result.coverage.finalCoveragePercent
      },
      generatedCount: sumDistrictSourceCount(result, "generated"),
      finalCoveragePercent: result.coverage.finalCoveragePercent,
      qualityOk: result.quality.ok,
      durationMs: Math.round(performance.now() - batchStarted),
      deterministicHash: result.deterministicHash,
      peakRssBytes: process.memoryUsage().rss
    });
  }
}

const report = {
  schemaVersion: "territorykit-tr-v2-hybrid-benchmark@1",
  generatedAt: new Date(0).toISOString(),
  algorithmVersion: TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
  mode: smoke ? "smoke" : "benchmark",
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch
  },
  durationMs: Math.round(performance.now() - startedAt),
  deterministicHash: sha256(
    scenarioResults
      .map((item) => item.deterministicHash)
      .sort()
      .join(":")
  ),
  scenarios: scenarioResults
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, outputPath, report }, null, 2));

function assertHybridQuality(result, scenarioName) {
  if (
    !result.quality.ok ||
    result.coverage.finalCoveragePercent < 99.99 ||
    result.quality.summary.siblingOverlapAfterPriorityCount !== 0 ||
    result.quality.summary.realGeneratedOverlapKm2 !== 0 ||
    result.quality.summary.parentContainmentErrorCount !== 0 ||
    !result.quality.strictValidation.ok
  ) {
    throw new Error(`Turkey V2 hybrid scenario '${scenarioName}' failed quality gates.`);
  }
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function createBatchDistricts(count) {
  return Array.from({ length: count }, (_, index) => {
    const column = index % 10;
    const row = Math.floor(index / 10);
    const west = 26 + column * 0.18;
    const south = 36 + row * 0.14;
    return district(
      `batch-${String(index + 1).padStart(3, "0")}`,
      rectangle(west, south, west + 0.12, south + 0.1),
      "01",
      String(index + 1).padStart(3, "0")
    );
  });
}

function district(idSuffix, geometry, provinceCode, districtCode) {
  return {
    id: `tr:adm2:${idSuffix}`,
    datasetId: "hybrid-benchmark-tr-adm2",
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
        sourceAdminLevel: "ADM2",
        semanticType: "district",
        semanticReviewStatus: "reviewed",
        coverageStatus: "verified"
      }
    }
  };
}

function realZone(idSuffix, sourceClass, geometry, parentIdOrSuffix) {
  const parentId = parentIdOrSuffix.startsWith("tr:adm2:")
    ? parentIdOrSuffix
    : `tr:adm2:${parentIdOrSuffix}`;
  const parentSuffix = parentId.replace(/^tr:adm2:/, "");
  const providerId = sourceClass === "osm" ? "openstreetmap" : "benchmark-official";
  const license = sourceClass === "osm" ? "ODbL-1.0" : "CC BY 4.0";
  const attribution =
    sourceClass === "osm" ? "OpenStreetMap contributors, ODbL 1.0" : "Benchmark official fixture";

  return {
    id: `tr:adm3:${idSuffix.replace(/[^a-zA-Z0-9_.-]+/g, "-")}`,
    datasetId: "hybrid-benchmark-tr-adm3",
    countryCode: "TR",
    level: 3,
    sourceAdminLevel: "ADM3",
    semanticType: "neighbourhood",
    name: idSuffix,
    parentId,
    neighborIds: [],
    geometry,
    center: center(geometry),
    bbox: bbox(geometry),
    properties: {
      territory: {
        countryCode: "TR",
        provinceCode: "01",
        districtCode: parentSuffix,
        adminLevel: "ADM3",
        sourceAdminLevel: "ADM3",
        semanticType: "neighbourhood",
        localType: "neighbourhood",
        localTypeName: "Mahalle",
        hierarchyDepth: 3,
        parentId,
        sourceClass,
        providerClass: sourceClass,
        providerId,
        providerName: providerId,
        sourceProvider: providerId,
        sourceDatasetId: sourceClass === "osm" ? "openstreetmap" : "benchmark-official",
        sourceNativeId: idSuffix,
        sourceDate: "2026-08-01",
        sourceUrl:
          sourceClass === "osm"
            ? "https://www.openstreetmap.org/"
            : "https://data.example.test/tr/adm3",
        license,
        attribution,
        official: sourceClass === "official",
        generated: false,
        semanticReviewStatus: "reviewed",
        coverageStatus: "verified",
        stableId: `tr:adm3:${idSuffix.replace(/[^a-zA-Z0-9_.-]+/g, "-")}`,
        redistributionPolicy: "allowed",
        commercialUsePolicy: "allowed",
        modificationPolicy: "allowed",
        source: {
          provider: providerId,
          sourceClass,
          sourceDatasetId: sourceClass === "osm" ? "openstreetmap" : "benchmark-official",
          sourceId: idSuffix,
          sourceNativeId: idSuffix,
          sourceDate: "2026-08-01",
          sourceUrl:
            sourceClass === "osm"
              ? "https://www.openstreetmap.org/"
              : "https://data.example.test/tr/adm3",
          license,
          attribution
        }
      }
    }
  };
}

function leftHalf(geometry) {
  const [west, south, east, north] = bbox(geometry);
  return rectangle(west, south, (west + east) / 2, north);
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

function countVertices(zones) {
  return zones.reduce((total, zone) => total + collectPoints(zone.geometry.coordinates).length, 0);
}

function sumDistrictSourceCount(result, sourceClass) {
  return result.districts.reduce(
    (total, districtResult) => total + districtResult.coverage.sourceCounts[sourceClass],
    0
  );
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}
