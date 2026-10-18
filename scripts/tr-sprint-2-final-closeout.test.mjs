import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  EXPECTED_OSM_RESEARCH_CANDIDATE_COUNT,
  OSM_RESEARCH_PUBLIC_GEOJSON_DISTRIBUTION_ALLOWED,
  SPRINT_2_FINAL_REPORT_ROOT,
  buildSemanticScreening,
  classifyPolygonDisposition,
  normalizeTrName
} from "./lib/tr-sprint-2-final-closeout.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = join(REPO_ROOT, SPRINT_2_FINAL_REPORT_ROOT);

test("normalizeTrName strips Turkish administrative suffixes for matching", () => {
  assert.equal(normalizeTrName("Balat Mahallesi"), "balat");
  assert.equal(normalizeTrName("Kınalıada Köyü"), "kınalıada");
  assert.equal(normalizeTrName("Foo Mah."), "foo");
  assert.equal(normalizeTrName("  Akşemsettin MAH  "), "akşemsettin");
});

test("buildSemanticScreening scopes duplicate names to parent ADM2", () => {
  const zones = [
    {
      id: "a",
      parentId: "parent-1",
      name: "Merkez Mahallesi",
      properties: { territory: { osmTags: { admin_level: "8" } } }
    },
    {
      id: "b",
      parentId: "parent-2",
      name: "Merkez Mahallesi",
      properties: { territory: { osmTags: { admin_level: "8" } } }
    }
  ];
  const screening = buildSemanticScreening({
    zones,
    provenanceByZoneId: new Map(),
    settlementIndexByParentAdm2: new Map()
  });
  assert.equal(screening.ambiguousCaseCount, 0);
});

test("disposition never auto-approves spatial or semantic conflicts", () => {
  assert.equal(
    classifyPolygonDisposition({
      ringAssessed: true,
      ringOk: true,
      provenanceComplete: true,
      parentContainmentExceeds: true,
      involvedInSiblingOverlap: false,
      identityAmbiguous: false,
      missingName: false,
      unexpectedAdminLevel: false
    }),
    "SPATIAL_CONFLICT_REVIEW_REQUIRED"
  );
  assert.equal(
    classifyPolygonDisposition({
      ringAssessed: true,
      ringOk: true,
      provenanceComplete: true,
      parentContainmentExceeds: false,
      involvedInSiblingOverlap: false,
      identityAmbiguous: true,
      missingName: false,
      unexpectedAdminLevel: false
    }),
    "IDENTITY_AMBIGUOUS"
  );
});

test("Sprint 2 final closeout artifacts validate inventory and QA scope", async (t) => {
  const inventoryPath = join(REPORT_DIR, "candidate-inventory.json");
  if (!existsSync(inventoryPath)) {
    t.skip("NOT_RUN: run pnpm data:tr:sprint2:final-closeout first");
    return;
  }

  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  assert.equal(inventory.candidateCount, EXPECTED_OSM_RESEARCH_CANDIDATE_COUNT);
  assert.equal(inventory.idValidation.osmCandidateIdsUnique, true);
  assert.equal(inventory.idValidation.countMatchesExpected, true);

  const qa = JSON.parse(await readFile(join(REPORT_DIR, "polygon-qa-results.json"), "utf8"));
  assert.equal(qa.polygonCount, EXPECTED_OSM_RESEARCH_CANDIDATE_COUNT);
  for (const row of qa.results) {
    assert.equal(row.humanSemanticApproval.status, "unreviewed");
    assert.equal(row.humanSemanticApproval.official, false);
    assert.notEqual(row.disposition, "APPROVED");
  }

  const semantic = JSON.parse(await readFile(join(REPORT_DIR, "semantic-screening.json"), "utf8"));
  assert.equal(semantic.records.length, EXPECTED_OSM_RESEARCH_CANDIDATE_COUNT);
  assert.equal(
    semantic.osmCandidateReviewBatch.pendingCount,
    EXPECTED_OSM_RESEARCH_CANDIDATE_COUNT
  );

  const decision = JSON.parse(await readFile(join(REPORT_DIR, "closeout-decision.json"), "utf8"));
  assert.equal(decision.decisions.istanbulGeographicalAcceptance, "NO_GO");
  assert.equal(decision.decisions.sprint3NationalReadiness, "NO_GO");
  assert.equal(decision.acceptanceQuestions.D_semanticMahalleBoundaries.humanApprovals, 0);

  const manifestPath = join(REPORT_DIR, "research-candidate-dataset/manifest.json");
  assert.ok(existsSync(manifestPath));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.featureCount, EXPECTED_OSM_RESEARCH_CANDIDATE_COUNT);
  assert.equal(manifest.doesNotOverwriteRc8, true);
  assert.equal(manifest.dataLicense, "ODbL-1.0");
  assert.equal(manifest.distribution.publicGitGeoJsonArtifact, false);
  assert.equal(manifest.distribution.redistributionApproved, false);
  assert.match(manifest.repositoryCodeLicenseNote, /Apache-2\.0/);
  assert.match(manifest.repositoryCodeLicenseNote, /not licensed under Apache-2\.0/i);
  if (!OSM_RESEARCH_PUBLIC_GEOJSON_DISTRIBUTION_ALLOWED) {
    assert.equal(manifest.geojsonWrittenToRepository, false);
  }
});
