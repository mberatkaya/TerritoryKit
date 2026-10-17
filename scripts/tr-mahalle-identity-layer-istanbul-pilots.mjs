#!/usr/bin/env node
/**
 * Sprint 2D — Istanbul settlement identity pilots (8 districts) on pinned rc.8 gameplay shards.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { writeReportJson, writeReportMarkdown } from "./lib/write-report-json.mjs";
import { buildMahalleIdentityDistrictReports } from "./lib/tr-mahalle-identity-layer-district.mjs";
import {
  ISTANBUL_SETTLEMENT_IDENTITY_PILOTS,
  FATIH_REGRESSION_METRICS
} from "./lib/tr-mahalle-identity-istanbul-pilots.mjs";

const REPO_ROOT = process.cwd();
const REPORT_ROOT =
  process.env.MAHALLE_IDENTITY_REPORT_ROOT ?? "reports/tr-adm3/mahalle-identity-layer";

function reportPath(...segments) {
  const root = isAbsolute(REPORT_ROOT) ? REPORT_ROOT : join(REPO_ROOT, REPORT_ROOT);
  return join(root, ...segments);
}

function parseDistrictFilter(argv) {
  const onlyFlag = argv.find((arg) => arg.startsWith("--only="));
  if (onlyFlag) {
    return onlyFlag
      .slice("--only=".length)
      .split(",")
      .map((s) => s.trim());
  }
  if (process.env.MAHALLE_IDENTITY_PILOT_SLUGS) {
    return process.env.MAHALLE_IDENTITY_PILOT_SLUGS.split(",").map((s) => s.trim());
  }
  return null;
}

function technicalDecisionForRow(row, result) {
  if (result.blocked) {
    return "BLOCKED_BY_SOURCE";
  }
  if (!result.immutability?.determinismVerified) {
    return "NO_GO";
  }
  if (!result.lookupSmoke?.consumerLoadOk) {
    return "NO_GO";
  }
  return "GO_WITH_REVIEW";
}

async function main() {
  const slugFilter = parseDistrictFilter(process.argv.slice(2));
  const pilots = slugFilter
    ? ISTANBUL_SETTLEMENT_IDENTITY_PILOTS.filter((p) => slugFilter.includes(p.slug))
    : ISTANBUL_SETTLEMENT_IDENTITY_PILOTS;

  if (pilots.length === 0) {
    throw new Error("No pilots matched filter");
  }

  const generatedAt = new Date().toISOString();
  const stressSlugs = ["adalar", "eyupsultan", "kadikoy"];
  const stressResults = [];
  const matrixRows = [];
  const blocked = [];

  for (const pilot of pilots) {
    const result = await buildMahalleIdentityDistrictReports({
      repoRoot: REPO_ROOT,
      pilot,
      reportRoot: REPORT_ROOT
    });

    if (stressSlugs.includes(pilot.slug)) {
      stressResults.push({ slug: pilot.slug, result });
    }

    if (result.blocked) {
      blocked.push(result);
      matrixRows.push({
        district: pilot.district,
        slug: pilot.slug,
        parentAdm2Id: result.parentAdm2Id,
        technicalPilotDecision: "BLOCKED_BY_SOURCE",
        officialMahalleAccuracy: "NOT_ASSESSED",
        productionRelease: "NO_GO",
        reasonCode: result.reasonCode,
        missingArtifact: result.missingArtifact,
        zoneCount: "NOT_ASSESSED",
        settlementCount: "NOT_ASSESSED",
        ambiguousZoneCount: "NOT_ASSESSED",
        singleCandidateZoneCount: "NOT_ASSESSED",
        unseededZoneCount: "NOT_ASSESSED",
        zoneIdSetSha256: "BLOCKED_BY_SOURCE",
        geometryHashSetSha256: "BLOCKED_BY_SOURCE",
        identityLayerContentChecksum: "BLOCKED_BY_SOURCE",
        osmSourceLockState: "NOT_ASSESSED",
        missingSourceReasonCode: result.reasonCode
      });
      continue;
    }

    const tech = technicalDecisionForRow(pilot, result);
    matrixRows.push({
      district: pilot.district,
      slug: pilot.slug,
      parentAdm2Id: result.parentAdm2Id,
      parentAdm2NameVerified: result.parentAdm2Name,
      stressPhase: pilot.stressPhase ?? "expansion",
      technicalPilotDecision: tech,
      officialMahalleAccuracy:
        pilot.officialDataPolicy?.status === "BLOCKED_BY_SOURCE"
          ? "BLOCKED_BY_SOURCE"
          : "REVIEW_REQUIRED",
      productionRelease: "NO_GO",
      zoneCount: result.metrics.zoneCount,
      settlementCount: result.metrics.settlementCount,
      associationCount: result.metrics.associationCount,
      ambiguousZoneCount: result.metrics.ambiguousZoneCount,
      singleCandidateZoneCount: result.metrics.singleSeedZoneCount,
      unseededZoneCount: result.metrics.unseededZoneCount,
      distinctSeedsRepresented: result.metrics.distinctSeedsRepresented,
      zoneIdSetSha256: result.immutability.zoneIdSetSha256,
      geometryHashSetSha256: result.immutability.geometryHashSetSha256,
      identityLayerContentChecksum: result.immutability.identityLayerContentChecksum,
      gameplayDatasetVersion: result.layer.gameplayDatasetVersion,
      determinismVerified: result.immutability.determinismVerified,
      consumerLoadOk: result.lookupSmoke.consumerLoadOk,
      osmSourceLockState: result.coverage.provenance.osmSourceLockState,
      missingSourceReasonCode: result.coverage.provenance.missingSourceReasonCode ?? null,
      officialDataPolicy: pilot.officialDataPolicy ?? null
    });
  }

  const stressFailed = stressResults.some(
    (row) => row.result.blocked || technicalDecisionForRow(null, row.result) === "NO_GO"
  );

  const crossDistrict = await buildCrossDistrictEvidence(matrixRows);

  const fatihRow = matrixRows.find((row) => row.slug === "fatih");
  const fatihRegressionOk =
    fatihRow &&
    fatihRow.zoneCount === FATIH_REGRESSION_METRICS.zoneCount &&
    fatihRow.ambiguousZoneCount === FATIH_REGRESSION_METRICS.ambiguousZoneCount &&
    fatihRow.zoneIdSetSha256 === FATIH_REGRESSION_METRICS.zoneIdSetSha256;

  const programDecision = {
    schemaVersion: "territorykit-tr-mahalle-identity-sprint-2d-decision@1",
    generatedAt,
    baselinePr: {
      number: 119,
      mergeCommit: "a716f6fe",
      note: "SettlementIdentityLayer canonical API on main"
    },
    decisions: {
      technicalPilot:
        blocked.length > 0 || stressFailed
          ? blocked.length === pilots.length
            ? "BLOCKED_BY_SOURCE"
            : "PARTIAL_GO_WITH_REVIEW"
          : "GO_WITH_REVIEW",
      officialMahalleAccuracy: "NO_GO",
      productionRelease: "NO_GO"
    },
    stressPhase: {
      districts: stressSlugs,
      passed: stressResults.length === 0 ? "NOT_ASSESSED" : !stressFailed
    },
    fatihRegressionOk,
    blockedDistricts: blocked,
    matrixPath: `${REPORT_ROOT}/istanbul-pilot-matrix.json`,
    crossDistrictQaPath: `${REPORT_ROOT}/istanbul-cross-district-qa.json`,
    rationale: [
      "Semantic association only — gameplay rc.8 geometry and zone IDs are read-only inputs.",
      "OSM locality seeds are not official mahalle polygons; autoDisplayNameAllowed remains false without human review.",
      "Missing OSM source-lock is recorded explicitly; never marked verified without lock bytes.",
      "Kadıköy official municipal bundle remains BLOCKED_BY_SOURCE; seed layer does not substitute licensed boundaries."
    ]
  };

  await writeReportJson(`${REPORT_ROOT}/istanbul-pilot-matrix.json`, {
    schemaVersion: "territorykit-tr-mahalle-identity-istanbul-matrix@1",
    generatedAt,
    rc8Root:
      process.env.MAHALLE_IDENTITY_RC8_ROOT ??
      ".territory/national-geometry-remediation/candidate-rc8-impl-rev1",
    districts: matrixRows
  });

  await writeReportJson(`${REPORT_ROOT}/istanbul-cross-district-qa.json`, crossDistrict);

  await writeReportMarkdown(
    `${REPORT_ROOT}/sprint-2d-decision.md`,
    buildDecisionMarkdown(programDecision, matrixRows, crossDistrict)
  );
  await writeReportJson(`${REPORT_ROOT}/sprint-2d-decision.json`, programDecision);

  console.log(
    JSON.stringify(
      {
        ok: blocked.length === 0 && !stressFailed,
        programDecision: programDecision.decisions,
        districtCount: matrixRows.length,
        blockedCount: blocked.length,
        stressPassed: !stressFailed,
        fatihRegressionOk
      },
      null,
      2
    )
  );

  if (blocked.length > 0 || stressFailed) {
    process.exitCode = 1;
  }
}

async function buildCrossDistrictEvidence(matrixRows) {
  const active = matrixRows.filter((row) => row.zoneIdSetSha256 !== "BLOCKED_BY_SOURCE");
  const settlementIdOwners = new Map();
  const normalizedNameOwners = new Map();

  for (const row of active) {
    const settlements = JSON.parse(
      await readFile(reportPath(`${row.slug}-settlement-identities.json`), "utf8")
    );
    for (const settlement of settlements.settlements) {
      const owners = settlementIdOwners.get(settlement.settlementId) ?? [];
      owners.push({ district: row.district, parentAdm2Id: row.parentAdm2Id });
      settlementIdOwners.set(settlement.settlementId, owners);

      const norm = settlement.normalizedName ?? settlement.displayName;
      const nameOwners = normalizedNameOwners.get(norm) ?? [];
      nameOwners.push(row.district);
      normalizedNameOwners.set(norm, nameOwners);
    }
  }

  const duplicateSettlementIds = [...settlementIdOwners.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([settlementId, owners]) => ({ settlementId, owners }));

  const sameNameDifferentDistricts = [...normalizedNameOwners.entries()]
    .filter(([, districts]) => new Set(districts).size > 1)
    .map(([normalizedName, districts]) => ({ normalizedName, districts }));

  return {
    schemaVersion: "territorykit-tr-mahalle-identity-cross-district-qa@1",
    generatedAt: new Date().toISOString(),
    duplicateCanonicalSettlementIds: duplicateSettlementIds,
    sameNormalizedNameAcrossDistricts: sameNameDifferentDistricts,
    duplicateSettlementIdCount: duplicateSettlementIds.length,
    crossNameCollisionCount: sameNameDifferentDistricts.length,
    note: "Same normalized name across districts is expected; duplicate canonical settlement IDs across parents require review evidence."
  };
}

function buildDecisionMarkdown(programDecision, matrixRows, crossDistrict) {
  const table = matrixRows
    .map(
      (row) =>
        `| ${row.district} | ${row.technicalPilotDecision} | ${row.zoneCount} | ${row.settlementCount ?? "—"} | ${row.ambiguousZoneCount ?? "—"} | ${row.unseededZoneCount ?? "—"} |`
    )
    .join("\n");

  return `# Sprint 2D — Istanbul settlement identity pilots

## Program decisions

| Gate | Decision |
| --- | --- |
| Technical pilot | **${programDecision.decisions.technicalPilot}** |
| Official mahalle accuracy | **${programDecision.decisions.officialMahalleAccuracy}** |
| Production release | **${programDecision.decisions.productionRelease}** |

Stress phase (Adalar, Eyüpsultan, Kadıköy): **${programDecision.stressPhase.passed}**

Fatih regression (Sprint 2C pins): **${programDecision.fatihRegressionOk ? "PASS" : "FAIL"}**

## District matrix

| District | Technical | Zones | Settlements | Ambiguous | Unseeded |
| --- | --- | ---: | ---: | ---: | ---: |
${table}

## Cross-district QA

- Duplicate canonical settlement IDs: **${crossDistrict.duplicateSettlementIdCount}**
- Same normalized name across districts (informational): **${crossDistrict.crossNameCollisionCount}**

Artifacts: \`istanbul-pilot-matrix.json\`, per-district \`*-consumer-pin.json\`, \`istanbul-cross-district-qa.json\`.
`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
