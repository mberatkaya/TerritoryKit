import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createSquareZone } from "@territory-kit/shared-testkit";
import {
  TURKEY_V2_NATIONAL_CHECKPOINT_IMPLEMENTATION_REVISION,
  TURKEY_V2_NATIONAL_CHECKPOINT_PRODUCTION_BEHAVIOR_DIGESTS,
  TURKEY_V2_NATIONAL_DISTRICT_CHECKPOINT_SCHEMA_VERSION,
  createTurkeyV2NationalDistrictCheckpointEnvelope,
  createTurkeyV2NationalDistrictCheckpointKey,
  evaluateTurkeyV2NationalDistrictCheckpointRestore,
  stableNationalCheckpointHash
} from "../src/turkey-v2-national-checkpoint.js";
import type { TurkeyV2HybridDistrictBuildOptions } from "../src/turkey-v2-hybrid.js";

function districtOptions(id: string): TurkeyV2HybridDistrictBuildOptions {
  const district = createSquareZone({
    id,
    level: 2,
    name: "Fixture",
    west: 0,
    south: 0,
    east: 1,
    north: 1,
    properties: { territory: { provinceCode: "01", districtCode: "fixture" } }
  });
  return {
    district,
    provinceCode: "01",
    districtCode: "fixture",
    officialZones: [],
    osmZones: [],
    buildDate: "2026-10-14T00:00:00.000Z"
  };
}

function keyInput(id: string) {
  return {
    options: districtOptions(id),
    snapshotChecksum: "abc",
    datasetVersion: "2.1.0-rc.8",
    sourceLockHash: "sha256:fixture"
  };
}

const REPO_ROOT = resolve(__dirname, "../../..");

describe("Turkey V2 national district checkpoints", () => {
  it("pins production-behavior digests for the active implementation revision", async () => {
    for (const [relativePath, expectedDigest] of Object.entries(
      TURKEY_V2_NATIONAL_CHECKPOINT_PRODUCTION_BEHAVIOR_DIGESTS
    )) {
      const bytes = await readFile(resolve(REPO_ROOT, relativePath));
      const actualDigest = createHash("sha256").update(bytes).digest("hex");
      expect(actualDigest, relativePath).toBe(expectedDigest);
    }
    expect(TURKEY_V2_NATIONAL_CHECKPOINT_IMPLEMENTATION_REVISION).toBe(
      "national-playable-v3-rescue-balance-v1"
    );
  });

  it("includes implementation revision in the checkpoint key separately from algorithm version", () => {
    const key = createTurkeyV2NationalDistrictCheckpointKey(keyInput("tr:adm2:a"));
    expect(key).toHaveLength(64);
    expect(key).not.toContain(TURKEY_V2_NATIONAL_CHECKPOINT_IMPLEMENTATION_REVISION);
  });

  it("changes the checkpoint key when implementation revision would change", () => {
    const first = createTurkeyV2NationalDistrictCheckpointKey(keyInput("tr:adm2:a"));
    const tamperedEnvelope = createTurkeyV2NationalDistrictCheckpointEnvelope({
      key: first,
      resultHash: "00",
      result: { quality: { ok: true }, district: { id: "x" } }
    });
    tamperedEnvelope.implementationRevision =
      "stale-revision" as typeof tamperedEnvelope.implementationRevision;
    const decision = evaluateTurkeyV2NationalDistrictCheckpointRestore(tamperedEnvelope, first);
    expect(decision).toEqual({ ok: false, reason: "implementation-revision-mismatch" });
  });

  it("fail-closed rejects legacy @4 checkpoints without implementation revision", () => {
    const result = { quality: { ok: true }, district: { id: "tr:adm2:legacy" } };
    const legacy = {
      schemaVersion: "territorykit-tr-smart-district-checkpoint@4",
      key: createTurkeyV2NationalDistrictCheckpointKey(keyInput("tr:adm2:legacy")),
      resultHash: stableNationalCheckpointHash(result),
      result
    };
    expect(
      evaluateTurkeyV2NationalDistrictCheckpointRestore(
        legacy,
        createTurkeyV2NationalDistrictCheckpointKey(keyInput("tr:adm2:legacy"))
      )
    ).toEqual({ ok: false, reason: "schema-mismatch" });
  });

  it("accepts a matching @5 envelope with implementation revision", () => {
    const result = {
      quality: { ok: true },
      district: { id: "tr:adm2:ok" },
      effective: { generated: [] }
    };
    const key = createTurkeyV2NationalDistrictCheckpointKey(keyInput("tr:adm2:ok"));
    const envelope = createTurkeyV2NationalDistrictCheckpointEnvelope({
      key,
      resultHash: stableNationalCheckpointHash(result),
      result
    });
    expect(envelope.schemaVersion).toBe(TURKEY_V2_NATIONAL_DISTRICT_CHECKPOINT_SCHEMA_VERSION);
    expect(envelope.implementationRevision).toBe(
      TURKEY_V2_NATIONAL_CHECKPOINT_IMPLEMENTATION_REVISION
    );
    expect(evaluateTurkeyV2NationalDistrictCheckpointRestore(envelope, key)).toEqual({ ok: true });
  });
});
