import { createHash } from "node:crypto";
import {
  computeGeometryCenter,
  validateGeometryDataset
} from "../../packages/dataset/dist/index.mjs";
import { createDatasetGeometryHash } from "../../packages/generators/dist/turkey-adm3.mjs";
import {
  adm1LookupRefFromProvinceCode,
  adm2ParentGeometryIsUsable,
  metadata,
  parentId
} from "../tr-adm3-quality-source-audit.mjs";

export const SCHEMA = "territorykit-tr-national-quality-closeout@1";
export const EXPECTED_ADM1 = 81;
export const EXPECTED_ADM2 = 973;
export const BASELINE_PATH = "reports/baselines/sprint-6-national-rc7.json";

export const EVIDENCE = {
  REAL_ARTIFACT_VERIFIED: "REAL_ARTIFACT_VERIFIED",
  HISTORICAL_RECORDED: "HISTORICAL_RECORDED",
  FIXTURE_TESTED: "FIXTURE_TESTED",
  NOT_ASSESSED: "NOT_ASSESSED",
  BLOCKED_BY_MISSING_ARTIFACT: "BLOCKED_BY_MISSING_ARTIFACT",
  BLOCKED_BY_SOURCE: "BLOCKED_BY_SOURCE",
  BLOCKED_BY_AUTHORIZATION: "BLOCKED_BY_AUTHORIZATION"
};

export const QUALITY_STATUS = {
  PASS: "PASS",
  PASS_ESTIMATED_WITH_DISCLOSURE: "PASS_ESTIMATED_WITH_DISCLOSURE",
  WARNING_REVIEW_REQUIRED: "WARNING_REVIEW_REQUIRED",
  BLOCKED_BY_SOURCE: "BLOCKED_BY_SOURCE",
  BLOCKED_BY_GEOMETRY: "BLOCKED_BY_GEOMETRY",
  BLOCKED_BY_AUTHORIZATION: "BLOCKED_BY_AUTHORIZATION",
  NOT_ASSESSED: "NOT_ASSESSED"
};

const LOW_CONFIDENCE_ROOT_CAUSES = [
  {
    code: "NO_ROUTE",
    match: (d) => d.reasonCodes?.includes("TR_V2_HYBRID_SMART_FALLBACK_NO_ROUTE")
  },
  {
    code: "INSUFFICIENT_BARRIER",
    match: (d) =>
      d.hardGateFailures?.includes("barrierSufficiency") ||
      d.qualityGates?.barrierSufficiency === false
  },
  {
    code: "DISCONNECTED_ROAD_GRAPH",
    match: (d) => d.reasonCodes?.some((c) => c.includes("NETWORK") && c.includes("DISCONNECT"))
  },
  {
    code: "LONG_SYNTHETIC_BOUNDARY",
    match: (d) => (d.syntheticBoundaryRatio ?? 0) > 0.35 || (d.unsupportedStraightRatio ?? 0) > 0.2
  },
  {
    code: "INSUFFICIENT_SEED",
    match: (d) =>
      d.hardGateFailures?.includes("inputSufficiency") || d.qualityGates?.inputSufficiency === false
  },
  {
    code: "GEOGRAPHIC_REALISM_REJECTED",
    match: (d) =>
      d.reasonCodes?.includes("TR_V2_HYBRID_SMART_FALLBACK_GEOGRAPHIC_REALISM_REJECTED") ||
      d.qualityGates?.geographicRealism === false
  },
  {
    code: "OFFICIAL_SOURCE_UNAVAILABLE",
    match: (d) => d.reasonCodes?.includes("TR_V2_HYBRID_OFFICIAL_ADM3_UNAVAILABLE")
  },
  {
    code: "OSM_ADMIN_UNAVAILABLE",
    match: (d) => d.reasonCodes?.includes("TR_V2_HYBRID_OSM_ADMIN_BOUNDARY_UNAVAILABLE")
  }
];

