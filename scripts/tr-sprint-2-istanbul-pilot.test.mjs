import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  inspectTurkeyMunicipalShapefileCompanionBundle,
  summarizeTurkeyNetworkRouteRootCause
} from "../packages/generators/dist/turkey-adm3.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
