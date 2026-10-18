import type { TurkeyV2HybridIssue } from "./turkey-v2-hybrid.js";
import type { TurkeySmartFallbackInput } from "./turkey-smart-fallback.js";
import {
  buildTurkeyNetworkFirstSmartFallbackWithAdjacency,
  buildTurkeyOrganicSmartFallbackWithAdjacency,
  buildTurkeySmartFallbackWithAdjacency,
  resolveTurkeySmartFallbackConfiguration,
  type TurkeySmartFallbackBuildResult,
  type TurkeySmartFallbackIssueCode,
  type TurkeySmartFallbackQualityReport
} from "./turkey-smart-fallback.js";

export const TURKEY_PLAYABLE_RESCUE_SCHEMA_VERSION = "territorykit-tr-playable-rescue@1" as const;

export type TurkeyPlayableRescueStage =
  | "verified-administrative"
  | "network-faces"
  | "settlement-network-grouping"
  | "organic-routing-repair"
  | "low-confidence-estimate"
  | "single-parent-last-resort";

export type TurkeyPlayableRescueFailureReason =
  | "NO_CANDIDATE_BUILT"
  | "TOPOLOGY_UNSAFE"
  | "COVERAGE_GAP_REMAINS"
  | "PRECISION_REGULARIZATION_FAILED"
  | "ALL_STRATEGIES_REJECTED"
  | "LEGACY_GRID_FORBIDDEN";

export interface TurkeyPlayableRescueContext {
  roadDensityKmPerKm2: number;
  strongBarrierCount: number;
  localitySeedCount: number;
  waterBarrierCount: number;
  parentComponentCount: number;
  coastalOrIslandLikely: boolean;
  denseUrbanLikely: boolean;
  sparseRuralLikely: boolean;
  /** Large districts with moderate road density (e.g. Eyüpsultan): network-faces can dominate oversized cells. */
  mixedUrbanRuralLikely: boolean;
}

export interface TurkeyPlayableRescueCandidateRecord {
  stage: TurkeyPlayableRescueStage;
  mode: "standard" | "network-first" | "organic" | "coarse-organic";
  result: TurkeySmartFallbackBuildResult;
  rank: number;
  accepted: boolean;
  topologySafe: boolean;
}

export interface TurkeyPlayableRescueReport {
  schemaVersion: typeof TURKEY_PLAYABLE_RESCUE_SCHEMA_VERSION;
  selectedStage: TurkeyPlayableRescueStage | null;
  selectedMode: TurkeyPlayableRescueCandidateRecord["mode"] | null;
  acceptedAsRescue: boolean;
  failureReason: TurkeyPlayableRescueFailureReason | null;
  context: TurkeyPlayableRescueContext;
  candidates: TurkeyPlayableRescueCandidateRecord[];
}

export interface TurkeyAdaptivePlayableRescueOptions {
  organicFallback?: boolean;
  allowCoarseLowConfidence?: boolean;
}

export interface TurkeyAdaptivePlayableRescueResult {
  result: TurkeySmartFallbackBuildResult | undefined;
  report: TurkeyPlayableRescueReport;
  issues: TurkeyV2HybridIssue[];
  acceptedAsRescue: boolean;
}

const TOPOLOGY_HARD_GATES = [
  "geometryValid",
  "overlap",
  "outsideSpill",
  "parentCoverage",
  "gridLikeness",
  "syntheticSplitLimit"
] as const;