export function classifyLowConfidenceRootCauses(smartRow) {
  if (!smartRow) return ["NOT_ASSESSED"];
  const hits = LOW_CONFIDENCE_ROOT_CAUSES.filter((rule) => rule.match(smartRow)).map((r) => r.code);
  if (hits.length) return hits;
  if (smartRow.confidence === "low") return ["LOW_CONFIDENCE_UNCLASSIFIED"];
  return [];
}

export function deriveDistrictQualityStatus({
  coverageRow,
  smartRow,
  geometrySummary,
  artifactAvailable
}) {
  if (!artifactAvailable) return QUALITY_STATUS.NOT_ASSESSED;
  if (geometrySummary?.errorCount > 0) return QUALITY_STATUS.BLOCKED_BY_GEOMETRY;
  if (coverageRow?.reasonCode === "ARTIFACT_NOT_AVAILABLE") return QUALITY_STATUS.NOT_ASSESSED;

  const hasGenerated = (coverageRow?.generatedFeatureCount ?? 0) > 0;
  const hasOfficial = (coverageRow?.officialFeatureCount ?? 0) > 0;
  const confidence = smartRow?.confidence ?? coverageRow?.confidence;

  if (smartRow?.smartAcceptanceStatus === "HARD_REJECT") return QUALITY_STATUS.BLOCKED_BY_GEOMETRY;

  if (confidence === "low" || smartRow?.qualityGates?.geographicRealism === false) {
    return QUALITY_STATUS.WARNING_REVIEW_REQUIRED;
  }

  if (hasGenerated && !hasOfficial) {
    return confidence === "high" || confidence === "medium"
      ? QUALITY_STATUS.PASS_ESTIMATED_WITH_DISCLOSURE
      : QUALITY_STATUS.WARNING_REVIEW_REQUIRED;
  }

  if (hasOfficial) {
    return QUALITY_STATUS.PASS_ESTIMATED_WITH_DISCLOSURE;
  }

  return QUALITY_STATUS.PASS;
}

export function summarizeGeometryReport(report) {
  const issues = report?.issues ?? [];
  const errors = issues.filter((i) => i.severity === "error");
  return {
    ok: report?.ok ?? false,
    errorCount: errors.length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
    issueCodes: [...new Set(issues.map((i) => i.code))].sort(),
    errorIssues: errors.slice(0, 12).map((issue) => ({
      code: issue.code,
      zoneId: issue.zoneId ?? issue.featureId ?? null,
      otherZoneId: issue.otherZoneId ?? null,
      message: issue.message ?? null
    }))
  };
}

/** rc.7 ADM2 zones omit top-level parentId; parent is provinceCode → ADM1 lookup ref. */
export function resolveAdm2ParentAdm1Id(zone) {
  const territory = metadata(zone);
  const explicit = zone.parentId ?? territory.parentId ?? territory.parentAdm1Id;
  if (explicit) return explicit;
  const rawProvince = territory.provinceCode ?? zone.provinceCode;
  if (rawProvince == null || rawProvince === "") return null;
  const provinceCode = String(rawProvince).padStart(2, "0").slice(-2);
  return adm1LookupRefFromProvinceCode(provinceCode);
}

export function buildQualityMetricsSummary(matrix) {
  const lowConfidenceDistrictCount = matrix.filter((row) => row.confidence === "low").length;
  const warningReviewDistrictCount = matrix.filter(
    (row) => row.qualityStatus === QUALITY_STATUS.WARNING_REVIEW_REQUIRED
  ).length;
  const geometryBlockedDistrictCount = matrix.filter(
    (row) => row.qualityStatus === QUALITY_STATUS.BLOCKED_BY_GEOMETRY
  ).length;
  const lowConfidenceExcludingGeometryBlocked = matrix.filter(
    (row) => row.confidence === "low" && row.qualityStatus !== QUALITY_STATUS.BLOCKED_BY_GEOMETRY
  ).length;
  return {
    lowConfidenceDistrictCount,
    warningReviewDistrictCount,
    geometryBlockedDistrictCount,
    lowConfidenceExcludingGeometryBlocked,
    metricsRelationship:
      "lowConfidenceDistrictCount is the smart/coverage confidence field (631 on rc.7). warningReviewDistrictCount is the closeout qualityStatus WARNING_REVIEW_REQUIRED (628). geometryBlockedDistrictCount uses BLOCKED_BY_GEOMETRY (3); those districts remain low-confidence in source metrics but are not counted in warningReviewDistrictCount."
  };
}

