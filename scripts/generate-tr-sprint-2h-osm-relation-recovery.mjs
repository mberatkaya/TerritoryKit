#!/usr/bin/env node
import { execSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  writeReportGeoJson,
  writeReportJson,
  writeReportMarkdown
} from "./lib/write-report-json.mjs";
import { buildMahalleIdentityDistrictReports } from "./lib/tr-mahalle-identity-layer-district.mjs";
import {
  SPRINT_2H_REPORT_ROOT,
  buildDistrictMatrix,
  buildExtendedMapPreview,
  buildPolygonTechnicalQa,
  buildRecoveredPolygonsReport,
  buildSprint2hDecision,
  compareDistrictExtractionMethods,
  diagnoseRelationCompleteness,
  extractAllPilotDistricts,
  loadSprint2gBaseline,
  rollupGeometryQaCounts,
  verifyOriginalSourceIntegrity
} from "./lib/tr-sprint-2h-osm-relation-recovery.mjs";
import { pilotBySlug } from "./lib/tr-mahalle-identity-istanbul-pilots.mjs";
import {
  assessDistrictGeometryQa,
  buildGameplayOverlayReport,
  loadRc8DistrictContext,
  orderedIstanbulPilots
} from "./lib/tr-sprint-2g-geometry-validation.mjs";

