#!/usr/bin/env node
/**
 * Sprint 2B.4 — Fatih hybrid (impl-rev4) + independent v1.7 vs impl-rev3 boundary QA.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { geometryToPolygons } from "../packages/dataset/dist/index.mjs";
import { validateTurkeyV2Dataset } from "../packages/dataset/dist/turkey-v2.mjs";
import { writeReportJson, writeReportMarkdown } from "./lib/write-report-json.mjs";
import {
  TURKEY_SMART_FALLBACK_V2_PILOT_IMPLEMENTATION_REVISION_REV4,
  buildTurkeyNetworkFirstSmartFallbackWithAdjacency,
  buildTurkeySmartFallbackV2PilotRev4HybridWithAdjacency,
  createTurkeySmartFallbackDataset,
  inspectTurkeyGeneratedZonePathology,
  readTurkeyOsmAdm2BarrierArtifact
} from "../packages/generators/dist/turkey-adm3.mjs";

const REPO_ROOT = process.cwd();
const FATIH_ADM2_SUFFIX = "54988432b39641834885080";
const PARENT_ADM2_ID = `tr:adm2:${FATIH_ADM2_SUFFIX}`;
const BASELINE_ROOT =
  process.env.MAHALLE_FIRST_RC8_ROOT ??
  ".territory/national-geometry-remediation/candidate-rc8-impl-rev1";
const BARRIER_ROOT =
  process.env.MAHALLE_FIRST_BARRIER_ROOT ?? ".territory/sprint-6/calibration/barriers";
const OSM_SOURCE_LOCK =
  process.env.MAHALLE_FIRST_OSM_SOURCE_LOCK ??
  ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json";
const REV3_OUTPUT =
  process.env.MAHALLE_FIRST_FATIH_REV3_OUTPUT ??
  ".territory/mahalle-first-pilot/fatih-v2-impl-rev3";
const OUTPUT_ROOT =
  process.env.MAHALLE_FIRST_FATIH_HYBRID_OUTPUT ??
  ".territory/mahalle-first-pilot/fatih-v2-impl-rev4-hybrid";
const REPORT_ROOT = "reports/tr-adm3/mahalle-first-program";

const REV3_SEED_COVERAGE_FLOOR = 0.5352;
const V17_WEIGHTED_ALIGNMENT_TARGET = 0.8907;
const EDGE_KEY_PRECISION = 6;
const EDGE_MATCH_TOLERANCE_METERS = 1.5;

async function readJson(path) {
  return JSON.parse(await readFile(join(REPO_ROOT, path), "utf8"));
}

function territoryMeta(zone) {
  return zone.properties?.territory ?? zone.properties ?? {};
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundCoord(value) {
  const factor = 10 ** EDGE_KEY_PRECISION;
  return Math.round(value * factor) / factor;
}

function haversineMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function geometryRingSegments(geometry) {
  const segments = [];
  for (const polygon of geometryToPolygons(geometry)) {
    for (const ring of polygon) {
      for (let index = 0; index < ring.length - 1; index++) {
        segments.push({ a: ring[index], b: ring[index + 1] });
      }
    }
  }
  return segments;
}

function segmentKey(segment) {
  const ax = roundCoord(segment.a[0]);
  const ay = roundCoord(segment.a[1]);
  const bx = roundCoord(segment.b[0]);
  const by = roundCoord(segment.b[1]);
  if (ax < bx || (ax === bx && ay <= by)) {
    return `${ax},${ay}|${bx},${by}`;
  }
  return `${bx},${by}|${ax},${ay}`;
}

function inventoryInternalEdges(zones) {
  const edgeStats = new Map();
  for (const zone of zones) {
    for (const segment of geometryRingSegments(zone.geometry)) {
      const lengthMeters = haversineMeters(segment.a, segment.b);
      if (lengthMeters <= 0) {
        continue;
      }
      const key = segmentKey(segment);
      const prior = edgeStats.get(key) ?? { sum: 0, maxSeg: 0 };
      prior.sum += lengthMeters;
      prior.maxSeg = Math.max(prior.maxSeg, lengthMeters);
      edgeStats.set(key, prior);
    }
  }
  const internal = new Map();
  for (const [key, stats] of edgeStats.entries()) {
    if (stats.sum < stats.maxSeg * 1.8) {
      continue;
    }
    internal.set(key, stats.sum / 2);
  }
  return { internal };
}

function classifyBoundaryInventory(v17Zones, rev3Zones) {
  const v17 = inventoryInternalEdges(v17Zones);
  const rev3 = inventoryInternalEdges(rev3Zones);
  let sharedLengthMeters = 0;
  let v17OnlyLengthMeters = 0;
  let rev3OnlyLengthMeters = 0;
  const v17OnlySamples = [];
  const rev3OnlySamples = [];

  for (const [key, meters] of v17.internal.entries()) {
    if (rev3.internal.has(key)) {
      sharedLengthMeters += Math.min(meters, rev3.internal.get(key) ?? 0);
    } else {
      v17OnlyLengthMeters += meters;
      if (v17OnlySamples.length < 12) {
        v17OnlySamples.push({ edgeKey: key, lengthMeters: round(meters, 2) });
      }
    }
  }
  for (const [key, meters] of rev3.internal.entries()) {
    if (!v17.internal.has(key)) {
      rev3OnlyLengthMeters += meters;
      if (rev3OnlySamples.length < 12) {
        rev3OnlySamples.push({ edgeKey: key, lengthMeters: round(meters, 2) });
      }
    }
  }
  const totalUnique = sharedLengthMeters + v17OnlyLengthMeters + rev3OnlyLengthMeters || 1;
  return {
    schemaVersion: "territorykit-tr-mahalle-first-boundary-inventory-qa@1",
    method:
      "Length-weighted internal edges counted once when shared by two zones (segment key rounding); independent of smart-fallback quality gate JSON.",
    edgeKeyPrecision: EDGE_KEY_PRECISION,
    sharedInternalBoundaryMeters: round(sharedLengthMeters, 2),
    v17OnlyInternalBoundaryMeters: round(v17OnlyLengthMeters, 2),
    rev3OnlyInternalBoundaryMeters: round(rev3OnlyLengthMeters, 2),
    v17OnlyShareOfUniqueInternal: round(v17OnlyLengthMeters / totalUnique),
    rev3OnlyShareOfUniqueInternal: round(rev3OnlyLengthMeters / totalUnique),
    sharedShareOfUniqueInternal: round(sharedLengthMeters / totalUnique),
    v17OnlySampleEdges: v17OnlySamples,
    rev3OnlySampleEdges: rev3OnlySamples,
    interpretation: {
      v17Only:
        "Barrier-backed v1.7 internal boundaries absent from impl-rev3 (watershed splits / weak-barrier cuts).",
      rev3Only:
        "Additional impl-rev3 internal boundaries not present in v1.7 replay (explains +17 zone cardinality).",
      edgeMatchToleranceMeters: EDGE_MATCH_TOLERANCE_METERS
    }
  };
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 0) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInZone(point, zone) {
  for (const polygon of geometryToPolygons(zone.geometry)) {
    if (pointInRing(point, polygon[0])) {
      return true;
    }
  }
  return false;
}

function buildAlternativeBSemanticAssociation(v17Zones, seeds) {
  const zones = v17Zones.map((zone) => {
    const contained = seeds.filter((seed) => pointInZone(seed.coordinate, zone));
    const names = [...new Set(contained.map((seed) => seed.name.trim()))];
    let namingStatus = "UNSEEDED";
    if (names.length === 1) {
      namingStatus = "SINGLE_SEED_MATCH";
    } else if (names.length > 1) {
      namingStatus = "AMBIGUOUS_REVIEW_REQUIRED";
    }
    return {
      zoneId: zone.id,
      zoneName: zone.name,
      containedSeedCount: contained.length,
      distinctMahalleNames: names,
      namingStatus,
      seeds: contained.map((seed) => ({ name: seed.name, coordinate: seed.coordinate }))
    };
  });
  const ambiguous = zones.filter((row) => row.namingStatus === "AMBIGUOUS_REVIEW_REQUIRED");
  return {
    schemaVersion: "territorykit-tr-mahalle-first-alternative-b-semantic@1",
    design:
      "Alternative B — gameplay geometry unchanged (v1.7 replay); mahalle seeds as semantic association only.",
    zoneCount: zones.length,
    ambiguousZoneCount: ambiguous.length,
    singleSeedZoneCount: zones.filter((row) => row.namingStatus === "SINGLE_SEED_MATCH").length,
    unseededZoneCount: zones.filter((row) => row.namingStatus === "UNSEEDED").length,
    distinctSeedsRepresented: new Set(
      zones.flatMap((row) => row.distinctMahalleNames.map((name) => name.toLocaleLowerCase("tr")))
    ).size,
    zones,
    migrationImpact:
      "No polygon or stable ID change; consumer must not auto-apply mahalle display names when namingStatus is AMBIGUOUS_REVIEW_REQUIRED."
  };
}

function summarizeSeedCoverage(zones, seeds) {
  const normalizedSeedNames = new Set(
    seeds.map((seed) => seed.name.trim().toLocaleLowerCase("tr"))
  );
  let seedNamed = 0;
  const uniqueSeedNames = new Set();
  for (const zone of zones) {
    const meta = territoryMeta(zone);
    if (meta.nameSource === "locality-seed" || meta.seedName) {
      seedNamed += 1;
      if (meta.seedName) {
        uniqueSeedNames.add(meta.seedName.trim().toLocaleLowerCase("tr"));
      }
    }
  }
  return {
    adm3ZoneCount: zones.length,
    validMahalleSeedCount: seeds.length,
    seedNamedZoneCount: seedNamed,
    seedNamedShare: zones.length ? round(seedNamed / zones.length) : 0,
    seedNameMatchCount: uniqueSeedNames.size,
    seedCoverageRatio: seeds.length ? round(uniqueSeedNames.size / seeds.length) : 0
  };
}

function summarizeQuality(quality, pathology) {
  return {
    meanBarrierAlignment: round(quality.meanBarrierAlignment ?? 0),
    meanZoneBarrierAlignment: round(quality.meanZoneBarrierAlignment ?? 0),
    weightedInternalBarrierAlignment: round(quality.weightedInternalBarrierAlignment ?? 0),
    geographicRealism: quality.gates?.geographicRealism ?? null,
    pathologyFindingCount: pathology.findings?.length ?? 0,
    seedCoverageDetail: quality.seedCoverageDetail ?? null,
    v17AnchoredWatershedMerge:
      quality.networkConstruction?.v17AnchoredWatershedMerge ??
      quality.networkDiagnostics?.v17AnchoredWatershedMerge ??
      null
  };
}

async function runBuild(label, builder, smartInput) {
  const started = performance.now();
  const result = await builder(smartInput);
  const durationMs = Math.round(performance.now() - started);
  const dataset = createTurkeySmartFallbackDataset({
    parent: smartInput.parent,
    zones: result.zones,
    datasetId: `tr-adm3-smart-fallback-${label}`,
    sourceDate: result.configuration.algorithmVersion
  });
  const validation = validateTurkeyV2Dataset(dataset);
  return { result, dataset, validation, durationMs };
}

function deriveHybridDecision(rev4Build, v17Replay, rev3Metrics) {
  const geographicRealism = rev4Build.result.quality.gates?.geographicRealism === true;
  if (!rev4Build.validation.ok || !rev4Build.result.quality.ok) {
    return {
      status: "FAIL",
      reason: "impl-rev4 hybrid failed validation or quality gates.",
      nationalExpansion: "NO-GO"
    };
  }
  if (!geographicRealism) {
    return {
      status: "FAIL",
      reason: "impl-rev4 geographic realism gate failed.",
      nationalExpansion: "NO-GO"
    };
  }
  const weighted = rev4Build.result.quality.weightedInternalBarrierAlignment ?? 0;
  const seedCoverage = summarizeSeedCoverage(
    rev4Build.result.zones,
    rev4Build.seeds
  ).seedCoverageRatio;
  const weightedOk = weighted + 1e-4 >= V17_WEIGHTED_ALIGNMENT_TARGET;
  const seedOk = seedCoverage + 1e-4 >= REV3_SEED_COVERAGE_FLOOR;
  if (weightedOk && seedOk) {
    return {
      status: "PASS_WITH_REVIEW",
      reason: "impl-rev4 met Fatih hybrid gates (barrier + seed coverage).",
      nationalExpansion: "NO-GO (single-district proof only)"
    };
  }
  return {
    status: "NO-GO",
    reason: `Hybrid Pareto miss: weighted barrier ${round(weighted)} (target ${V17_WEIGHTED_ALIGNMENT_TARGET}), seed coverage ${round(seedCoverage)} (floor ${REV3_SEED_COVERAGE_FLOOR}).`,
    paretoTradeOff: true,
    nationalExpansion: "NO-GO",
    missingEvidence: weightedOk
      ? "Seed coverage regression vs impl-rev3 — stronger in-zone splits or semantic Alternative B may be required."
      : "Barrier alignment still below v1.7 replay — v17 anchor merge insufficient; need official mahalle geometry or accept Alternative B."
  };
}

async function main() {
  const baselineShard = join(
    BASELINE_ROOT,
    "districts",
    `tr_adm2_${FATIH_ADM2_SUFFIX}`,
    "dataset.json"
  );
  const baselineDataset = await readJson(baselineShard);
  const parent = baselineDataset.zones.find(
    (zone) => zone.level === 2 && zone.id === PARENT_ADM2_ID
  );
  if (!parent) {
    throw new Error(`ADM2 parent not found: ${PARENT_ADM2_ID}`);
  }

  const artifact = await readTurkeyOsmAdm2BarrierArtifact(
    join(REPO_ROOT, BARRIER_ROOT),
    PARENT_ADM2_ID
  );
  const smartInput = {
    parent,
    provinceCode: "34",
    districtCode: FATIH_ADM2_SUFFIX,
    profile: "dense-urban",
    roads: artifact.roads,
    railways: artifact.railways,
    water: artifact.water,
    landuse: artifact.landuse,
    parks: artifact.parks,
    localitySeeds: artifact.localitySeeds,
    options: {
      sourceMetadata: {
        providerId: artifact.manifest.source.providerId,
        providerName: artifact.manifest.source.providerName,
        sourceDatasetId: artifact.manifest.source.sourceDatasetId,
        sourceId: artifact.manifest.adm2Id,
        sourceDate: artifact.manifest.source.snapshotDate,
        sourceVersion: artifact.manifest.source.algorithmVersion,
        sourceUrl: artifact.manifest.source.sourceUrl,
        sourceSnapshotId: artifact.manifest.source.snapshotSha256.slice(0, 16),
        sourceSnapshotChecksum: artifact.manifest.source.snapshotSha256,
        barrierArtifactChecksum: artifact.manifest.artifactChecksum,
        license: artifact.manifest.source.license,
        attribution: artifact.manifest.source.attribution
      }
    }
  };

  const v17Replay = await runBuild(
    "v17-replay",
    buildTurkeyNetworkFirstSmartFallbackWithAdjacency,
    smartInput
  );

  const rev3Dataset = await readJson(join(REV3_OUTPUT, "dataset.json"));
  const rev3Zones = rev3Dataset.zones.filter((zone) => zone.level === 3);

  const rev4Build = await runBuild(
    "impl-rev4-hybrid",
    buildTurkeySmartFallbackV2PilotRev4HybridWithAdjacency,
    smartInput
  );
  rev4Build.seeds = artifact.localitySeeds;
  const rev4Repeat = await runBuild(
    "impl-rev4-hybrid-repeat",
    buildTurkeySmartFallbackV2PilotRev4HybridWithAdjacency,
    smartInput
  );

  const rev3Comparison = await readJson(join(REPORT_ROOT, "fatih-v2-impl-rev3-comparison.json"));

  const boundaryInventoryQa = classifyBoundaryInventory(v17Replay.result.zones, rev3Zones);
  const alternativeB = buildAlternativeBSemanticAssociation(
    v17Replay.result.zones,
    artifact.localitySeeds
  );

  const boundaryAlignment = {
    v17Replay: {
      totalInternalBoundaryLengthKm: v17Replay.result.quality.totalInternalBoundaryLengthKm ?? null,
      realBarrierRatio: v17Replay.result.quality.realBarrierRatio ?? null
    },
    implRev3: {
      totalInternalBoundaryLengthKm:
        rev3Comparison.v2Pilot.quality?.totalInternalBoundaryLengthKm ?? null,
      realBarrierRatio: rev3Comparison.v2Pilot.quality?.realBarrierRatio ?? null,
      weightedInternalBarrierAlignment:
        rev3Comparison.v2Pilot.quality.weightedInternalBarrierAlignment
    },
    implRev4Hybrid: {
      totalInternalBoundaryLengthKm: rev4Build.result.quality.totalInternalBoundaryLengthKm ?? null,
      realBarrierRatio: rev4Build.result.quality.realBarrierRatio ?? null
    }
  };

  const pathologyV17 = inspectTurkeyGeneratedZonePathology({ zones: v17Replay.result.zones });
  const pathologyRev3 = inspectTurkeyGeneratedZonePathology({ zones: rev3Zones });
  const pathologyRev4 = inspectTurkeyGeneratedZonePathology({ zones: rev4Build.result.zones });

  const comparison = {
    schemaVersion: "territorykit-tr-mahalle-first-fatih-sprint-2b4-comparison@1",
    generatedAt: new Date().toISOString(),
    district: "Fatih",
    parentAdm2Id: PARENT_ADM2_ID,
    implRev3Historical: {
      implementationRevision: "impl-rev3",
      adm3ZoneCount: rev3Comparison.v2Pilot.adm3ZoneCount,
      weightedInternalBarrierAlignment:
        rev3Comparison.v2Pilot.quality.weightedInternalBarrierAlignment,
      seedCoverageRatio: rev3Comparison.v2Pilot.seedCoverageRatio,
      pathologyFindingCount: rev3Comparison.v2Pilot.pathologyFindingCount
    },
    v17Replay: {
      ...summarizeSeedCoverage(v17Replay.result.zones, artifact.localitySeeds),
      ...summarizeQuality(v17Replay.result.quality, pathologyV17),
      deterministicHash: v17Replay.result.deterministicHash,
      validationOk: v17Replay.validation.ok
    },
    implRev4Hybrid: {
      implementationRevision: TURKEY_SMART_FALLBACK_V2_PILOT_IMPLEMENTATION_REVISION_REV4,
      ...summarizeSeedCoverage(rev4Build.result.zones, artifact.localitySeeds),
      ...summarizeQuality(rev4Build.result.quality, pathologyRev4),
      deterministicHash: rev4Build.result.deterministicHash,
      determinismVerified:
        rev4Repeat.result.deterministicHash === rev4Build.result.deterministicHash,
      validationOk: rev4Build.validation.ok,
      qualityOk: rev4Build.result.quality.ok,
      buildDurationMs: rev4Build.durationMs
    },
    qualityGates: {
      weightedBarrierTarget: V17_WEIGHTED_ALIGNMENT_TARGET,
      seedCoverageFloor: REV3_SEED_COVERAGE_FLOOR,
      weightedMet:
        (rev4Build.result.quality.weightedInternalBarrierAlignment ?? 0) + 1e-4 >=
        V17_WEIGHTED_ALIGNMENT_TARGET,
      seedCoverageMet:
        summarizeSeedCoverage(rev4Build.result.zones, artifact.localitySeeds).seedCoverageRatio +
          1e-4 >=
        REV3_SEED_COVERAGE_FLOOR
    },
    boundaryInventoryQa,
    boundaryAlignmentIndependent: {
      totalInternalBoundaryKm: {
        v17Replay: boundaryAlignment.v17Replay.totalInternalBoundaryLengthKm,
        implRev3: boundaryAlignment.implRev3.totalInternalBoundaryLengthKm,
        implRev4Hybrid: boundaryAlignment.implRev4Hybrid.totalInternalBoundaryLengthKm
      },
      realBarrierRatio: {
        v17Replay: boundaryAlignment.v17Replay.realBarrierRatio,
        implRev3: boundaryAlignment.implRev3.realBarrierRatio,
        implRev4Hybrid: boundaryAlignment.implRev4Hybrid.realBarrierRatio
      }
    },
    pathologyRootCauses: {
      implRev3: rev3Comparison.rootCauseSummary,
      implRev4: {
        pathologyByKind: pathologyRev4.findings?.reduce((acc, finding) => {
          const key = finding.kind ?? finding.code ?? "unknown";
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
        note: "SPIKE findings often follow dense watershed face corners; compare counts vs rev3 before treating as new regression."
      }
    },
    alternativeBPreview: {
      ambiguousZoneCount: alternativeB.ambiguousZoneCount,
      distinctSeedsRepresented: alternativeB.distinctSeedsRepresented,
      gameplayPolygonChange: false
    },
    decision: deriveHybridDecision(rev4Build, v17Replay, rev3Comparison.v2Pilot)
  };

  const architectureMarkdown = buildArchitectureMarkdown({
    boundaryInventoryQa,
    boundaryAlignment,
    alternativeB,
    rev3Comparison,
    comparison
  });

  const decisionMarkdown = buildDecisionMarkdown(comparison);

  const zonesToFeatureCollection = (zones, label) => ({
    type: "FeatureCollection",
    features: zones.map((zone) => ({
      type: "Feature",
      properties: { id: zone.id, name: zone.name, label },
      geometry: zone.geometry
    }))
  });

  const visualComparisonHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Fatih v1.7 vs rev3 vs rev4 hybrid</title>
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>html,body,#map{margin:0;height:100%;} .legend{position:absolute;top:8px;left:8px;background:#fff;padding:8px;font:12px sans-serif;z-index:1;}</style></head>
<body><div class="legend">
<label><input type="checkbox" id="toggle-v17" checked/> v1.7 replay</label><br/>
<label><input type="checkbox" id="toggle-rev3"/> impl-rev3 ref</label><br/>
<label><input type="checkbox" id="toggle-rev4" checked/> impl-rev4 hybrid</label>
</div><div id="map"></div>
<script>
const map = new maplibregl.Map({container:'map',style:'https://demotiles.maplibre.org/style.json',center:[${parent.center[0]},${parent.center[1]}],zoom:12});
map.on('load', async () => {
  for (const [id,url,color] of [['v17','v17-replay.geojson','#4c78a8'],['rev3','impl-rev3-reference.geojson','#72b7b2'],['rev4','impl-rev4-hybrid.geojson','#e4572e']]) {
    const data = await fetch(url).then(r=>r.json());
    map.addSource(id,{type:'geojson',data});
    map.addLayer({id:id+'-fill',type:'fill',source:id,paint:{'fill-color':color,'fill-opacity':0.22}});
    map.addLayer({id:id+'-line',type:'line',source:id,paint:{'line-color':color,'line-width':1.4}});
  }
});
</script></body></html>`;

  const writes = [
    [join(OUTPUT_ROOT, "dataset.json"), rev4Build.dataset],
    [join(OUTPUT_ROOT, "before-after-metrics.json"), comparison],
    [
      join(OUTPUT_ROOT, "v17-replay.geojson"),
      zonesToFeatureCollection(v17Replay.result.zones, "v17")
    ],
    [
      join(OUTPUT_ROOT, "impl-rev3-reference.geojson"),
      zonesToFeatureCollection(rev3Zones, "rev3-ref")
    ],
    [
      join(OUTPUT_ROOT, "impl-rev4-hybrid.geojson"),
      zonesToFeatureCollection(rev4Build.result.zones, "rev4")
    ],
    [join(REPORT_ROOT, "fatih-v17-rev3-boundary-qa.json"), boundaryInventoryQa],
    [join(REPORT_ROOT, "fatih-v2-impl-rev4-comparison.json"), comparison],
    [join(REPORT_ROOT, "fatih-alternative-b-semantic-association.json"), alternativeB],
    [
      join(REPORT_ROOT, "sprint-2b4-architecture-decision.md"),
      { kind: "markdown", body: architectureMarkdown }
    ],
    [join(REPORT_ROOT, "sprint-2b4-decision.md"), { kind: "markdown", body: decisionMarkdown }]
  ];

  for (const [relativePath, payload] of writes) {
    const absolute = join(REPO_ROOT, relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    if (payload?.kind === "markdown") {
      await writeReportMarkdown(absolute, payload.body);
    } else {
      await writeReportJson(absolute, payload);
    }
  }
  await writeFile(
    join(REPO_ROOT, OUTPUT_ROOT, "visual-comparison.html"),
    visualComparisonHtml,
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputRoot: OUTPUT_ROOT,
        decision: comparison.decision.status,
        implRev4Weighted: comparison.implRev4Hybrid.weightedInternalBarrierAlignment,
        implRev4SeedCoverage: comparison.implRev4Hybrid.seedCoverageRatio,
        implRev4Zones: comparison.implRev4Hybrid.adm3ZoneCount
      },
      null,
      2
    )
  );
}

function buildArchitectureMarkdown(input) {
  const { boundaryInventoryQa, boundaryAlignment, alternativeB, rev3Comparison, comparison } =
    input;
  return `# Sprint 2B.4 — Hybrid mahalle partitioning architecture

## Context

Sprint 2B.3 closed **INCONCLUSIVE**: impl-rev3 improved seed coverage (0.5352) but weighted barrier alignment remained **0.7521** vs v1.7 replay **0.8907**, with **+17** ADM3 zones vs v1.7. Further watershed threshold tuning is out of scope.

## Alternative A — Barrier-preserved hybrid (impl-rev4)

**Idea:** Keep v1.7 area-target merge groups as anchors; run seed watershed inside each group; **collapse** inter-seed splits that are separated only by **weak** barriers (<0.75 strength); retain splits when a **strong** road/rail/water barrier separates seeds.

**Implementation:** \`mergeV17AnchoredWatershedFaceGroups\` + \`buildTurkeyNetworkFaceV17MergeLeader\` in \`turkey-seed-watershed.ts\`; opt-in via \`impl-rev4\` / \`buildTurkeySmartFallbackV2PilotRev4HybridWithAdjacency\`.

| Dimension | Assessment |
| --- | --- |
| Technical cost | Medium — localized to network face merge stage; rev1–rev3 preserved |
| Source compatibility | Same pinned OSM + seeds as 2B.3 |
| Geometry quality | Targets fewer unsupported internal edges than rev3 (see boundary inventory) |
| Migration | New stable IDs if zone count changes; rc.8/v1.7 IDs still not retained without approved map |

**Fatih measurement (this run):** weighted=${comparison.implRev4Hybrid.weightedInternalBarrierAlignment}, seedCoverage=${comparison.implRev4Hybrid.seedCoverageRatio}, zones=${comparison.implRev4Hybrid.adm3ZoneCount}.

## Alternative B — Gameplay zone vs settlement identity

**Idea:** Keep **v1.7 replay polygons and stable IDs**; attach 0..N mahalle seeds per zone as semantic metadata; **do not** auto-name when \`AMBIGUOUS_REVIEW_REQUIRED\`.

**Fatih preview:** ${alternativeB.ambiguousZoneCount} ambiguous zones, ${alternativeB.distinctSeedsRepresented} distinct seed names represented geometrically inside v1.7 zones (no new polygons).

| Dimension | Assessment |
| --- | --- |
| Technical cost | Low — schema/reporting + consumer contract |
| Source compatibility | Full — no fabricated boundaries |
| Geometry quality | Identical to v1.7 replay (barrier alignment preserved) |
| Migration | Minimal if gameplay IDs unchanged; semantic layer versioned separately |

## Independent boundary QA (v1.7 replay vs impl-rev3 reference)

| Metric | Value |
| --- | ---: |
| Shared internal boundary (m) | ${boundaryInventoryQa.sharedInternalBoundaryMeters} |
| v1.7-only internal boundary (m) | ${boundaryInventoryQa.v17OnlyInternalBoundaryMeters} |
| rev3-only internal boundary (m) | ${boundaryInventoryQa.rev3OnlyInternalBoundaryMeters} |
| rev3-only share of unique internal | ${boundaryInventoryQa.rev3OnlyShareOfUniqueInternal} |

\`inspectTurkeySmartBoundaryAlignment\` realBarrierRatio: v1.7=${boundaryAlignment.v17Replay.realBarrierRatio}, rev3=${boundaryAlignment.implRev3.realBarrierRatio}, rev4=${boundaryAlignment.implRev4Hybrid.realBarrierRatio}.

## Pathology / seed semantics (from 2B.3 root cause, verified on pinned inputs)

- **+17 zones:** rev3-only internal boundary length (${boundaryInventoryQa.rev3OnlyInternalBoundaryMeters} m unique-weighted) vs v1.7-only lost (${boundaryInventoryQa.v17OnlyInternalBoundaryMeters} m).
- **47 represented vs 38 seed-named:** watershed represents more seed labels than receive \`locality-seed\` polygon names (multi-face components + naming cap).
- **25 SPIKE findings (rev3):** ${JSON.stringify(rev3Comparison.rootCauseSummary?.pathologyDistribution ?? {})}

## Recommendation

- If Alternative A Fatih gates fail → **technical NO-GO** for national hybrid watershed; pursue **Alternative B** for mahalle semantics without geometry churn, or acquire licensed official mahalle polygons.
- Do not relax quality gates to force GO.

## Locks

- Parent ADM2: \`${comparison.parentAdm2Id}\`
- rev3 reference output: \`${REV3_OUTPUT}\` (read-only)
- Hybrid output: \`${OUTPUT_ROOT}\`
`;
}

function buildDecisionMarkdown(comparison) {
  return `# Sprint 2B.4 — Fatih hybrid (impl-rev4)

## Decision

- **Status:** ${comparison.decision.status}
- **Reason:** ${comparison.decision.reason}
- **National expansion:** ${comparison.decision.nationalExpansion ?? "NO-GO"}

## Quality gates

| Gate | Target | impl-rev4 |
| --- | --- | --- |
| Weighted barrier alignment | ≥ ${comparison.qualityGates.weightedBarrierTarget} | ${comparison.implRev4Hybrid.weightedInternalBarrierAlignment} (${comparison.qualityGates.weightedMet ? "met" : "miss"}) |
| Seed coverage | ≥ ${comparison.qualityGates.seedCoverageFloor} | ${comparison.implRev4Hybrid.seedCoverageRatio} (${comparison.qualityGates.seedCoverageMet ? "met" : "miss"}) |
| Determinism | PASS | ${comparison.implRev4Hybrid.determinismVerified ? "PASS" : "FAIL"} |
| Validation | PASS | ${comparison.implRev4Hybrid.validationOk ? "PASS" : "FAIL"} |

## Metrics snapshot

| Metric | v1.7 replay | impl-rev3 (historical) | impl-rev4 hybrid |
| --- | ---: | ---: | ---: |
| ADM3 zones | ${comparison.v17Replay.adm3ZoneCount} | ${comparison.implRev3Historical.adm3ZoneCount} | ${comparison.implRev4Hybrid.adm3ZoneCount} |
| Weighted barrier alignment | ${comparison.v17Replay.weightedInternalBarrierAlignment} | ${comparison.implRev3Historical.weightedInternalBarrierAlignment} | ${comparison.implRev4Hybrid.weightedInternalBarrierAlignment} |
| Seed coverage ratio | ${comparison.v17Replay.seedCoverageRatio} | ${comparison.implRev3Historical.seedCoverageRatio} | ${comparison.implRev4Hybrid.seedCoverageRatio} |
| Pathology findings | ${comparison.v17Replay.pathologyFindingCount} | ${comparison.implRev3Historical.pathologyFindingCount} | ${comparison.implRev4Hybrid.pathologyFindingCount} |

## Commands

\`\`\`sh
pnpm data:tr:mahalle-first:fatih-hybrid-pilot
pnpm --filter @territory-kit/generators test turkey-smart-derived-v2-pilot turkey-seed-watershed
\`\`\`
`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