export function assessNationalQaCloseout({ artifactExists, matrix, adm2Validation }) {
  const failures = [];
  if (!artifactExists) failures.push("BLOCKED_BY_MISSING_ARTIFACT");
  if (matrix.length !== EXPECTED_ADM2) {
    failures.push(`DISTRICT_ROW_COUNT_${matrix.length}`);
  }
  if (
    adm2Validation?.adm2ParentLinkageOk === false ||
    (adm2Validation?.orphanParentCount ?? 0) > 0
  ) {
    failures.push("ADM2_PARENT_LINKAGE");
  }
  return {
    ok: failures.length === 0,
    failures,
    nationalQaCloseoutVerdict: failures.length === 0 ? "CONDITIONAL_GO" : "NO_GO"
  };
}

export function validateDistrictGeometry({ district, zones, manifest }) {
  const report = validateGeometryDataset(
    {
      manifest,
      zones: [district, ...zones.map((z) => ({ ...z, parentId: district.id }))]
    },
    { checks: "full", epsilon: 1e-9, allowHoleBoundaryTouch: true }
  );
  return summarizeGeometryReport(report);
}

export function validateAdm2Layer({ adm1, adm2, manifest }) {
  const adm1Zones = adm1?.zones ?? [];
  const adm2Zones = adm2?.zones ?? [];
  const adm1IdSet = new Set(adm1Zones.map((zone) => zone.id));
  const adm2ByParent = new Map();
  for (const zone of adm2Zones) {
    const resolvedParentId = resolveAdm2ParentAdm1Id(zone);
    const list = adm2ByParent.get(resolvedParentId) ?? [];
    list.push(zone);
    adm2ByParent.set(resolvedParentId, list);
  }
  const invalidPolygons = adm2Zones.filter((z) => !adm2ParentGeometryIsUsable(z));
  const parentMismatches = adm2Zones.filter((z) => {
    const resolvedParentId = resolveAdm2ParentAdm1Id(z);
    return !resolvedParentId || !adm1IdSet.has(resolvedParentId);
  });
  const rawParentIdOrphans = adm2Zones.filter((z) => {
    const parent = adm1Zones.find((p) => p.id === z.parentId);
    return !parent;
  });
  const siblingReport = validateGeometryDataset(
    {
      manifest: manifest ?? adm2.manifest,
      zones: [...adm1Zones, ...adm2Zones]
    },
    { checks: { siblingOverlaps: true, coordinates: true, rings: true, selfIntersections: true } }
  );
  const siblingSummary = summarizeGeometryReport(siblingReport);
  return {
    adm1Count: adm1Zones.length,
    adm2Count: adm2Zones.length,
    adm1Expected: EXPECTED_ADM1,
    adm2Expected: EXPECTED_ADM2,
    adm1Complete: adm1Zones.length === EXPECTED_ADM1,
    adm2Complete: adm2Zones.length === EXPECTED_ADM2,
    invalidAdm2PolygonCount: invalidPolygons.length,
    invalidAdm2Ids: invalidPolygons.map((z) => z.id).slice(0, 20),
    orphanParentCount: parentMismatches.length,
    rawParentIdFieldOrphanCount: rawParentIdOrphans.length,
    parentLinkageMethod: "provinceCode_to_adm1_lookup_ref",
    adm2ParentLinkageOk: parentMismatches.length === 0,
    adm2GeometryHash: adm2 ? createDatasetGeometryHash(adm2) : null,
    declaredAdm2GeometryHash: adm2?.manifest?.geometryHash ?? null,
    siblingOverlapSummary: siblingSummary,
    evidenceClass:
      adm2Zones.length === EXPECTED_ADM2 ? EVIDENCE.REAL_ARTIFACT_VERIFIED : EVIDENCE.NOT_ASSESSED
  };
}

