#!/usr/bin/env node
/**
 * Sprint 3 nationwide playable-v3 closeout (coordinate-free metrics; reads local candidate bytes).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeReportJson, writeReportMarkdown } from "./lib/write-report-json.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CANDIDATE = path.join(ROOT, ".territory/sprint-3/playable-v3/candidate");
const DEFAULT_RC7 = path.join(ROOT, ".territory/sprint-6/final/candidate");
const DEFAULT_RC8 = path.join(
  ROOT,
  ".territory/national-geometry-remediation/candidate-rc8-impl-rev1"
);
const OUT_DIR = path.join(ROOT, "reports/tr-adm3/sprint-3-national-playable-v3");

function parseArgs(argv) {
  const options = {
    candidateRoot: DEFAULT_CANDIDATE,
    rc7Root: DEFAULT_RC7,
    rc8Root: DEFAULT_RC8,
    outDir: OUT_DIR
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--candidate") options.candidateRoot = path.resolve(ROOT, argv[++i]);
    else if (arg === "--rc7") options.rc7Root = path.resolve(ROOT, argv[++i]);
    else if (arg === "--rc8") options.rc8Root = path.resolve(ROOT, argv[++i]);
    else if (arg === "--out-dir") options.outDir = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function inspectedCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function readJsonOptional(absolutePath) {
  if (!existsSync(absolutePath)) return null;
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

function summarizeSmartCoverage(smartCoverage, label) {
  if (!smartCoverage) {
    return { label, status: "MISSING", totals: null };
  }
  const districts = smartCoverage.districts ?? [];
  const zeroZone = districts.filter((d) => (d.zoneCount ?? 0) <= 0).length;
  const emergencySingle = districts.filter(
    (d) => d.zoneCount === 1 && d.selectedSourceTier !== "unavailable"
  ).length;
  const lowConfidence = districts.filter((d) => d.confidence === "low").length;
  const oversized = districts.filter((d) => (d.largestTerritoryAreaShare ?? 0) > 0.35).length;
  const straightViolations = districts.filter(
    (d) => (d.axisAlignedInternalBoundaryRatio ?? 0) > 0.15
  ).length;
  const adm3Zones = districts.reduce((sum, d) => sum + (d.zoneCount ?? 0), 0);
  return {
    label,
    status: "PRESENT",
    datasetVersion: smartCoverage.datasetVersion ?? null,
    totals: smartCoverage.totals ?? null,
    zoneTotals: smartCoverage.zoneTotals ?? null,
    uncoveredPercent: smartCoverage.uncoveredPercent ?? null,
    derived: {
      adm3ZoneCountRollup: adm3Zones,
      zeroZoneDistricts: zeroZone,
      emergencySingleParentDistricts: emergencySingle,
      lowConfidenceDistricts: lowConfidence,
      oversizedCellDistricts: oversized,
      unsupportedStraightThresholdDistricts: straightViolations
    }
  };
}

function worstDistricts(smartCoverage, limit = 10) {
  const districts = smartCoverage?.districts ?? [];
  const ranked = districts
    .map((d) => ({
      adm2Id: d.adm2Id,
      district: d.district,
      province: d.province,
      zoneCount: d.zoneCount,
      confidence: d.confidence,
      smartMode: d.smartMode,
      largestTerritoryAreaShare: d.largestTerritoryAreaShare ?? null,
      axisAlignedInternalBoundaryRatio: d.axisAlignedInternalBoundaryRatio ?? null,
      barrierAlignment: d.barrierAlignment ?? null,
      qualityScore: d.quality ?? null,
      rankingEvidence:
        typeof d.largestTerritoryAreaShare === "number" ||
        typeof d.axisAlignedInternalBoundaryRatio === "number" ||
        d.confidence === "low" ||
        (d.zoneCount ?? 0) <= 0 ||
        d.zoneCount === 1
    }))
    .filter((row) => row.rankingEvidence)
    .sort((a, b) => {
      const impact = (row) =>
        (row.zoneCount <= 0 ? 1_000_000 : 0) +
        (row.zoneCount === 1 ? 500_000 : 0) +
        (row.confidence === "low" ? 250_000 : 0) +
        (typeof row.largestTerritoryAreaShare === "number" ? row.largestTerritoryAreaShare : 0) *
          10_000 +
        (typeof row.axisAlignedInternalBoundaryRatio === "number"
          ? row.axisAlignedInternalBoundaryRatio
          : 0) *
          5_000;
      return impact(b) - impact(a);
    })
    .slice(0, limit);
  return {
    disclaimer:
      "Sıralama yalnızca ölçüm veya güven kanıtı olan ilçeleri içerir; null metrikler sıfır veya PASS sayılmaz.",
    districts: ranked
  };
}

function eyupsultanDelta(baseline, candidate) {
  const find = (coverage) =>
    (coverage?.districts ?? []).find((d) => d.adm2Id === "tr:adm2:54988432b93840376788897");
  const before = find(baseline);
  const after = find(candidate);
  if (!before || !after) return { status: "MISSING_BASELINE_OR_CANDIDATE", before, after };
  return {
    status: "COMPARED",
    before: {
      zoneCount: before.zoneCount,
      smartMode: before.smartMode,
      confidence: before.confidence,
      largestTerritoryAreaShare: before.largestTerritoryAreaShare,
      axisAlignedInternalBoundaryRatio: before.axisAlignedInternalBoundaryRatio
    },
    after: {
      zoneCount: after.zoneCount,
      smartMode: after.smartMode,
      confidence: after.confidence,
      largestTerritoryAreaShare: after.largestTerritoryAreaShare,
      axisAlignedInternalBoundaryRatio: after.axisAlignedInternalBoundaryRatio
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const candidateSmart = await readJsonOptional(
    path.join(options.candidateRoot, "smart-coverage.json")
  );
  const candidatePerformance = await readJsonOptional(
    path.join(options.candidateRoot, "../reports/performance.json")
  );
  const rc7Smart = await readJsonOptional(path.join(options.rc7Root, "smart-coverage.json"));
  const rc8Smart = await readJsonOptional(path.join(options.rc8Root, "smart-coverage.json"));

  const checkpointRoot = path.join(options.candidateRoot, "districts");
  let checkpointDistrictFiles = 0;
  if (existsSync(checkpointRoot)) {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(checkpointRoot);
    checkpointDistrictFiles = files.filter((name) => name.endsWith(".json")).length;
  }

  const report = {
    schemaVersion: "territorykit-tr-sprint-3-playable-v3-closeout@1",
    generatedAt: new Date().toISOString(),
    inspectedCommit: inspectedCommit(),
    paths: {
      candidateRoot: path.relative(ROOT, options.candidateRoot),
      rc7Root: path.relative(ROOT, options.rc7Root),
      rc8Root: path.relative(ROOT, options.rc8Root)
    },
    candidate: summarizeSmartCoverage(candidateSmart, "playable-v3"),
    baselines: {
      rc7: summarizeSmartCoverage(rc7Smart, "rc.7"),
      rc8: existsSync(options.rc8Root)
        ? summarizeSmartCoverage(rc8Smart, "rc.8")
        : { status: "NOT_PRESENT" }
    },
    eyupsultan: eyupsultanDelta(rc7Smart, candidateSmart),
    worstRemainingDistricts: worstDistricts(candidateSmart, 10),
    runtime: {
      performanceReportPresent: Boolean(candidatePerformance),
      checkpointDistrictFiles,
      ...(candidatePerformance
        ? {
            durationMs: candidatePerformance.durationMs,
            resumedAdm2Count: candidatePerformance.resumedAdm2Count,
            newlyBuiltAdm2Count: candidatePerformance.newlyBuiltAdm2Count,
            p95Adm2Ms: candidatePerformance.p95Adm2Ms
          }
        : {})
    },
    validation: {
      candidateDatasetPresent: existsSync(path.join(options.candidateRoot, "dataset.json")),
      nationalValidateCommand:
        "pnpm --filter @territory-kit/cli build && node packages/cli/dist/index.mjs tr v2 national validate --output .territory/sprint-3/playable-v3/candidate"
    }
  };

  await writeReportJson(path.join(options.outDir, "nationwide-closeout.json"), report);
  const md = `# Sprint 3 nationwide playable-v3 closeout

**Generated (UTC):** ${report.generatedAt}  
**Commit:** \`${report.inspectedCommit ?? "unknown"}\`  
**Candidate:** \`${report.paths.candidateRoot}\`

## Coverage summary

| Metric | playable-v3 | rc.7 |
| --- | ---: | ---: |
| ADM2 attempted | ${report.candidate.totals?.adm2Attempted ?? "—"} | ${report.baselines.rc7.totals?.adm2Attempted ?? "—"} |
| ADM2 successful | ${report.candidate.totals?.adm2Successful ?? "—"} | ${report.baselines.rc7.totals?.adm2Successful ?? "—"} |
| ADM3 zones (rollup) | ${report.candidate.derived?.adm3ZoneCountRollup ?? "—"} | ${report.baselines.rc7.derived?.adm3ZoneCountRollup ?? "—"} |
| Zero-zone districts | ${report.candidate.derived?.zeroZoneDistricts ?? "—"} | ${report.baselines.rc7.derived?.zeroZoneDistricts ?? "—"} |
| Low-confidence districts | ${report.candidate.derived?.lowConfidenceDistricts ?? "—"} | ${report.baselines.rc7.derived?.lowConfidenceDistricts ?? "—"} |
| Oversized-cell districts | ${report.candidate.derived?.oversizedCellDistricts ?? "—"} | ${report.baselines.rc7.derived?.oversizedCellDistricts ?? "—"} |

## Eyüpsultan delta (rc.7 → v3)

\`\`\`json
${JSON.stringify(report.eyupsultan, null, 2)}
\`\`\`

Map previews (local only): \`.territory/sprint-3/playable-v3/map-preview/\`
`;
  await writeReportMarkdown(path.join(options.outDir, "OZET.md"), md);
  console.log(`Wrote ${path.join(options.outDir, "nationwide-closeout.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
