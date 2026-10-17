import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { FATIH_REGRESSION_METRICS } from "./lib/tr-mahalle-identity-istanbul-pilots.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = join(REPO_ROOT, "reports/tr-adm3/mahalle-identity-layer");
const STRESS_SLUGS = ["adalar", "eyupsultan", "kadikoy"];

function rc8Present() {
  return existsSync(
    join(
      REPO_ROOT,
      ".territory/national-geometry-remediation/candidate-rc8-impl-rev1/districts/tr_adm2_54988432b39641834885080/dataset.json"
    )
  );
}

test("Istanbul identity integration stress pilots regenerate deterministically", async (t) => {
  if (!rc8Present()) {
    t.skip("BLOCKED_BY_SOURCE: pinned rc.8 shards not available locally");
    return;
  }

  execSync(
    `node scripts/tr-mahalle-identity-layer-istanbul-pilots.mjs --only=${STRESS_SLUGS.join(",")}`,
    {
      cwd: REPO_ROOT,
      stdio: "pipe",
      env: { ...process.env }
    }
  );

  for (const slug of STRESS_SLUGS) {
    const immutability = JSON.parse(
      await readFile(join(REPORT_DIR, `${slug}-geometry-immutability.json`), "utf8")
    );
    assert.equal(immutability.determinismVerified, true, slug);
  }
});

test("Istanbul identity integration full matrix includes Fatih regression pins", async (t) => {
  if (!rc8Present()) {
    t.skip("BLOCKED_BY_SOURCE: pinned rc.8 shards not available locally");
    return;
  }

  execSync("node scripts/tr-mahalle-identity-layer-istanbul-pilots.mjs", {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: { ...process.env }
  });

  const fatih = JSON.parse(
    await readFile(join(REPORT_DIR, "fatih-geometry-immutability.json"), "utf8")
  );
  assert.equal(fatih.zoneIdSetSha256, FATIH_REGRESSION_METRICS.zoneIdSetSha256);
  assert.equal(fatih.geometryHashSetSha256, FATIH_REGRESSION_METRICS.geometryHashSetSha256);

  const matrix = JSON.parse(await readFile(join(REPORT_DIR, "istanbul-pilot-matrix.json"), "utf8"));
  assert.equal(matrix.districts.length, 8);
});
