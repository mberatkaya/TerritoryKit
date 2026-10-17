import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ISTANBUL_SETTLEMENT_IDENTITY_PILOTS } from "./tr-mahalle-identity-istanbul-pilots.mjs";

const PRIORITY = {
  conflict: 0,
  ambiguousZone: 1,
  sourceIdentityCollision: 2,
  duplicateNormalizedName: 3,
  crossDistrictBorderline: 4,
  localityClassUncertainty: 5,
  unseededZone: 6,
  officialNameUnavailable: 7
};

function proposedActionFor(reasonCodes) {
  if (reasonCodes.includes("ASSOCIATION_CONFLICT")) {
    return "resolve-conflicting-associations";
  }
  if (reasonCodes.includes("AMBIGUOUS_MULTI_SEED_ZONE")) {
    return "pick-primary-seed-or-split-zone";
  }
  if (reasonCodes.includes("UNSEEDED_GAMEPLAY_ZONE")) {
    return "acquire-seeds-or-accept-unlabeled-zone";
  }
  if (reasonCodes.includes("OFFICIAL_POLYGON_UNAVAILABLE")) {
    return "blocked-await-official-source";
  }
  return "human-review-required";
}

/**
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {string} options.reportRoot
 * @param {string} [options.crossDistrictQaPath]
 */
