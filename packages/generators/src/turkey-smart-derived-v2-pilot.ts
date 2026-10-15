import type {
  TurkeySmartFallbackBuildResult,
  TurkeySmartFallbackInput
} from "./turkey-smart-fallback.js";
import {
  TURKEY_SMART_FALLBACK_V2_PILOT_ALGORITHM_VERSION,
  TURKEY_SMART_FALLBACK_V2_PILOT_IMPLEMENTATION_REVISION,
  buildTurkeySmartFallbackWithAdjacency,
  resolveTurkeySmartFallbackConfiguration
} from "./turkey-smart-fallback.js";

export {
  TURKEY_SMART_FALLBACK_V2_PILOT_ALGORITHM_VERSION,
  TURKEY_SMART_FALLBACK_V2_PILOT_IMPLEMENTATION_REVISION
};

/**
 * Opt-in mahalle-first pilot: barrier-network faces partitioned by multi-source
 * seed watershed (barrier crossing cost), not v1.7 area-target face merging.
 */
export async function buildTurkeySmartFallbackV2PilotWithAdjacency(
  input: TurkeySmartFallbackInput
): Promise<TurkeySmartFallbackBuildResult> {
  const standard = resolveTurkeySmartFallbackConfiguration({
    ...input,
    profile: input.profile ?? "dense-urban",
    options: {
      ...input.options,
      algorithmVersion: TURKEY_SMART_FALLBACK_V2_PILOT_ALGORITHM_VERSION
    }
  }).configuration;
  const targetCount = Math.min(96, Math.max(8, input.localitySeeds?.length ?? 0));
  const gameplayAreaCapKm2 =
    standard.targetGeometryAreaKm2 >= 75 && standard.profileDecision.signals.localitySeedCount >= 8
      ? standard.targetGeometryAreaKm2 * 0.65
      : Number.POSITIVE_INFINITY;
  const implementationRevision =
    input.options?.v2PilotImplementationRevision ??
    TURKEY_SMART_FALLBACK_V2_PILOT_IMPLEMENTATION_REVISION;
  const maxAreaGameplayMultiplier = input.options?.v2PilotMaxAreaGameplayMultiplier ?? 1;
  const baseMaxAreaKm2 = Math.max(standard.maxAreaKm2, standard.targetGeometryAreaKm2 / 6);

  return buildTurkeySmartFallbackWithAdjacency({
    ...input,
    profile: input.profile ?? "dense-urban",
    options: {
      ...input.options,
      algorithmVersion: TURKEY_SMART_FALLBACK_V2_PILOT_ALGORITHM_VERSION,
      v2PilotImplementationRevision: implementationRevision,
      organic: true,
      networkFirst: true,
      seed: `${standard.seed}:v2-pilot-${implementationRevision}`,
      maxTerritories: 96,
      targetTerritoryCount: targetCount,
      targetAreaKm2: Math.max(
        standard.targetAreaKm2,
        standard.targetGeometryAreaKm2 / Math.max(1, targetCount)
      ),
      maxAreaKm2: Math.min(baseMaxAreaKm2 * maxAreaGameplayMultiplier, gameplayAreaCapKm2),
      minMeanQualityScore: 0.25,
      minMeanBarrierAlignment: 0,
      maxSyntheticSplits: 0,
      requireBarrierForMultiTerritory: false
    }
  });
}
