import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { FATIH_REGRESSION_METRICS } from "./lib/tr-mahalle-identity-istanbul-pilots.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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

  const reportDir = await mkdtemp(join(tmpdir(), "tk-mahalle-identity-"));
  try {
    execSync(
      `node scripts/tr-mahalle-identity-layer-istanbul-pilots.mjs --only=${STRESS_SLUGS.join(",")}`,
      {
        cwd: REPO_ROOT,
        stdio: "pipe",
        env: { ...process.env, MAHALLE_IDENTITY_REPORT_ROOT: reportDir }
      }
    );

    for (const slug of STRESS_SLUGS) {
      const immutability = JSON.parse(
        await readFile(join(reportDir, `${slug}-geometry-immutability.json`), "utf8")
      );
      assert.equal(immutability.determinismVerified, true, slug);
    }
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
});

test("Istanbul identity integration full matrix includes Fatih regression pins", async (t) => {
  if (!rc8Present()) {
    t.skip("BLOCKED_BY_SOURCE: pinned rc.8 shards not available locally");
    return;
  }

  const reportDir = await mkdtemp(join(tmpdir(), "tk-mahalle-identity-full-"));
  try {
    execSync("node scripts/tr-mahalle-identity-layer-istanbul-pilots.mjs", {
      cwd: REPO_ROOT,
      stdio: "pipe",
      env: { ...process.env, MAHALLE_IDENTITY_REPORT_ROOT: reportDir }
    });

    const fatih = JSON.parse(
      await readFile(join(reportDir, "fatih-geometry-immutability.json"), "utf8")
    );
    assert.equal(fatih.zoneIdSetSha256, FATIH_REGRESSION_METRICS.zoneIdSetSha256);
    assert.equal(fatih.geometryHashSetSha256, FATIH_REGRESSION_METRICS.geometryHashSetSha256);

    const matrix = JSON.parse(
      await readFile(join(reportDir, "istanbul-pilot-matrix.json"), "utf8")
    );
    assert.equal(matrix.districts.length, 8);
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
});
