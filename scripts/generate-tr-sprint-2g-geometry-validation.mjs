#!/usr/bin/env node
/**
 * Sprint 2G — Istanbul mahalle geometry validation (official/OSM research, rc.8 immutable).
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeReportJson, writeReportMarkdown } from "./lib/write-report-json.mjs";
import { investigateKadikoyOfficialShapefile } from "./investigate-kadikoy-official-shapefile.mjs";
import { buildMahalleIdentityDistrictReports } from "./lib/tr-mahalle-identity-layer-district.mjs";
import {
  SPRINT_2G_REPORT_ROOT,
  assessDistrictGeometryQa,
  buildAcceptanceGates,
  buildFatihAlternativeMatrix,
  buildGameplayOverlayReport,
  buildMapPreviewGeoJson,
  classifyDistrictOutcome,
  loadFatihHistoricalReferences,
  loadOrExtractIstanbulOsmAdministrative,
  loadRc8DistrictContext,
  orderedIstanbulPilots,
  osmUnresolvedForParent,
  osmZonesForParent,
  probeKadikoyCkanAlternatives
} from "./lib/tr-sprint-2g-geometry-validation.mjs";

const REPO_ROOT = process.cwd();
const GENERATED_AT = process.env.SPRINT_2G_GENERATED_AT ?? new Date().toISOString();
const RC8_ROOT =
  process.env.SPRINT_2G_RC8_ROOT ??
  ".territory/national-geometry-remediation/candidate-rc8-impl-rev1";
const MAIN_BASELINE_SHA = process.env.SPRINT_2G_MAIN_BASELINE_SHA ?? null;

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const pilots = orderedIstanbulPilots();
  const kadikoyInvestigation = await investigateKadikoyOfficialShapefile({ repoRoot: REPO_ROOT });
  const kadikoyAlternatives = await probeKadikoyCkanAlternatives();

  const parents = [];
  const districtContexts = new Map();
  for (const pilot of pilots) {
    const context = await loadRc8DistrictContext(REPO_ROOT, pilot, RC8_ROOT);
    districtContexts.set(pilot.slug, context);
    if (!context.blocked) {
      parents.push(context.parent);
    }
  }

  const osmExtract = await loadOrExtractIstanbulOsmAdministrative({
    repoRoot: REPO_ROOT,
    generatedAt: GENERATED_AT,
    districtParents: parents
  });

  const reportRootAbs = join(REPO_ROOT, SPRINT_2G_REPORT_ROOT);
  const previewRoot = join(reportRootAbs, "map-preview");
  await mkdir(previewRoot, { recursive: true });

  const districtMatrix = [];
  const overlayByDistrict = {};
  const gameplayImpactRows = [];
  let verifiedOsmPolygonCount = 0;
  let osmTechnicalPassCount = 0;
  let overlayAssessedCount = 0;

  for (const pilot of pilots) {
    const context = districtContexts.get(pilot.slug);
    if (context.blocked) {
      districtMatrix.push({
        district: pilot.district,
        slug: pilot.slug,
        parentAdm2Id: context.parentAdm2Id,
        classification:
          context.reasonCode === "GEOMETRY_IMMUTABILITY_PIN_MISMATCH"
            ? "GEOMETRY_IMMUTABILITY_BLOCKER"
            : "BLOCKED_BY_SOURCE",
        officialPolygons: 0,
        osmAdministrativePolygons: 0,
        estimatedCandidatePolygons: 0,
        gameplayZoneCount: "NOT_ASSESSED",
        geometryQa: "NOT_ASSESSED",
        stressFocus: pilot.stressFocus ?? [],
        notes: [
          context.missingArtifact,
          context.reasonCode,
          context.expectedPins,
          context.observedPins
        ].filter(Boolean)
      });
      continue;
    }

    const identity = await buildMahalleIdentityDistrictReports({
      repoRoot: REPO_ROOT,
      pilot,
      rc8Root: RC8_ROOT,
      writeArtifacts: false
    });
    const osmZones = osmExtract.blocked ? [] : osmZonesForParent(osmExtract, context.parentAdm2Id);
    verifiedOsmPolygonCount += osmZones.length;

    const geometryQa = assessDistrictGeometryQa({
      parent: context.parent,
      gameplayZones: context.gameplayZones,
      osmZones,
      osmUnresolvedForDistrict: osmExtract.blocked
        ? []
        : osmUnresolvedForParent(osmExtract, context.parentAdm2Id)
    });
    if (geometryQa.polygonTechnicalQa?.osmAdministrative?.structurallyValid) {
      osmTechnicalPassCount += 1;
    }

    const overlay = buildGameplayOverlayReport({
      generatedAt: GENERATED_AT,
      gameplayZones: context.gameplayZones,
      osmZones
    });
    overlayByDistrict[pilot.slug] = overlay;
    if (overlay.status === "ASSESSED") {
      overlayAssessedCount += 1;
    }

    const classification = classifyDistrictOutcome({
      pilot,
      kadikoyBlocked: pilot.slug === "kadikoy",
      osmPolygonCount: osmZones.length,
      officialVerified: false,
      experimentalImproved: false
    });

    const preview = buildMapPreviewGeoJson({
      pilot,
      parent: context.parent,
      gameplayZones: context.gameplayZones,
      osmZones,
      seeds: identity.blocked ? [] : (identity.layer?.settlements ?? [])
    });
    await writeFile(
      join(previewRoot, `${pilot.slug}-geometry-comparison.geojson`),
      `${JSON.stringify(preview, null, 2)}\n`,
      "utf8"
    );

    districtMatrix.push({
      district: pilot.district,
      slug: pilot.slug,
      parentAdm2Id: context.parentAdm2Id,
      classification,
      officialPolygons: 0,
      osmAdministrativePolygons: osmZones.length,
      estimatedCandidatePolygons: 0,
      gameplayZoneCount: context.gameplayZones.length,
      gameplayGeometryHashSetSha256: context.geometryHashSetSha256,
      gameplayZoneIdSetSha256: context.zoneIdSetSha256,
      geometryQa: {
        polygonTechnical: {
          gameplaySpatialOk: geometryQa.polygonTechnicalQa.gameplay.structurallyValid,
          osmSpatialOk: geometryQa.polygonTechnicalQa.osmAdministrative.structurallyValid,
          gameplaySliverCount:
            geometryQa.polygonTechnicalQa.gameplay.spatialQuality.summary.sliverCount,
          osmSliverCount:
            geometryQa.polygonTechnicalQa.osmAdministrative.spatialQuality?.summary.sliverCount ??
            null,
          gameplayOverlapCount:
            geometryQa.polygonTechnicalQa.gameplay.spatialQuality.summary.overlapCount,
          osmOverlapCount:
            geometryQa.polygonTechnicalQa.osmAdministrative.spatialQuality?.summary.overlapCount ??
            null,
          gameplayParentContainmentNote:
            geometryQa.polygonTechnicalQa.gameplay.parentContainmentNote ?? null
        },
        districtCoverage: geometryQa.districtCoverageQa
      },
      seedMetrics: identity.blocked
        ? { status: "NOT_ASSESSED" }
        : {
            status: "ASSESSED",
            zoneCount: identity.metrics.zoneCount,
            settlementCount: identity.metrics.settlementCount,
            unseededZoneCount: identity.metrics.unseededZoneCount,
            ambiguousZoneCount: identity.metrics.ambiguousZoneCount
          },
      stressFocus: pilot.stressFocus ?? [],
      mapPreviewPath: `${SPRINT_2G_REPORT_ROOT}/map-preview/${pilot.slug}-geometry-comparison.geojson`,
      overlaySummary: overlay.correspondence ?? null
    });

    gameplayImpactRows.push({
      district: pilot.district,
      slug: pilot.slug,
      parentAdm2Id: context.parentAdm2Id,
      overlay,
      gameplayImmutable: true,
      ownershipMigrationPerformed: false
    });
  }

  const fatihHistorical = await loadFatihHistoricalReferences(REPO_ROOT);
  const fatihContext = districtContexts.get("fatih");
  const fatihOsm =
    fatihContext && !fatihContext.blocked && !osmExtract.blocked
      ? osmZonesForParent(osmExtract, fatihContext.parentAdm2Id)
      : [];
  const fatihQa =
    fatihContext && !fatihContext.blocked
      ? assessDistrictGeometryQa({
          parent: fatihContext.parent,
          gameplayZones: fatihContext.gameplayZones,
          osmZones: fatihOsm
        })
      : null;

  const officialAcquisition = {
    schemaVersion: "territorykit-tr-sprint-2g-official-source-acquisition@1",
    generatedAt: GENERATED_AT,
    verifiedOfficialPolygonCount: 0,
    kadikoy: {
      investigation: kadikoyInvestigation.decision,
      ckanAlternativeProbe: kadikoyAlternatives,
      status: "BLOCKED_BY_SOURCE",
      missingEvidence: kadikoyInvestigation.officialPolygonIngestionEvidenceRequirements
    },
    districts: pilots.map((pilot) => ({
      district: pilot.district,
      slug: pilot.slug,
      verifiedOfficialPolygons: 0,
      status: pilot.slug === "kadikoy" ? "BLOCKED_BY_SOURCE" : "NO_VERIFIED_OFFICIAL_PACKAGE",
      evidencePaths: [
        "reports/tr-adm3/sprint-2f-official-sources/istanbul-pilot-official-source-matrix.json",
        pilot.slug === "kadikoy"
          ? "reports/tr-adm3/audit/kadikoy-acquisition.json"
          : `reports/tr-adm3/mahalle-identity-layer/${pilot.slug}-coverage-and-provenance.json`
      ]
    }))
  };

  const osmCandidates = {
    schemaVersion: "territorykit-tr-sprint-2g-osm-administrative-candidates@1",
    generatedAt: GENERATED_AT,
    extractBlocked: Boolean(osmExtract.blocked),
    missingArtifact: osmExtract.missingArtifact ?? null,
    fromCache: osmExtract.fromCache ?? false,
    cachePath: osmExtract.cachePath ?? null,
    countryPbfSourceLock: osmExtract.countryPbfSourceLock ?? null,
    extractionComparisons: osmExtract.extractionComparisons ?? [],
    coverage: osmExtract.coverage ?? null,
    quality: osmExtract.quality ?? null,
    unresolvedCount: osmExtract.unresolved?.length ?? null,
    unresolvedSummary: osmExtract.coverage?.unresolvedSummary ?? null,
    duplicateCount: osmExtract.duplicates?.length ?? null,
    pilots: districtMatrix.map((row) => ({
      slug: row.slug,
      parentAdm2Id: row.parentAdm2Id,
      osmAdministrativePolygonCount: row.osmAdministrativePolygons,
      classification: row.classification
    })),
    totalVerifiedOsmAdministrativePolygons: verifiedOsmPolygonCount,
    note: "OSM administrative polygons are independent research candidates; not official mahalle boundaries."
  };

  const fatihBeforeAfter = {
    schemaVersion: "territorykit-tr-sprint-2g-fatih-before-after-quality@1",
    generatedAt: GENERATED_AT,
    district: "Fatih",
    historicalReferences: Object.keys(fatihHistorical),
    historicalMetrics: {
      v17Replay:
        fatihHistorical["reports/tr-adm3/mahalle-first-program/fatih-v1-v2-comparison.json"]
          ?.v17Replay,
      v2ImplRev3:
        fatihHistorical["reports/tr-adm3/mahalle-first-program/fatih-v2-impl-rev2-comparison.json"]
          ?.implRev3,
      hybridRev4:
        fatihHistorical["reports/tr-adm3/mahalle-first-program/fatih-hybrid-rev4-comparison.json"]
          ?.implRev4Hybrid
    },
    currentRc8GameplayQa: fatihQa?.gameplay ?? null,
    currentOsmAdministrativeQa: fatihQa?.osmAdministrative ?? null,
    experimentalCandidateDecision: "NO_GO",
    selectedGameplayGeometry: "rc.8-pinned-smart-derived-v1.7",
    geographicalProductAcceptance: "NO_GO"
  };

  const fatihBoundaryComparison = {
    schemaVersion: "territorykit-tr-sprint-2g-fatih-boundary-comparison@1",
    generatedAt: GENERATED_AT,
    alternatives: buildFatihAlternativeMatrix(fatihHistorical, fatihQa, fatihQa),
    overlay: overlayByDistrict.fatih ?? null,
    mapPreviewPath: `${SPRINT_2G_REPORT_ROOT}/map-preview/fatih-geometry-comparison.geojson`
  };

  const geometryProvenance = {
    schemaVersion: "territorykit-tr-sprint-2g-geometry-source-provenance@1",
    generatedAt: GENERATED_AT,
    gameplay: {
      datasetVersion: "2.1.0-rc.8",
      artifactRoot: RC8_ROOT,
      immutable: true,
      note: "Sprint 2G did not mutate gameplay zone IDs or geometries."
    },
    settlementIdentity: {
      layer: "canonical-settlement-identity",
      humanApprovedDecisions: 0
    },
    administrativeBoundaryResearch: {
      officialVerifiedCount: 0,
      osmAdministrativePolygonCount: verifiedOsmPolygonCount,
      estimatedExperimentalCount: 0
    },
    sourceLocks: {
      countryOsmPbf: osmExtract.countryPbfSourceLock ?? null,
      derivedDistrictClips: (osmExtract.perDistrictExtracts ?? []).map((row) => ({
        parentAdm2Id: row.parentAdm2Id,
        slug: row.slug,
        extractionMode: row.extractionMode,
        derivedClipSha256: row.derivedClip?.sha256,
        countryPbfSha256: osmExtract.countryPbfSourceLock?.sha256
      })),
      osmBarrierSnapshot:
        "reports/tr-adm3/sprint-2e-source-evidence/istanbul-eight-district-source-evidence-matrix.json"
    }
  };

  const experimentalReadiness = {
    schemaVersion: "territorykit-tr-sprint-2g-experimental-candidate-readiness@1",
    generatedAt: GENERATED_AT,
    estimatedCandidates: [],
    decision: "NO_GO",
    reason:
      "No measured smart-derived candidate beats rc.8 v1.7 on barrier alignment without unacceptable seed/barrier tradeoffs (Sprint 2B.4 NO-GO preserved).",
    fatihHistoricalNoGoPreserved: true
  };

  const gameplayMigrationImpact = {
    schemaVersion: "territorykit-tr-sprint-2g-gameplay-id-migration-impact@1",
    generatedAt: GENERATED_AT,
    rc8Immutable: true,
    rushAndClaimDbModified: false,
    ownershipTransferPerformed: false,
    districts: gameplayImpactRows
  };

  const gates = buildAcceptanceGates({
    officialVerifiedCount: 0,
    osmVerifiedDistrictCount: districtMatrix.filter((row) => row.osmAdministrativePolygons > 0)
      .length,
    osmPolygonCount: verifiedOsmPolygonCount,
    osmTechnicalPassCount,
    kadikoyStatus: kadikoyInvestigation.decision?.status ?? "BLOCKED_BY_SOURCE",
    overlayAssessed: overlayAssessedCount > 0,
    geographicalGo: false
  });

  const sprintDecision = {
    schemaVersion: "territorykit-tr-sprint-2g-decision@1",
    generatedAt: GENERATED_AT,
    repository: {
      mainBaselineSha: MAIN_BASELINE_SHA ?? gitHead(),
      evaluatedCommit: gitHead(),
      branch: "feat/tr-istanbul-mahalle-geometry-validation",
      headSha: gitHead()
    },
    counts: {
      verifiedOfficialPolygons: 0,
      verifiedOsmAdministrativePolygons: verifiedOsmPolygonCount,
      experimentalEstimatedPolygons: 0,
      istanbulPilotDistricts: pilots.length
    },
    gates,
    geographicalProductAcceptance: "NO_GO",
    nationalExpansion: "NO_GO",
    productionReadiness: "NO_GO",
    nextTechnicalAction:
      verifiedOsmPolygonCount > 0
        ? "Human license review for ODbL redistribution + independent OSM-vs-official accuracy sampling before any gameplay replacement-map promotion."
        : "Restore pinned Geofabrik OSM PBF locally and re-run OSM administrative extraction for Istanbul ADM2 parents."
  };

  await mkdir(reportRootAbs, { recursive: true });
  await writeReportJson(
    `${SPRINT_2G_REPORT_ROOT}/official-source-acquisition.json`,
    officialAcquisition
  );
  await writeReportJson(
    `${SPRINT_2G_REPORT_ROOT}/osm-administrative-candidates.json`,
    osmCandidates
  );
  await writeReportJson(
    `${SPRINT_2G_REPORT_ROOT}/fatih-before-after-quality.json`,
    fatihBeforeAfter
  );
  await writeReportJson(
    `${SPRINT_2G_REPORT_ROOT}/fatih-boundary-comparison.json`,
    fatihBoundaryComparison
  );
  await writeReportJson(`${SPRINT_2G_REPORT_ROOT}/istanbul-eight-district-geometry-matrix.json`, {
    schemaVersion: "territorykit-tr-sprint-2g-istanbul-eight-district-geometry-matrix@1",
    generatedAt: GENERATED_AT,
    rc8Root: RC8_ROOT,
    districts: districtMatrix
  });
  await writeReportJson(
    `${SPRINT_2G_REPORT_ROOT}/geometry-source-provenance.json`,
    geometryProvenance
  );
  await writeReportJson(
    `${SPRINT_2G_REPORT_ROOT}/experimental-candidate-readiness.json`,
    experimentalReadiness
  );
  await writeReportJson(
    `${SPRINT_2G_REPORT_ROOT}/gameplay-id-migration-impact.json`,
    gameplayMigrationImpact
  );
  await writeReportJson(`${SPRINT_2G_REPORT_ROOT}/sprint-2g-decision.json`, sprintDecision);

  await writeReportMarkdown(
    `${SPRINT_2G_REPORT_ROOT}/SPRINT-2G-FINAL-REPORT.md`,
    buildFinalReportMarkdown({
      sprintDecision,
      districtMatrix,
      gates,
      kadikoyInvestigation,
      osmCandidates
    })
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        reportRoot: SPRINT_2G_REPORT_ROOT,
        verifiedOsmAdministrativePolygons: verifiedOsmPolygonCount,
        geographicalProductAcceptance: sprintDecision.geographicalProductAcceptance,
        osmExtractBlocked: Boolean(osmExtract.blocked)
      },
      null,
      2
    )
  );
}

function buildFinalReportMarkdown({
  sprintDecision,
  districtMatrix,
  gates,
  kadikoyInvestigation,
  osmCandidates
}) {
  return `# Sprint 2G — İstanbul mahalle geometry validation

**Generated:** ${GENERATED_AT}  
**Main baseline:** \`${sprintDecision.repository.mainBaselineSha}\`  
**Branch HEAD:** \`${sprintDecision.repository.headSha ?? "unknown"}\`

## A. Repository

| Field | Value |
| --- | --- |
| Branch | \`feat/tr-istanbul-mahalle-geometry-validation\` |
| Geographical product acceptance | **${sprintDecision.geographicalProductAcceptance}** |

## B. Source discovery

- Verified official mahalle polygons: **0**
- OSM administrative polygon features (pilot parents): **${sprintDecision.counts.verifiedOsmAdministrativePolygons}**
- Kadıköy official acquisition: **${kadikoyInvestigation.decision?.status ?? "BLOCKED_BY_SOURCE"}**

## C. Fatih geometry QA

- Gameplay remains **rc.8 pinned smart-derived v1.7** (immutable).
- Smart-derived v2 / hybrid: **NO_GO** (historical Sprint 2B.4).
- OSM administrative layer: research candidate only (\`GO_WITH_REVIEW\` technical QA when polygons present).

## D. Istanbul pilots (8 districts)

| District | Classification | OSM admin polys | Gameplay zones |
| --- | --- | ---: | ---: |
${districtMatrix
  .map(
    (row) =>
      `| ${row.district} | ${row.classification} | ${row.osmAdministrativePolygons} | ${row.gameplayZoneCount} |`
  )
  .join("\n")}

## E. Acceptance gates

| Gate | Result |
| --- | --- |
| A Source discovery | ${gates.gateA_sourceDiscovery} |
| B Technical polygon QA | ${gates.gateB_technicalPolygonQa} |
| C Geographical quality | ${gates.gateC_geographicalQuality} |
| D Legal eligibility | ${gates.gateD_sourceLegalEligibility} |
| E Gameplay migration readiness | ${gates.gateE_gameplayMigrationReadiness} |
| F Production readiness | ${gates.gateF_productionReadiness} |

## F. Next action

${sprintDecision.nextTechnicalAction}

## Evidence

- OSM extract cache: \`${osmCandidates.cachePath ?? "not-created"}\`
- Map previews: \`${SPRINT_2G_REPORT_ROOT}/map-preview/\`
`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
