import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EVIDENCE_PATH,
  resolveTurkeyAdm2BenchmarkDataset,
  validateTurkeyBenchmarkDataset
} from "./release-benchmark-dataset.mjs";

const root = new URL("..", import.meta.url).pathname;
const evidence = resolveTurkeyAdm2BenchmarkDataset({ root }).evidence;

test("clean checkout uses pinned production evidence and current fixture", () => {
  const temp = mkdtempSync(join(tmpdir(), "territory-release-benchmark-"));
  try {
    const target = join(temp, EVIDENCE_PATH);
    mkdirSync(join(temp, "benchmarks/evidence"), { recursive: true });
    writeFileSync(target, JSON.stringify(evidence, null, 2) + "\n");
    const result = resolveTurkeyAdm2BenchmarkDataset({ root: temp });
    assert.equal(result.mode, "pinned-evidence-and-current-fixture");
    assert.equal(result.datasetPath, undefined);
    assert.throws(
      () => resolveTurkeyAdm2BenchmarkDataset({ root: temp, override: "missing.json" }),
      /override is missing/
    );
    writeFileSync(target, "{}\n");
    assert.throws(() => resolveTurkeyAdm2BenchmarkDataset({ root: temp }), /checksum mismatch/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("dataset checksum, version and feature count are enforced", () => {
  const dataset = {
    manifest: { datasetId: "tr-adm2", datasetVersion: "0.1.0" },
    zones: Array.from({ length: 973 }, (_, id) => ({ id }))
  };
  const bytes = Buffer.from(JSON.stringify(dataset));
  const source = {
    datasetId: "tr-adm2",
    datasetVersion: "0.1.0",
    datasetSha256: createHash("sha256").update(bytes).digest("hex"),
    featureCount: 973
  };
  assert.doesNotThrow(() => validateTurkeyBenchmarkDataset(bytes, source, "test.json"));
  assert.throws(
    () =>
      validateTurkeyBenchmarkDataset(
        bytes,
        { ...source, datasetSha256: "0".repeat(64) },
        "test.json"
      ),
    /checksum mismatch/
  );
  assert.throws(
    () =>
      validateTurkeyBenchmarkDataset(bytes, { ...source, datasetVersion: "0.2.0" }, "test.json"),
    /identity\/version mismatch/
  );
  assert.throws(
    () => validateTurkeyBenchmarkDataset(bytes, { ...source, featureCount: 974 }, "test.json"),
    /feature count mismatch/
  );
});

test("benchmark command failure is fatal", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/benchmark-run.mjs", "--mode", "local-real", "--dataset", "missing.json"],
    { cwd: root, encoding: "utf8" }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ENOENT/);
});
