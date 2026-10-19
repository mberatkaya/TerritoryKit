import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RC8_SHARD = join(
  REPO_ROOT,
  ".territory/national-geometry-remediation/candidate-rc8-impl-rev1/districts/tr_adm2_54988432b39641834885080/dataset.json"
);

const EXPECTED = {
  zoneIdSetSha256: "334ba60d9e4bf65c2acfce7d3724e7bf430ec082ad897459a902c19d3660852f",
  geometryHashSetSha256: "3b4c2dd9214f6aa1023277a3426e100bd9c2902f5c06e4a49b2478e462866645"
};

test("Fatih mahalle identity integration reports BLOCKED_BY_SOURCE without pinned rc.8", async (t) => {
  if (existsSync(RC8_SHARD)) {
    t.skip("pinned rc.8 shard present; covered by integration regeneration test");
    return;
  }
  t.skip("BLOCKED_BY_SOURCE: pinned rc.8 Fatih shard not available locally");
});

test("Fatih mahalle identity integration regenerates pinned rc.8 reports", async (t) => {
  if (!existsSync(RC8_SHARD)) {
    t.skip("BLOCKED_BY_SOURCE: pinned rc.8 Fatih shard not available locally");
    return;
  }

  const reportDir = await mkdtemp(join(tmpdir(), "tk-mahalle-fatih-"));
  try {
    execSync("node scripts/tr-mahalle-identity-layer-fatih.mjs", {
      cwd: REPO_ROOT,
      stdio: "pipe",
      env: { ...process.env, MAHALLE_IDENTITY_REPORT_ROOT: reportDir }
    });

    const immutability = JSON.parse(
      await readFile(join(reportDir, "fatih-geometry-immutability.json"), "utf8")
    );
    assert.equal(immutability.zoneIdSetSha256, EXPECTED.zoneIdSetSha256);
    assert.equal(immutability.geometryHashSetSha256, EXPECTED.geometryHashSetSha256);
    assert.equal(immutability.determinismVerified, true);
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
});
