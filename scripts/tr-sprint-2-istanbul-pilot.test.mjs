import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  inspectTurkeyMunicipalShapefileCompanionBundle,
  summarizeTurkeyNetworkRouteRootCause
} from "../packages/generators/dist/turkey-adm3.mjs";
import { sha256OfUtf8FileContents } from "./tr-sprint-2-istanbul-pilot.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = path.join(REPO_ROOT, "reports/tr-adm3/sprint-2-istanbul");

test("Kadıköy acquisition evidence is classified as duplicate companion response", async () => {
  const acquisition = JSON.parse(
    await readFile(path.join(REPO_ROOT, "reports/tr-adm3/audit/kadikoy-acquisition.json"), "utf8")
  );
  const sha = acquisition[0].sha256;
  const bytes = new Uint8Array(16);
  const files = acquisition.map((entry) => ({
    fileName: entry.url.split("/").at(-1),
    bytes
  }));
  const report = inspectTurkeyMunicipalShapefileCompanionBundle(files);
  assert.equal(sha.length, 64);
  assert.equal(report.uniqueSha256Count, 1);
  assert.ok(report.reasonCodes.includes("IDENTICAL_COMPANION_BYTES"));
});

test("Eyüpsultan replay fixture exposes NO_ROUTE classification", async () => {
  const replay = JSON.parse(
    await readFile(path.join(REPO_ROOT, "reports/tr-adm3/audit/istanbul-replay.json"), "utf8")
  );
  const eyup = replay.results.find((row) => row.district === "Eyüpsultan");
  assert.ok(eyup);
  const rootCause = summarizeTurkeyNetworkRouteRootCause({
    longestUnsupportedStraightChainMeters: eyup.longestUnsupportedStraightChainMeters,
    networkConstruction: eyup.networkAttemptDiagnostics,
    organicRouting: eyup.networkAttemptDiagnostics.finalRouting
  });
  assert.equal(rootCause.routeFailureReason, "NO_ROUTE");
  assert.ok(rootCause.reasonCodes.includes("ORGANIC_ROUTE_NO_PATH"));
});

test("pilot summary sha256 matches on-disk JSON bytes", async () => {
  execSync("node scripts/tr-sprint-2-istanbul-pilot.mjs", {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: {
      ...process.env,
      SPRINT2_PILOT_GENERATED_AT: "2026-10-13T00:00:00.000Z"
    }
  });
  const jsonBytes = await readFile(path.join(REPORT_DIR, "pilot-summary.json"));
  const shaLine = (await readFile(path.join(REPORT_DIR, "pilot-summary.sha256"), "utf8")).trim();
  const digest = sha256OfUtf8FileContents(jsonBytes.toString("utf8"));
  assert.equal(shaLine, `${digest}  pilot-summary.json`);
  assert.equal(digest, createHash("sha256").update(jsonBytes).digest("hex"));

  const summary = JSON.parse(jsonBytes.toString("utf8"));
  assert.equal(summary.schemaVersion, "territorykit-tr-adm3-sprint-2-istanbul@2");
  assert.equal(summary.determinismScope.assessedDistrictCount, 3);
  assert.ok(
    summary.pilotDistricts.every(
      (row) => row.scope.stableIdEvidence === "NOT_ASSESSED" || row.scope.stableIdEvidence
    )
  );
  const kadikoy = summary.kadikoyOfficialPilot;
  assert.equal(kadikoy.pilotStatus, "BLOCKED_BY_SOURCE");
  assert.ok(
    kadikoy.companionStates.some((row) => row.state === "MISSING_LOCAL_FILE") ||
      kadikoy.bundle.status === "BLOCKED_DUPLICATE_RESPONSE"
  );
});