export function derivePlayableRescueContext(
  input: TurkeySmartFallbackInput
): TurkeyPlayableRescueContext {
  const configuration = resolveTurkeySmartFallbackConfiguration(input).configuration;
  const signals = configuration.profileDecision.signals;
  const waterBarrierCount =
    (input.water?.features?.length ?? 0) > 0 ? input.water!.features.length : 0;
  const parentComponentCount =
    input.parent.geometry.type === "MultiPolygon" ? input.parent.geometry.coordinates.length : 1;
  const coastalOrIslandLikely =
    waterBarrierCount >= 12 || parentComponentCount >= 3 || signals.roadDensityKmPerKm2 < 2.5;
  const denseUrbanLikely = signals.roadDensityKmPerKm2 >= 8;
  const sparseRuralLikely =
    signals.roadDensityKmPerKm2 < 1.5 && configuration.targetGeometryAreaKm2 >= 120;
  const mixedUrbanRuralLikely =
    !denseUrbanLikely &&
    !sparseRuralLikely &&
    configuration.targetGeometryAreaKm2 >= 70 &&
    signals.roadDensityKmPerKm2 >= 1.8 &&
    signals.roadDensityKmPerKm2 < 8;
  return {
    roadDensityKmPerKm2: signals.roadDensityKmPerKm2,
    strongBarrierCount: signals.strongBarrierCount,
    localitySeedCount: signals.localitySeedCount,
    waterBarrierCount,
    parentComponentCount,
    coastalOrIslandLikely,
    denseUrbanLikely,
    sparseRuralLikely,
    mixedUrbanRuralLikely
  };
}

export function isTopologySafePlayableRescue(quality: TurkeySmartFallbackQualityReport): boolean {
  if (quality.territoryCount <= 0 || quality.invalidGeometryCount > 0) {
    return false;
  }
  for (const gate of TOPOLOGY_HARD_GATES) {
    if (!quality.gates[gate]) {
      return false;
    }
  }
  return quality.geometryValidationErrors.length === 0;
}

/** Soft smart-fallback quality errors intentionally tolerated after topology-safe playable rescue. */
const PLAYABLE_RESCUE_TOLERATED_SMART_FALLBACK_ERROR_CODES: ReadonlySet<TurkeySmartFallbackIssueCode> =
  new Set(["SMART_FALLBACK_PARTITION_DEGENERATE"]);

export function countSmartFallbackGeneratedMetadataErrors(
  result: TurkeySmartFallbackBuildResult,
  playableRescueAccepted: boolean
): number {
  return result.issues.filter((issue) => {
    if (issue.severity !== "error") {
      return false;
    }
    if (
      playableRescueAccepted &&
      isTopologySafePlayableRescue(result.quality) &&
      PLAYABLE_RESCUE_TOLERATED_SMART_FALLBACK_ERROR_CODES.has(issue.code)
    ) {
      return false;
    }
    return true;
  }).length;
}

export function rankPlayableRescueCandidate(
  result: TurkeySmartFallbackBuildResult,
  context: TurkeyPlayableRescueContext
): number {
  const q = result.quality;
  const districtScaleMeters = Math.max(1, Math.sqrt(q.parentAreaKm2) * 1000);
  const okBonus = q.ok ? 6 : isTopologySafePlayableRescue(q) ? 2.5 : 0;
  const oversizeWeight = context.sparseRuralLikely ? 16 : context.mixedUrbanRuralLikely ? 14 : 12;
  const oversizeMidWeight = context.sparseRuralLikely ? 9 : context.mixedUrbanRuralLikely ? 8 : 6;
  const oversizePenalty =
    q.largestTerritoryAreaShare > 0.35
      ? (q.largestTerritoryAreaShare - 0.35) * oversizeWeight
      : q.largestTerritoryAreaShare > 0.25
        ? (q.largestTerritoryAreaShare - 0.25) * oversizeMidWeight
        : 0;
  const unsupportedPenalty =
    (q.longestUnsupportedStraightChainMeters / districtScaleMeters) *
    (context.sparseRuralLikely ? 6.5 : context.coastalOrIslandLikely ? 7 : 4);
  const alignmentBonus = Math.min(1, q.barrierFollowingInternalBoundaryRatio) * 3.5;
  const zoneCountBonus = context.sparseRuralLikely
    ? Math.min(q.territoryCount, 24) / 24
    : Math.min(q.territoryCount, 48) / 48;
  const coastalZeroSeamBonus =
    context.coastalOrIslandLikely && q.longestUnsupportedStraightChainMeters < 25 ? 1.5 : 0;
  const ruralBalanceBonus =
    context.sparseRuralLikely &&
    q.largestTerritoryAreaShare <= 0.22 &&
    q.barrierFollowingInternalBoundaryRatio >= 0.22
      ? 1.25
      : 0;
  const fragmentPenalty =
    context.sparseRuralLikely &&
    q.meanSyntheticBoundaryRatio > 0.65 &&
    q.barrierFollowingInternalBoundaryRatio < 0.4
      ? (q.meanSyntheticBoundaryRatio - 0.65) * 4
      : 0;

  return (
    okBonus +
    alignmentBonus +
    zoneCountBonus +
    coastalZeroSeamBonus +
    ruralBalanceBonus +
    q.meanQualityScore -
    q.meanSyntheticBoundaryRatio * (context.sparseRuralLikely ? 2.75 : 2) -
    unsupportedPenalty -
    oversizePenalty -
    fragmentPenalty
  );
}