export function buildDistrictQualityMatrix({
  coverageDistricts,
  smartByAdm2,
  geometryByAdm2,
  artifactAvailable
}) {
  return coverageDistricts.map((row) => {
    const smart = smartByAdm2.get(row.adm2Id);
    const geometrySummary = geometryByAdm2?.get(row.adm2Id) ?? null;
    const qualityStatus = deriveDistrictQualityStatus({
      coverageRow: row,
      smartRow: smart,
      geometrySummary,
      artifactAvailable
    });
    return {
      provinceCode: row.provinceCode,
      provinceName: row.provinceName,
      adm1ParentId: row.provinceCode ? `tr:adm1:tr-${row.provinceCode}` : null,
      adm2Id: row.adm2Id,
      districtName: row.districtName,
      adm3ZoneCount:
        (row.officialFeatureCount ?? 0) +
        (row.osmAdministrativeFeatureCount ?? 0) +
        (row.generatedFeatureCount ?? 0) +
        (row.unknownSourceFeatureCount ?? 0),
      officialPolygonCount: row.officialFeatureCount,
      osmAdministrativePolygonCount: row.osmAdministrativeFeatureCount,
      smartDerivedPolygonCount: row.generatedFeatureCount,
      sourceClassSummary: {
        official: row.officialFeatureCount ?? 0,
        osmAdministrative: row.osmAdministrativeFeatureCount ?? 0,
        generated: row.generatedFeatureCount ?? 0
      },
      sourceVersions: row.sourceVersion,
      confidence: row.confidence,
      geometryQualityScore:
        smart?.qualityGates?.qualityScore === true ? "PASS" : smart ? "RECORDED" : null,
      coveragePercentEstimated: row.estimatedAreaPercent,
      coveragePercentOfficial: row.officialAreaPercent,
      parentContainmentStatus: geometrySummary?.errorCount
        ? "GEOMETRY_ERRORS"
        : geometrySummary
          ? "PASS"
          : "NOT_RERUN",
      overlapGapStatus:
        smart?.qualityGates?.effectiveSiblingOverlap === false ? "OVERLAP" : "RECORDED_PASS",
      qualityStatus,
      reasonCode: row.reasonCode,
      lowConfidenceRootCauses: classifyLowConfidenceRootCauses(smart),
      recordedReasonCodes: row.recordedReasonCodes ?? smart?.reasonCodes ?? [],
      ...(geometrySummary?.errorIssues?.length
        ? { geometryErrorIssues: geometrySummary.errorIssues }
        : {}),
      blocker:
        qualityStatus === QUALITY_STATUS.BLOCKED_BY_GEOMETRY
          ? "GEOMETRY_VALIDATION"
          : row.reasonCode === "ARTIFACT_NOT_AVAILABLE"
            ? "MISSING_ARTIFACT"
            : null,
      evidenceStatus: artifactAvailable
        ? EVIDENCE.REAL_ARTIFACT_VERIFIED
        : EVIDENCE.BLOCKED_BY_MISSING_ARTIFACT
    };
  });
}

