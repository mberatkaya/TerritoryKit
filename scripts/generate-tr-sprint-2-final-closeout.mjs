#!/usr/bin/env node
import { execSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  buildPilotMapHtml,
  runSprint2FinalCloseoutAssessment,
  SPRINT_2_FINAL_REPORT_ROOT,
  writePilotVisualComparisonArtifacts,
  writeResearchDatasetArtifacts
} from "./lib/tr-sprint-2-final-closeout.mjs";
import { writeReportJson, writeReportMarkdown } from "./lib/write-report-json.mjs";

const REPO_ROOT = process.cwd();
const GENERATED_AT = process.env.SPRINT_2_FINAL_GENERATED_AT ?? new Date().toISOString();

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const reportRoot = join(REPO_ROOT, SPRINT_2_FINAL_REPORT_ROOT);
  const previewRoot = join(reportRoot, "pilot-visual-comparison");
  await mkdir(previewRoot, { recursive: true });

  const headSha = gitHead();
  const assessment = await runSprint2FinalCloseoutAssessment(REPO_ROOT, GENERATED_AT);
  assessment.closeoutDecision.headSha = headSha;

  await writeReportJson(join(reportRoot, "candidate-inventory.json"), {
    ...assessment.candidateInventory,
    generatedAt: GENERATED_AT,
    headSha
  });

  await writeReportJson(join(reportRoot, "polygon-qa-results.json"), {
    schemaVersion: "territorykit-tr-sprint-2-final-polygon-qa@1",
    generatedAt: GENERATED_AT,
    headSha,
    extractionBlocked: assessment.extractionBlocked,
    sourceIntegrity: assessment.sourceIntegrity,
    polygonCount: assessment.polygonQaResults.length,
    results: assessment.polygonQaResults
  });

  await writeReportJson(join(reportRoot, "semantic-screening.json"), {
    ...assessment.semanticScreening,
    generatedAt: GENERATED_AT,
    headSha,
    osmCandidateReviewBatch: {
      note: "Separate from Sprint 2F gameplay human-review ledger; all OSM candidates remain unapproved.",
      recordCount: assessment.semanticScreening.records.length,
      pendingCount: assessment.semanticScreening.records.length
    }
  });

  await writeReportJson(join(reportRoot, "district-coverage-matrix.json"), {
    ...assessment.districtCoverageMatrix,
    generatedAt: GENERATED_AT,
    headSha
  });

  await writeReportJson(join(reportRoot, "parent-boundary-discrepancies.json"), {
    ...assessment.parentBoundaryDiscrepancies,
    generatedAt: GENERATED_AT,
    headSha
  });

  await writeReportJson(join(reportRoot, "source-and-license-status.json"), {
    ...assessment.sourceLicense,
    generatedAt: GENERATED_AT,
    headSha
  });

  await writeResearchDatasetArtifacts(
    REPO_ROOT,
    SPRINT_2_FINAL_REPORT_ROOT,
    assessment.researchDataset
  );

  await writeReportJson(join(reportRoot, "national-readiness.json"), {
    ...assessment.nationalReadiness,
    generatedAt: GENERATED_AT,
    headSha
  });

  await writeReportJson(join(reportRoot, "closeout-decision.json"), assessment.closeoutDecision);

  await writePilotVisualComparisonArtifacts(
    REPO_ROOT,
    SPRINT_2_FINAL_REPORT_ROOT,
    assessment.pilotVisuals,
    {
      buildHtml: buildPilotMapHtml
    }
  );

  const disposition = assessment.closeoutDecision.dispositionRollup;
  const report = `# Sprint 2 final geospatial closeout

**Generated:** ${GENERATED_AT}  
**HEAD:** ${headSha ?? "unknown"}  
**Extraction blocked:** ${assessment.extractionBlocked ? "yes (used Sprint 2H rollup where needed)" : "no"}

## Product decision

| Area | Decision |
| --- | --- |
| Engineering scope completed | ${assessment.closeoutDecision.decisions.engineeringScopeCompleted} |
| OSM recovery pipeline | ${assessment.closeoutDecision.decisions.osmRecoveryPipeline} |
| Individual polygon QA | ${assessment.closeoutDecision.decisions.individualPolygonQa} |
| Semantic boundary accuracy | ${assessment.closeoutDecision.decisions.semanticBoundaryAccuracy} |
| Source/legal eligibility | ${assessment.closeoutDecision.decisions.sourceLegalEligibility} |
| İstanbul geographical acceptance | ${assessment.closeoutDecision.decisions.istanbulGeographicalAcceptance} |
| Sprint 3 national readiness | ${assessment.closeoutDecision.decisions.sprint3NationalReadiness} |
| Sprint 4 integration readiness | ${assessment.closeoutDecision.decisions.sprint4IntegrationReadiness} |
| Production readiness | ${assessment.closeoutDecision.decisions.productionReadiness} |

## Acceptance questions (A–E)

- **A — OSM recovery:** ${assessment.closeoutDecision.acceptanceQuestions.A_osmPolygonRecovery.verdict} (${assessment.closeoutDecision.acceptanceQuestions.A_osmPolygonRecovery.recoveredCandidates} candidates)
- **B — Technical validity:** ${assessment.closeoutDecision.acceptanceQuestions.B_technicalValidity.verdict} (ring-valid: ${assessment.closeoutDecision.acceptanceQuestions.B_technicalValidity.ringValidCount})
- **C — Geographic accuracy:** ${assessment.closeoutDecision.acceptanceQuestions.C_geographicAccuracy.verdict}
- **D — Semantic mahalle/köy:** ${assessment.closeoutDecision.acceptanceQuestions.D_semanticMahalleBoundaries.verdict}
- **E — Legal distribution:** ${assessment.closeoutDecision.acceptanceQuestions.E_legalDistribution.verdict}

## Counts

- OSM research candidates: **${assessment.candidateInventory.candidateCount}**
- Dispositions: ${JSON.stringify(disposition)}
- Human semantic approvals: **0**
- Official verified polygons: **0**

## Representative pilots

MapLibre comparison GeoJSON/HTML under \`pilot-visual-comparison/\` are **local-only** (gitignored) until ODbL redistribution is project-approved. Historical git exposure is recorded in \`osm-geometry-historical-git-distribution.json\` (git history is not rewritten).

### Kadıköy
- 21 OSM research polygons; Kadıköy CKAN official mahalle SHP remains blocked (see \`source-and-license-status.json\`).
- Parent containment excursions and partial district coverage documented in \`polygon-qa-results.json\`.

### Fatih
- 48 OSM research polygons; country getid recovery explains 9 additional relations vs polygon clip (see Sprint 2H \`fatih-extraction-method-comparison.json\`).
- Smart-derived v1.7 historical NO_GO preserved; rc.8 gameplay geometry not modified.

### Adalar
- Island multipolygon topology assessed; no invented inter-island bridges.

## Remaining blockers

${assessment.nationalReadiness.blockers.map((row) => `- ${row}`).join("\n")}

## Engineering vs product

${assessment.closeoutDecision.remainingWork}
`;

  await writeReportMarkdown(join(reportRoot, "SPRINT-2-FINAL-REPORT.md"), report);

  console.log(`Sprint 2 final closeout reports written to ${SPRINT_2_FINAL_REPORT_ROOT}`);
}

await main();
