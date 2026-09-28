import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { computeTerritoryAreaM2 } from "../packages/dataset/dist/index.mjs";
import {
  buildTurkeyV2HybridDistrict,
  createTurkeyOsmSmartFallbackGeneratedOptions,
  readTurkeyOsmAdm2BarrierArtifact,
  TURKEY_SMART_FALLBACK_ALGORITHM_VERSION
} from "../packages/generators/dist/turkey-adm3.mjs";
const baseline = JSON.parse(
  await fs.readFile("reports/baselines/sprint-6-geographic-calibration.json", "utf8")
);
const source = JSON.parse(
  await fs.readFile("datasets/generated/countries/TR/dataset.json", "utf8")
);
const official = JSON.parse(
  await fs.readFile(".territory/build/TR/ADM3/official/levels/ADM3/dataset.json", "utf8")
);
const rows = [];
const t = performance.now();
for (const before of baseline.failedDistrictInputSignals) {
  const district = source.zones.find((z) => z.id === before.adm2Id);
  if (!district) throw Error(`Missing parent ${before.adm2Id}`);
  const officialZones = official.zones
    .filter((z) => z.properties?.territory?.parentAdm2Id === district.id)
    .map((z) => ({ ...z, parentId: district.id }));
  const artifact = await readTurkeyOsmAdm2BarrierArtifact(
    ".territory/sprint-6/calibration/barriers",
    district.id
  );
  const generated = createTurkeyOsmSmartFallbackGeneratedOptions(artifact, {
    smartFallbackOptions: {
      maxTerritories: computeTerritoryAreaM2(district.geometry) > 100_000_000 ? 32 : 128
    }
  });
  let result, error;
  const start = performance.now();
  try {
    result = await buildTurkeyV2HybridDistrict({
      district,
      provinceCode: district.parentId?.match(/tr-(\d{2})/)?.[1] ?? "",
      districtCode: district.id.slice(8),
      officialZones,
      generated,
      buildDate: "2026-09-28T00:00:00.000Z"
    });
  } catch (e) {
    error = String(e);
  }
  const q = result?.smartFallbackResult?.quality;
  const row = {
    district: district.name,
    districtId: district.id,
    beforeFailureReason:
      baseline.districts.find((d) => d.adm2Id === district.id)?.failureReason ?? null,
    afterAccepted: result?.quality.ok ?? false,
    afterError: error ?? null,
    sourceTier: result?.smartFallbackResult
      ? result.smartFallbackResult.configuration.organic
        ? "organic-smart"
        : "standard-smart"
      : null,
    officialInputCount: officialZones.length,
    officialRetainedCount: result?.effective.official.length ?? 0,
    approvedEffectiveInputCount: result?.quality.summary.approvedInputZoneCount ?? 0,
    preAcceptanceOfficialRejections:
      result?.rejections.rejections
        .filter((rejection) => rejection.sourceClass === "official")
        .map((rejection) => ({ zoneId: rejection.zoneId, reason: rejection.reason })) ?? [],
    approvedSourcePreservation: result?.quality.gates.approvedSourcePreservation ?? false,
    coveragePercent: result?.coverage.finalCoveragePercent ?? null,
    zoneCount: result?.effective.zones.length ?? 0,
    geometryHash: result?.dataset?.manifest?.geometryHash ?? null,
    roadDensity:
      result?.smartFallbackResult?.configuration?.profileDecision?.signals?.roadDensityKmPerKm2 ??
      null,
    barrierDensity:
      result?.smartFallbackResult?.configuration?.profileDecision?.signals?.strongBarrierCount ??
      null,
    localitySeedCount: q?.inputDiagnostics?.seedsNormalized ?? null,
    parentAreaKm2: computeTerritoryAreaM2(district.geometry) / 1e6,
    missingGapAreaKm2: result?.coverage.missingBeforeGeneratedAreaKm2 ?? null,
    realBarrierRatio: q?.meanRealBarrierRatio ?? null,
    barrierFollowingRatio: q?.barrierFollowingInternalBoundaryRatio ?? null,
    syntheticRatio: q?.meanSyntheticBoundaryRatio ?? null,
    unsupportedStraightRatio: q?.longUnsupportedStraightBoundaryRatio ?? null,
    axisRatio: q?.axisAlignedInternalBoundaryRatio ?? null,
    availableBarrierOpportunityRatio: q?.availableBarrierOpportunityRatio ?? null,
    geometryValid: result?.quality.gates.invalidGeometry ?? false,
    precisionRecovery: q?.precisionRecovery ?? [],
    reasonCodes: result?.issues.map((i) => i.code) ?? [],
    durationMs: Math.round(performance.now() - start)
  };
  rows.push(row);
  console.log(
    `${rows.length}/24 ${district.name}: ${row.afterAccepted ? "PASS" : "FAIL"} ${row.durationMs}ms`
  );
  await fs.writeFile(
    ".territory/sprint-6/final/failure-cohort-progress.json",
    JSON.stringify(rows)
  );
}
const report = {
  schemaVersion: "territorykit-sprint-6-final-recovery@1",
  algorithmVersion: TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
  attempted: rows.length,
  accepted: rows.filter((r) => r.afterAccepted).length,
  failed: rows.filter((r) => !r.afterAccepted).length,
  durationMs: Math.round(performance.now() - t),
  districts: rows
};
await fs.writeFile(
  "reports/baselines/sprint-6-final-recovery.json",
  JSON.stringify(report, null, 2) + "\n"
);