export function buildProvinceSummary(matrix) {
  const byProvince = new Map();
  for (const row of matrix) {
    const key = row.provinceCode ?? "unknown";
    const bucket = byProvince.get(key) ?? {
      provinceCode: row.provinceCode,
      provinceName: row.provinceName,
      districtCount: 0,
      adm3ZoneCount: 0,
      officialPolygonCount: 0,
      smartDerivedPolygonCount: 0,
      lowConfidenceDistricts: 0,
      warningDistricts: 0,
      blockedDistricts: 0
    };
    bucket.districtCount++;
    bucket.adm3ZoneCount += row.adm3ZoneCount;
    bucket.officialPolygonCount += row.officialPolygonCount ?? 0;
    bucket.smartDerivedPolygonCount += row.smartDerivedPolygonCount ?? 0;
    if (row.confidence === "low") bucket.lowConfidenceDistricts++;
    if (row.qualityStatus === QUALITY_STATUS.WARNING_REVIEW_REQUIRED) bucket.warningDistricts++;
    if (row.qualityStatus === QUALITY_STATUS.BLOCKED_BY_GEOMETRY) bucket.blockedDistricts++;
    byProvince.set(key, bucket);
  }
  return [...byProvince.values()].sort((a, b) =>
    String(a.provinceCode).localeCompare(String(b.provinceCode))
  );
}

export function buildNationalInventory({
  coverageReport,
  matrix,
  adm2Validation,
  artifactClassification
}) {
  return {
    schemaVersion: SCHEMA,
    artifactClassification,
    datasetVersion: coverageReport?.datasetVersion ?? null,
    geometryHash: coverageReport?.geometryHash ?? null,
    parentInventorySource: coverageReport?.parentInventorySource ?? null,
    parentGeometryAvailable: coverageReport?.parentGeometryAvailable ?? false,
    districtCount: matrix.length,
    expectedDistrictCount: EXPECTED_ADM2,
    completeDistrictCoverage: matrix.length === EXPECTED_ADM2,
    adm1Count: adm2Validation.adm1Count,
    adm2Count: adm2Validation.adm2Count,
    totals: coverageReport?.totals ?? null,
    measuredAreaPercent: coverageReport?.measuredAreaPercent ?? null,
    districts: matrix
  };
}

export function buildSourceAvailabilityMatrix(sourceInventory, providerRegistry) {
  const providersByProvince = new Map();
  for (const entry of providerRegistry?.provinces ?? providerRegistry?.entries ?? []) {
    const code = entry.provinceCode ?? entry.code;
    if (code) providersByProvince.set(code, entry);
  }
  return (sourceInventory?.provinces ?? []).map((province) => {
    const registry = providersByProvince.get(province.provinceCode);
    return {
      provinceCode: province.provinceCode,
      provinceName: province.provinceName,
      inventoryStatus: province.status,
      license: province.license,
      redistributionPermission: province.redistributionPermission,
      provider: province.provider,
      registryProviderId: registry?.providerId ?? registry?.id ?? null,
      registryStatus: registry?.status ?? null,
      evidenceClass:
        province.status === "approved" || province.status === "production"
          ? EVIDENCE.REAL_ARTIFACT_VERIFIED
          : province.status === "requires-authority-request"
            ? EVIDENCE.BLOCKED_BY_AUTHORIZATION
            : EVIDENCE.HISTORICAL_RECORDED
    };
  });
}

export function buildNeighborhoodIdentityAudit({ officialFidelity, adm3Zones }) {
  if (!officialFidelity) {
    return {
      evidenceClass: EVIDENCE.NOT_ASSESSED,
      scope: "Official fidelity report unavailable; no neighborhood identity crosswalk performed.",
      provinces: []
    };
  }
  const effectiveOfficial = adm3Zones.filter((z) => metadata(z).sourceClass === "official");
  const byProvince = new Map();
  for (const source of officialFidelity.sources ?? []) {
    byProvince.set(source.provinceCode, {
      provinceCode: source.provinceCode,
      providerId: source.providerId,
      parseIssues: source.parseIssues,
      importedCount: source.importedCount,
      effectiveCount: source.effectiveCount,
      duplicatedEffectiveNativeIds: source.duplicatedEffectiveNativeIds ?? [],
      missingEffectiveNativeIds: source.missingEffectiveNativeIds ?? [],
      bundleEvidenceStatus: source.evidence?.status ?? null
    });
  }
  return {
    evidenceClass: EVIDENCE.REAL_ARTIFACT_VERIFIED,
    scope:
      "Compares official import cohort to effective rc.7 polygons for licensed provinces only; ADM3 zones are gameplay regions, not legal mahalle census.",
    effectiveOfficialZoneCount: effectiveOfficial.length,
    rawToEffectiveGeometryChanges: officialFidelity.rawToEffectiveParsedGeometryChanges ?? null,
    parentCorrections: officialFidelity.parentCorrections?.length ?? 0,
    provinces: [...byProvince.values()]
  };
}

