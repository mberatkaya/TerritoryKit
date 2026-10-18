import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(REPO_ROOT, "reports/tr-adm3/playable-rescue-pilot");

test("playable rescue pilot report is stable and records explicit district status", async () => {
  execSync("node scripts/tr-playable-rescue-pilot.mjs", {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: {
      ...process.env,
      TR_PLAYABLE_RESCUE_GENERATED_AT: "2026-10-18T12:00:00.000Z"
    }
  });
  const json = JSON.parse(await readFile(path.join(OUTPUT, "pilot-metrics.json"), "utf8"));
  assert.equal(json.schemaVersion, "territorykit-tr-playable-rescue-pilot@1");
  const expectedPilotCount = json.inputRoots.pilotSet === "istanbul-local-calibration" ? 6 : 3;
  assert.equal(json.pilots.length, expectedPilotCount);
  for (const row of json.pilots) {
    assert.ok(row.archetype);
    assert.ok(row.status);
    if (row.status === "OK" || row.status === "EMERGENCY_SINGLE_PARENT") {
      assert.ok(row.metrics.playableZoneCount > 0);
      assert.ok(row.metrics.finalCoveragePercent >= 99.9);
      assert.ok(row.metrics.partitionOutcome);
      assert.notEqual(row.metrics.partitionOutcome, "failed");
      if (row.status === "EMERGENCY_SINGLE_PARENT") {
        assert.equal(row.metrics.partitionOutcome, "emergency-single-parent-fallback");
      }
    } else {
      assert.ok(row.explicitFailureReason);
    }
  }
  assert.ok(
    (await readFile(path.join(OUTPUT, "previews", "iskenderun-after.html"), "utf8").catch(
      () => null
    )) || (await readFile(path.join(OUTPUT, "previews", "fatih-after.html"), "utf8"))
  );
});
