import { describe, expect, it } from "vitest";
import { diffTurkeyV2SourceLocks } from "../src/turkey-v2-source-diff.js";
import type { TurkeyV2NationalSourceLock } from "../src/turkey-v2-national.js";

function lock(): TurkeyV2NationalSourceLock {
  return {
    contentHash: "sha256:old",
    adm0Adm2: {
      sourceId: "national",
      sourceUrl: "https://example.test",
      sourceDate: "2026-01",
      sha256: "a",
      levels: {}
    },
    officialAdm3: {
      providers: [{ providerId: "local", provinceCode: "34", checksum: "a", sourceDate: "2026-01" }]
    },
    osm: { sourceUrl: "https://example.test/osm", checksum: "a" },
    osmBarrierSnapshotChecksum: "a",
    generated: { algorithmVersion: "v1", generatorConfigHash: "a", seed: "x" }
  } as unknown as TurkeyV2NationalSourceLock;
}

describe("Turkey V2 source lock diff", () => {
  it("reports no rebuild for unchanged pinned sources", () => {
    expect(diffTurkeyV2SourceLocks(lock(), lock())).toMatchObject({
      changes: [],
      rebuildScope: "none",
      requiresReview: false
    });
  });

  it("scopes a provider checksum change and sorts changes deterministically", () => {
    const previous = lock();
    const candidate = structuredClone(previous);
    candidate.officialAdm3.providers[0]!.checksum = "b";
    candidate.contentHash = "sha256:new";
    const report = diffTurkeyV2SourceLocks(previous, candidate);
    expect(report).toMatchObject({
      rebuildScope: "affected-provinces",
      affectedProvinceCodes: ["34"],
      requiresReview: true
    });
    expect(report.changes[0]).toMatchObject({
      sourceId: "official:local:34",
      kind: "checksum-changed",
      changedFields: ["checksum"]
    });
    expect(diffTurkeyV2SourceLocks(previous, candidate).contentHash).toBe(report.contentHash);
  });

  it("flags metadata changes separately and national snapshot changes globally", () => {
    const previous = lock();
    const candidate = structuredClone(previous);
    candidate.officialAdm3.providers[0]!.sourceDate = "2026-02";
    candidate.osmBarrierSnapshotChecksum = "b";
    const report = diffTurkeyV2SourceLocks(previous, candidate);
    expect(report.changes.map((change) => [change.sourceId, change.kind])).toEqual([
      ["official:local:34", "metadata-changed"],
      ["osm:barriers", "checksum-changed"]
    ]);
    expect(report.rebuildScope).toBe("national");
  });

  it("reports added and removed local providers with affected provinces", () => {
    const previous = lock();
    const candidate = structuredClone(previous);
    candidate.officialAdm3.providers = [
      { providerId: "new", providerName: "New source", provinceCode: "06", checksum: "new" }
    ];
    const report = diffTurkeyV2SourceLocks(previous, candidate);
    expect(report.changes.map((change) => [change.sourceId, change.kind])).toEqual([
      ["official:local:34", "removed"],
      ["official:new:06", "added"]
    ]);
    expect(report.affectedProvinceCodes).toEqual(["06", "34"]);
  });
});