export function resolveBaselineAdm3GeometryHash(baseline, baselineClaims) {
  if (baseline?.adm3GeometryHash) return baseline.adm3GeometryHash;
  const claim = baselineClaims?.claims?.find((c) => c.adm3GeometryHash)?.adm3GeometryHash;
  return claim ?? null;
}

export function buildBaselineComparison({
  baseline,
  baselineClaims,
  coverageReport,
  smartTotals,
  matrix
}) {
  const lowNow = matrix.filter((r) => r.confidence === "low").length;
  const realismWarnings =
    smartTotals?.softGeographicRealismWarnings ?? baseline?.quality?.softGeographicRealismWarnings;
  const baselineAdm3Hash = resolveBaselineAdm3GeometryHash(baseline, baselineClaims);
  const observedAdm3Hash =
    coverageReport?.declaredGeometryHash ?? coverageReport?.geometryHash ?? null;
  return {
    baselinePath: BASELINE_PATH,
    evidenceClass: baseline ? EVIDENCE.HISTORICAL_RECORDED : EVIDENCE.NOT_ASSESSED,
    candidateEvidenceClass:
      coverageReport?.fileEvidence?.status === "LOCKED_BYTES_VERIFIED"
        ? EVIDENCE.REAL_ARTIFACT_VERIFIED
        : EVIDENCE.BLOCKED_BY_MISSING_ARTIFACT,
    metrics: [
      {
        metric: "adm3Zones",
        baseline: baseline?.adm3Zones ?? null,
        observed: coverageReport?.totals
          ? Object.values(coverageReport.totals).reduce((a, b) => a + b, 0)
          : null
      },
      {
        metric: "officialZones",
        baseline: baseline?.sourceClassZones?.official ?? null,
        observed: coverageReport?.totals?.officialFeatureCount ?? null
      },
      {
        metric: "generatedZones",
        baseline: baseline?.sourceClassZones?.generated ?? null,
        observed: coverageReport?.totals?.generatedFeatureCount ?? null
      },
      {
        metric: "lowConfidenceDistricts",
        baseline: baseline?.confidenceDistricts?.low ?? null,
        observed: lowNow
      },
      {
        metric: "softGeographicRealismWarnings",
        baseline: baseline?.quality?.softGeographicRealismWarnings ?? null,
        observed: realismWarnings ?? null,
        note: "Recorded smart-coverage diagnostics; not regenerated in closeout unless national rebuild runs."
      },
      {
        metric: "adm3GeometryHash",
        baseline: baselineAdm3Hash,
        observed: observedAdm3Hash,
        unchanged: Boolean(baselineAdm3Hash && baselineAdm3Hash === observedAdm3Hash)
      },
      {
        metric: "fullDatasetGeometryHash",
        baseline: baseline?.geometryHash ?? null,
        observed: null,
        note: "National combined hash; compare via candidate dataset.json when needed."
      }
    ],
    newCandidateBuilt: false,
    newCandidateVersion: null,
    sprint108CodeMergedAfterRc7Build:
      "Istanbul geometry fixes (#108) are on main but rc.7 bytes predate merge; national rebuild required for geometry delta."
  };
}

