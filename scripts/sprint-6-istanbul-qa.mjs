import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { computeTerritoryAreaM2 } from "../packages/dataset/dist/index.mjs";
import {
  buildTurkeyV2HybridDistrict,
  createTurkeyOsmSmartFallbackGeneratedOptions,
  readTurkeyOsmAdm2BarrierArtifact,
  TURKEY_SMART_FALLBACK_ALGORITHM_VERSION
} from "../packages/generators/dist/turkey-adm3.mjs";

const source = JSON.parse(
  await fs.readFile("datasets/generated/countries/TR/dataset.json", "utf8")
);
const official = JSON.parse(
  await fs.readFile(".territory/build/TR/ADM3/official/levels/ADM3/dataset.json", "utf8")
);
const province = source.zones.find((z) => z.level === 1 && z.name === "İstanbul");
if (!province) throw Error("Istanbul province missing from ADM2 source");
const districts = source.zones
  .filter((z) => z.level === 2 && z.parentId === province.id)
  .sort((a, b) => a.name.localeCompare(b.name, "tr"));
if (districts.length !== 39 || new Set(districts.map((z) => z.id)).size !== districts.length)
  throw Error(`Unexpected Istanbul canonical cohort: ${districts.length}`);
const root = process.env.ISTANBUL_QA_ARTIFACT_ROOT ?? ".territory/sprint-6/final/istanbul-qa";
const reportPath =
  process.env.ISTANBUL_QA_REPORT ??
  (process.env.ISTANBUL_QA_DISTRICT
    ? path.join(root, "report.json")
    : "reports/baselines/sprint-6-istanbul-39.json");
const selectedDistricts = process.env.ISTANBUL_QA_DISTRICT
  ? districts.filter((district) =>
      process.env.ISTANBUL_QA_DISTRICT.split(",").includes(district.name)
    )
  : districts;
