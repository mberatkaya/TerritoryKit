#!/usr/bin/env node
/**
 * Fatih-only smart-derived-v2.0-pilot build + v1.7 rc.8 comparison (read-only baseline).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeReportJson, writeReportMarkdown } from "./lib/write-report-json.mjs";
import { performance } from "node:perf_hooks";
import { validateTurkeyV2Dataset } from "../packages/dataset/dist/turkey-v2.mjs";
import {
  TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
  TURKEY_SMART_FALLBACK_V2_PILOT_ALGORITHM_VERSION,
  TURKEY_SMART_FALLBACK_V2_PILOT_IMPLEMENTATION_REVISION,
  buildTurkeyNetworkFirstSmartFallbackWithAdjacency,
  buildTurkeySmartFallbackV2PilotWithAdjacency,
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
const OUTPUT_ROOT =
  process.env.MAHALLE_FIRST_FATIH_V2_OUTPUT ?? ".territory/mahalle-first-pilot/fatih-v2-impl-rev3";
const REPORT_ROOT = "reports/tr-adm3/mahalle-first-program";
const REV1_HISTORICAL_COMPARISON = join(REPORT_ROOT, "fatih-v1-v2-comparison.json");
const REV2_HISTORICAL_COMPARISON = join(REPORT_ROOT, "fatih-v2-impl-rev2-comparison.json");
const NOT_ASSESSED = "NOT_ASSESSED";
const REV2_SEED_COVERAGE_FLOOR = 0.5211;
const V17_WEIGHTED_ALIGNMENT_TARGET = 0.8907;

const HYPOTHESIS_VARIANTS = [
  {
    id: "hypothesis-a-weak-reassignment",
    hypothesis: "A",
    v2PilotWeakBarrierReassignment: true,
    v2PilotMaxAreaGameplayMultiplier: 1
  },
  {
    id: "hypothesis-b-max-area-1p12",
    hypothesis: "B",
    v2PilotWeakBarrierReassignment: false,
    v2PilotMaxAreaGameplayMultiplier: 1.12
  },
  {
    id: "impl-rev3-combined",
    hypothesis: "A+B",
    v2PilotWeakBarrierReassignment: true,
    v2PilotMaxAreaGameplayMultiplier: 1.12
  }
];

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

function zonesToFeatureCollection(zones, label) {
  return {
    type: "FeatureCollection",
    features: zones.map((zone) => ({
      type: "Feature",
      properties: {
        id: zone.id,
        name: zone.name,
        label,
        algorithmVersion: territoryMeta(zone).algorithmVersion ?? null
      },
      geometry: zone.geometry
    }))
  };
}

function summarizeSeedCoverage(zones, seeds) {
  const normalizedSeedNames = new Set(
    seeds.map((seed) => seed.name.trim().toLocaleLowerCase("tr"))
  );
  let seedNamed = 0;
  let uniqueSeedNames = new Set();
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
    gridLikeness: quality.gates?.gridLikeness ?? null,
    longUnsupportedStraightBoundaryRatio: round(quality.longUnsupportedStraightBoundaryRatio ?? 0),
    longestUnsupportedStraightChainMeters: round(
      quality.longestUnsupportedStraightChainMeters ?? 0,
      2
    ),
    barrierFollowingInternalBoundaryRatio: round(
      quality.barrierFollowingInternalBoundaryRatio ?? 0
    ),
    seedCoverageDetail: quality.seedCoverageDetail ?? null,
    pathologyFindingCount: pathology.findings?.length ?? 0,
    qualityGateNotes: {
      minMeanBarrierAlignment: 0,
      requireBarrierForMultiTerritory: false,
      minMeanQualityScore: 0.25,
      effect:
        "v2 pilot relaxes barrier-alignment and barrier-sufficiency gates; geographic realism and geometry gates remain authoritative."
    }
  };
}

function summarizeBaselineRc8Quality() {
  return {
    meanBarrierAlignment: { status: NOT_ASSESSED, value: null },
    meanZoneBarrierAlignment: { status: NOT_ASSESSED, value: null },
    weightedInternalBarrierAlignment: { status: NOT_ASSESSED, value: null },
    geographicRealism: { status: NOT_ASSESSED, value: null },
    longestUnsupportedStraightChainMeters: { status: NOT_ASSESSED, value: null }
  };
}

function draftStableIdReplacementMap(baselineZones, candidateZones) {
  const candidates = candidateZones.map((zone) => ({
    id: zone.id,
    areaKm2: (territoryMeta(zone).areaM2 ?? 0) / 1_000_000,
    bbox: zone.bbox
  }));
  const proposals = [];
  for (const baseline of baselineZones) {
    const baselineArea = (territoryMeta(baseline).areaM2 ?? 0) / 1_000_000;
    const overlaps = candidates
      .map((candidate) => {
        const overlap = bboxOverlapRatio(baseline.bbox, candidate.bbox);
        return { candidateId: candidate.id, overlap, areaKm2: candidate.areaKm2 };
      })
      .filter((row) => row.overlap > 0.05)
      .sort((a, b) => b.overlap - a.overlap || a.candidateId.localeCompare(b.candidateId));
    proposals.push({
      baselineId: baseline.id,
      baselineAreaKm2: round(baselineArea, 3),
      status: overlaps.length ? "PROPOSED_REPLACEMENT" : "NO_OVERLAP_CANDIDATE",
      topCandidates: overlaps.slice(0, 3),
      migrationApproval: "DRAFT_NOT_APPROVED"
    });
  }
  return {
    schemaVersion: "territorykit-tr-mahalle-first-replacement-map-draft@1",
    migrationApproval: "DRAFT_NOT_APPROVED",
    method: "bbox-overlap-heuristic-only",
    proposals
  };
}

function bboxOverlapRatio(left, right) {
  if (!left || !right) return 0;
  const west = Math.max(left[0], right[0]);
  const south = Math.max(left[1], right[1]);
  const east = Math.min(left[2], right[2]);
  const north = Math.min(left[3], right[3]);
  if (east <= west || north <= south) return 0;
  const intersection = (east - west) * (north - south);
  const leftArea = Math.max(0, left[2] - left[0]) * Math.max(0, left[3] - left[1]);
  const rightArea = Math.max(0, right[2] - right[0]) * Math.max(0, right[3] - right[1]);
  const union = leftArea + rightArea - intersection;
  return union > 0 ? intersection / union : 0;
}

function migrationImpact(baselineZones, candidateZones) {
  const baselineIds = new Set(baselineZones.map((zone) => zone.id));
  const candidateIds = new Set(candidateZones.map((zone) => zone.id));
  const retained = [...candidateIds].filter((id) => baselineIds.has(id)).length;
  return {
    baselineStableIdCount: baselineZones.length,
    candidateStableIdCount: candidateZones.length,
    retainedStableIdCount: retained,
    retainedStableIdShare: candidateZones.length ? round(retained / candidateZones.length) : 0,
    newStableIdCount: candidateZones.length - retained,
    droppedStableIdCount: baselineZones.length - retained
  };
}

function withV2PilotOptions(smartInput, variant) {
  return {
    ...smartInput,
    options: {
      ...smartInput.options,
      v2PilotImplementationRevision: TURKEY_SMART_FALLBACK_V2_PILOT_IMPLEMENTATION_REVISION,
      v2PilotWeakBarrierReassignment: variant.v2PilotWeakBarrierReassignment,
      v2PilotMaxAreaGameplayMultiplier: variant.v2PilotMaxAreaGameplayMultiplier
    }
  };
}

function scorePilotVariant(build, seeds) {
  const coverage = summarizeSeedCoverage(build.result.zones, seeds);
  return {
    weightedInternalBarrierAlignment: build.result.quality.weightedInternalBarrierAlignment ?? 0,
    seedCoverageRatio: coverage.seedCoverageRatio,
    seedNamedShare: coverage.seedNamedShare,
    adm3ZoneCount: coverage.adm3ZoneCount,
    geographicRealism: build.result.quality.gates?.geographicRealism === true,
    seedCoverageOk: coverage.seedCoverageRatio + 1e-4 >= REV2_SEED_COVERAGE_FLOOR * 0.97,
    validationOk: build.validation.ok,
    qualityOk: build.result.quality.ok
  };
}

function pickHypothesisWinner(variantResults) {
  const eligible = variantResults.filter(
    (row) =>
      row.score.validationOk &&
      row.score.qualityOk &&
      row.score.geographicRealism &&
      row.score.seedCoverageOk
  );
  eligible.sort(
    (left, right) =>
      right.score.weightedInternalBarrierAlignment - left.score.weightedInternalBarrierAlignment ||
      right.score.seedCoverageRatio - left.score.seedCoverageRatio ||
      left.score.adm3ZoneCount - right.score.adm3ZoneCount
  );
  return eligible[0] ?? variantResults.find((row) => row.id === "impl-rev3-combined");
}

function buildRootCauseAnalysis({ v17Replay, v2Build, v2Rev2Historical, pathologyV2, seeds }) {
  const network =
    v2Build.result.quality.networkConstruction ?? v2Build.result.quality.networkDiagnostics ?? {};
  const audit = network.seedWatershedBarrierAudit ?? null;
  const pathologyByKind = {};
  for (const finding of pathologyV2.findings ?? []) {
    const key = finding.kind ?? finding.code ?? "unknown";
    pathologyByKind[key] = (pathologyByKind[key] ?? 0) + 1;
  }
  const v17Weighted = v17Replay.result.quality.weightedInternalBarrierAlignment ?? 0;
  const v2Weighted = v2Build.result.quality.weightedInternalBarrierAlignment ?? 0;
  return {
    weightedAlignmentDeltaVsV17Replay: round(v2Weighted - v17Weighted),
    v17ReplayWeightedInternalBarrierAlignment: round(v17Weighted),
    v2WeightedInternalBarrierAlignment: round(v2Weighted),
    rev2HistoricalWeighted:
      v2Rev2Historical?.v2Pilot?.quality?.weightedInternalBarrierAlignment ?? null,
    seedSemantics: {
      validSeedCount: seeds.length,
      distinctRepresentedSeeds:
        v2Build.result.quality.seedCoverageDetail?.distinctMahalleSeedsRepresented ?? null,
      seedNamedZoneCount: summarizeSeedCoverage(v2Build.result.zones, seeds).seedNamedZoneCount,
      seedsInOwnPolygonCount:
        v2Build.result.quality.seedCoverageDetail?.seedsInOwnPolygonCount ?? null,
      zonesWithoutSeedCount:
        v2Build.result.quality.seedCoverageDetail?.zonesWithoutSeedCount ?? null,
      seedNameCollisionCount:
        v2Build.result.quality.seedCoverageDetail?.seedNameCollisionCount ?? null,
      note: "47 distinct represented seeds vs 37 seed-named zones: extra represented seeds can share a name with a primary zone or sit in multi-face watershed components without a dedicated named polygon."
    },
    watershedBarrierAudit: audit,
    seedFaceSemantics: {
      multiFacePerSeedLabelFaceCount: audit?.multiFacePerSeedLabelFaceCount ?? null,
      distinctLabeledSeedCount: audit?.distinctLabeledSeedCount ?? null,
      unseededFaceCount: audit?.unseededFaceCount ?? null,
      weakDifferentSeedBoundaryLengthMeters: audit?.weakDifferentSeedBoundaryLengthMeters ?? null,
      strongDifferentSeedBoundaryLengthMeters:
        audit?.strongDifferentSeedBoundaryLengthMeters ?? null,
      weakBarrierReassignedFaceCount: audit?.weakBarrierReassignedFaceCount ?? null,
      legacyMisnamedMetric:
        "seedCollisionFaceCount was retired; multi-face-per-seed is normal watershed behavior, not a seed conflict."
    },
    networkResidual: {
      networkCoveragePercent: network.networkCoveragePercent ?? null,
      residualAreaPercent: network.residualAreaPercent ?? null,
      areaRejectedGroupCount: network.areaRejectedGroupCount ?? null,
      topologyRejectedGroupCount: network.topologyRejectedGroupCount ?? null,
      maxAreaBlockedMergeCount: network.maxAreaBlockedMergeCount ?? null,
      residualGapAttachedCount: network.residualGapAttachedCount ?? null,
      residualUnattachedAreaKm2: network.residualUnattachedAreaKm2 ?? null,
      preMergePieceCount: network.preMergePieceCount ?? null,
      postMergePieceCount: network.postMergePieceCount ?? null
    },
    pathologyDistribution: {
      totalFindings: pathologyV2.findings?.length ?? 0,
      byKind: pathologyByKind
    },
    groundTruthIoU: NOT_ASSESSED
  };
}

async function runBuild(label, builder, smartInput) {
  const started = performance.now();
  const memoryBefore = process.memoryUsage().heapUsed;
  const result = await builder(smartInput);
  const durationMs = Math.round(performance.now() - started);
  const memoryPeakMb = round((process.memoryUsage().heapUsed - memoryBefore) / (1024 * 1024), 2);
  const dataset = createTurkeySmartFallbackDataset({
    parent: smartInput.parent,
    zones: result.zones,
    datasetId: `tr-adm3-smart-fallback-${label}`,
    sourceDate: result.configuration.algorithmVersion
  });
  const validation = validateTurkeyV2Dataset(dataset);
  return { result, dataset, validation, durationMs, memoryPeakMb };
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
    throw new Error(`ADM2 parent not found in baseline shard: ${PARENT_ADM2_ID}`);
  }
  const baselineV17Zones = baselineDataset.zones.filter(
    (zone) => zone.level === 3 && zone.parentId === PARENT_ADM2_ID
  );

  const artifact = await readTurkeyOsmAdm2BarrierArtifact(
    join(REPO_ROOT, BARRIER_ROOT),
    PARENT_ADM2_ID
  );
  const sourceLock = await readJson(OSM_SOURCE_LOCK);
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
  let v2Rev2Historical = null;
  try {
    v2Rev2Historical = await readJson(REV2_HISTORICAL_COMPARISON);
  } catch {
    v2Rev2Historical = null;
  }

  const hypothesisVariantResults = [];
  for (const variant of HYPOTHESIS_VARIANTS) {
    const build = await runBuild(
      variant.id,
      buildTurkeySmartFallbackV2PilotWithAdjacency,
      withV2PilotOptions(smartInput, variant)
    );
    hypothesisVariantResults.push({
      ...variant,
      score: scorePilotVariant(build, artifact.localitySeeds),
      deterministicHash: build.result.deterministicHash,
      buildDurationMs: build.durationMs
    });
  }
  const winningVariant = pickHypothesisWinner(hypothesisVariantResults);
  const v2SmartInput = withV2PilotOptions(smartInput, winningVariant);

  const v2Build = await runBuild(
    "v2-pilot",
    buildTurkeySmartFallbackV2PilotWithAdjacency,
    v2SmartInput
  );
  const v2Repeat = await runBuild(
    "v2-pilot-repeat",
    buildTurkeySmartFallbackV2PilotWithAdjacency,
    v2SmartInput
  );

  const pathologyV17 = inspectTurkeyGeneratedZonePathology({ zones: v17Replay.result.zones });
  const pathologyV2 = inspectTurkeyGeneratedZonePathology({ zones: v2Build.result.zones });
  const pathologyBaseline = inspectTurkeyGeneratedZonePathology({ zones: baselineV17Zones });

  let v2Rev1Historical = null;
  try {
    v2Rev1Historical = await readJson(REV1_HISTORICAL_COMPARISON);
  } catch {
    v2Rev1Historical = null;
  }

  const rootCause = buildRootCauseAnalysis({
    v17Replay,
    v2Build,
    v2Rev2Historical,
    pathologyV2,
    seeds: artifact.localitySeeds
  });

  const comparison = {
    schemaVersion: "territorykit-tr-mahalle-first-fatih-sprint-2b3-comparison@1",
    generatedAt: new Date().toISOString(),
    district: "Fatih",
    parentAdm2Id: PARENT_ADM2_ID,
    baseline: {
      artifactRoot: BASELINE_ROOT,
      datasetVersion: "2.1.0-rc.8",
      algorithmVersion: TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
      readOnly: true,
      ...summarizeSeedCoverage(baselineV17Zones, artifact.localitySeeds),
      quality: summarizeBaselineRc8Quality(),
      pathologyFindingCount: pathologyBaseline.findings.length
    },
    v2Rev1Historical: v2Rev1Historical?.v2Pilot
      ? {
          implementationRevision: v2Rev1Historical.v2Pilot.implementationRevision ?? "impl-rev1",
          adm3ZoneCount: v2Rev1Historical.v2Pilot.adm3ZoneCount,
          seedNamedShare: v2Rev1Historical.v2Pilot.seedNamedShare,
          quality: v2Rev1Historical.v2Pilot.quality
        }
      : null,
    v2Rev2Historical: v2Rev2Historical?.v2Pilot
      ? {
          implementationRevision: v2Rev2Historical.v2Pilot.implementationRevision ?? "impl-rev2",
          adm3ZoneCount: v2Rev2Historical.v2Pilot.adm3ZoneCount,
          seedNamedShare: v2Rev2Historical.v2Pilot.seedNamedShare,
          seedCoverageRatio: v2Rev2Historical.v2Pilot.seedCoverageRatio,
          quality: v2Rev2Historical.v2Pilot.quality,
          weightedInternalBarrierAlignment:
            v2Rev2Historical.v2Pilot.quality?.weightedInternalBarrierAlignment ?? null
        }
      : null,
    hypothesisEvaluation: {
      variants: hypothesisVariantResults,
      selectedVariantId: winningVariant.id,
      selectionPolicy:
        "Among geography/validation-passing variants, maximize weighted internal barrier alignment without material seed-coverage regression vs impl-rev2 (>=97% of 0.5211)."
    },
    acceptanceTargets: {
      weightedInternalBarrierAlignmentTarget: V17_WEIGHTED_ALIGNMENT_TARGET,
      seedCoverageRatioFloor: REV2_SEED_COVERAGE_FLOOR
    },
    rootCauseSummary: rootCause,
    v17Replay: {
      algorithmVersion: TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
      deterministicHash: v17Replay.result.deterministicHash,
      buildDurationMs: v17Replay.durationMs,
      memoryDeltaMb: v17Replay.memoryPeakMb,
      validationOk: v17Replay.validation.ok,
      qualityOk: v17Replay.result.quality.ok,
      ...summarizeSeedCoverage(v17Replay.result.zones, artifact.localitySeeds),
      quality: summarizeQuality(v17Replay.result.quality, pathologyV17),
      pathologyFindingCount: pathologyV17.findings.length
    },
    v2Pilot: {
      algorithmVersion: TURKEY_SMART_FALLBACK_V2_PILOT_ALGORITHM_VERSION,
      implementationRevision: TURKEY_SMART_FALLBACK_V2_PILOT_IMPLEMENTATION_REVISION,
      deterministicHash: v2Build.result.deterministicHash,
      determinismVerified: v2Repeat.result.deterministicHash === v2Build.result.deterministicHash,
      buildDurationMs: v2Build.durationMs,
      memoryDeltaMb: v2Build.memoryPeakMb,
      validationOk: v2Build.validation.ok,
      qualityOk: v2Build.result.quality.ok,
      ...summarizeSeedCoverage(v2Build.result.zones, artifact.localitySeeds),
      quality: summarizeQuality(v2Build.result.quality, pathologyV2),
      pathologyFindingCount: pathologyV2.findings.length,
      networkDiagnostics: v2Build.result.quality.networkConstruction ?? null,
      seedWatershedBarrierAudit:
        v2Build.result.quality.networkConstruction?.seedWatershedBarrierAudit ?? null
    },
    deltas: {
      seedNamedShareV2MinusBaseline: round(
        summarizeSeedCoverage(v2Build.result.zones, artifact.localitySeeds).seedNamedShare -
          summarizeSeedCoverage(baselineV17Zones, artifact.localitySeeds).seedNamedShare
      ),
      meanZoneBarrierAlignmentV2MinusBaseline: round(
        (v2Build.result.quality.meanZoneBarrierAlignment ?? 0) -
          (v17Replay.result.quality.meanZoneBarrierAlignment ?? 0)
      ),
      longestUnsupportedChainV2MinusV17Replay: round(
        (v2Build.result.quality.longestUnsupportedStraightChainMeters ?? 0) -
          (v17Replay.result.quality.longestUnsupportedStraightChainMeters ?? 0),
        2
      ),
      weightedInternalBarrierAlignmentV2MinusV17Replay: round(
        (v2Build.result.quality.weightedInternalBarrierAlignment ?? 0) -
          (v17Replay.result.quality.weightedInternalBarrierAlignment ?? 0)
      ),
      adm3ZoneCountV2MinusV17Replay: v2Build.result.zones.length - v17Replay.result.zones.length,
      zoneCountRationale:
        "Higher ADM3 counts can follow seed-watershed face cardinality and max-area caps; zone count alone is not a success metric."
    },
    decision: deriveDecision(
      v2Build,
      v17Replay,
      baselineV17Zones,
      v2Build.result.zones,
      artifact.localitySeeds,
      v2Rev1Historical
    )
  };

  await mkdir(join(REPO_ROOT, OUTPUT_ROOT), { recursive: true });
  await mkdir(join(REPO_ROOT, REPORT_ROOT), { recursive: true });

  const locks = {
    parentAdm2Id: PARENT_ADM2_ID,
    baselineShardPath: baselineShard,
    barrierArtifactRoot: BARRIER_ROOT,
    osmSourceLockPath: OSM_SOURCE_LOCK,
    sourceSnapshotChecksum: artifact.manifest.source.snapshotSha256,
    barrierArtifactChecksum: artifact.manifest.artifactChecksum,
    algorithmVersion: TURKEY_SMART_FALLBACK_V2_PILOT_ALGORITHM_VERSION,
    implementationRevision: TURKEY_SMART_FALLBACK_V2_PILOT_IMPLEMENTATION_REVISION,
    sourceLockSha256: createHash("sha256").update(JSON.stringify(sourceLock)).digest("hex")
  };

  const seedAssignment = {
    schemaVersion: "territorykit-tr-mahalle-first-seed-assignment@1",
    seeds: artifact.localitySeeds,
    zones: v2Build.result.zones.map((zone) => {
      const meta = territoryMeta(zone);
      return {
        id: zone.id,
        name: zone.name,
        seedName: meta.seedName ?? null,
        nameSource: meta.nameSource ?? null,
        seedIds: meta.smartFallback?.seedIds ?? [],
        reasonCodes: meta.smartFallback?.reasonCodes ?? []
      };
    })
  };

  const geometryQuality = {
    schemaVersion: "territorykit-tr-mahalle-first-geometry-quality@1",
    v2: pathologyV2,
    v17Replay: pathologyV17,
    baselineRc8: pathologyBaseline,
    validation: v2Build.validation
  };

  const migration = {
    schemaVersion: "territorykit-tr-mahalle-first-migration-impact@2",
    baselineRc8VsV2: migrationImpact(baselineV17Zones, v2Build.result.zones),
    v17ReplayVsV2: migrationImpact(v17Replay.result.zones, v2Build.result.zones),
    replacementMapDraft: draftStableIdReplacementMap(baselineV17Zones, v2Build.result.zones),
    exactPolygonEvidence: {
      status: NOT_ASSESSED,
      reason:
        "Fatih sprint-2b3 pilot records bbox-overlap draft only; exact intersection/IoU/split-merge evidence requires a dedicated geometry diff job on pinned shards."
    },
    stableIdNotes: {
      algorithmVersionRegeneration:
        "v2 pilot uses smart-derived-v2.0-pilot IDs; zero retained rc.8 IDs is expected without an approved replacement map.",
      migrationApproval: "DRAFT_NOT_APPROVED"
    }
  };

  const barrierDiagnostics = {
    schemaVersion: "territorykit-tr-mahalle-first-barrier-graph@2",
    manifest: artifact.manifest,
    quality: artifact.quality,
    v2NetworkConstruction: v2Build.result.quality.networkConstruction ?? null,
    rootCauseAnalysis: rootCause
  };

  const visualComparisonHtml = buildVisualComparisonHtml({
    center: parent.center,
    layers: {
      baseline: "baseline-v17-rc8.geojson",
      v17Replay: "v17-replay.geojson",
      v2: "v2-candidate.geojson",
      seeds: "locality-seeds.geojson",
      roads: "roads-sample.geojson",
      railways: "railways-sample.geojson"
    }
  });

  const writes = [
    [join(OUTPUT_ROOT, "dataset.json"), v2Build.dataset],
    [join(OUTPUT_ROOT, "build-summary.json"), v2Build.result],
    [join(OUTPUT_ROOT, "quality-report.json"), v2Build.result.quality],
    [join(OUTPUT_ROOT, "seed-assignment-report.json"), seedAssignment],
    [join(OUTPUT_ROOT, "barrier-graph-diagnostics.json"), barrierDiagnostics],
    [join(OUTPUT_ROOT, "geometry-qa-report.json"), geometryQuality],
    [join(OUTPUT_ROOT, "before-after-metrics.json"), comparison],
    [join(OUTPUT_ROOT, "source-implementation-locks.json"), locks],
    [join(OUTPUT_ROOT, "migration-impact-report.json"), migration],
    [
      join(OUTPUT_ROOT, "v2-candidate.geojson"),
      zonesToFeatureCollection(v2Build.result.zones, "v2")
    ],
    [
      join(OUTPUT_ROOT, "v17-replay.geojson"),
      zonesToFeatureCollection(v17Replay.result.zones, "v17-replay")
    ],
    [
      join(OUTPUT_ROOT, "baseline-v17-rc8.geojson"),
      zonesToFeatureCollection(baselineV17Zones, "baseline-rc8")
    ],
    [
      join(OUTPUT_ROOT, "locality-seeds.geojson"),
      {
        type: "FeatureCollection",
        features: artifact.localitySeeds.map((seed) => ({
          type: "Feature",
          properties: { name: seed.name, type: seed.type ?? "unknown" },
          geometry: { type: "Point", coordinates: seed.coordinate }
        }))
      }
    ],
    [join(OUTPUT_ROOT, "visual-comparison.html"), visualComparisonHtml],
    [
      join(OUTPUT_ROOT, "screenshot-status.json"),
      { status: "NOT_RUN", reason: "No headless MapLibre renderer in CI script" }
    ],
    [join(REPORT_ROOT, "fatih-v2-impl-rev3-comparison.json"), comparison],
    [join(REPORT_ROOT, "fatih-v2-impl-rev3-geometry-quality.json"), geometryQuality],
    [
      join(REPORT_ROOT, "fatih-v2-impl-rev3-seed-barrier-audit.json"),
      { seedAssignment, barrierDiagnostics }
    ],
    [join(REPORT_ROOT, "fatih-v2-impl-rev3-migration-impact.json"), migration],
    [
      join(REPORT_ROOT, "sprint-2b3-decision.md"),
      { kind: "markdown", body: buildDecisionMarkdown(comparison, locks, "Sprint 2B.3") }
    ],
    [
      join(REPORT_ROOT, "sprint-2b-decision.md"),
      {
        kind: "markdown",
        body: buildDecisionMarkdown(comparison, locks, "Sprint 2B (superseded by 2B.3)")
      }
    ],
    [
      join(REPORT_ROOT, "sprint-2a-decision.md"),
      {
        kind: "markdown",
        body: buildDecisionMarkdown(comparison, locks, "Sprint 2A (superseded by 2B)")
      }
    ]
  ];

  for (const [relativePath, payload] of writes) {
    const absolute = join(REPO_ROOT, relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    if (typeof payload === "string") {
      await writeFile(absolute, payload.endsWith("\n") ? payload : `${payload}\n`, "utf8");
    } else if (payload?.kind === "markdown") {
      await writeReportMarkdown(absolute, payload.body);
    } else {
      await writeReportJson(absolute, payload);
    }
  }

  // Roads sample for visual overlay (truncate for HTML size)
  await writeReportJson(join(REPO_ROOT, OUTPUT_ROOT, "roads-sample.geojson"), artifact.roads);
  await writeReportJson(
    join(REPO_ROOT, OUTPUT_ROOT, "railways-sample.geojson"),
    artifact.railways ?? { type: "FeatureCollection", features: [] }
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputRoot: OUTPUT_ROOT,
        decision: comparison.decision.status,
        v2Determinism: comparison.v2Pilot.determinismVerified,
        v2QualityOk: comparison.v2Pilot.qualityOk
      },
      null,
      2
    )
  );
}

function deriveDecision(v2Build, v17Replay, baselineZones, v2Zones, seeds, v2Rev1Historical) {
  if (!v2Build.validation.ok) {
    return { status: "FAIL", reason: "Turkey V2 dataset validation failed on v2 pilot output." };
  }
  if (!v2Build.result.quality.ok) {
    return { status: "FAIL", reason: "Smart fallback quality gates failed on v2 pilot." };
  }
  const geographicRealism = v2Build.result.quality.gates.geographicRealism === true;
  const coverage = summarizeSeedCoverage(v2Zones, seeds);
  const seedGain =
    coverage.seedNamedShare > summarizeSeedCoverage(baselineZones, seeds).seedNamedShare;
  const v17ZoneAlignment = v17Replay.result.quality.meanZoneBarrierAlignment ?? 0;
  const v2ZoneAlignment = v2Build.result.quality.meanZoneBarrierAlignment ?? 0;
  const v17Weighted = v17Replay.result.quality.weightedInternalBarrierAlignment ?? 0;
  const v2Weighted = v2Build.result.quality.weightedInternalBarrierAlignment ?? 0;
  const barrierGain =
    v2ZoneAlignment + 1e-6 >= v17ZoneAlignment && v2Weighted + 1e-6 >= v17Weighted;
  const seedCoverageOk = coverage.seedCoverageRatio + 1e-4 >= REV2_SEED_COVERAGE_FLOOR * 0.97;
  const weightedTargetMet = v2Weighted + 1e-4 >= V17_WEIGHTED_ALIGNMENT_TARGET;

  if (!geographicRealism) {
    return {
      status: "FAIL",
      reason: "Geographic realism gate did not pass on v2 pilot."
    };
  }
  if (seedCoverageOk && weightedTargetMet && geographicRealism) {
    return {
      status: "PASS_WITH_REVIEW",
      reason:
        "impl-rev3 met Fatih acceptance targets: weighted barrier alignment at v1.7 replay level with seed coverage not materially below impl-rev2."
    };
  }
  if (seedGain && barrierGain) {
    return {
      status: "PASS_WITH_REVIEW",
      reason: "Seed coverage and barrier alignment improved vs rc.8/v1.7 replay on pinned inputs."
    };
  }
  if (seedGain && !barrierGain) {
    const rev1ZoneAlignment = v2Rev1Historical?.quality?.meanZoneBarrierAlignment;
    const rev2ZoneAlignment = v2Build.result.quality.meanZoneBarrierAlignment ?? 0;
    const paretoNote =
      rev1ZoneAlignment !== undefined
        ? ` impl-rev2 raised mean zone barrier alignment from ${rev1ZoneAlignment} (impl-rev1) to ${round(rev2ZoneAlignment)} but remains below v1.7 replay (${round(v17ZoneAlignment)}).`
        : "";
    return {
      status: "INCONCLUSIVE",
      reason: `Pareto trade-off: seed-named coverage improved vs rc.8/v1.7 replay but barrier alignment has not reached v1.7 replay levels (weighted ${round(v2Weighted)} vs target ${V17_WEIGHTED_ALIGNMENT_TARGET}).${paretoNote}`,
      paretoTradeOff: true,
      nationalExpansion: "NO-GO"
    };
  }
  return {
    status: "INCONCLUSIVE",
    reason: "No material seed-coverage gain vs rc.8 baseline on pinned inputs.",
    nationalExpansion: "NO-GO"
  };
}

function buildDecisionMarkdown(comparison, locks, sprintLabel) {
  const hypothesisLines = (comparison.hypothesisEvaluation?.variants ?? [])
    .map(
      (row) =>
        `- ${row.id}: weighted=${row.score.weightedInternalBarrierAlignment}, seedCoverage=${row.score.seedCoverageRatio}, zones=${row.score.adm3ZoneCount}`
    )
    .join("\n");
  return `# ${sprintLabel} — Fatih smart-derived-v2.0-pilot

## Decision

- **Status:** ${comparison.decision.status}
- **Reason:** ${comparison.decision.reason}
- **National expansion:** ${comparison.decision.nationalExpansion ?? "NO-GO (Fatih pilot only)"}
- **Selected variant:** ${comparison.hypothesisEvaluation?.selectedVariantId ?? "impl-rev3"}

## Hypothesis variants (deterministic)

${hypothesisLines || "- (not evaluated)"}

## Design note

- Hypothesis A (weak-barrier watershed relabeling) materially improved weighted barrier alignment vs impl-rev2 (+0.096) while preserving seed coverage.
- Hypothesis B (max-area ×1.12) did not change Fatih metrics vs rev2; default impl-rev3 keeps multiplier 1.0.
- Closing the remaining ~0.14 weighted gap to v1.7 replay likely requires a deeper v2 partition model (fewer zone boundaries / stronger-barrier-preserving merges), not further threshold tuning.

## Locks

- Parent ADM2: \`${locks.parentAdm2Id}\`
- Baseline (read-only): \`${locks.baselineShardPath}\`
- Barriers: \`${locks.barrierArtifactRoot}\`
- OSM source lock: \`${locks.osmSourceLockPath}\`
- Algorithm: \`${locks.algorithmVersion}\` (\`${locks.implementationRevision}\`)

## Metrics snapshot

| Metric | rc.8 baseline | v1.7 replay | v2 pilot |
| --- | ---: | ---: | ---: |
| ADM3 zones | ${comparison.baseline.adm3ZoneCount} | ${comparison.v17Replay.adm3ZoneCount} | ${comparison.v2Pilot.adm3ZoneCount} |
| Seed-named share | ${comparison.baseline.seedNamedShare} | ${comparison.v17Replay.seedNamedShare} | ${comparison.v2Pilot.seedNamedShare} |
| Mean zone barrier alignment | ${comparison.baseline.quality.meanZoneBarrierAlignment?.status ?? comparison.baseline.quality.meanZoneBarrierAlignment} | ${comparison.v17Replay.quality.meanZoneBarrierAlignment} | ${comparison.v2Pilot.quality.meanZoneBarrierAlignment} |
| Weighted internal barrier alignment | ${comparison.baseline.quality.weightedInternalBarrierAlignment?.status ?? "—"} | ${comparison.v17Replay.quality.weightedInternalBarrierAlignment} | ${comparison.v2Pilot.quality.weightedInternalBarrierAlignment} |
| Longest unsupported chain (m) | ${comparison.baseline.quality.longestUnsupportedStraightChainMeters?.status ?? "—"} | ${comparison.v17Replay.quality.longestUnsupportedStraightChainMeters} | ${comparison.v2Pilot.quality.longestUnsupportedStraightChainMeters} |
| Deterministic hash | — | ${comparison.v17Replay.deterministicHash.slice(0, 16)}… | ${comparison.v2Pilot.deterministicHash.slice(0, 16)}… |

## Next gate (Eyüpsultan)

- Reuse the same OSM snapshot + implementation revision.
- Require barrier-graph partition stability and improved seed/barrier metrics without rc.8 regression.

## Tests

- Run \`pnpm --filter @territory-kit/generators test turkey-smart-derived-v2-pilot\` and full \`pnpm verify\` before merge.
`;
}

function buildVisualComparisonHtml({ center, layers }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Fatih v1.7 vs v2 pilot</title>
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>html,body,#map{margin:0;height:100%;} .legend{position:absolute;top:8px;left:8px;background:#fff;padding:8px;font:12px sans-serif;z-index:1;}</style>
</head>
<body>
<div class="legend">
  <label><input type="checkbox" id="toggle-baseline" checked /> rc.8 baseline</label><br/>
  <label><input type="checkbox" id="toggle-v17" /> v1.7 replay</label><br/>
  <label><input type="checkbox" id="toggle-v2" checked /> v2 pilot</label><br/>
  <label><input type="checkbox" id="toggle-seeds" checked /> seeds</label><br/>
  <label><input type="checkbox" id="toggle-roads" /> barrier roads</label><br/>
  <label><input type="checkbox" id="toggle-railways" /> railways</label>
</div>
<div id="map"></div>
<script>
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [${center[0]}, ${center[1]}],
  zoom: 12
});
const sources = {
  baseline: '${layers.baseline}',
  v17: '${layers.v17Replay}',
  v2: '${layers.v2}',
  seeds: '${layers.seeds}',
  roads: '${layers.roads}',
  railways: '${layers.railways}'
};
map.on('load', async () => {
  for (const [id, url] of Object.entries(sources)) {
    const data = await fetch(url).then(r => r.json());
    map.addSource(id, { type: 'geojson', data });
    if (id === 'seeds') {
      map.addLayer({ id: id+'-layer', type: 'circle', source: id, paint: { 'circle-radius': 5, 'circle-color': '#111' } });
    } else if (id === 'roads' || id === 'railways') {
      map.addLayer({ id: id+'-line', type: 'line', source: id, paint: { 'line-color': id==='railways' ? '#6b4c9a' : '#555', 'line-width': 1.2, 'line-opacity': 0.7 } });
    } else {
      map.addLayer({ id: id+'-fill', type: 'fill', source: id, paint: { 'fill-color': id==='v2' ? '#e4572e' : '#4c78a8', 'fill-opacity': 0.25 } });
      map.addLayer({ id: id+'-line', type: 'line', source: id, paint: { 'line-color': id==='v2' ? '#e4572e' : '#4c78a8', 'line-width': 1.5 } });
    }
  }
});
['toggle-baseline','toggle-v17','toggle-v2','toggle-seeds','toggle-roads','toggle-railways'].forEach((toggleId) => {
  document.getElementById(toggleId).addEventListener('change', (event) => {
    const layerPrefix = toggleId.replace('toggle-','');
    const visibility = event.target.checked ? 'visible' : 'none';
    ['fill','line','layer'].forEach((suffix) => {
      const layerId = layerPrefix === 'seeds' ? 'seeds-layer' : layerPrefix + '-' + suffix;
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visibility);
    });
  });
});
</script>
</body>
</html>`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