export function buildReplacementMap({ baseline, baselineClaims, coverageReport, adm3ZoneCount }) {
  const baselineAdm3Hash = resolveBaselineAdm3GeometryHash(baseline, baselineClaims);
  const observedAdm3Hash =
    coverageReport?.declaredGeometryHash ?? coverageReport?.geometryHash ?? null;
  const unchanged = Boolean(baselineAdm3Hash && baselineAdm3Hash === observedAdm3Hash);
  if (!observedAdm3Hash) {
    return {
      evidenceClass: EVIDENCE.BLOCKED_BY_MISSING_ARTIFACT,
      entryCount: 0,
      entries: [],
      migrationEligibility: "NOT_ASSESSED"
    };
  }
  if (unchanged) {
    return {
      evidenceClass: EVIDENCE.REAL_ARTIFACT_VERIFIED,
      baselineAdm3GeometryHash: baselineAdm3Hash,
      observedAdm3GeometryHash: observedAdm3Hash,
      entryCount: adm3ZoneCount,
      entries: [],
      summary: {
        matchType: "IDENTITY_ALL",
        matchConfidence: 1,
        parentChangeCount: 0,
        geometryChangeCount: 0,
        sourceChangeCount: 0,
        deletedTerritoryCount: 0,
        newTerritoryCount: 0
      },
      migrationEligibility: "DRY_RUN_IDENTITY",
      requiredReview: false,
      reasonCode: "RC7_BASELINE_UNCHANGED",
      note: "Per-zone rows omitted when geometry hash unchanged; expand via dataset diff when a new candidate exists."
    };
  }
  return {
    evidenceClass: EVIDENCE.NOT_ASSESSED,
    baselineAdm3GeometryHash: baselineAdm3Hash,
    observedAdm3GeometryHash: observedAdm3Hash,
    entryCount: 0,
    entries: [],
    migrationEligibility: "BLOCKED_PENDING_NEW_CANDIDATE",
    requiredReview: true,
    reasonCode: "GEOMETRY_HASH_DELTA",
    note: "Run territory tr v2 national source-diff / migration-plan when new candidate bytes exist."
  };
}

