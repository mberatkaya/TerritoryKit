import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT = resolve(ROOT, "reports/tr-adm3/national-geometry-remediation");

test("rc.8 closeout reports exist when generated locally", async () => {
  const required = [
    "national-quality-comparison.json",
    "stable-id-diff.json",
    "adm3-independent-validation.json",
    "final-decision.md"
  ];
  if (!existsSync(resolve(ROOT, ".territory/national-geometry-remediation/candidate-rc8-impl-rev1"))) {
    return;
  }
  for (const name of required) {
    assert.ok(existsSync(resolve(OUT, name)), `missing ${name}`);
  }
  const validation = JSON.parse(
    await readFile(resolve(OUT, "adm3-independent-validation.json"), "utf8")
  );
  assert.equal(validation.adm3ZoneCount, 20392);
  assert.equal(validation.aggregateErrors.siblingOverlapErrors, 0);
});
