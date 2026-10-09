import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  createTurkeyGeoBoundariesHistoricalCountryConfig,
  verifyGeoBoundariesSourceArtifactBytes,
  verifyTurkeyGeoBoundariesFullBuilderReplay
} from "../packages/generators/dist/turkey-adm3.mjs";
import {
  generateGeoBoundariesParentReplayReports,
  isGeoBoundariesParentReplayCliEntry
} from "./tr-geoboundaries-parent-replay.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURE_LOCK = path.join(
  REPO_ROOT,
  "packages/generators/test/fixtures/tr-geoboundaries-parent/source-lock.json"
);
const FIXTURE_CACHE = path.join(
  REPO_ROOT,
  "packages/generators/test/fixtures/tr-geoboundaries-parent/cache"
);

test("replay CLI entry detection", () => {
  assert.equal(
    isGeoBoundariesParentReplayCliEntry([
      "node",
      path.join(REPO_ROOT, "scripts/tr-geoboundaries-parent-replay.mjs")
    ]),
    true
  );
});

test("historical TR config uses shapeID fields", () => {
  const config = createTurkeyGeoBoundariesHistoricalCountryConfig();
  assert.equal(config.levelMappings.ADM1?.sourceIdProperty, "shapeID");
  assert.equal(config.levelMappings.ADM1?.sourceNameProperty, "shapeName");
});

test("verify replay rejects unauthorized migration", () => {
  const verification = verifyTurkeyGeoBoundariesFullBuilderReplay({
    schemaVersion: "territorykit-tr-geoboundaries-full-builder-replay@1",
    classification: "FULL_REPLAY_VERIFIED",
    pathBTechnicalRecommendation: "GO",
    legalReviewStatus: "PENDING_REVIEW",
    migrationAuthorizationStatus: "NOT_AUTHORIZED",
    replayConfiguration: {},
    inputChecksums: {},
    replaySummary: {
      ADM0: { identityMatched: 1, geometryHashMatches: 1, geometryHashMismatches: 0 },
      ADM1: { identityMatched: 1, geometryHashMatches: 1, geometryHashMismatches: 0 },
      ADM2: { identityMatched: 1, geometryHashMatches: 1, geometryHashMismatches: 0 }
    },
    determinism: {
      firstRunDatasetSha256: "a",
      secondRunDatasetSha256: "a",
      byteIdentical: true,
      skipped: false
    },
    reportPaths: {}
  });
  assert.equal(verification.ok, false);
});

test("replay blocked without canonical parent artifacts", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "gb-replay-blocked-"));
  const missingParent = path.join(outputDir, "missing-dataset.json");
  const { result } = await generateGeoBoundariesParentReplayReports({
    outputDir,
    parentDatasetPath: missingParent,
    sourceLockPath: FIXTURE_LOCK,
    geoBoundariesCacheRoot: FIXTURE_CACHE,
    strict: false,
    skipSecondDeterminismRun: true,
    skipGeographicEquivalence: true
  });
  assert.equal(result.classification, "BLOCKED_BY_MISSING_EVIDENCE");
  await rm(outputDir, { recursive: true, force: true });
});

test("source SHA-256 pin verification fixture", async () => {
  const artifactPath = path.join(
    FIXTURE_CACHE,
    "af72983854237239724ecee55a93936764dc349689e1486b5f53cccd2069f9ac/artifact"
  );
  const verified = await verifyGeoBoundariesSourceArtifactBytes({
    adminLevel: "ADM0",
    artifactPath,
    expectedSha256: "deadbeef"
  });
  assert.equal(verified.status, "CHECKSUM_MISMATCH");
});

test("report JSON files end with newline", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "gb-replay-fmt-"));
  await generateGeoBoundariesParentReplayReports({
    outputDir,
    parentDatasetPath: path.join(outputDir, "nope.json"),
    sourceLockPath: FIXTURE_LOCK,
    geoBoundariesCacheRoot: FIXTURE_CACHE,
    strict: false,
    skipSecondDeterminismRun: true,
    skipGeographicEquivalence: true
  });
  const summary = await readFile(path.join(outputDir, "replay-summary.json"), "utf8");
  assert.ok(summary.endsWith("\n"));
  await rm(outputDir, { recursive: true, force: true });
});