export async function buildMahalleHumanReviewQueue(options) {
  const { repoRoot, reportRoot, crossDistrictQaPath } = options;
  const generatedAt = new Date().toISOString();
  const records = [];
  const settlementIndex = new Map();
  const normalizedNameIndex = new Map();

  for (const pilot of ISTANBUL_SETTLEMENT_IDENTITY_PILOTS) {
    const prefix = pilot.slug;
    const associationsPath = join(repoRoot, reportRoot, `${prefix}-zone-associations.json`);
    const identitiesPath = join(repoRoot, reportRoot, `${prefix}-settlement-identities.json`);
    const coveragePath = join(repoRoot, reportRoot, `${prefix}-coverage-and-provenance.json`);

    let associations;
    let identities;
    let coverage;
    try {
      associations = JSON.parse(await readFile(associationsPath, "utf8"));
      identities = JSON.parse(await readFile(identitiesPath, "utf8"));
      coverage = JSON.parse(await readFile(coveragePath, "utf8"));
    } catch {
      continue;
    }

    const settlementById = new Map(identities.settlements.map((row) => [row.settlementId, row]));

    for (const settlement of identities.settlements) {
      const owners = settlementIndex.get(settlement.settlementId) ?? [];
      owners.push({
        district: pilot.district,
        parentAdm2Id: pilot.adm2Suffix ? `tr:adm2:${pilot.adm2Suffix}` : associations.parentAdm2Id
      });
      settlementIndex.set(settlement.settlementId, owners);

      const norm = settlement.normalizedName ?? settlement.displayName;
      const nameOwners = normalizedNameIndex.get(norm) ?? [];
      nameOwners.push({ district: pilot.district, settlementId: settlement.settlementId });
      normalizedNameIndex.set(norm, nameOwners);
    }

    for (const summary of associations.zoneSummaries) {
      const reasonCodes = [];
      let reviewPriority = PRIORITY.unseededZone;

      if (summary.associationStatus === "multiple-candidates") {
        reasonCodes.push("AMBIGUOUS_MULTI_SEED_ZONE");
        reviewPriority = PRIORITY.ambiguousZone;
      }
      if (summary.associationStatus === "unseeded") {
        reasonCodes.push("UNSEEDED_GAMEPLAY_ZONE");
        reviewPriority = PRIORITY.unseededZone;
      }

      if (pilot.officialDataPolicy?.status === "BLOCKED_BY_SOURCE") {
        reasonCodes.push("OFFICIAL_POLYGON_UNAVAILABLE");
        reviewPriority = Math.min(reviewPriority, PRIORITY.officialNameUnavailable);
      }

      if (reasonCodes.length === 0) {
        continue;
      }

      const zoneAssociations = associations.associations.filter(
        (row) => row.zoneId === summary.zoneId
      );
      const settlementIds = zoneAssociations.map((row) => row.settlementId);
      const seedNames = settlementIds
        .map((id) => settlementById.get(id)?.displayName)
        .filter(Boolean);
      const coordinates = zoneAssociations
        .flatMap((row) => row.evidence ?? [])
        .map((row) => row.seedCoordinate)
        .filter(Boolean);

      records.push({
        stableZoneId: summary.zoneId,
        district: pilot.district,
        parentAdm2Id: associations.parentAdm2Id,
        settlementIds,
        seedNames,
        coordinates,
        sourceProvenance: {
          gameplayShard: coverage.provenance?.gameplayShard,
          barrierSnapshotSha256: coverage.provenance?.barrierSnapshotSha256 ?? null,
          osmSourceLockState: coverage.provenance?.osmSourceLockState ?? "unknown"
        },
        geometryClassification: "gameplay-rc8-adm3",
        ambiguityReasonCodes: reasonCodes,
        reviewPriority,
        proposedAction: proposedActionFor(reasonCodes),
        reviewer: null,
        reviewDecision: "pending",
        autoDisplayNameAllowed: false,
        evidenceLinks: [
          `${reportRoot}/${prefix}-zone-associations.json`,
          `${reportRoot}/${prefix}-ambiguity-report.json`,
          coverage.provenance?.osmSourceLockPath ? `${coverage.provenance.osmSourceLockPath}` : null
        ].filter(Boolean)
      });
    }

    for (const association of associations.associations) {
      if (association.status !== "conflict") {
        continue;
      }

      const settlement = settlementById.get(association.settlementId);
      records.push({
        stableZoneId: association.zoneId,
        district: pilot.district,
        parentAdm2Id: associations.parentAdm2Id,
        settlementIds: [association.settlementId],
        seedNames: settlement ? [settlement.displayName] : [],
        coordinates: (association.evidence ?? []).map((row) => row.seedCoordinate).filter(Boolean),
        sourceProvenance: {
          gameplayShard: coverage.provenance?.gameplayShard,
          barrierSnapshotSha256: coverage.provenance?.barrierSnapshotSha256 ?? null,
          osmSourceLockState: coverage.provenance?.osmSourceLockState ?? "unknown"
        },
        geometryClassification: "gameplay-rc8-adm3",
        ambiguityReasonCodes: ["ASSOCIATION_CONFLICT"],
        reviewPriority: PRIORITY.conflict,
        proposedAction: proposedActionFor(["ASSOCIATION_CONFLICT"]),
        reviewer: null,
        reviewDecision: "pending",
        autoDisplayNameAllowed: false,
        evidenceLinks: [`${reportRoot}/${prefix}-zone-associations.json`]
      });
    }
  }

  const duplicateNormalizedNames = [...normalizedNameIndex.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([normalizedName, owners]) => ({ normalizedName, owners }));

  for (const row of duplicateNormalizedNames) {
    const districts = new Set(row.owners.map((owner) => owner.district));
    if (districts.size === 1 && row.owners.length > 1) {
      records.push({
        stableZoneId: null,
        district: row.owners[0].district,
        parentAdm2Id: null,
        settlementIds: row.owners.map((owner) => owner.settlementId),
        seedNames: [row.normalizedName],
        coordinates: [],
        sourceProvenance: null,
        geometryClassification: "seed-identity",
        ambiguityReasonCodes: ["DUPLICATE_NORMALIZED_NAME"],
        reviewPriority: PRIORITY.duplicateNormalizedName,
        proposedAction: "dedupe-or-disambiguate-seed-identity",
        reviewer: null,
        reviewDecision: "pending",
        autoDisplayNameAllowed: false,
        evidenceLinks: []
      });
    }
  }

  const duplicateSettlementIds = [...settlementIndex.entries()].filter(
    ([, owners]) => owners.length > 1
  );
  for (const [settlementId, owners] of duplicateSettlementIds) {
    records.push({
      stableZoneId: null,
      district: owners.map((row) => row.district).join(","),
      parentAdm2Id: owners.map((row) => row.parentAdm2Id).join(","),
      settlementIds: [settlementId],
      seedNames: [],
      coordinates: [],
      sourceProvenance: null,
      geometryClassification: "seed-identity",
      ambiguityReasonCodes: ["SOURCE_IDENTITY_COLLISION"],
      reviewPriority: PRIORITY.sourceIdentityCollision,
      proposedAction: "resolve-cross-district-settlement-id-collision",
      reviewer: null,
      reviewDecision: "pending",
      autoDisplayNameAllowed: false,
      evidenceLinks: crossDistrictQaPath ? [crossDistrictQaPath] : []
    });
  }

  records.sort((left, right) => left.reviewPriority - right.reviewPriority);

  const summary = {
    gameplayZoneCount: ISTANBUL_SETTLEMENT_IDENTITY_PILOTS.length,
    reviewRecordCount: records.length,
    ambiguousZoneRecords: records.filter((row) =>
      row.ambiguityReasonCodes.includes("AMBIGUOUS_MULTI_SEED_ZONE")
    ).length,
    unseededZoneRecords: records.filter((row) =>
      row.ambiguityReasonCodes.includes("UNSEEDED_GAMEPLAY_ZONE")
    ).length,
    conflictRecords: records.filter((row) =>
      row.ambiguityReasonCodes.includes("ASSOCIATION_CONFLICT")
    ).length,
    officialPolygonVerifiedCount: 0
  };

  return {
    schemaVersion: "territorykit-tr-mahalle-human-review-queue@1",
    generatedAt,
    programBaseline: {
      gameplayZones: 206,
      settlementRecords: 567,
      ambiguousZones: 73,
      unseededZones: 84,
      officialVerifiedPolygons: 0
    },
    summary,
    records
  };
}
