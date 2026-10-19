#!/usr/bin/env node
/**
 * Sprint 2F — human review decision ledger, progress report, technical decisions.
 */
import { mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeReportJson, writeReportMarkdown } from "./lib/write-report-json.mjs";
import { buildMahalleHumanReviewQueue } from "./lib/tr-mahalle-human-review-queue.mjs";
import {
  buildInitialMahalleHumanReviewDecisionLedger,
  loadDistrictReviewPins,
  summarizeMahalleHumanReviewProgress
} from "./lib/tr-mahalle-human-review-workflow.mjs";

const REPO_ROOT = process.cwd();
const REPORT_ROOT = "reports/tr-adm3/sprint-2f-human-review";
const QUEUE_SOURCE = "reports/tr-adm3/sprint-2e-source-evidence/human-review-queue.json";

async function main() {
  const generatedAt = new Date().toISOString();
  let queue;
  try {
    queue = JSON.parse(await readFile(join(REPO_ROOT, QUEUE_SOURCE), "utf8"));
  } catch {
    queue = await buildMahalleHumanReviewQueue({
      repoRoot: REPO_ROOT,
      reportRoot: "reports/tr-adm3/mahalle-identity-layer"
    });
  }

  const districtPins = await loadDistrictReviewPins({ repoRoot: REPO_ROOT, queue });
  const ledger = buildInitialMahalleHumanReviewDecisionLedger({
    repoRoot: REPO_ROOT,
    queue,
    districtPins
  });
  const progress = summarizeMahalleHumanReviewProgress(ledger);

  const technicalDecisions = {
    schemaVersion: "territorykit-tr-sprint-2f-technical-decisions@1",
    generatedAt,
    contracts: {
      gameplayTerritory: [
        "Stable zone IDs and rc.8 geometry are immutable without migration review.",
        "Human review cannot split gameplay polygons or change adjacency."
      ],
      settlementIdentity: [
        "Semantic label decisions are versioned and attributable.",
        "approved-semantic-label does not imply official mahalle boundary accuracy."
      ],
      officialAdministrativeGeometry: [
        "Verified official polygons require separate evidence bundle and license review.",
        "Seed points and OSM locality seeds are not official boundaries."
      ]
    },
    staleProtection: [
      "zone ID",
      "per-zone geometry hash",
      "settlement IDs",
      "OSM snapshot checksum",
      "identity layer version/checksum",
      "gameplay dataset version",
      "parent ADM2"
    ],
    distributionGates: {
      autoDisplayNameAllowed: "hard false until redistribution rights approved",
      productionRelease: "NO_GO",
      officialPolygonPromotion: "requires verified bytes + legal clearance"
    }
  };

  await mkdir(join(REPO_ROOT, REPORT_ROOT), { recursive: true });

  await writeReportJson(`${REPORT_ROOT}/human-review-queue-baseline.json`, queue);
  await writeReportJson(`${REPORT_ROOT}/human-review-decision-ledger.json`, ledger);
  await writeReportJson(`${REPORT_ROOT}/human-review-progress.json`, {
    schemaVersion: "territorykit-tr-sprint-2f-human-review-progress@1",
    generatedAt,
    progress,
    programBaseline: queue.programBaseline,
    queueSummary: queue.summary
  });
  await writeReportJson(`${REPORT_ROOT}/technical-decisions.json`, technicalDecisions);

  await writeReportMarkdown(
    `${REPORT_ROOT}/technical-decisions.md`,
    `# Sprint 2F — technical decisions

## Contract separation

- **Gameplay territory**: rc.8 zone IDs and geometry pins are authoritative for claim/scoring surfaces.
- **Settlement identity**: human semantic labels are versioned in \`human-review-decision-ledger.json\` and never overwrite gameplay geometry.
- **Official administrative geometry**: separate acquisition matrix; 0 verified mahalle polygons in this sprint.

## Stale review protection

Decisions are invalid when pinned context drifts: ${technicalDecisions.staleProtection.join(", ")}.

## Distribution

- \`autoDisplayNameAllowed\` remains **false** for all ${ledger.entries.length} baseline records.
- Attributed human decisions in ledger history: **${progress.attributedHumanDecisions}** (expected 0 at generation time).
`
  );

  await writeReportMarkdown(
    `${REPORT_ROOT}/OZET.md`,
    `# Sprint 2F — Human review workflow

| Metric | Value |
| --- | ---: |
| Review records | ${progress.reviewRecordCount} |
| Pending | ${progress.pendingRecords} |
| Attributed human decisions | ${progress.attributedHumanDecisions} |
| Official verified polygons | ${progress.officialVerifiedPolygonCount} |

Local review UI: \`examples/web-maplibre-turkey/mahalle-human-review.html\` (Vite dev server).
`
  );

  console.log(JSON.stringify({ ok: true, progress, reportRoot: REPORT_ROOT }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