export function selectPlayableRescueCandidate(
  eligible: readonly TurkeyPlayableRescueCandidateRecord[],
  context: TurkeyPlayableRescueContext
): TurkeyPlayableRescueCandidateRecord | undefined {
  if (!eligible.length) return undefined;
  let selected = [...eligible].sort((left, right) => right.rank - left.rank)[0]!;
  const balanceOrganicOverOversizedNetwork =
    context.sparseRuralLikely || context.mixedUrbanRuralLikely;
  if (!balanceOrganicOverOversizedNetwork) return selected;

  const organic = eligible.find((row) => row.mode === "organic" && row.result.quality.ok);
  const network = eligible.find((row) => row.mode === "network-first" && row.result.quality.ok);
  if (selected.mode === "network-first" && organic && network) {
    const nq = network.result.quality;
    const oq = organic.result.quality;
    const materiallySmallerLargest =
      oq.largestTerritoryAreaShare < nq.largestTerritoryAreaShare - 0.1;
    const seamLengthFactor = context.mixedUrbanRuralLikely ? 1.55 : 1.35;
    const seamAlignmentSlack = context.mixedUrbanRuralLikely ? 0.42 : 0.12;
    const seamsNotMuchWorse =
      oq.longestUnsupportedStraightChainMeters <=
        nq.longestUnsupportedStraightChainMeters * seamLengthFactor &&
      oq.barrierFollowingInternalBoundaryRatio + seamAlignmentSlack >=
        nq.barrierFollowingInternalBoundaryRatio;
    const balancedOrganicOverOversizedNetwork =
      nq.largestTerritoryAreaShare > 0.28 &&
      oq.largestTerritoryAreaShare <= 0.18 &&
      oq.barrierFollowingInternalBoundaryRatio >= 0.33 &&
      oq.longestUnsupportedStraightChainMeters <= 11_000;
    const mixedUrbanOversizedNetwork =
      context.mixedUrbanRuralLikely &&
      nq.largestTerritoryAreaShare > 0.4 &&
      materiallySmallerLargest &&
      oq.longestUnsupportedStraightChainMeters <= nq.longestUnsupportedStraightChainMeters * 1.55;
    if (
      (materiallySmallerLargest && seamsNotMuchWorse) ||
      balancedOrganicOverOversizedNetwork ||
      mixedUrbanOversizedNetwork
    ) {
      selected = organic;
    }
  }
  return selected;
}

export function summarizePlayableRescueFailure(
  candidates: readonly TurkeyPlayableRescueCandidateRecord[],
  precisionFailure?: string
): TurkeyPlayableRescueFailureReason {
  if (precisionFailure === "SMART_FALLBACK_PRECISION_REGULARIZATION_FAILED") {
    return "PRECISION_REGULARIZATION_FAILED";
  }
  if (!candidates.length) {
    return "NO_CANDIDATE_BUILT";
  }
  if (candidates.every((row) => !row.topologySafe)) {
    return "TOPOLOGY_UNSAFE";
  }
  return "ALL_STRATEGIES_REJECTED";
}

