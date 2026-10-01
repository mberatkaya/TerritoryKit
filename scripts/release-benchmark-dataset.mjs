import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const EVIDENCE_PATH = "benchmarks/evidence/turkey-adm2-production.json";
export const EVIDENCE_SHA256 = "ab3b6d4ae84423b00ccfd4a839df3a4131dd53a413843f2402beb6af91e3036d";
export const DEFAULT_DATASET_PATH = "datasets/generated/countries/TR/levels/ADM2/dataset.json";

export function resolveTurkeyAdm2BenchmarkDataset({ root, override } = {}) {
  const evidenceBytes = readFileSync(join(root, EVIDENCE_PATH));
  const evidenceHash = sha256(evidenceBytes);
  if (evidenceHash !== EVIDENCE_SHA256) {
    throw new Error(
      `Pinned Turkey benchmark evidence checksum mismatch: expected ${EVIDENCE_SHA256}, got ${evidenceHash}.`
    );
  }
  const evidence = JSON.parse(evidenceBytes);
  const source = evidence.source;
  const result = evidence.benchmark;
  if (
    evidence.schemaVersion !== "territorykit-release-turkey-evidence@1" ||
    source.provider !== "geoboundaries" ||
    !/^sha256:[a-f0-9]{64}$/.test(source.sourceLockHash) ||
    !/^[a-f0-9]{64}$/.test(source.datasetSha256) ||
    result.mode !== "local-real" ||
    result.scenario !== "turkey-adm2-production" ||
    result.skipped?.length ||
    result.inputs?.datasetId !== source.datasetId ||
    result.inputs?.datasetVersion !== source.datasetVersion ||
    result.inputs?.featureCount !== source.featureCount ||
    source.featureCount < 973 ||
    evidence.turkey?.adm0Adm2?.sourceLockHash !== source.sourceLockHash ||
    evidence.turkey?.adm0Adm2?.checksums?.ok !== true ||
    evidence.turkey?.adm3?.checksums?.ok !== true
  ) {
    throw new Error(
      "Pinned Turkey benchmark evidence has invalid identity or incomplete validation."
    );
  }

  const datasetPath = override ?? DEFAULT_DATASET_PATH;
  const absolutePath = join(root, datasetPath);
  if (!existsSync(absolutePath)) {
    if (override) throw new Error(`Turkey benchmark dataset override is missing: ${datasetPath}.`);
    return {
      datasetPath: undefined,
      evidence,
      source,
      materialized: false,
      mode: "pinned-evidence-and-current-fixture"
    };
  }
  const bytes = readFileSync(absolutePath);
  validateTurkeyBenchmarkDataset(bytes, source, datasetPath);
  return { datasetPath, evidence, source, materialized: false, mode: "verified-local-real" };
}

export function validateTurkeyBenchmarkDataset(bytes, source, datasetPath) {
  const checksum = sha256(bytes);
  if (checksum !== source.datasetSha256) {
    throw new Error(
      `Turkey benchmark dataset checksum mismatch at ${datasetPath}: expected ${source.datasetSha256}, got ${checksum}.`
    );
  }
  const dataset = JSON.parse(bytes);
  if (
    dataset.manifest?.datasetId !== source.datasetId ||
    dataset.manifest?.datasetVersion !== source.datasetVersion
  ) {
    throw new Error(`Turkey benchmark dataset identity/version mismatch at ${datasetPath}.`);
  }
  if (dataset.zones?.length !== source.featureCount || dataset.zones.length < 973) {
    throw new Error(`Turkey benchmark dataset feature count mismatch at ${datasetPath}.`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