if (!selectedDistricts.length) throw Error("Requested Istanbul district is not canonical ADM2");
await fs.mkdir(root, { recursive: true });
const results = [];
const started = performance.now();
let peakRssBytes = process.memoryUsage().rss;
for (const [index, district] of selectedDistricts.entries()) {
  const slug = district.name
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-");
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
  const t = performance.now();
  let result, error;
  try {
    result = await buildTurkeyV2HybridDistrict({
      district,
      provinceCode: "34",
      districtCode: district.id.slice(8),
      officialZones,
      generated,
      buildDate: "2026-09-28T00:00:00.000Z"
    });
  } catch (e) {
    error = String(e);
  }
  const durationMs = Math.round(performance.now() - t);
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  const quality = result?.smartFallbackResult?.quality;
  const networkCandidate = result?.smartFallbackResult?.candidateComparisons?.find(
    (candidate) => candidate.mode === "network-first"
  );
  const row = {
    district: district.name,
    districtId: district.id,
    parentAreaKm2: computeTerritoryAreaM2(district.geometry) / 1e6,
    approvedOfficialPolygonCount: officialZones.length,
    verifiedOsmAdministrativePolygonCount: 0,
    algorithmVersion: TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
    sourceTier: result?.smartFallbackResult
      ? result.smartFallbackResult.configuration.networkFirst
        ? "network-first"
        : result.smartFallbackResult.configuration.organic
          ? "organic-smart"
          : "standard-smart"
      : result?.effective.official.length
        ? "official"
        : null,
    standardSmartZoneCount: result?.smartFallbackResult?.configuration?.organic
      ? 0
      : (result?.effective.generated.length ?? 0),
    organicSmartZoneCount:
      result?.smartFallbackResult?.configuration?.organic &&
      !result?.smartFallbackResult?.configuration?.networkFirst
        ? (result?.effective.generated.length ?? 0)
        : 0,
    networkFirstZoneCount: result?.smartFallbackResult?.configuration?.networkFirst
      ? (result?.effective.generated.length ?? 0)
      : 0,
    zoneCount: result?.effective.zones.length ?? 0,
    largestTerritoryAreaShare: quality?.largestTerritoryAreaShare ?? null,
    effectivePartitionCount: quality?.effectivePartitionCount ?? null,
    minimumUsefulTerritoryCount: quality?.minimumUsefulTerritoryCount ?? null,
    territoryCountAdequacy: quality?.territoryCountAdequacy ?? null,
    medianTerritoryAreaKm2: quality?.medianTerritoryAreaKm2 ?? null,
    p90TerritoryAreaKm2: quality?.p90TerritoryAreaKm2 ?? null,
    territoryAreaCV: quality?.territoryAreaCV ?? null,
    geometryHash: result?.dataset?.manifest?.geometryHash ?? null,
    coveragePercent: result?.coverage.finalCoveragePercent ?? null,
    uncoveredKm2: result?.quality.summary.remainingGapAreaKm2 ?? null,
    spillKm2: quality?.outsideSpillKm2 ?? null,
    overlapKm2: quality?.overlapAreaKm2 ?? null,
    roadDensity:
      result?.smartFallbackResult?.configuration?.profileDecision?.signals?.roadDensityKmPerKm2 ??
      null,
    barrierDensity:
      result?.smartFallbackResult?.configuration?.profileDecision?.signals?.strongBarrierCount ??
      null,
    localitySeedCount: quality?.inputDiagnostics?.seedsNormalized ?? null,
    realBarrierRatio: quality?.meanRealBarrierRatio ?? null,
    barrierFollowingInternalBoundaryRatio: quality?.barrierFollowingInternalBoundaryRatio ?? null,
    syntheticBoundaryRatio: quality?.meanSyntheticBoundaryRatio ?? null,
    availableBarrierOpportunityRatio: quality?.availableBarrierOpportunityRatio ?? null,
    barrierRoutingUtilization: quality?.barrierRoutingUtilization ?? null,
    axisAlignedInternalBoundaryRatio: quality?.axisAlignedInternalBoundaryRatio ?? null,
    longUnsupportedStraightBoundaryRatio: quality?.longUnsupportedStraightBoundaryRatio ?? null,
    longestUnsupportedStraightChainMeters: quality?.longestUnsupportedStraightChainMeters ?? null,
    longestUnsupportedStraightChain: quality?.longestUnsupportedStraightChain ?? null,
    longestUnsupportedStraightNormalized: quality
      ? quality.longestUnsupportedStraightNormalized
      : null,
    networkFaceCountRaw: quality?.networkFaceCountRaw ?? null,
    networkAttemptDiagnostics:
      networkCandidate?.networkConstruction ?? quality?.networkConstruction ?? null,
    networkConstructionSucceeded:
      networkCandidate?.networkConstruction?.constructionStatus === "constructed",
    networkCandidateQualityAccepted: networkCandidate?.accepted ?? false,
    networkCandidateLargestTerritoryAreaShare: networkCandidate?.largestTerritoryAreaShare ?? null,
    networkCandidateEffectivePartitionCount: networkCandidate?.effectivePartitionCount ?? null,
    networkCandidateMinimumUsefulTerritoryCount:
      networkCandidate?.minimumUsefulTerritoryCount ?? null,
    networkFaceCountAfterFiltering: quality?.networkFaceCountAfterFiltering ?? null,
    networkFaceCoveragePercent: quality?.networkFaceCoveragePercent ?? null,
    networkDerivedTerritoryCount: quality?.networkDerivedTerritoryCount ?? null,
    networkBoundaryUsageRatio: quality?.networkBoundaryUsageRatio ?? null,
    residualAreaPercent: quality?.residualAreaPercent ?? null,
    residualOrganicTerritoryCount: quality?.residualOrganicTerritoryCount ?? null,
    largestResidualTerritoryAreaShare: quality?.largestResidualTerritoryAreaShare ?? null,
    effectiveResidualPartitionCount: quality?.effectiveResidualPartitionCount ?? null,
    minimumUsefulResidualTerritoryCount: quality?.minimumUsefulResidualTerritoryCount ?? null,
    residualPartitionAdequacy: quality?.residualPartitionAdequacy ?? null,
    strongBarrierEdgeRetentionRatio: quality?.strongBarrierEdgeRetentionRatio ?? null,
    weakBarrierMergeCount: quality?.weakBarrierMergeCount ?? null,
    candidateComparisons: result?.smartFallbackResult?.candidateComparisons ?? [],
    meanQuality: quality?.meanQualityScore ?? null,
    confidence: quality?.confidenceTier ?? null,
    acceptanceStatus:
      quality?.acceptanceStatus ?? (result?.quality.ok ? "USABLE_REAL_SOURCE" : "HARD_REJECT"),
    hardGateFailures: quality?.hardGateFailures ?? [],
    syntheticConnectorEvidence: quality?.syntheticConnectorEvidence ?? null,
    reasonCodes: result?.issues.map((i) => i.code) ?? [],
    gates: result?.quality.gates ?? {},
    smartGates: quality?.gates ?? {},
    qualityAccepted: result?.quality.ok ?? false,
    approvedSourcePreservation: result?.quality.gates.approvedSourcePreservation ?? false,
    error: error ?? null,
    generationFailureReason:
      result?.issues.find((issue) => issue.code === "TR_V2_HYBRID_GENERATION_FAILED")?.details
        ?.reason ?? null,
    durationMs,
    visualQA: "NOT REVIEWED"
  };
  results.push(row);
  await fs.writeFile(path.join(root, `${slug}.json`), JSON.stringify(row));
  if (result) {
    const map = {
      district: district.name,
      parent: district.geometry,
      official: result.effective.official.map((z) => z.geometry),
      osm: result.effective.osm.map((z) => z.geometry),
      zones: result.effective.generated.map((z) => z.geometry),
      roads: generated.smartFallback?.roads,
      rail: generated.smartFallback?.railways,
      water: generated.smartFallback?.water,
      parks: generated.smartFallback?.parks,
      seeds: generated.smartFallback?.localitySeeds
    };
    await fs.writeFile(path.join(root, `${slug}-map.json`), JSON.stringify(map));
  }
  console.log(
    `${index + 1}/${selectedDistricts.length} ${district.name}: ${result?.quality.ok ? "PASS" : "FAIL"} ${durationMs}ms`
  );
  await fs.writeFile(
    path.join(root, "progress.json"),
    JSON.stringify({
      count: results.length,
      results,
      durationMs: Math.round(performance.now() - started)
    })
  );
}
const report = {
  schemaVersion: "territorykit-istanbul-39-qa@1",
  sourceDataset: "datasets/generated/countries/TR/dataset.json",
  algorithmVersion: TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
  canonicalDistrictCount: districts.length,
  processedDistrictCount: results.length,
  durationMs: Math.round(performance.now() - started),
  peakRssBytes,
  results
};
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