export function buildBlockers({ matrix, sourceMatrix, humanGates, kadikoyPilot, qualityMetrics }) {
  const blockers = [];
  const gateItems = humanGates?.items ?? humanGates?.gates ?? [];
  for (const gate of gateItems) {
    if (gate.status !== "APPROVED" && gate.status !== "ACCEPTED") {
      blockers.push({
        kind: "AUTHORIZATION",
        code: gate.id ?? gate.topic,
        status: gate.status,
        summary: gate.summary ?? null,
        evidenceClass: EVIDENCE.BLOCKED_BY_AUTHORIZATION
      });
    }
  }
  const kadikoy = kadikoyPilot?.kadikoyOfficialPilot ?? kadikoyPilot;
  if (
    kadikoy?.pilotStatus === "BLOCKED_BY_SOURCE" ||
    kadikoy?.bundle?.productionEligibility === "NOT_ELIGIBLE" ||
    kadikoy?.bundle?.structuralStatus === "STRUCTURALLY_INVALID"
  ) {
    blockers.push({
      kind: "SOURCE",
      code: "KADIKOY_SHP_BUNDLE_INVALID",
      status: kadikoy.pilotStatus ?? kadikoy.bundle?.status ?? "BLOCKED_BY_SOURCE",
      bundleStatus: kadikoy.bundle?.status ?? null,
      reasonCodes: kadikoy.bundle?.reasonCodes ?? [],
      evidenceClass: EVIDENCE.BLOCKED_BY_SOURCE
    });
  }
  const sourceBlockedProvinces = sourceMatrix.filter(
    (p) => p.inventoryStatus === "requires-authority-request" || p.inventoryStatus === "blocked"
  ).length;
  blockers.push({
    kind: "SOURCE_COVERAGE",
    code: "PROVINCES_WITHOUT_REDISTRIBUTABLE_ADM3",
    count: sourceBlockedProvinces,
    evidenceClass: EVIDENCE.HISTORICAL_RECORDED
  });
  const metrics = qualityMetrics ?? buildQualityMetricsSummary(matrix);
  blockers.push({
    kind: "LOW_CONFIDENCE",
    code: "SMART_LOW_CONFIDENCE_DISTRICTS",
    count: metrics.lowConfidenceDistrictCount,
    note: "Recorded smart/coverage metric; not remediated in this PR (no rc.8 rebuild).",
    evidenceClass: EVIDENCE.REAL_ARTIFACT_VERIFIED
  });
  blockers.push({
    kind: "QUALITY_WARNING",
    code: "WARNING_REVIEW_REQUIRED_DISTRICTS",
    count: metrics.warningReviewDistrictCount,
    note: "Closeout qualityStatus WARNING_REVIEW_REQUIRED (excludes geometry-blocked districts).",
    evidenceClass: EVIDENCE.REAL_ARTIFACT_VERIFIED
  });
  const geometryBlocked = matrix.filter(
    (r) => r.qualityStatus === QUALITY_STATUS.BLOCKED_BY_GEOMETRY
  );
  if (geometryBlocked.length) {
    blockers.push({
      kind: "GEOMETRY",
      code: "DISTRICT_GEOMETRY_VALIDATION_ERRORS",
      count: geometryBlocked.length,
      districts: geometryBlocked.map((r) => ({
        adm2Id: r.adm2Id,
        districtName: r.districtName,
        provinceCode: r.provinceCode,
        issueCodes: r.geometryErrorIssues?.map((i) => i.code) ?? [],
        errorIssues: r.geometryErrorIssues ?? []
      })),
      evidenceClass: EVIDENCE.REAL_ARTIFACT_VERIFIED
    });
  }
  return { blockers, qualityMetrics: metrics, generatedAt: new Date().toISOString() };
}

export function buildMapIndexPayload({ matrix, adm1Zones, adm2Zones }) {
  const adm1Features = (adm1Zones ?? []).map((zone) => ({
    type: "Feature",
    properties: {
      territoryId: zone.id,
      name: zone.name,
      level: 1
    },
    geometry: zone.geometry
  }));
  const colorFor = (row) => {
    if (row.qualityStatus === QUALITY_STATUS.BLOCKED_BY_GEOMETRY) return "blocked";
    if (row.confidence === "low") return "low-confidence";
    if ((row.officialPolygonCount ?? 0) > 0) return "official";
    if ((row.osmAdministrativePolygonCount ?? 0) > 0) return "osm";
    return "smart-derived";
  };
  const adm2Features = matrix.map((row) => {
    const district = adm2Zones?.find((z) => z.id === row.adm2Id);
    const center = district?.geometry ? computeGeometryCenter(district.geometry) : null;
    return {
      type: "Feature",
      properties: {
        territoryId: row.adm2Id,
        parentAdm2Id: row.adm2Id,
        name: row.districtName,
        provinceCode: row.provinceCode,
        sourceClass: colorFor(row),
        confidence: row.confidence,
        qualityStatus: row.qualityStatus,
        reasonCode: row.reasonCode
      },
      geometry: center ? { type: "Point", coordinates: center } : null
    };
  });
  return {
    type: "FeatureCollection",
    mapKind: "ADM2_QUALITY_INDEX",
    mapScope:
      "ADM1 province polygons (context) and ADM2 district centroids colored by source/confidence. Not an ADM3 mahalle boundary map.",
    adm3PolygonVisualization: "NOT_INCLUDED",
    adm3PolygonVisualizationBlocker:
      "ADM3 full-national polygon layer omitted (payload size and scope); use district matrix and rc.7 candidate for zone geometry.",
    features: [...adm1Features, ...adm2Features.filter((f) => f.geometry)]
  };
}

export function stableReportHash(record) {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}
