import { execSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("mahalle-first gap analysis generator emits stable schema", () => {
  execSync("node scripts/generate-tr-mahalle-first-gap-analysis.mjs", { stdio: "pipe" });
  const json = JSON.parse(
    fs.readFileSync("reports/tr-adm3/mahalle-first-program/gap-analysis.json", "utf8")
  );
  assert.equal(json.schemaVersion, "territorykit-tr-mahalle-first-gap-analysis@1");
  assert.ok(json.governanceDelta.focusProvinces.length === 5);
  assert.equal(json.pr111.state, "MERGED");
  assert.ok(json.moduleMap.length >= 8);
  assert.ok(fs.existsSync("reports/tr-adm3/mahalle-first-program/gap-analysis.md"));
});