function stageForMode(
  mode: TurkeyPlayableRescueCandidateRecord["mode"]
): TurkeyPlayableRescueStage {
  switch (mode) {
    case "standard":
      return "low-confidence-estimate";
    case "network-first":
      return "network-faces";
    case "organic":
      return "organic-routing-repair";
    case "coarse-organic":
      return "settlement-network-grouping";
  }
}

function shouldAttemptNetworkFirst(
  context: TurkeyPlayableRescueContext,
  standard?: TurkeySmartFallbackBuildResult
): boolean {
  if (context.roadDensityKmPerKm2 >= 1 || context.strongBarrierCount >= 20) {
    return true;
  }
  if (context.localitySeedCount >= 2) {
    return true;
  }
  if (context.waterBarrierCount >= 8) {
    return true;
  }
  if (standard && !standard.quality.ok) {
    return true;
  }
  return false;
}

async function buildCoarseOrganicRescueCandidate(
  input: TurkeySmartFallbackInput
): Promise<TurkeySmartFallbackBuildResult> {
  const standard = resolveTurkeySmartFallbackConfiguration(input).configuration;
  const targetCount = Math.max(2, Math.min(8, Math.ceil(standard.targetGeometryAreaKm2 / 45)));
  return buildTurkeyOrganicSmartFallbackWithAdjacency({
    ...input,
    options: {
      ...input.options,
      organic: true,
      organicGeographicRefinement: true,
      seed: `${standard.seed}:rescue-coarse-v1`,
      targetTerritoryCount: targetCount,
      maxTerritories: Math.max(targetCount, 16),
      targetAreaKm2: Math.max(standard.targetAreaKm2, standard.targetGeometryAreaKm2 / targetCount),
      maxAreaKm2: Math.max(standard.maxAreaKm2, standard.targetGeometryAreaKm2 / targetCount),
      minMeanQualityScore: 0.15,
      minMeanBarrierAlignment: 0,
      requireBarrierForMultiTerritory: false,
      maxSyntheticSplits: 0
    }
  });
}

