#!/usr/bin/env node
/**
 * Sprint 2E — OSM source evidence, Kadıköy investigation, human review queue, program gates.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeReportJson, writeReportMarkdown } from "./lib/write-report-json.mjs";
import { ISTANBUL_SETTLEMENT_IDENTITY_PILOTS } from "./lib/tr-mahalle-identity-istanbul-pilots.mjs";
import { buildMahalleIdentityDistrictReports } from "./lib/tr-mahalle-identity-layer-district.mjs";
import { buildMahalleHumanReviewQueue } from "./lib/tr-mahalle-human-review-queue.mjs";
import { investigateKadikoyOfficialShapefile } from "./investigate-kadikoy-official-shapefile.mjs";

const REPO_ROOT = process.cwd();
const REPORT_ROOT = "reports/tr-adm3/sprint-2e-source-evidence";
const IDENTITY_REPORT_ROOT =
  process.env.MAHALLE_IDENTITY_REPORT_ROOT ?? "reports/tr-adm3/mahalle-identity-layer";
const RC8_ROOT =
  process.env.MAHALLE_IDENTITY_RC8_ROOT ??
  ".territory/national-geometry-remediation/candidate-rc8-impl-rev1";
const OSM_SOURCE_LOCK =
  process.env.MAHALLE_IDENTITY_OSM_SOURCE_LOCK ??
  ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json";

async function buildDistrictEvidenceMatrix() {
  const rows = [];
  for (const pilot of ISTANBUL_SETTLEMENT_IDENTITY_PILOTS) {
    const result = await buildMahalleIdentityDistrictReports({
      repoRoot: REPO_ROOT,
      pilot,
      rc8Root: RC8_ROOT,
      osmSourceLockPath: OSM_SOURCE_LOCK,
      reportRoot: IDENTITY_REPORT_ROOT,
      writeArtifacts: false
    });

    if (result.blocked) {
      rows.push({
        district: pilot.district,
        slug: pilot.slug,
        parentAdm2Id: result.parentAdm2Id,
        rc8PinnedGeometryChecksum: "BLOCKED_BY_SOURCE",
        adm2ParentId: result.parentAdm2Id,
        osmBarrierSnapshotHash: null,
        sourceLockPath: OSM_SOURCE_LOCK,
        sourceBytesVerification: "BLOCKED_BY_SOURCE",
        localitySeedProvenance: "NOT_ASSESSED",
        sourceAvailability: "BLOCKED_BY_SOURCE",
        licenseState: "unknown",
        redistributionApproval: "pending",
        hostedDeliveryApproval: "pending",
        reasonCode: result.reasonCode,
        missingArtifact: result.missingArtifact
      });
      continue;
    }

    const evidence = result.sourceEvidence;
    rows.push({
      district: pilot.district,
      slug: pilot.slug,
      parentAdm2Id: result.parentAdm2Id,
      rc8PinnedGeometryChecksum: result.immutability.geometryHashSetSha256,
      adm2ParentId: result.parentAdm2Id,
      osmBarrierSnapshotHash: result.coverage.provenance.barrierSnapshotSha256,
      sourceLockPath: OSM_SOURCE_LOCK,
      sourceLockContentHash: evidence.sourceLockContentHash,
      sourceBytesVerification: evidence.gates.sourceBytesVerified ? "VERIFIED" : "FAILED",
      localitySeedProvenance: "osm-barrier-locality-seeds",
      sourceAvailability: evidence.gates.sourceBytesVerified ? "AVAILABLE" : "BLOCKED_BY_SOURCE",
      licenseState: evidence.licenseState,
      redistributionApproval: evidence.redistributionApproval,
      hostedDeliveryApproval: evidence.hostedDeliveryApproval,
      sourceEvidenceGates: evidence.gates,
      sourceEvidenceReasonCodes: evidence.reasonCodes,
      zoneCount: result.metrics.zoneCount,
      settlementCount: result.metrics.settlementCount,
      distinctNormalizedSeedNames: result.metrics.distinctSeedsRepresented,
      zoneIdSetSha256: result.immutability.zoneIdSetSha256,
      geometryHashSetSha256: result.immutability.geometryHashSetSha256,
      officialDataPolicy: pilot.officialDataPolicy ?? null
    });
  }
  return rows;
}

async function aggregateProgramTotals(matrixRows) {
  const active = matrixRows.filter((row) => row.zoneCount !== undefined);
  return {
    districtCount: matrixRows.length,
    gameplayZoneCount: active.reduce((sum, row) => sum + row.zoneCount, 0),
    settlementRecordCount: active.reduce((sum, row) => sum + row.settlementCount, 0),
    sourceBytesVerifiedDistricts: active.filter((row) => row.sourceBytesVerification === "VERIFIED")
      .length
  };
}

function programDecisions(matrixRows, kadikoyInvestigation, reviewQueue) {
  const allBytesVerified =
    matrixRows.length > 0 && matrixRows.every((row) => row.sourceBytesVerification === "VERIFIED");
  const kadikoyBlocked = kadikoyInvestigation.decision.status === "BLOCKED_BY_SOURCE";

  return {
    sourceIntegrity: allBytesVerified ? "GO_WITH_REVIEW" : "NO_GO",
    officialMahalleAccuracy: kadikoyBlocked ? "NO_GO" : "NO_GO",
    productionRelease: "NO_GO",
    technicalPilotPreserved: "GO_WITH_REVIEW",
    humanReviewQueueReady: reviewQueue.records.length > 0 ? "GO" : "NO_GO"
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const matrixRows = await buildDistrictEvidenceMatrix();
  const totals = await aggregateProgramTotals(matrixRows);
  const kadikoyInvestigation = await investigateKadikoyOfficialShapefile({ repoRoot: REPO_ROOT });
  const crossDistrictPath = join(IDENTITY_REPORT_ROOT, "istanbul-cross-district-qa.json");
  const reviewQueue = await buildMahalleHumanReviewQueue({
    repoRoot: REPO_ROOT,
    reportRoot: IDENTITY_REPORT_ROOT,
    crossDistrictQaPath: existsSync(join(REPO_ROOT, crossDistrictPath))
      ? crossDistrictPath
      : undefined
  });

  const immutabilityEvidence = [];
  for (const pilot of ISTANBUL_SETTLEMENT_IDENTITY_PILOTS) {
    const path = join(REPO_ROOT, IDENTITY_REPORT_ROOT, `${pilot.slug}-geometry-immutability.json`);
    if (!existsSync(path)) {
      continue;
    }
    const payload = JSON.parse(await readFile(path, "utf8"));
    immutabilityEvidence.push({
      district: pilot.district,
      zoneCount: payload.zoneCount,
      zoneIdSetSha256: payload.zoneIdSetSha256,
      geometryHashSetSha256: payload.geometryHashSetSha256,
      determinismVerified: payload.determinismVerified
    });
  }

  const decisions = programDecisions(matrixRows, kadikoyInvestigation, reviewQueue);
  const decisionDoc = {
    schemaVersion: "territorykit-tr-sprint-2e-decision@1",
    generatedAt,
    baselineMain: "a802f427453b700a358de036e3e7934a81b71a83",
    decisions,
    totals,
    reviewQueueSummary: reviewQueue.summary,
    kadikoyStatus: kadikoyInvestigation.decision.status,
    missingLegalEvidence: [
      "Municipal redistribution approval (Kadıköy and other official sources)",
      "Hosted tile/CDN delivery authorization",
      "Human review completion for ambiguous associations"
    ],
    paths: {
      districtMatrix: `${REPORT_ROOT}/istanbul-eight-district-source-evidence-matrix.json`,
      kadikoyInvestigation: `${REPORT_ROOT}/kadikoy-official-shapefile-investigation.json`,
      humanReviewQueue: `${REPORT_ROOT}/human-review-queue.json`,
      officialPolygonRequirements: `${REPORT_ROOT}/official-polygon-ingestion-evidence-requirements.json`
    }
  };

  await mkdir(join(REPO_ROOT, REPORT_ROOT), { recursive: true });

  await writeReportJson(`${REPORT_ROOT}/istanbul-eight-district-source-evidence-matrix.json`, {
    schemaVersion: "territorykit-tr-sprint-2e-district-source-evidence@1",
    generatedAt,
    rc8Root: RC8_ROOT,
    osmSourceLockPath: OSM_SOURCE_LOCK,
    districts: matrixRows
  });

  await writeReportJson(
    `${REPORT_ROOT}/kadikoy-official-shapefile-investigation.json`,
    kadikoyInvestigation
  );

  await writeReportJson(`${REPORT_ROOT}/human-review-queue.json`, reviewQueue);

  await writeReportJson(`${REPORT_ROOT}/official-polygon-ingestion-evidence-requirements.json`, {
    schemaVersion: "territorykit-tr-official-polygon-ingestion-evidence@1",
    generatedAt,
    requirements: kadikoyInvestigation.officialPolygonIngestionEvidenceRequirements,
    note: "Satisfying technical bundle validation does not imply legal approval or production eligibility."
  });

  await writeReportJson(`${REPORT_ROOT}/geometry-immutability-evidence.json`, {
    schemaVersion: "territorykit-tr-sprint-2e-geometry-immutability@1",
    generatedAt,
    districts: immutabilityEvidence
  });

  await writeReportJson(`${REPORT_ROOT}/sprint-2e-decision.json`, decisionDoc);

  await writeReportMarkdown(
    `${REPORT_ROOT}/OZET.md`,
    buildOzetMarkdown(decisionDoc, matrixRows, reviewQueue, kadikoyInvestigation)
  );

  console.log(
    JSON.stringify(
      {
        ok: decisions.sourceIntegrity !== "NO_GO",
        decisions,
        totals,
        reviewQueueRecords: reviewQueue.records.length
      },
      null,
      2
    )
  );
}

function buildOzetMarkdown(decisionDoc, matrixRows, reviewQueue, kadikoyInvestigation) {
  const table = matrixRows
    .map(
      (row) =>
        `| ${row.district} | ${row.sourceBytesVerification ?? row.reasonCode} | ${row.zoneCount ?? "—"} | ${row.settlementCount ?? "—"} | ${row.distinctNormalizedSeedNames ?? "—"} |`
    )
    .join("\n");

  return `# Sprint 2E — Source evidence governance

## Gates

| Gate | Decision |
| --- | --- |
| Source integrity | **${decisionDoc.decisions.sourceIntegrity}** |
| Official mahalle accuracy | **${decisionDoc.decisions.officialMahalleAccuracy}** |
| Production release | **${decisionDoc.decisions.productionRelease}** |

## Eight-district OSM / rc.8 evidence

| District | Source bytes | Zones | Settlements | Distinct seeds |
| --- | --- | ---: | ---: | ---: |
${table}

## Human review queue

- Records: **${reviewQueue.records.length}**
- Ambiguous zone records: **${reviewQueue.summary.ambiguousZoneRecords}**
- Unseeded zone records: **${reviewQueue.summary.unseededZoneRecords}**

## Kadıköy official shapefile

- Status: **${kadikoyInvestigation.decision.status}**
- Historical identical companion bytes: **${kadikoyInvestigation.historicalAudit.identicalBytesAcrossCompanions}**

Başakşehir gameplay zones: **20** (settlement records **33**, distinct normalized seed names **32**).
`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
