import { createHash } from "node:crypto";
import type { TurkeyV2NationalSourceLock } from "./turkey-v2-national.js";

type Source = { id: string; provinceCode?: string; values: Record<string, unknown> };
export type TurkeyV2SourceChangeKind =
  "added" | "removed" | "checksum-changed" | "version-changed" | "metadata-changed";

export interface TurkeyV2SourceChange {
  sourceId: string;
  kind: TurkeyV2SourceChangeKind;
  changedFields: string[];
  provinceCode?: string;
}

export interface TurkeyV2SourceDiff {
  schemaVersion: "territorykit-tr-v2-source-diff@1";
  previousLockHash: string;
  candidateLockHash: string;
  changes: TurkeyV2SourceChange[];
  affectedProvinceCodes: string[];
  rebuildScope: "none" | "affected-provinces" | "national";
  requiresReview: boolean;
  contentHash: string;
}

/** Compare pinned sources without promoting or downloading candidate data. */
export function diffTurkeyV2SourceLocks(
  previous: TurkeyV2NationalSourceLock,
  candidate: TurkeyV2NationalSourceLock
): TurkeyV2SourceDiff {
  const before = new Map(sourceEntries(previous).map((source) => [source.id, source]));
  const after = new Map(sourceEntries(candidate).map((source) => [source.id, source]));
  const changes: TurkeyV2SourceChange[] = [];
  for (const sourceId of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const oldSource = before.get(sourceId);
    const newSource = after.get(sourceId);
    const changedFields = [
      ...new Set([...Object.keys(oldSource?.values ?? {}), ...Object.keys(newSource?.values ?? {})])
    ]
      .filter(
        (key) => JSON.stringify(oldSource?.values[key]) !== JSON.stringify(newSource?.values[key])
      )
      .sort();
    if (!changedFields.length) continue;
    const kind: TurkeyV2SourceChangeKind = !oldSource
      ? "added"
      : !newSource
        ? "removed"
        : changedFields.some((key) => /checksum|sha256|hash/i.test(key))
          ? "checksum-changed"
          : changedFields.some((key) => /version/i.test(key))
            ? "version-changed"
            : "metadata-changed";
    const provinceCode = newSource?.provinceCode ?? oldSource?.provinceCode;
    changes.push({ sourceId, kind, changedFields, ...(provinceCode ? { provinceCode } : {}) });
  }
  const affectedProvinceCodes = [
    ...new Set(changes.flatMap((change) => (change.provinceCode ? [change.provinceCode] : [])))
  ].sort();
  const rebuildScope: TurkeyV2SourceDiff["rebuildScope"] =
    changes.length === 0
      ? "none"
      : changes.some((change) => !change.provinceCode)
        ? "national"
        : "affected-provinces";
  const body = {
    schemaVersion: "territorykit-tr-v2-source-diff@1" as const,
    previousLockHash: previous.contentHash,
    candidateLockHash: candidate.contentHash,
    changes,
    affectedProvinceCodes,
    rebuildScope,
    requiresReview: changes.length > 0
  };
  return { ...body, contentHash: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}

function sourceEntries(lock: TurkeyV2NationalSourceLock): Source[] {
  return [
    {
      id: `adm0-adm2:${lock.adm0Adm2.sourceId}`,
      values: {
        sourceUrl: lock.adm0Adm2.sourceUrl,
        downloadUrl: lock.adm0Adm2.downloadUrl,
        sourceDate: lock.adm0Adm2.sourceDate,
        sha256: lock.adm0Adm2.sha256,
        levels: lock.adm0Adm2.levels,
        license: lock.adm0Adm2.license,
        attribution: lock.adm0Adm2.attribution
      }
    },
    ...lock.officialAdm3.providers.map((provider) => ({
      id: `official:${provider.providerId}:${provider.provinceCode}`,
      provinceCode: provider.provinceCode,
      values: { ...provider }
    })),
    {
      id: "osm:barriers",
      values: {
        sourceUrl: lock.osm.sourceUrl,
        downloadUrl: lock.osm.downloadUrl,
        checksum: lock.osm.checksum,
        snapshotChecksum: lock.osmBarrierSnapshotChecksum,
        status: lock.osm.status,
        license: lock.osm.license,
        attribution: lock.osm.attribution
      }
    },
    {
      id: "generated:algorithm",
      values: {
        algorithmVersion: lock.generated.algorithmVersion,
        generatorConfigHash: lock.generated.generatorConfigHash,
        seed: lock.generated.seed
      }
    },
    {
      id: "pipeline:policy",
      values: {
        sourcePriority: lock.hybridPipeline?.sourcePriority,
        minimumDistrictCoveragePercent: lock.hybridPipeline?.minimumDistrictCoveragePercent,
        geometry: lock.geometry,
        productionFallbackPolicy: lock.productionFallbackPolicy
      }
    }
  ];
}