export async function runTurkeyAdaptivePlayableRescue(input: {
  smartInput: TurkeySmartFallbackInput;
  parentId: string;
  options?: TurkeyAdaptivePlayableRescueOptions;
}): Promise<TurkeyAdaptivePlayableRescueResult> {
  const rescueOptions = input.options ?? {};
  const context = derivePlayableRescueContext(input.smartInput);
  const issues: TurkeyV2HybridIssue[] = [];
  const built: TurkeyPlayableRescueCandidateRecord[] = [];
  let precisionFailure: string | undefined;

  let standardCandidate: TurkeySmartFallbackBuildResult | undefined;
  try {
    standardCandidate = await buildTurkeySmartFallbackWithAdjacency(input.smartInput);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "SMART_FALLBACK_PRECISION_REGULARIZATION_FAILED"
    ) {
      throw error;
    }
    precisionFailure = error.message;
    issues.push({
      code: "PLAYABLE_RESCUE_STANDARD_PRECISION_FAILED",
      severity: "warning",
      message: "Standard smart partition failed precision regularization; rescue continues.",
      parentId: input.parentId,
      details: { reason: precisionFailure }
    });
  }

  if (standardCandidate) {
    built.push({
      stage: stageForMode("standard"),
      mode: "standard",
      result: standardCandidate,
      rank: rankPlayableRescueCandidate(standardCandidate, context),
      accepted: standardCandidate.quality.ok,
      topologySafe: isTopologySafePlayableRescue(standardCandidate.quality)
    });
  }

  if (shouldAttemptNetworkFirst(context, standardCandidate)) {
    try {
      const networkResult = await buildTurkeyNetworkFirstSmartFallbackWithAdjacency(
        input.smartInput
      );
      built.push({
        stage: stageForMode("network-first"),
        mode: "network-first",
        result: networkResult,
        rank: rankPlayableRescueCandidate(networkResult, context),
        accepted: networkResult.quality.ok,
        topologySafe: isTopologySafePlayableRescue(networkResult.quality)
      });
    } catch (error) {
      issues.push({
        code: "PLAYABLE_RESCUE_NETWORK_REJECTED",
        severity: "warning",
        message: "Network-first rescue candidate could not be constructed.",
        parentId: input.parentId,
        details: { reason: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  if (rescueOptions.organicFallback ?? true) {
    if (standardCandidate && !standardCandidate.quality.ok) {
      issues.push({
        code: "SMART_STANDARD_QUALITY_REJECTED",
        severity: "warning",
        message: "Standard Smart rejected; adaptive rescue comparing geographic alternatives.",
        parentId: input.parentId,
        details: {
          quality: standardCandidate.quality,
          reasonCodes: standardCandidate.reasonCodes
        }
      });
    }
    try {
      const organicResult = await buildTurkeyOrganicSmartFallbackWithAdjacency({
        ...input.smartInput,
        options: {
          ...input.smartInput.options,
          ...(context.sparseRuralLikely ? { organicGeographicRefinement: true } : {})
        }
      });
      built.push({
        stage: stageForMode("organic"),
        mode: "organic",
        result: organicResult,
        rank: rankPlayableRescueCandidate(organicResult, context),
        accepted: organicResult.quality.ok,
        topologySafe: isTopologySafePlayableRescue(organicResult.quality)
      });
      issues.push({
        code: organicResult.quality.ok ? "ORGANIC_SMART_ACCEPTED" : "ORGANIC_SMART_REJECTED",
        severity: organicResult.quality.ok ? "info" : "warning",
        message: "Organic smart candidate quality decision.",
        parentId: input.parentId,
        details: { reasonCodes: organicResult.reasonCodes }
      });
    } catch (error) {
      issues.push({
        code: "ORGANIC_SMART_REJECTED",
        severity: "warning",
        message: "Organic smart candidate could not be constructed.",
        parentId: input.parentId,
        details: { reason: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  const needsCoarse =
    (rescueOptions.allowCoarseLowConfidence ?? true) &&
    !built.some((row) => row.accepted) &&
    built.some((row) => row.topologySafe);
  if (needsCoarse) {
    try {
      const coarse = await buildCoarseOrganicRescueCandidate(input.smartInput);
      built.push({
        stage: stageForMode("coarse-organic"),
        mode: "coarse-organic",
        result: coarse,
        rank: rankPlayableRescueCandidate(coarse, context),
        accepted: coarse.quality.ok,
        topologySafe: isTopologySafePlayableRescue(coarse.quality)
      });
    } catch (error) {
      issues.push({
        code: "PLAYABLE_RESCUE_COARSE_REJECTED",
        severity: "warning",
        message: "Coarse organic rescue candidate could not be constructed.",
        parentId: input.parentId,
        details: { reason: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  const eligible = built.filter(
    (row) => row.accepted || (row.topologySafe && row.result.zones.length > 0)
  );
  const selected = selectPlayableRescueCandidate(eligible, context);
  const failureReason = selected ? null : summarizePlayableRescueFailure(built, precisionFailure);

  if (failureReason) {
    issues.push({
      code: "PLAYABLE_RESCUE_FAILED",
      severity: "error",
      message: "Adaptive playable rescue could not produce topology-safe zones.",
      parentId: input.parentId,
      details: {
        failureReason,
        candidateCount: built.length,
        modes: built.map((row) => row.mode)
      }
    });
  } else if (selected && !selected.accepted) {
    issues.push({
      code: "PLAYABLE_RESCUE_LOW_CONFIDENCE_ACCEPTED",
      severity: "warning",
      message:
        "Adaptive rescue accepted a topology-safe low-confidence estimate after quality rejection.",
      parentId: input.parentId,
      details: {
        mode: selected.mode,
        rank: selected.rank,
        reasonCodes: selected.result.reasonCodes,
        failedGates: Object.entries(selected.result.quality.gates)
          .filter(([, passed]) => !passed)
          .map(([gate]) => gate)
      }
    });
  }

  const report: TurkeyPlayableRescueReport = {
    schemaVersion: TURKEY_PLAYABLE_RESCUE_SCHEMA_VERSION,
    selectedStage: selected?.stage ?? null,
    selectedMode: selected?.mode ?? null,
    acceptedAsRescue: Boolean(selected && !selected.accepted),
    failureReason,
    context,
    candidates: built
  };

  let result = selected?.result;
  if (!result && built.length > 0) {
    const insufficientOrganic = built.find((row) =>
      row.result.reasonCodes.includes("ORGANIC_FALLBACK_INPUT_INSUFFICIENT")
    );
    const standardDiagnostic = built.find((row) => row.mode === "standard");
    result =
      insufficientOrganic?.result ??
      standardDiagnostic?.result ??
      [...built].sort((left, right) => right.rank - left.rank)[0]!.result;
  }
  if (result) {
    result = {
      ...result,
      candidateComparisons: built.map((row) => ({
        mode: row.mode === "coarse-organic" ? "organic" : row.mode,
        accepted: row.accepted || row === selected,
        coveragePercent: row.result.quality.coveragePercent,
        territoryCount: row.result.quality.territoryCount,
        largestTerritoryAreaShare: row.result.quality.largestTerritoryAreaShare,
        minimumZoneAreaKm2: row.result.quality.minAreaKm2,
        configuredMinimumAreaKm2: row.result.configuration.minAreaKm2,
        effectivePartitionCount: row.result.quality.effectivePartitionCount,
        minimumUsefulTerritoryCount: row.result.quality.minimumUsefulTerritoryCount,
        partitionAdequacy: row.result.quality.gates.partitionAdequacy,
        followingRatio: row.result.quality.barrierFollowingInternalBoundaryRatio,
        syntheticRatio: row.result.quality.meanSyntheticBoundaryRatio,
        axisAlignedInternalBoundaryRatio: row.result.quality.axisAlignedInternalBoundaryRatio,
        longUnsupportedStraightBoundaryRatio:
          row.result.quality.longUnsupportedStraightBoundaryRatio,
        unsupportedStraightChainCountAbove500m:
          row.result.quality.unsupportedStraightChainCountAbove500m,
        availableBarrierOpportunityRatio: row.result.quality.availableBarrierOpportunityRatio,
        longestUnsupportedMeters: row.result.quality.longestUnsupportedStraightChainMeters,
        deterministicHash: row.result.deterministicHash,
        rejectionCodes: row.result.quality.ok ? [] : row.result.reasonCodes,
        failedGates: Object.entries(row.result.quality.gates)
          .filter(([, passed]) => !passed)
          .map(([gate]) => gate),
        geometryValidationErrors: row.result.quality.geometryValidationErrors,
        ...(row.result.quality.networkConstruction
          ? { networkConstruction: row.result.quality.networkConstruction }
          : {})
      }))
    };
  }

  return {
    result,
    report,
    issues,
    acceptedAsRescue: Boolean(selected && !selected.accepted)
  };
}

export function measurePlayableRescueMetrics(input: {
  playableZoneCount: number;
  uncoveredAreaKm2: number;
  largestTerritoryAreaShare: number | null;
  longestUnsupportedStraightMeters: number | null;
  barrierFollowingRatio: number | null;
  invalidPolygonCount: number;
  overlapAreaKm2: number;
  deterministicHash: string | null;
}) {
  return {
    playableZoneCount: input.playableZoneCount,
    uncoveredAreaKm2: input.uncoveredAreaKm2,
    oversizedUrbanCellShare: input.largestTerritoryAreaShare,
    roadBarrierAlignment: input.barrierFollowingRatio,
    longestUnsupportedStraightMeters: input.longestUnsupportedStraightMeters,
    invalidPolygonCount: input.invalidPolygonCount,
    overlapAreaKm2: input.overlapAreaKm2,
    deterministicRebuildHash: input.deterministicHash
  };
}