const REPO_ROOT = process.cwd();
const GENERATED_AT = process.env.SPRINT_2H_GENERATED_AT ?? new Date().toISOString();
const RC8_ROOT =
  process.env.SPRINT_2H_RC8_ROOT ??
  ".territory/national-geometry-remediation/candidate-rc8-impl-rev1";

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const reportRoot = join(REPO_ROOT, SPRINT_2H_REPORT_ROOT);
  const previewRoot = join(reportRoot, "map-preview");
  await mkdir(previewRoot, { recursive: true });

  const headSha = gitHead();
  const sourceIntegrity = await verifyOriginalSourceIntegrity(REPO_ROOT);
  const sprint2gBaseline = await loadSprint2gBaseline(REPO_ROOT);

  const fatihContext = await loadRc8DistrictContext(
    REPO_ROOT,
    orderedIstanbulPilots().find((row) => row.slug === "fatih"),
    RC8_ROOT
  );
  const adalarContext = await loadRc8DistrictContext(
    REPO_ROOT,
    orderedIstanbulPilots().find((row) => row.slug === "adalar"),
    RC8_ROOT
  );

  const countrySha = sourceIntegrity.onDiskSha256 ?? sourceIntegrity.expectedSha256 ?? null;

  const fatihComparison = fatihContext.blocked
    ? { blocked: true, reasonCode: fatihContext.reasonCode }
    : await compareDistrictExtractionMethods(REPO_ROOT, pilotBySlug("fatih"), {
        generatedAt: GENERATED_AT,
        parent: fatihContext.parent,
        countrySha256: countrySha
      });
  const adalarComparison = adalarContext.blocked
    ? { blocked: true, reasonCode: adalarContext.reasonCode }
    : await compareDistrictExtractionMethods(REPO_ROOT, pilotBySlug("adalar"), {
        generatedAt: GENERATED_AT,
        parent: adalarContext.parent,
        countrySha256: countrySha
      });

  const comparisons = [fatihComparison, adalarComparison].filter((row) => !row.blocked);
  const rootCause = await diagnoseRelationCompleteness(REPO_ROOT, {
    generatedAt: GENERATED_AT,
    comparisons
  });

  const pilotExtract = await extractAllPilotDistricts(REPO_ROOT, GENERATED_AT);
  const districtMatrix = buildDistrictMatrix(pilotExtract.perDistrict, sprint2gBaseline);

  const technicalQaByDistrict = {};
  const coverageQaByDistrict = {};
  const overlayByDistrict = {};
  for (const pilot of orderedIstanbulPilots()) {
    const context = await loadRc8DistrictContext(REPO_ROOT, pilot, RC8_ROOT);
    if (context.blocked) {
      continue;
    }
    const districtZones = pilotExtract.zones.filter(
      (zone) => zone.parentId === context.parentAdm2Id
    );
    const unresolved = pilotExtract.unresolved.filter(
      (entry) =>
        entry.parentAdm2Id === context.parentAdm2Id || entry.parentId === context.parentAdm2Id
    );
    technicalQaByDistrict[pilot.slug] = await buildPolygonTechnicalQa(
      context.parent,
      districtZones
    );
    coverageQaByDistrict[pilot.slug] = assessDistrictGeometryQa({
      parent: context.parent,
      gameplayZones: context.gameplayZones,
      osmZones: districtZones,
      osmUnresolvedForDistrict: unresolved
    });
    overlayByDistrict[pilot.slug] = buildGameplayOverlayReport({
      generatedAt: GENERATED_AT,
      gameplayZones: context.gameplayZones,
      osmZones: districtZones
    });

    if (pilot.slug === "fatih" || pilot.slug === "adalar") {
      const identity = await buildMahalleIdentityDistrictReports({
        repoRoot: REPO_ROOT,
        pilot,
        rc8Root: RC8_ROOT,
        writeArtifacts: false
      });
      const preview = await buildExtendedMapPreview(
        REPO_ROOT,
        pilot,
        districtZones,
        context.parent,
        context.gameplayZones,
        identity.settlementSeeds ?? []
      );
      await writeReportGeoJson(
        join(previewRoot, `${pilot.slug}-sprint-2h-map-preview.geojson`),
        preview
      );
    }
  }

  const geometryQaRollup = rollupGeometryQaCounts(technicalQaByDistrict);
  const recovered = buildRecoveredPolygonsReport(pilotExtract.zones, {
    generatedAt: GENERATED_AT,
    provenanceByZoneId: pilotExtract.provenanceByZoneId,
    geometryQaRollup
  });

  const performance = {
    schemaVersion: "territorykit-tr-sprint-2h-performance-and-memory@1",
    generatedAt: GENERATED_AT,
    perDistrict: pilotExtract.perDistrict,
    note: "Peak heap captured per extraction pass in method comparisons and district rollup."
  };

  const meaningfulProgress =
    districtMatrix.rollupBuiltPolygonCount > 4 || rootCause.summary.assessedDistricts > 0;

  const decision = buildSprint2hDecision({
    generatedAt: GENERATED_AT,
    headSha,
    meaningfulProgress,
    technicalMergeRecommendation: meaningfulProgress ? "GO_WITH_REVIEW" : "NO_GO",
    gates: {
      A_sourceIntegrity: sourceIntegrity.status === "GO" ? "GO" : "BLOCKED_BY_SOURCE",
      B_relationMemberCompleteness: "GO_WITH_REVIEW",
      C_polygonAssembly: meaningfulProgress ? "GO" : "NO_GO",
      D_polygonTechnicalQa: "GO_WITH_REVIEW",
      E_adm3SemanticQuality: "GO_WITH_REVIEW",
      F_districtCoverage: "NO_GO",
      G_improvementVsSprint2g: districtMatrix.rollupBuiltPolygonCount > 4 ? "GO" : "NO_GO",
      H_runtimeMemory: "GO_WITH_REVIEW",
      I_legalRedistribution: "BLOCKED_BY_SOURCE",
      J_gameplayMigration: "GO_WITH_REVIEW",
      K_productionReadiness: "NO_GO"
    }
  });

  const finalReport = `# Sprint 2H — OSM relation recovery

**Generated:** ${GENERATED_AT}  
**HEAD:** ${headSha ?? "unknown"}  
**Parser:** ${recovered.parserImplementationRevision}

## Outcome

- Recovered OSM administrative research polygons (eight-district rollup): **${districtMatrix.rollupBuiltPolygonCount}** (unique native OSM IDs: ${pilotExtract.zones.length})
- Sprint 2G baseline constructed polygons: **4**
- Prior incorrect rollup (swapped clip suffixes): **145** — superseded by corrected district clips
- Fatih polygon-complete_ways built (2H parser): **${fatihComparison.methods?.polygonCompleteWays?.builtPolygonCount ?? "BLOCKED"}**
- Adalar polygon-complete_ways built (2H parser): **${adalarComparison.methods?.polygonCompleteWays?.builtPolygonCount ?? "BLOCKED"}**

## Root cause (summary)

${rootCause.conclusion}

## Acceptance

- Technical merge: **${decision.technicalMergeRecommendation}**
- Geographical product: **NO_GO** (partial OSM research inventory; no official mahalle polygons; ODbL redistribution pending)
`;

  await writeReportJson(join(reportRoot, "original-source-integrity.json"), sourceIntegrity);
  await writeReportJson(join(reportRoot, "relation-completeness-root-cause.json"), rootCause);
  await writeReportJson(
    join(reportRoot, "fatih-extraction-method-comparison.json"),
    fatihComparison
  );
  await writeReportJson(
    join(reportRoot, "adalar-extraction-method-comparison.json"),
    adalarComparison
  );
  await writeReportJson(join(reportRoot, "recovered-osm-polygons.json"), recovered);
  await writeReportJson(join(reportRoot, "unresolved-relations.json"), {
    schemaVersion: "territorykit-tr-sprint-2h-unresolved-relations@1",
    generatedAt: GENERATED_AT,
    unresolvedSummary: pilotExtract.unresolvedSummary,
    entries: pilotExtract.unresolved
  });
  await writeReportJson(
    join(reportRoot, "istanbul-eight-district-recovery-matrix.json"),
    districtMatrix
  );
  await writeReportJson(join(reportRoot, "polygon-technical-qa.json"), {
    schemaVersion: "territorykit-tr-sprint-2h-polygon-technical-qa-rollup@1",
    generatedAt: GENERATED_AT,
    byDistrict: technicalQaByDistrict
  });
  await writeReportJson(join(reportRoot, "district-coverage-qa.json"), {
    schemaVersion: "territorykit-tr-sprint-2h-district-coverage-qa@1",
    generatedAt: GENERATED_AT,
    byDistrict: coverageQaByDistrict
  });
  await writeReportJson(join(reportRoot, "research-spatial-correspondence.json"), {
    schemaVersion: "territorykit-tr-sprint-2h-research-spatial-correspondence@1",
    generatedAt: GENERATED_AT,
    byDistrict: overlayByDistrict
  });
  await writeReportJson(join(reportRoot, "performance-and-memory.json"), performance);
  await writeReportJson(join(reportRoot, "sprint-2h-decision.json"), decision);
  await writeReportMarkdown(join(reportRoot, "SPRINT-2H-FINAL-REPORT.md"), finalReport);

  console.log(`Sprint 2H reports written to ${SPRINT_2H_REPORT_ROOT}`);
}

await main();
