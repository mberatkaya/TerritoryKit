/**
 * Sprint 2 final geospatial closeout — per-polygon QA, research dataset, and product decisions.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateGeometryDataset } from "../../packages/dataset/dist/index.mjs";
import {
  computeTurkeyAdm3GeometryAreaKm2,
  createTurkeyAdm3GeometryHash,
  inspectTurkeyAdm3SpatialQuality,
  TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION
} from "../../packages/generators/dist/turkey-adm3.mjs";
import {
  assessDistrictGeometryQa,
  buildMapPreviewGeoJson,
  loadRc8DistrictContext,
  orderedIstanbulPilots
} from "./tr-sprint-2g-geometry-validation.mjs";
import { pilotBySlug } from "./tr-mahalle-identity-istanbul-pilots.mjs";
import {
  buildPolygonTechnicalQa,
  buildRecoveredPolygonsReport,
  extractAllPilotDistricts,
  rollupGeometryQaCounts,
  SPRINT_2H_EXTRACT_IMPLEMENTATION_REVISION,
  verifyOriginalSourceIntegrity
} from "./tr-sprint-2h-osm-relation-recovery.mjs";

export const SPRINT_2_FINAL_REPORT_ROOT = "reports/tr-adm3/sprint-2-final-closeout";
export const EXPECTED_OSM_RESEARCH_CANDIDATE_COUNT = 228;
export const PINNED_SOURCE_PBF_SHA256 =
  "5ec68ce5e0b2be55b2c34ee7cd1ff91b6b3d8db8acab5a6be2fa7beb633eaedc";
export const PINNED_SOURCE_SNAPSHOT_DATE = "2026-08-27T20:21:06.000Z";

const PARENT_OUTSIDE_TOLERANCE_KM2 = 0.000001;
const REPRESENTATIVE_PILOT_SLUGS = ["kadikoy", "fatih", "adalar"];

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

function normalizeTrName(value) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKC")
    .trim();
}

function km2ToM2(km2) {
  return typeof km2 === "number" ? km2 * 1_000_000 : null;
}

function round6(value) {
  return typeof value === "number" ? Number(value.toFixed(6)) : null;
}

export function classifyPolygonDisposition({
  ringAssessed,
  ringOk,
  provenanceComplete,
  parentContainmentExceeds,
  involvedInSiblingOverlap,
  identityAmbiguous,
  missingName,
  unexpectedAdminLevel
}) {
  if (!ringAssessed) {
    return "NOT_ASSESSED";
  }
  if (!provenanceComplete) {
    return "SOURCE_INCOMPLETE";
  }
  if (!ringOk) {
    return "INVALID_GEOMETRY";
  }
  if (parentContainmentExceeds || involvedInSiblingOverlap) {
    return "SPATIAL_CONFLICT_REVIEW_REQUIRED";
  }
  if (identityAmbiguous || missingName || unexpectedAdminLevel) {
    return "IDENTITY_AMBIGUOUS";
  }
  return "TECHNICALLY_VALID_REVIEW_REQUIRED";
}

function provenanceRecordComplete(provenance, zone) {
  const territory = zone.properties?.territory ?? {};
  return Boolean(
    provenance?.sourcePbfSha256 &&
    provenance?.derivedClipSha256 &&
    provenance?.derivedClipRel &&
    (territory.osmId ?? territory.sourceNativeId) &&
    zone.parentId
  );
}

function buildOverlapIndex(spatialQuality) {
  const byZone = new Map();
  for (const overlap of spatialQuality?.overlaps ?? []) {
    for (const zoneId of [overlap.leftZoneId, overlap.rightZoneId]) {
      const rows = byZone.get(zoneId) ?? [];
      rows.push(overlap);
      byZone.set(zoneId, rows);
    }
  }
  return byZone;
}

function buildParentContainmentIndex(spatialQuality) {
  const byZone = new Map();
  for (const row of spatialQuality?.parentContainmentErrors ?? []) {
    byZone.set(row.zoneId, row);
  }
  return byZone;
}

export function assessSinglePolygonGeometry(zone, parent) {
  let ringValidation = null;
  try {
    ringValidation = validateGeometryDataset(
      { manifest: { datasetId: "tr-adm3-osm-research-closeout" }, zones: [zone] },
      {
        checks: {
          ringClosure: true,
          selfIntersections: true,
          duplicateVertices: true,
          parentContainment: false,
          siblingOverlaps: false
        }
      }
    );
  } catch {
    ringValidation = null;
  }

  const spatial =
    parent != null ? inspectTurkeyAdm3SpatialQuality({ districts: [parent], zones: [zone] }) : null;

  const parentRow = spatial?.parentContainmentErrors?.[0] ?? null;
  const outsideAreaKm2 = parentRow?.outsideAreaKm2 ?? 0;
  const zoneAreaKm2 = computeTurkeyAdm3GeometryAreaKm2(zone.geometry);
  const outsideRatio = zoneAreaKm2 > 0 ? outsideAreaKm2 / zoneAreaKm2 : null;

  return {
    ringValidationAssessed: ringValidation !== null,
    ringOk: ringValidation?.ok ?? null,
    ringIssueCodes: ringValidation
      ? [...new Set(ringValidation.issues.map((issue) => issue.code))].sort()
      : [],
    sliverCount: spatial?.slivers?.length ?? 0,
    parentContainmentExceeds: outsideAreaKm2 > PARENT_OUTSIDE_TOLERANCE_KM2,
    outsideParentAreaKm2: round6(outsideAreaKm2),
    outsideParentAreaM2: round6(km2ToM2(outsideAreaKm2)),
    outsideParentAreaRatio: round6(outsideRatio),
    disconnectedComponentNote:
      zone.geometry?.type === "MultiPolygon"
        ? `multipolygon-${zone.geometry.coordinates?.length ?? 0}-components`
        : "single-polygon"
  };
}

export function buildPolygonQaResults({
  zones,
  provenanceByZoneId,
  parentsById,
  districtSpatialByParentId
}) {
  const results = [];
  for (const zone of zones) {
    const provenance = provenanceByZoneId.get(zone.id) ?? {};
    const parent = parentsById.get(zone.parentId);
    const districtSpatial = districtSpatialByParentId.get(zone.parentId);
    const overlapIndex = buildOverlapIndex(districtSpatial);
    const containmentIndex = buildParentContainmentIndex(districtSpatial);

    const geometry = assessSinglePolygonGeometry(zone, parent);
    const territory = zone.properties?.territory ?? {};
    const osmTags = territory.osmTags ?? {};
    const overlapRows = overlapIndex.get(zone.id) ?? [];
    const containmentRow = containmentIndex.get(zone.id) ?? null;

    const disposition = classifyPolygonDisposition({
      ringAssessed: geometry.ringValidationAssessed,
      ringOk: geometry.ringOk,
      provenanceComplete: provenanceRecordComplete(provenance, zone),
      parentContainmentExceeds: geometry.parentContainmentExceeds,
      involvedInSiblingOverlap: overlapRows.length > 0,
      identityAmbiguous: false,
      missingName: !zone.name,
      unexpectedAdminLevel: osmTags.admin_level != null && String(osmTags.admin_level) !== "8"
    });

    results.push({
      osmCandidateId: zone.id,
      nativeOsmRelationId:
        territory.osmType === "relation" && typeof territory.osmId === "number"
          ? territory.osmId
          : null,
      parentAdm2Id: zone.parentId,
      pilotSlug: provenance.pilotSlug ?? null,
      pilotDistrict: provenance.pilotDistrict ?? null,
      disposition,
      humanSemanticApproval: {
        status: "unreviewed",
        official: false,
        productionEligible: false,
        autoDisplayNameAllowed: false,
        redistributionApproved: false
      },
      provenance: {
        sourcePbfSha256: provenance.sourcePbfSha256 ?? PINNED_SOURCE_PBF_SHA256,
        sourceSnapshotDate: provenance.sourceSnapshotDate ?? PINNED_SOURCE_SNAPSHOT_DATE,
        derivedClipRel: provenance.derivedClipRel ?? null,
        derivedClipSha256: provenance.derivedClipSha256 ?? null,
        extractionImplementationRevision: SPRINT_2H_EXTRACT_IMPLEMENTATION_REVISION,
        parserImplementationRevision:
          provenance.parserImplementationRevision ?? TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION,
        geometryHash: territory.geometryHash ?? createTurkeyAdm3GeometryHash(zone.geometry),
        osmTags
      },
      geometryQa: {
        ...geometry,
        siblingOverlaps: overlapRows.map((row) => ({
          peerZoneId: row.leftZoneId === zone.id ? row.rightZoneId : row.leftZoneId,
          overlapAreaKm2: row.areaKm2,
          overlapAreaM2: km2ToM2(row.areaKm2)
        })),
        districtLevelParentContainment: containmentRow
          ? {
              outsideAreaKm2: containmentRow.outsideAreaKm2,
              outsideAreaM2: km2ToM2(containmentRow.outsideAreaKm2)
            }
          : null
      }
    });
  }

  results.sort((left, right) => left.osmCandidateId.localeCompare(right.osmCandidateId));
  return results;
}

async function loadSettlementNameIndex(repoRoot) {
  const indexByDistrict = new Map();
  for (const pilot of orderedIstanbulPilots()) {
    const path = join(
      repoRoot,
      "reports/tr-adm3/mahalle-identity-layer",
      `${pilot.slug}-settlement-identities.json`
    );
    if (!existsSync(path)) {
      continue;
    }
    const payload = JSON.parse(await readFile(path, "utf8"));
    const byNorm = new Map();
    for (const settlement of payload.settlements ?? []) {
      const norm = normalizeTrName(settlement.normalizedName ?? settlement.displayName);
      const rows = byNorm.get(norm) ?? [];
      rows.push(settlement);
      byNorm.set(norm, rows);
    }
    indexByDistrict.set(pilot.slug, byNorm);
  }
  return indexByDistrict;
}

export function buildSemanticScreening({ zones, provenanceByZoneId, settlementIndexByDistrict }) {
  const duplicateNames = new Map();
  for (const zone of zones) {
    const norm = normalizeTrName(zone.name);
    const rows = duplicateNames.get(norm) ?? [];
    rows.push(zone.id);
    duplicateNames.set(norm, rows);
  }

  const records = [];
  const ambiguousCases = [];

  for (const zone of zones) {
    const provenance = provenanceByZoneId.get(zone.id) ?? {};
    const territory = zone.properties?.territory ?? {};
    const osmTags = territory.osmTags ?? {};
    const slug = provenance.pilotSlug;
    const norm = normalizeTrName(zone.name);
    const settlementMatches = slug ? (settlementIndexByDistrict.get(slug)?.get(norm) ?? []) : [];
    const duplicateNameZoneIds = (duplicateNames.get(norm) ?? []).filter((id) => id !== zone.id);

    const identityAmbiguous =
      duplicateNameZoneIds.length > 0 || settlementMatches.length > 1 || !zone.name;
    const adminLevelEvidence = {
      admin_level: osmTags.admin_level ?? null,
      border_type: osmTags.border_type ?? null,
      place: osmTags.place ?? null,
      "name:tr": osmTags["name:tr"] ?? null
    };
    const classification =
      osmTags.admin_level === "8" || osmTags.admin_level === 8
        ? "osm-admin-level-8-neighbourhood-candidate"
        : osmTags.admin_level
          ? "osm-admin-level-not-8"
          : "osm-admin-level-missing";

    if (identityAmbiguous) {
      ambiguousCases.push({
        osmCandidateId: zone.id,
        reasonCodes: [
          !zone.name ? "MISSING_NAME" : null,
          duplicateNameZoneIds.length > 0 ? "DUPLICATE_NORMALIZED_NAME" : null,
          settlementMatches.length > 1 ? "MULTIPLE_SETTLEMENT_IDENTITY_MATCHES" : null
        ].filter(Boolean)
      });
    }

    records.push({
      osmCandidateId: zone.id,
      osmAdministrativeName: zone.name,
      nameTr: osmTags["name:tr"] ?? null,
      adminLevelEvidence,
      neighbourhoodClassification: classification,
      settlementIdentityMatches: settlementMatches.map((row) => ({
        settlementId: row.settlementId,
        displayName: row.displayName,
        matchType: "normalized-name-exact"
      })),
      officialInventoryMatch: null,
      identityAmbiguous,
      humanApproval: {
        status: "unreviewed",
        semanticApproval: false,
        note: "OSM research polygon; name match alone does not prove administrative correctness."
      },
      reviewPins: {
        sourceSnapshotSha256: provenance.sourcePbfSha256 ?? PINNED_SOURCE_PBF_SHA256,
        geometryHash: territory.geometryHash ?? createTurkeyAdm3GeometryHash(zone.geometry),
        parentAdm2Id: zone.parentId,
        sourceRelationId: territory.osmId ?? null,
        identityLayerVersion: "settlement-identity-layer-pilot"
      }
    });
  }

  return {
    schemaVersion: "territorykit-tr-sprint-2-final-semantic-screening@1",
    ambiguousCaseCount: ambiguousCases.length,
    ambiguousCases,
    settlementIdentityMatchCount: records.filter((row) => row.settlementIdentityMatches.length > 0)
      .length,
    records
  };
}

export function buildCandidateInventory(recoveredReport, polygonQaResults) {
  const ids = recoveredReport.polygons.map((row) => row.osmCandidateId);
  const uniqueIds = new Set(ids);
  const nativeIds = recoveredReport.polygons.map((row) => row.nativeOsmRelationId);
  const uniqueNative = new Set(nativeIds.filter((id) => id != null));

  return {
    schemaVersion: "territorykit-tr-sprint-2-final-candidate-inventory@1",
    expectedCandidateCount: EXPECTED_OSM_RESEARCH_CANDIDATE_COUNT,
    candidateCount: ids.length,
    uniqueOsmCandidateIdCount: uniqueIds.size,
    uniqueNativeOsmRelationIdCount: uniqueNative.size,
    idValidation: {
      osmCandidateIdsUnique: uniqueIds.size === ids.length,
      nativeRelationIdsUnique: uniqueNative.size === nativeIds.filter((id) => id != null).length,
      countMatchesExpected: ids.length === EXPECTED_OSM_RESEARCH_CANDIDATE_COUNT
    },
    candidates: recoveredReport.polygons,
    dispositionRollup: polygonQaResults.reduce((rollup, row) => {
      rollup[row.disposition] = (rollup[row.disposition] ?? 0) + 1;
      return rollup;
    }, {})
  };
}

export function buildParentBoundaryDiscrepancies({
  parentsById,
  zonesByParent,
  districtSpatialByParentId
}) {
  const rows = [];
  for (const [parentId, zones] of zonesByParent.entries()) {
    const parent = parentsById.get(parentId);
    if (!parent) {
      continue;
    }
    const spatial = districtSpatialByParentId.get(parentId);
    const gap = spatial?.gaps?.[0] ?? null;
    const parentAreaKm2 = computeTurkeyAdm3GeometryAreaKm2(parent.geometry);
    const uncoveredKm2 = gap?.areaKm2 ?? null;
    const uncoveredRatio =
      parentAreaKm2 > 0 && uncoveredKm2 != null ? uncoveredKm2 / parentAreaKm2 : null;

    const containmentErrors = spatial?.parentContainmentErrors ?? [];
    const impactedRelationIds = containmentErrors
      .map((row) => {
        const zone = zones.find((candidate) => candidate.id === row.zoneId);
        const territory = zone?.properties?.territory ?? {};
        return typeof territory.osmId === "number" ? territory.osmId : null;
      })
      .filter((id) => id != null);

    rows.push({
      parentAdm2Id: parentId,
      sourceA: {
        label: "rc8-adm2-parent",
        geometryHash:
          parent.properties?.territory?.geometryHash ??
          createTurkeyAdm3GeometryHash(parent.geometry),
        areaKm2: round6(parentAreaKm2)
      },
      sourceB: {
        label: "osm-research-candidate-union",
        polygonCount: zones.length,
        summedZoneAreaKm2: round6(
          zones.reduce((total, zone) => total + computeTurkeyAdm3GeometryAreaKm2(zone.geometry), 0)
        )
      },
      difference: {
        uncoveredParentAreaKm2: round6(uncoveredKm2),
        uncoveredParentAreaM2: round6(km2ToM2(uncoveredKm2)),
        uncoveredParentAreaRatio: round6(uncoveredRatio),
        outsideParentPolygonCount: containmentErrors.length,
        totalOutsideParentAreaKm2: round6(
          containmentErrors.reduce((sum, row) => sum + (row.outsideAreaKm2 ?? 0), 0)
        ),
        siblingOverlapCount: spatial?.summary?.overlapCount ?? 0
      },
      impactedOsmRelationIds: [...new Set(impactedRelationIds)].sort((a, b) => a - b),
      evidenceCategory:
        containmentErrors.length > 0 && (uncoveredKm2 ?? 0) > PARENT_OUTSIDE_TOLERANCE_KM2
          ? "ADM2_VS_OSM_BOUNDARY_DISAGREEMENT"
          : containmentErrors.length > 0
            ? "OSM_EXTENDS_BEYOND_RC8_ADM2"
            : (uncoveredKm2 ?? 0) > PARENT_OUTSIDE_TOLERANCE_KM2
              ? "INCOMPLETE_OSM_DISTRICT_COVERAGE"
              : "WITHIN_MEASUREMENT_TOLERANCE",
      confidence: containmentErrors.length > 0 ? "medium" : gap ? "low" : "high",
      recommendedDisposition:
        containmentErrors.length > 0 || (spatial?.summary?.overlapCount ?? 0) > 0
          ? "human-spatial-review-required"
          : "monitor-only",
      note: "Does not mutate rc.8 ADM2 or clip OSM polygons; disagreement may reflect source date, coastline, or classification differences."
    });
  }

  rows.sort((left, right) => left.parentAdm2Id.localeCompare(right.parentAdm2Id));
  return {
    schemaVersion: "territorykit-tr-sprint-2-final-parent-boundary-discrepancies@1",
    districts: rows
  };
}

export async function buildSourceAndLicenseStatus(repoRoot) {
  const paths = {
    sprint2fBlockers: join(
      repoRoot,
      "reports/tr-adm3/sprint-2f-official-sources/source-legal-blockers.json"
    ),
    sprint2fMatrix: join(
      repoRoot,
      "reports/tr-adm3/sprint-2f-official-sources/istanbul-pilot-official-source-matrix.json"
    ),
    immutability: join(
      repoRoot,
      "reports/tr-adm3/sprint-2e-source-evidence/geometry-immutability-evidence.json"
    )
  };

  const official = existsSync(paths.sprint2fMatrix)
    ? JSON.parse(await readFile(paths.sprint2fMatrix, "utf8"))
    : null;
  const blockers = existsSync(paths.sprint2fBlockers)
    ? JSON.parse(await readFile(paths.sprint2fBlockers, "utf8"))
    : null;
  const immutability = existsSync(paths.immutability)
    ? JSON.parse(await readFile(paths.immutability, "utf8"))
    : null;
  const sourceIntegrity = await verifyOriginalSourceIntegrity(repoRoot);

  return {
    schemaVersion: "territorykit-tr-sprint-2-final-source-license@1",
    priorityOrder: [
      "verified-official-administrative",
      "verified-osm-administrative",
      "evidence-based-smart-derived",
      "explicit-unavailable-fallback"
    ],
    osmResearch: {
      eligibility: "ODBL_COMPLIANT_RESEARCH_ONLY",
      redistributionApproved: false,
      productionEligible: false,
      sourcePbfSha256: PINNED_SOURCE_PBF_SHA256,
      snapshotDate: PINNED_SOURCE_SNAPSHOT_DATE,
      sourceIntegrityStatus: sourceIntegrity.status ?? "UNKNOWN"
    },
    officialAdministrative: {
      verifiedPolygonCount: 0,
      kadikoyCkanStatus: blockers?.kadikoyStatus ?? "BLOCKED_BY_SOURCE",
      blockers: blockers?.legalRedistribution ?? [],
      technicalBlockers: blockers?.technical ?? [],
      matrixSummary: official?.summary ?? null
    },
    rc8Gameplay: {
      immutable: true,
      evidencePath: existsSync(paths.immutability)
        ? "reports/tr-adm3/sprint-2e-source-evidence/geometry-immutability-evidence.json"
        : null,
      districtPinCount: immutability?.districts?.length ?? null
    }
  };
}

export function buildResearchCandidateDataset(zones, provenanceByZoneId, generatedAt) {
  const features = zones.map((zone) => {
    const territory = zone.properties?.territory ?? {};
    const provenance = provenanceByZoneId.get(zone.id) ?? {};
    return {
      type: "Feature",
      id: zone.id,
      properties: {
        researchCandidateId: zone.id,
        name: zone.name,
        parentAdm2Id: zone.parentId,
        nativeOsmRelationId: territory.osmId ?? null,
        geometryHash: territory.geometryHash ?? createTurkeyAdm3GeometryHash(zone.geometry),
        sourceClass: "osm-administrative-research",
        official: false,
        productionEligible: false,
        provenanceStatus: "OSM_RESEARCH_CANDIDATE",
        sourcePbfSha256: provenance.sourcePbfSha256 ?? PINNED_SOURCE_PBF_SHA256,
        derivedClipSha256: provenance.derivedClipSha256 ?? null,
        parserImplementationRevision:
          provenance.parserImplementationRevision ?? TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION
      },
      geometry: zone.geometry
    };
  });

  const geojson = {
    type: "FeatureCollection",
    schemaVersion: "territorykit-tr-sprint-2-final-research-candidates@1",
    generatedAt,
    featureCount: features.length,
    features
  };

  const manifest = {
    schemaVersion: "territorykit-tr-sprint-2-final-research-dataset-manifest@1",
    generatedAt,
    datasetLabel: "istanbul-osm-administrative-research-candidates",
    datasetVersion: "sprint-2-final-closeout@1",
    featureCount: features.length,
    sourcePbfSha256: PINNED_SOURCE_PBF_SHA256,
    sourceSnapshotDate: PINNED_SOURCE_SNAPSHOT_DATE,
    parserImplementationRevision: TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION,
    extractImplementationRevision: SPRINT_2H_EXTRACT_IMPLEMENTATION_REVISION,
    geometryContentSha256: sha256Hex(JSON.stringify(features.map((row) => row.geometry))),
    doesNotOverwriteRc8: true
  };

  return { geojson, manifest };
}

export function buildDistrictCoverageMatrix({
  perDistrict,
  districtQaBySlug,
  sourceIntegrity,
  officialBlockers
}) {
  return {
    schemaVersion: "territorykit-tr-sprint-2-final-district-coverage-matrix@1",
    districts: perDistrict.map((row) => {
      const qa = districtQaBySlug[row.slug] ?? null;
      const osmCoverage = qa?.districtCoverageQa?.osmAdministrative;
      const parentAreaKm2 = osmCoverage?.parentAreaKm2 ?? null;
      const uncovered = osmCoverage?.uncoveredParentAreaKm2 ?? null;
      return {
        slug: row.slug,
        pilotDistrict: row.pilotDistrict,
        parentAdm2Id: row.parentAdm2Id,
        blocked: row.blocked ?? false,
        osmResearchPolygonCount: row.builtPolygonCount ?? 0,
        unresolvedRelationCount: row.unresolvedCount ?? null,
        coverageRatio:
          parentAreaKm2 && uncovered != null
            ? round6(Math.max(0, 1 - uncovered / parentAreaKm2))
            : null,
        uncoveredParentAreaKm2: round6(uncovered),
        overlapCount: osmCoverage?.overlapCount ?? null,
        gapCount: osmCoverage?.gapCount ?? null,
        missingOfficialSourceInventory:
          row.slug === "kadikoy"
            ? (officialBlockers?.kadikoyCkanStatus ?? "BLOCKED_BY_SOURCE")
            : "no-verified-official-polygon-in-pilot",
        unresolvedDefects: row.blocked
          ? [row.reasonCode ?? row.missingArtifact ?? "BLOCKED"]
          : [
              (osmCoverage?.gapCount ?? 0) > 0 ? "district-coverage-gap" : null,
              (osmCoverage?.overlapCount ?? 0) > 0 ? "sibling-overlap" : null,
              (qa?.polygonTechnicalQa?.osmAdministrative?.spatialQuality?.parentContainmentErrors
                ?.length ?? 0) > 0
                ? "parent-containment-excursion"
                : null
            ].filter(Boolean)
      };
    }),
    sourceIntegrityStatus: sourceIntegrity.status ?? "UNKNOWN"
  };
}

export function buildPilotVisualGeoJson({
  pilot,
  parent,
  gameplayZones,
  osmZones,
  polygonQaById,
  dispositionById
}) {
  const base = buildMapPreviewGeoJson({
    pilot,
    parent,
    gameplayZones,
    osmZones,
    seeds: []
  });

  for (const feature of base.features) {
    if (feature.properties?.layerClass === "osm-administrative") {
      const zoneId = feature.properties.polygonId;
      const qa = polygonQaById.get(zoneId);
      feature.properties.layerClass = "osm-administrative-research-closeout";
      feature.properties.closeoutDisposition = dispositionById.get(zoneId) ?? "NOT_ASSESSED";
      feature.properties.outsideParentAreaM2 = qa?.geometryQa?.outsideParentAreaM2 ?? null;
      feature.properties.qaOverlay =
        qa?.geometryQa?.parentContainmentExceeds ||
        (qa?.geometryQa?.siblingOverlaps?.length ?? 0) > 0
          ? "spatial-conflict"
          : "none";
    }
  }

  return base;
}

export function buildPilotMapHtml({ district, center, geojson }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Sprint 2 closeout — ${district}</title>
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    body { margin: 0; font: 14px system-ui, sans-serif; }
    #map { position: absolute; top: 0; bottom: 0; width: 100%; }
    .panel { position: absolute; top: 12px; left: 12px; z-index: 1; background: #fff; padding: 12px; max-width: 380px; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
  </style>
</head>
<body>
  <div class="panel">
    <h1>${district} pilot</h1>
    <p>rc.8 gameplay vs OSM research candidates (read-only). Red QA overlay = spatial conflict flag.</p>
    <pre id="detail">Click a feature.</pre>
  </div>
  <div id="map"></div>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <script>
    const data = ${JSON.stringify(geojson)};
    const map = new maplibregl.Map({
      container: "map",
      style: "https://demotiles.maplibre.org/style.json",
      center: [${center[0]}, ${center[1]}],
      zoom: 11.5
    });
    map.on("load", () => {
      map.addSource("pilot", { type: "geojson", data });
      map.addLayer({
        id: "parent-outline",
        type: "line",
        filter: ["==", ["get", "layerClass"], "rc8-gameplay"],
        source: "pilot",
        paint: { "line-color": "#555", "line-width": 2 }
      });
      map.addLayer({
        id: "gameplay-fill",
        type: "fill",
        filter: ["all", ["==", ["get", "layerClass"], "rc8-gameplay"], ["has", "settlementIdentity"]],
        source: "pilot",
        paint: { "fill-color": "#1a5fb4", "fill-opacity": 0.25 }
      });
      map.addLayer({
        id: "osm-fill",
        type: "fill",
        filter: ["==", ["get", "layerClass"], "osm-administrative-research-closeout"],
        source: "pilot",
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "qaOverlay"], "spatial-conflict"],
            "#c01c28",
            "#2ec27e"
          ],
          "fill-opacity": 0.35
        }
      });
      map.on("click", "osm-fill", (e) => {
        document.getElementById("detail").textContent = JSON.stringify(e.features[0].properties, null, 2);
      });
    });
  </script>
</body>
</html>`;
}

export function buildNationalReadiness({
  polygonQaResults,
  semanticScreening,
  sourceLicense,
  districtMatrix,
  extractionBlocked
}) {
  const technicallyValid = polygonQaResults.filter(
    (row) => row.disposition === "TECHNICALLY_VALID_REVIEW_REQUIRED"
  ).length;
  const spatialConflicts = polygonQaResults.filter(
    (row) => row.disposition === "SPATIAL_CONFLICT_REVIEW_REQUIRED"
  ).length;

  const blockers = [
    extractionBlocked ? "BLOCKED_BY_SOURCE: OSM PBF or district clips unavailable" : null,
    sourceLicense.officialAdministrative.verifiedPolygonCount === 0
      ? "No verified official mahalle polygons"
      : null,
    "0 human semantic approvals on OSM research candidates",
    sourceLicense.osmResearch.redistributionApproved === false
      ? "ODbL redistribution / hosted delivery not cleared"
      : null,
    spatialConflicts > 0 ? `${spatialConflicts} OSM polygons with spatial conflict flags` : null,
    districtMatrix.districts.some((row) => (row.gapCount ?? 0) > 0)
      ? "District-level OSM coverage gaps remain"
      : null
  ].filter(Boolean);

  return {
    schemaVersion: "territorykit-tr-sprint-2-final-national-readiness@1",
    istanbulPilotEvidence: {
      osmResearchCandidates: polygonQaResults.length,
      technicallyValidRingPass: technicallyValid,
      spatialConflictCount: spatialConflicts,
      semanticIdentityMatchCount: semanticScreening.settlementIdentityMatchCount,
      humanSemanticApprovals: 0,
      officialVerifiedPolygons: 0
    },
    technicalReadiness: extractionBlocked ? "BLOCKED_BY_SOURCE" : "PARTIAL",
    sprint3NationalCandidateProgram: extractionBlocked ? "BLOCKED_BY_SOURCE" : "NO_GO",
    blockers,
    decision: extractionBlocked ? "BLOCKED_BY_SOURCE" : "NO_GO"
  };
}

export function buildCloseoutDecision({
  generatedAt,
  headSha,
  extractionBlocked,
  polygonQaResults,
  sourceLicense
}) {
  const dispositionRollup = polygonQaResults.reduce((rollup, row) => {
    rollup[row.disposition] = (rollup[row.disposition] ?? 0) + 1;
    return rollup;
  }, {});

  const ringValidCount = polygonQaResults.filter((row) => row.geometryQa.ringOk === true).length;

  return {
    schemaVersion: "territorykit-tr-sprint-2-final-closeout-decision@1",
    generatedAt,
    headSha,
    acceptanceQuestions: {
      A_osmPolygonRecovery: {
        recoveredCandidates: polygonQaResults.length,
        reproducible: !extractionBlocked,
        verdict: extractionBlocked
          ? "BLOCKED_BY_SOURCE"
          : polygonQaResults.length === 228
            ? "GO"
            : "PARTIAL"
      },
      B_technicalValidity: {
        ringValidCount,
        invalidCount: dispositionRollup.INVALID_GEOMETRY ?? 0,
        notAssessedCount: dispositionRollup.NOT_ASSESSED ?? 0,
        verdict: extractionBlocked
          ? "NOT_ASSESSED"
          : (dispositionRollup.INVALID_GEOMETRY ?? 0) === 0
            ? "PARTIAL"
            : "NO_GO"
      },
      C_geographicAccuracy: {
        spatialConflictCount: dispositionRollup.SPATIAL_CONFLICT_REVIEW_REQUIRED ?? 0,
        verdict: "NO_GO"
      },
      D_semanticMahalleBoundaries: {
        humanApprovals: 0,
        verdict: "NO_GO"
      },
      E_legalDistribution: {
        redistributionApproved: false,
        verdict: sourceLicense.osmResearch.redistributionApproved ? "GO" : "BLOCKED"
      }
    },
    decisions: {
      engineeringScopeCompleted: extractionBlocked ? "PARTIAL" : "GO",
      osmRecoveryPipeline: extractionBlocked ? "BLOCKED_BY_SOURCE" : "GO",
      individualPolygonQa: extractionBlocked ? "NOT_ASSESSED" : "PARTIAL",
      semanticBoundaryAccuracy: "NO_GO",
      sourceLegalEligibility: "BLOCKED",
      istanbulGeographicalAcceptance: "NO_GO",
      sprint3NationalReadiness: "NO_GO",
      sprint4IntegrationReadiness: "NO_GO",
      productionReadiness: "NO_GO"
    },
    dispositionRollup,
    remainingWork:
      "Remaining blockers are primarily external official data/permission, human semantic validation, and spatial acceptance — not additional Sprint 2 parser infrastructure."
  };
}

export async function runSprint2FinalCloseoutAssessment(repoRoot, generatedAt) {
  const sourceIntegrity = await verifyOriginalSourceIntegrity(repoRoot);
  const extractionBlocked = sourceIntegrity.status !== "GO";

  let pilotExtract = {
    perDistrict: [],
    zones: [],
    unresolved: [],
    provenanceByZoneId: new Map()
  };

  if (!extractionBlocked) {
    pilotExtract = await extractAllPilotDistricts(repoRoot, generatedAt);
  } else {
    const recoveredPath = join(
      repoRoot,
      "reports/tr-adm3/sprint-2h-osm-relation-recovery/recovered-osm-polygons.json"
    );
    if (existsSync(recoveredPath)) {
      const recovered = JSON.parse(await readFile(recoveredPath, "utf8"));
      pilotExtract.perDistrict = JSON.parse(
        await readFile(
          join(
            repoRoot,
            "reports/tr-adm3/sprint-2h-osm-relation-recovery/istanbul-eight-district-recovery-matrix.json"
          ),
          "utf8"
        )
      ).districts;
      pilotExtract.zones = [];
      pilotExtract.provenanceByZoneId = new Map();
      for (const row of recovered.polygons) {
        pilotExtract.provenanceByZoneId.set(row.osmCandidateId, {
          sourcePbfSha256: row.sourcePbfSha256,
          sourceSnapshotDate: row.sourceSnapshotDate,
          derivedClipRel: row.derivedClipRel,
          derivedClipSha256: row.derivedClipSha256,
          pilotSlug: null,
          pilotDistrict: null,
          expectedParentAdm2Id: row.parentAdm2Id,
          parserImplementationRevision: row.parserImplementationRevision
        });
      }
    }
  }

  const parentsById = new Map();
  const zonesByParent = new Map();
  const districtSpatialByParentId = new Map();
  const districtQaBySlug = {};
  const technicalQaByDistrict = {};

  for (const pilot of orderedIstanbulPilots()) {
    const context = await loadRc8DistrictContext(repoRoot, pilot);
    if (context.blocked) {
      continue;
    }
    parentsById.set(context.parent.id, context.parent);
    const districtZones = extractionBlocked
      ? []
      : pilotExtract.zones.filter((zone) => zone.parentId === context.parent.id);
    zonesByParent.set(context.parent.id, districtZones);

    if (!extractionBlocked) {
      technicalQaByDistrict[pilot.slug] = await buildPolygonTechnicalQa(
        context.parent,
        districtZones
      );
      const unresolved = pilotExtract.unresolved.filter(
        (entry) => entry.parentAdm2Id === context.parent.id
      );
      districtQaBySlug[pilot.slug] = assessDistrictGeometryQa({
        parent: context.parent,
        gameplayZones: context.gameplayZones,
        osmZones: districtZones,
        osmUnresolvedForDistrict: unresolved
      });
      districtSpatialByParentId.set(
        context.parent.id,
        districtQaBySlug[pilot.slug].polygonTechnicalQa.osmAdministrative.spatialQuality
      );
    } else if (
      existsSync(
        join(repoRoot, "reports/tr-adm3/sprint-2h-osm-relation-recovery/polygon-technical-qa.json")
      )
    ) {
      const qaRollup = JSON.parse(
        await readFile(
          join(
            repoRoot,
            "reports/tr-adm3/sprint-2h-osm-relation-recovery/polygon-technical-qa.json"
          ),
          "utf8"
        )
      );
      technicalQaByDistrict[pilot.slug] = qaRollup.byDistrict[pilot.slug];
      const coverage = JSON.parse(
        await readFile(
          join(
            repoRoot,
            "reports/tr-adm3/sprint-2h-osm-relation-recovery/district-coverage-qa.json"
          ),
          "utf8"
        )
      );
      districtQaBySlug[pilot.slug] = coverage.byDistrict[pilot.slug];
      districtSpatialByParentId.set(
        context.parent.id,
        qaRollup.byDistrict[pilot.slug]?.spatialQuality ?? null
      );
    }
  }

  const geometryQaRollup = rollupGeometryQaCounts(technicalQaByDistrict);
  const recoveredReport = buildRecoveredPolygonsReport(pilotExtract.zones, {
    generatedAt,
    provenanceByZoneId: pilotExtract.provenanceByZoneId,
    geometryQaRollup
  });

  const polygonQaResults = extractionBlocked
    ? []
    : buildPolygonQaResults({
        zones: pilotExtract.zones,
        provenanceByZoneId: pilotExtract.provenanceByZoneId,
        parentsById,
        districtSpatialByParentId
      });

  if (
    extractionBlocked &&
    existsSync(
      join(repoRoot, "reports/tr-adm3/sprint-2h-osm-relation-recovery/polygon-technical-qa.json")
    )
  ) {
    const qaRollup = JSON.parse(
      await readFile(
        join(repoRoot, "reports/tr-adm3/sprint-2h-osm-relation-recovery/polygon-technical-qa.json"),
        "utf8"
      )
    );
    for (const [slug, districtQa] of Object.entries(qaRollup.byDistrict)) {
      for (const row of districtQa.spatialQuality?.parentContainmentErrors ?? []) {
        polygonQaResults.push({
          osmCandidateId: row.zoneId,
          nativeOsmRelationId: null,
          parentAdm2Id: row.parentId,
          pilotSlug: slug,
          disposition: "SPATIAL_CONFLICT_REVIEW_REQUIRED",
          humanSemanticApproval: {
            status: "unreviewed",
            official: false,
            productionEligible: false,
            autoDisplayNameAllowed: false,
            redistributionApproved: false
          },
          provenance: {
            note: "Rehydrated from Sprint 2H district rollup; run with PBF for full per-polygon provenance."
          },
          geometryQa: {
            parentContainmentExceeds: true,
            outsideParentAreaKm2: row.outsideAreaKm2,
            outsideParentAreaM2: km2ToM2(row.outsideAreaKm2),
            ringOk: true,
            ringValidationAssessed: true
          }
        });
      }
    }
  }

  const settlementIndex = await loadSettlementNameIndex(repoRoot);
  const semanticScreening = buildSemanticScreening({
    zones: pilotExtract.zones,
    provenanceByZoneId: pilotExtract.provenanceByZoneId,
    settlementIndexByDistrict: settlementIndex
  });

  const sourceLicense = await buildSourceAndLicenseStatus(repoRoot);
  const parentBoundaryDiscrepancies = buildParentBoundaryDiscrepancies({
    parentsById,
    zonesByParent,
    districtSpatialByParentId
  });

  const districtCoverageMatrix = buildDistrictCoverageMatrix({
    perDistrict: pilotExtract.perDistrict,
    districtQaBySlug,
    sourceIntegrity,
    officialBlockers: sourceLicense.officialAdministrative
  });

  const researchDataset = buildResearchCandidateDataset(
    pilotExtract.zones,
    pilotExtract.provenanceByZoneId,
    generatedAt
  );

  const nationalReadiness = buildNationalReadiness({
    polygonQaResults,
    semanticScreening,
    sourceLicense,
    districtMatrix: districtCoverageMatrix,
    extractionBlocked
  });

  const closeoutDecision = buildCloseoutDecision({
    generatedAt,
    headSha: null,
    extractionBlocked,
    polygonQaResults,
    sourceLicense
  });

  const candidateInventory = buildCandidateInventory(recoveredReport, polygonQaResults);

  const polygonQaById = new Map(polygonQaResults.map((row) => [row.osmCandidateId, row]));
  const dispositionById = new Map(
    polygonQaResults.map((row) => [row.osmCandidateId, row.disposition])
  );

  const pilotVisuals = {};
  for (const slug of REPRESENTATIVE_PILOT_SLUGS) {
    const pilot = pilotBySlug(slug);
    const context = await loadRc8DistrictContext(repoRoot, pilot);
    if (context.blocked) {
      continue;
    }
    const osmZones = pilotExtract.zones.filter((zone) => zone.parentId === context.parent.id);
    pilotVisuals[slug] = {
      geojson: buildPilotVisualGeoJson({
        pilot,
        parent: context.parent,
        gameplayZones: context.gameplayZones,
        osmZones,
        polygonQaById,
        dispositionById
      }),
      center: context.parent.center ?? [28.97, 41.01]
    };
  }

  return {
    sourceIntegrity,
    extractionBlocked,
    recoveredReport,
    polygonQaResults,
    semanticScreening,
    candidateInventory,
    districtCoverageMatrix,
    parentBoundaryDiscrepancies,
    sourceLicense,
    researchDataset,
    nationalReadiness,
    closeoutDecision,
    pilotVisuals,
    pilotExtract
  };
}

export async function writeResearchDatasetArtifacts(repoRoot, reportRoot, researchDataset) {
  const datasetDir = join(repoRoot, reportRoot, "research-candidate-dataset");
  const geoPath = join(datasetDir, "osm-administrative-candidates.geojson");
  const manifestPath = join(datasetDir, "manifest.json");
  const geoBody = `${JSON.stringify(researchDataset.geojson, null, 2)}\n`;
  const manifestBody = `${JSON.stringify(researchDataset.manifest, null, 2)}\n`;
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(datasetDir, { recursive: true });
  await writeFile(geoPath, geoBody, "utf8");
  await writeFile(manifestPath, manifestBody, "utf8");
  const onDiskSha = await sha256File(geoPath);
  researchDataset.manifest.geojsonSha256 = onDiskSha;
  await writeFile(manifestPath, `${JSON.stringify(researchDataset.manifest, null, 2)}\n`, "utf8");
}
