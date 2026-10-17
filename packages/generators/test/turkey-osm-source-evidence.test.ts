import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TURKEY_OSM_BARRIER_LICENSE,
  TURKEY_OSM_BARRIER_PROVIDER_ID,
  TURKEY_OSM_BARRIER_PROVIDER_NAME,
  TURKEY_OSM_BARRIER_SNAPSHOT_SOURCE_LOCK_SCHEMA_VERSION,
  type TurkeyOsmBarrierManifest
} from "../src/turkey-osm-barriers.js";
import {
  computeTurkeyOsmSnapshotSourceLockContentHash,
  evaluateTurkeyOsmSourceEvidence
} from "../src/turkey-osm-source-evidence.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createTempRepo(): Promise<{ repoRoot: string; pbfPath: string; lockPath: string }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "territory-osm-evidence-"));
  tempDirs.push(repoRoot);
  const pbfBytes = Buffer.from("territorykit-osm-snapshot-fixture");
  const pbfPath = join(repoRoot, "turkey.osm.pbf");
  await writeFile(pbfPath, pbfBytes);
  const sha256 = createHash("sha256").update(pbfBytes).digest("hex");
  const sourceLock = {
    schemaVersion: TURKEY_OSM_BARRIER_SNAPSHOT_SOURCE_LOCK_SCHEMA_VERSION,
    providerId: TURKEY_OSM_BARRIER_PROVIDER_ID,
    providerName: TURKEY_OSM_BARRIER_PROVIDER_NAME,
    countryCode: "TR",
    sourceUrl: "https://download.geofabrik.de/europe/turkey.html",
    downloadUrl: "https://download.geofabrik.de/europe/turkey-latest.osm.pbf",
    sourceDatasetId: "geofabrik:europe:turkey",
    snapshotDate: "2026-08-27T20:21:06.000Z",
    downloadedAt: "2026-08-28T00:00:00.000Z",
    fileSizeBytes: pbfBytes.length,
    sha256,
    license: TURKEY_OSM_BARRIER_LICENSE,
    attribution: "OpenStreetMap contributors",
    format: "osm-pbf",
    contentAddressedSnapshotId: `TR-${sha256.slice(0, 16)}`,
    cachePath: "turkey.osm.pbf",
    pbfHeader: {
      osmosisReplicationTimestamp: "2026-08-27T20:21:06.000Z"
    }
  };
  const lockPath = join(repoRoot, "source-lock.json");
  await writeFile(lockPath, JSON.stringify(sourceLock), "utf8");
  return { repoRoot, pbfPath, lockPath };
}

function barrierManifest(
  sha256: string,
  adm2Id = "tr:adm2:fixture"
): Pick<TurkeyOsmBarrierManifest, "adm2Id" | "source" | "sourceSnapshotChecksum"> {
  return {
    adm2Id,
    source: {
      providerId: TURKEY_OSM_BARRIER_PROVIDER_ID,
      providerName: TURKEY_OSM_BARRIER_PROVIDER_NAME,
      sourceUrl: "https://download.geofabrik.de/europe/turkey.html",
      sourceDatasetId: "geofabrik:europe:turkey",
      snapshotSha256: sha256,
      snapshotDate: "2026-08-27T20:21:06.000Z",
      license: TURKEY_OSM_BARRIER_LICENSE,
      attribution: "OpenStreetMap contributors",
      format: "osm-pbf"
    },
    sourceSnapshotChecksum: sha256
  };
}

describe("evaluateTurkeyOsmSourceEvidence", () => {
  it("verifies matching snapshot bytes and barrier lineage", async () => {
    const { repoRoot, lockPath } = await createTempRepo();
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as { sha256: string };

    const evaluation = await evaluateTurkeyOsmSourceEvidence({
      repoRoot,
      sourceLockPath: "source-lock.json",
      barrierManifest: barrierManifest(lock.sha256),
      expectedAdm2Id: "tr:adm2:fixture"
    });

    expect(evaluation.ok).toBe(true);
    expect(evaluation.sourceLockState).toBe("verified");
    expect(evaluation.gates.sourceBytesVerified).toBe(true);
    expect(evaluation.gates.licenseIdentified).toBe(true);
    expect(evaluation.gates.redistributionRightsApproved).toBe(false);
    expect(evaluation.gates.productionEligible).toBe(false);
    expect(evaluation.licenseState).toBe("pending");
  });

  it("rejects forged contentHash claims on otherwise valid locks", async () => {
    const { repoRoot, lockPath } = await createTempRepo();
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    lock.contentHash = "sha256:deadbeef";
    await writeFile(lockPath, JSON.stringify(lock), "utf8");

    const evaluation = await evaluateTurkeyOsmSourceEvidence({
      repoRoot,
      sourceLockPath: "source-lock.json",
      barrierManifest: barrierManifest(lock.sha256),
      expectedAdm2Id: "tr:adm2:fixture"
    });

    expect(evaluation.ok).toBe(false);
    expect(evaluation.reasonCodes).toContain("SOURCE_LOCK_CONTENT_HASH_FORGERY");
    expect(evaluation.sourceLockState).not.toBe("verified");
  });

  it("rejects snapshot checksum mismatch", async () => {
    const { repoRoot } = await createTempRepo();

    const evaluation = await evaluateTurkeyOsmSourceEvidence({
      repoRoot,
      sourceLockPath: "source-lock.json",
      barrierManifest: barrierManifest("f".repeat(64)),
      expectedAdm2Id: "tr:adm2:fixture"
    });

    expect(evaluation.ok).toBe(false);
    expect(evaluation.reasonCodes).toContain("BARRIER_SNAPSHOT_CHECKSUM_MISMATCH");
  });

  it("rejects wrong OSM provider on barrier manifest", async () => {
    const { repoRoot, lockPath } = await createTempRepo();
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    const manifest = barrierManifest(lock.sha256);
    manifest.source.providerId = "wrong-provider";

    const evaluation = await evaluateTurkeyOsmSourceEvidence({
      repoRoot,
      sourceLockPath: "source-lock.json",
      barrierManifest: manifest,
      expectedAdm2Id: "tr:adm2:fixture"
    });

    expect(evaluation.ok).toBe(false);
    expect(evaluation.reasonCodes).toContain("BARRIER_PROVIDER_MISMATCH");
  });

  it("rejects ADM2 lineage mismatch", async () => {
    const { repoRoot, lockPath } = await createTempRepo();
    const lock = JSON.parse(await readFile(lockPath, "utf8"));

    const evaluation = await evaluateTurkeyOsmSourceEvidence({
      repoRoot,
      sourceLockPath: "source-lock.json",
      barrierManifest: barrierManifest(lock.sha256, "tr:adm2:other"),
      expectedAdm2Id: "tr:adm2:fixture"
    });

    expect(evaluation.ok).toBe(false);
    expect(evaluation.reasonCodes).toContain("BARRIER_ADM2_LINEAGE_MISMATCH");
  });

  it("fails closed when snapshot bytes are missing", async () => {
    const { repoRoot, lockPath } = await createTempRepo();
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    lock.cachePath = "missing.osm.pbf";
    await writeFile(lockPath, JSON.stringify(lock), "utf8");

    const evaluation = await evaluateTurkeyOsmSourceEvidence({
      repoRoot,
      sourceLockPath: "source-lock.json",
      barrierManifest: barrierManifest(lock.sha256),
      expectedAdm2Id: "tr:adm2:fixture"
    });

    expect(evaluation.ok).toBe(false);
    expect(evaluation.reasonCodes).toContain("SOURCE_BYTES_MISSING");
  });

  it("keeps license gate pending when bytes verify but redistribution is not approved", async () => {
    const { repoRoot, lockPath } = await createTempRepo();
    const lock = JSON.parse(await readFile(lockPath, "utf8"));

    const evaluation = await evaluateTurkeyOsmSourceEvidence({
      repoRoot,
      sourceLockPath: "source-lock.json",
      barrierManifest: barrierManifest(lock.sha256),
      expectedAdm2Id: "tr:adm2:fixture"
    });

    expect(evaluation.gates.sourceBytesVerified).toBe(true);
    expect(evaluation.gates.redistributionRightsApproved).toBe(false);
    expect(evaluation.redistributionApproval).toBe("pending");
    expect(evaluation.reasonCodes).toContain("REDISTRIBUTION_NOT_APPROVED");
  });

  it("does not mark bytes verified when verifySnapshotBytes is false", async () => {
    const { repoRoot, lockPath } = await createTempRepo();
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as { sha256: string };

    const evaluation = await evaluateTurkeyOsmSourceEvidence({
      repoRoot,
      sourceLockPath: "source-lock.json",
      verifySnapshotBytes: false,
      barrierManifest: barrierManifest(lock.sha256),
      expectedAdm2Id: "tr:adm2:fixture"
    });

    expect(evaluation.gates.sourceBytesVerified).toBe(false);
    expect(evaluation.sourceLockState).not.toBe("verified");
    expect(evaluation.reasonCodes).toContain("SOURCE_BYTES_VERIFICATION_SKIPPED");
    expect(evaluation.gates.licenseIdentified).toBe(true);
    expect(evaluation.gates.redistributionRightsApproved).toBe(false);
  });

  it("fails closed without barrier manifest even when bytes match", async () => {
    const { repoRoot } = await createTempRepo();

    const evaluation = await evaluateTurkeyOsmSourceEvidence({
      repoRoot,
      sourceLockPath: "source-lock.json",
      expectedAdm2Id: "tr:adm2:fixture"
    });

    expect(evaluation.gates.sourceBytesVerified).toBe(false);
    expect(evaluation.reasonCodes).toContain("BARRIER_LINEAGE_NOT_VERIFIED");
  });

  it("fails closed without expectedAdm2Id when barrier manifest is present", async () => {
    const { repoRoot, lockPath } = await createTempRepo();
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as { sha256: string };

    const evaluation = await evaluateTurkeyOsmSourceEvidence({
      repoRoot,
      sourceLockPath: "source-lock.json",
      barrierManifest: barrierManifest(lock.sha256)
    });

    expect(evaluation.gates.sourceBytesVerified).toBe(false);
    expect(evaluation.reasonCodes).toContain("BARRIER_ADM2_LINEAGE_UNASSERTED");
  });

  it("rejects wrong snapshot bytes (checksum mismatch)", async () => {
    const { repoRoot, pbfPath, lockPath } = await createTempRepo();
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    await writeFile(pbfPath, Buffer.from("tampered-bytes"));

    const evaluation = await evaluateTurkeyOsmSourceEvidence({
      repoRoot,
      sourceLockPath: "source-lock.json",
      barrierManifest: barrierManifest(lock.sha256),
      expectedAdm2Id: "tr:adm2:fixture"
    });

    expect(evaluation.ok).toBe(false);
    expect(evaluation.reasonCodes).toContain("SOURCE_SNAPSHOT_CHECKSUM_MISMATCH");
  });

  it("flags barrier snapshot date mismatch without blocking byte verification", async () => {
    const { repoRoot, lockPath } = await createTempRepo();
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as { sha256: string };
    const manifest = barrierManifest(lock.sha256);
    manifest.source.snapshotDate = "2020-01-01T00:00:00.000Z";

    const evaluation = await evaluateTurkeyOsmSourceEvidence({
      repoRoot,
      sourceLockPath: "source-lock.json",
      barrierManifest: manifest,
      expectedAdm2Id: "tr:adm2:fixture"
    });

    expect(evaluation.gates.sourceBytesVerified).toBe(true);
    expect(evaluation.reasonCodes).toContain("BARRIER_SNAPSHOT_DATE_MISMATCH");
  });

  it("computes stable source-lock content hashes", async () => {
    const { lockPath } = await createTempRepo();
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    const parsed = {
      ...lock,
      pbfHeader: lock.pbfHeader
    };
    const first = computeTurkeyOsmSnapshotSourceLockContentHash(parsed);
    const second = computeTurkeyOsmSnapshotSourceLockContentHash(parsed);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
