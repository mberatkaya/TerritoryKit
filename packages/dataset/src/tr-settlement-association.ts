import { classifyLngLatTerritoryGeometryPlacement } from "./geometry.js";
import { hashTerritoryGeometry } from "./quality.js";
import type { LngLat, TerritoryDataset, TerritoryLicenseState, TerritoryZone } from "./types.js";

export const TR_SETTLEMENT_ASSOCIATION_SCHEMA_VERSION =
  "territorykit-tr-settlement-association@1" as const;

export const TR_SETTLEMENT_ASSOCIATION_STATUSES = [
  "SINGLE_SEED_MATCH",
  "AMBIGUOUS_REVIEW_REQUIRED",
  "UNSEEDED",
  "SOURCE_REVIEW_REQUIRED",
  "VERIFIED_BOUNDARY_MATCH"
] as const;

export type TrSettlementAssociationStatus = (typeof TR_SETTLEMENT_ASSOCIATION_STATUSES)[number];

export const TR_SETTLEMENT_KINDS = ["neighbourhood", "village", "locality", "unknown"] as const;

export type TrSettlementKind = (typeof TR_SETTLEMENT_KINDS)[number];

export const TR_SETTLEMENT_ASSOCIATION_METHODS = [
  "seed-point-in-zone",
  "official-boundary-overlay"
] as const;

export type TrSettlementAssociationMethod = (typeof TR_SETTLEMENT_ASSOCIATION_METHODS)[number];

export const TR_SETTLEMENT_REASON_CODES = [
  "CROSS_DISTRICT_PARENT",
  "SEED_ON_BOUNDARY",
  "DUPLICATE_SOURCE_ID",
  "MISSING_SOURCE_ID",
  "MULTI_ZONE_ASSOCIATION",
  "MULTI_SEED_IN_ZONE",
  "SOURCE_LICENSE_UNKNOWN",
  "PUBLICATION_RIGHTS_PENDING",
  "OFFICIAL_NAME_NOT_ASSESSED",
  "RURAL_VILLAGE_SEMANTICS"
] as const;

export const TR_SETTLEMENT_PUBLICATION_RIGHTS_STATUSES = [
  "approved",
  "pending",
  "restricted",
  "unknown"
] as const;

export type TrSettlementPublicationRightsStatus =
  (typeof TR_SETTLEMENT_PUBLICATION_RIGHTS_STATUSES)[number];

/** Evidence token required on records marked VERIFIED_BOUNDARY_MATCH. */
export const TR_SETTLEMENT_VERIFIED_BOUNDARY_EVIDENCE_TOKEN =
  "verified-official-boundary-spatial-match" as const;

export type TrSettlementReasonCode = (typeof TR_SETTLEMENT_REASON_CODES)[number];

export interface TrSettlementSeedInput {
  id?: string;
  name: string;
  coordinate: LngLat;
  type?: string;
  source?: string;
  sourceId?: string;
  confidence?: number;
}

export interface TrSettlementAssociationSourceContext {
  providerId?: string;
  sourceDatasetId?: string;
  sourceSnapshotChecksum?: string;
  sourceSnapshotId?: string;
  license?: string;
  licenseState?: TerritoryLicenseState;
  attribution?: string;
}

export interface TrSettlementAssociationRecord {
  parentAdm2Id: string;
  zoneId: string;
  settlementRefId: string;
  name: string;
  normalizedName: string;
  settlementKind: TrSettlementKind;
  seedCoordinate: LngLat;
  seedSourceId?: string;
  sourceSnapshotChecksum?: string;
  associationMethod: TrSettlementAssociationMethod;
  associationConfidence: number;
  associationStatus: TrSettlementAssociationStatus;
  evidence: string[];
  reasonCodes: TrSettlementReasonCode[];
  /** @deprecated Use `licenseIdentified` + `publicationRightsStatus`; retained for Rush&Claim preview. */
  sourceLicenseStatus: "known" | "unknown" | "restricted";
  licenseIdentified: boolean;
  publicationRightsStatus: TrSettlementPublicationRightsStatus;
}

export interface TrSettlementZoneSummary {
  zoneId: string;
  associationStatus: TrSettlementAssociationStatus;
  associationCount: number;
  distinctSettlementRefIds: string[];
  reasonCodes: TrSettlementReasonCode[];
}

export interface TrSettlementAssociationArtifact {
  schemaVersion: typeof TR_SETTLEMENT_ASSOCIATION_SCHEMA_VERSION;
  datasetId: string;
  datasetVersion: string;
  canonicalGeometryHash: string;
  parentAdm2Id: string;
  builtAt: string;
  source: TrSettlementAssociationSourceContext;
  invalidation: {
    rebuildWhen: ["canonicalGeometryHash", "sourceSnapshotChecksum"];
    note: string;
  };
  summary: {
    zoneCount: number;
    associationCount: number;
    byStatus: Record<TrSettlementAssociationStatus, number>;
    distinctSettlementRefs: number;
  };
  associations: TrSettlementAssociationRecord[];
  zoneSummaries: TrSettlementZoneSummary[];
  contentHash: string;
}

export interface TrSettlementAssociationBuildInput {
  dataset: TerritoryDataset;
  parentAdm2Id: string;
  seeds: readonly TrSettlementSeedInput[];
  source: TrSettlementAssociationSourceContext;
  builtAt?: string;
}

export interface TrSettlementAssociationValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
  zoneId?: string;
  settlementRefId?: string;
}

export interface TrSettlementAssociationValidationReport {
  ok: boolean;
  issues: TrSettlementAssociationValidationIssue[];
}

export interface TrSettlementAssociationValidationOptions {
  expectedSourceSnapshotChecksum?: string;
}

export interface TrSettlementPinnedShardEvidence {
  shardPath: string;
  shardSha256: string;
  expectedShardSha256?: string;
  shardBytesMatch: boolean;
  gameplayFingerprint: string;
  manifestGeometryHash: string;
  manifestDatasetVersion: string;
  adm3ZoneCount: number;
}

export interface TrSettlementGeometryInvariantReport {
  ok: boolean;
  zoneCountMatch: boolean;
  zoneIdSetMatch: boolean;
  canonicalGeometryHashMatch: boolean;
  gameplayFingerprintMatch: boolean;
  gameplayFingerprint: string;
  parentRelationMatch: boolean;
  neighborRelationMatch: boolean;
  mismatches: string[];
}

const COORDINATE_KEY_PRECISION = 6;

export function normalizeTrSettlementName(name: string): string {
  return name.trim().toLocaleLowerCase("tr").normalize("NFKC").replace(/\s+/g, " ");
}

export function mapTrSettlementSeedType(type: string | undefined): TrSettlementKind {
  switch (type) {
    case "neighbourhood":
    case "suburb":
    case "quarter":
      return "neighbourhood";
    case "village":
      return "village";
    case "locality":
      return "locality";
    default:
      return "unknown";
  }
}

export function resolveTrSettlementLicenseIdentified(
  source: TrSettlementAssociationSourceContext
): boolean {
  return Boolean(source.license?.trim());
}

export function resolveTrSettlementPublicationRightsStatus(
  source: TrSettlementAssociationSourceContext
): TrSettlementPublicationRightsStatus {
  if (source.licenseState === "restricted") {
    return "restricted";
  }

  if (source.licenseState === "approved") {
    return "approved";
  }

  if (source.licenseState === "pending") {
    return "pending";
  }

  return "unknown";
}

/** Maps publication/redistribution rights to legacy `sourceLicenseStatus` (not license identification). */
export function resolveTrSettlementSourceLicenseStatus(
  source: TrSettlementAssociationSourceContext
): "known" | "unknown" | "restricted" {
  const publicationRights = resolveTrSettlementPublicationRightsStatus(source);
  if (publicationRights === "approved") {
    return "known";
  }

  if (publicationRights === "restricted") {
    return "restricted";
  }

  return "unknown";
}

export function assessVerifiedBoundaryMatchFailures(
  association: TrSettlementAssociationRecord,
  source: TrSettlementAssociationSourceContext
): string[] {
  const failures: string[] = [];

  if (association.associationMethod !== "official-boundary-overlay") {
    failures.push("VERIFIED_BOUNDARY_MATCH requires associationMethod official-boundary-overlay.");
  }

  if (!association.licenseIdentified) {
    failures.push("VERIFIED_BOUNDARY_MATCH requires an identified upstream license on the source.");
  }

  if (association.publicationRightsStatus !== "approved") {
    failures.push(
      "VERIFIED_BOUNDARY_MATCH requires explicit publication/redistribution approval; license identification alone is insufficient."
    );
  }

  if (!source.providerId?.trim() || !source.sourceDatasetId?.trim()) {
    failures.push("VERIFIED_BOUNDARY_MATCH requires source providerId and sourceDatasetId.");
  }

  if (!source.sourceSnapshotChecksum?.trim()) {
    failures.push("VERIFIED_BOUNDARY_MATCH requires source.sourceSnapshotChecksum.");
  }

  if (!association.sourceSnapshotChecksum?.trim()) {
    failures.push("VERIFIED_BOUNDARY_MATCH requires per-record sourceSnapshotChecksum.");
  }

  if (
    !association.evidence.includes(TR_SETTLEMENT_VERIFIED_BOUNDARY_EVIDENCE_TOKEN) &&
    !association.evidence.some((entry) => entry.includes("official boundary spatial match"))
  ) {
    failures.push(
      "VERIFIED_BOUNDARY_MATCH requires governed official polygon spatial-match evidence."
    );
  }

  if (association.associationMethod === "seed-point-in-zone") {
    failures.push("OSM seed point-in-zone associations cannot be VERIFIED_BOUNDARY_MATCH.");
  }

  return failures;
}

export function buildTrSettlementPinnedShardEvidence(input: {
  shardPath: string;
  shardSha256: string;
  dataset: TerritoryDataset;
  parentAdm2Id: string;
  expectedShardSha256?: string;
}): TrSettlementPinnedShardEvidence {
  const adm3ZoneCount = input.dataset.zones.filter(
    (zone) => zone.level === 3 && zone.parentId === input.parentAdm2Id
  ).length;

  return {
    shardPath: input.shardPath,
    shardSha256: input.shardSha256,
    ...(input.expectedShardSha256 ? { expectedShardSha256: input.expectedShardSha256 } : {}),
    shardBytesMatch: input.expectedShardSha256
      ? input.shardSha256 === input.expectedShardSha256
      : true,
    gameplayFingerprint: computeTrSettlementGameplayFingerprint(input.dataset, input.parentAdm2Id),
    manifestGeometryHash: input.dataset.manifest.geometryHash,
    manifestDatasetVersion: input.dataset.manifest.datasetVersion,
    adm3ZoneCount
  };
}

export function createTrSettlementRefId(
  seed: TrSettlementSeedInput,
  source: TrSettlementAssociationSourceContext
): string {
  const namespace = source.sourceSnapshotChecksum?.slice(0, 16) ?? "no-snapshot";
  if (seed.sourceId && seed.sourceId.trim().length > 0) {
    const qualified = seed.sourceId.trim().replace(/[^a-zA-Z0-9:_-]+/g, "-");
    return `tr:settlement-ref:${namespace}:${qualified}`;
  }

  const normalizedName = normalizeTrSettlementName(seed.name);
  const coordinateKey = seed.coordinate
    .map((value) => Math.round(value * 10 ** COORDINATE_KEY_PRECISION))
    .join(",");
  const digest = fnv1a32(`${normalizedName}|${coordinateKey}|${seed.source ?? "osm"}`);
  return `tr:settlement-ref:${namespace}:name-${digest}`;
}

function roundCoordinate(coordinate: LngLat): LngLat {
  const factor = 10 ** COORDINATE_KEY_PRECISION;
  return [Math.round(coordinate[0] * factor) / factor, Math.round(coordinate[1] * factor) / factor];
}

function readZoneGeometryHash(zone: TerritoryZone): string | undefined {
  const territory = zone.properties?.territory as Record<string, unknown> | undefined;
  const geometryHash =
    typeof territory?.geometryHash === "string"
      ? territory.geometryHash
      : typeof territory?.effectiveGeometryHash === "string"
        ? territory.effectiveGeometryHash
        : undefined;
  return geometryHash;
}

function compareAssociations(
  left: TrSettlementAssociationRecord,
  right: TrSettlementAssociationRecord
): number {
  return (
    left.zoneId.localeCompare(right.zoneId) ||
    left.settlementRefId.localeCompare(right.settlementRefId) ||
    left.normalizedName.localeCompare(right.normalizedName)
  );
}

function deriveZoneAssociationStatus(
  records: readonly TrSettlementAssociationRecord[]
): TrSettlementAssociationStatus {
  if (records.length === 0) {
    return "UNSEEDED";
  }

  const distinctRefs = new Set(records.map((record) => record.settlementRefId));
  const distinctNames = new Set(records.map((record) => record.normalizedName));

  if (distinctRefs.size > 1 || distinctNames.size > 1) {
    return "AMBIGUOUS_REVIEW_REQUIRED";
  }

  if (records.every((record) => record.associationStatus === "VERIFIED_BOUNDARY_MATCH")) {
    return "VERIFIED_BOUNDARY_MATCH";
  }

  return "SINGLE_SEED_MATCH";
}

export function buildTrSettlementAssociations(
  input: TrSettlementAssociationBuildInput
): TrSettlementAssociationArtifact {
  const adm3Zones = input.dataset.zones
    .filter((zone) => zone.level === 3 && zone.parentId === input.parentAdm2Id)
    .sort((left, right) => left.id.localeCompare(right.id));

  const parentZone = input.dataset.zones.find((zone) => zone.id === input.parentAdm2Id);
  if (!parentZone) {
    throw new Error(`Parent ADM2 zone not found: ${input.parentAdm2Id}`);
  }

  const licenseIdentified = resolveTrSettlementLicenseIdentified(input.source);
  const publicationRightsStatus = resolveTrSettlementPublicationRightsStatus(input.source);
  const sourceLicenseStatus = resolveTrSettlementSourceLicenseStatus(input.source);
  const settlementRefToZones = new Map<string, Set<string>>();
  const associations: TrSettlementAssociationRecord[] = [];

  const sortedSeeds = [...input.seeds].sort((left, right) => {
    const nameCompare = normalizeTrSettlementName(left.name).localeCompare(
      normalizeTrSettlementName(right.name),
      "tr"
    );
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return left.coordinate[0] - right.coordinate[0] || left.coordinate[1] - right.coordinate[1];
  });

  const sourceIdCounts = new Map<string, number>();
  for (const seed of sortedSeeds) {
    if (seed.sourceId?.trim()) {
      const key = seed.sourceId.trim();
      sourceIdCounts.set(key, (sourceIdCounts.get(key) ?? 0) + 1);
    }
  }

  for (const seed of sortedSeeds) {
    const settlementRefId = createTrSettlementRefId(seed, input.source);
    const normalizedName = normalizeTrSettlementName(seed.name);
    const settlementKind = mapTrSettlementSeedType(seed.type);
    const reasonCodes: TrSettlementReasonCode[] = [];
    const evidence: string[] = [];

    const parentPlacement = classifyLngLatTerritoryGeometryPlacement(
      seed.coordinate,
      parentZone.geometry
    );
    if (parentPlacement === "outside") {
      reasonCodes.push("CROSS_DISTRICT_PARENT");
      evidence.push("Seed coordinate lies outside parent ADM2 geometry.");
    }

    if (!seed.sourceId?.trim()) {
      reasonCodes.push("MISSING_SOURCE_ID");
      evidence.push(
        "No upstream source-native ID; settlementRefId uses source-qualified name hash."
      );
    } else if ((sourceIdCounts.get(seed.sourceId.trim()) ?? 0) > 1) {
      reasonCodes.push("DUPLICATE_SOURCE_ID");
      evidence.push(`Duplicate sourceId ${seed.sourceId.trim()} in seed snapshot.`);
    }

    if (settlementKind === "village") {
      reasonCodes.push("RURAL_VILLAGE_SEMANTICS");
    }

    reasonCodes.push("OFFICIAL_NAME_NOT_ASSESSED");

    const matchedZones: Array<{
      zone: TerritoryZone;
      placement: ReturnType<typeof classifyLngLatTerritoryGeometryPlacement>;
    }> = [];

    for (const zone of adm3Zones) {
      const zonePlacement = classifyLngLatTerritoryGeometryPlacement(
        seed.coordinate,
        zone.geometry
      );
      if (zonePlacement === "inside" || zonePlacement === "boundary") {
        matchedZones.push({ zone, placement: zonePlacement });
      }
    }

    if (matchedZones.length === 0) {
      continue;
    }

    if (matchedZones.length > 1) {
      reasonCodes.push("MULTI_ZONE_ASSOCIATION");
      evidence.push(
        `Seed matches ${matchedZones.length} gameplay zones; association emitted per zone.`
      );
    }

    const zoneSet = settlementRefToZones.get(settlementRefId) ?? new Set<string>();
    for (const match of matchedZones) {
      zoneSet.add(match.zone.id);
    }
    settlementRefToZones.set(settlementRefId, zoneSet);
    if (zoneSet.size > 1) {
      reasonCodes.push("MULTI_ZONE_ASSOCIATION");
    }

    let associationStatus: TrSettlementAssociationStatus = "SINGLE_SEED_MATCH";
    if (publicationRightsStatus !== "approved") {
      associationStatus = "SOURCE_REVIEW_REQUIRED";
      if (!licenseIdentified) {
        reasonCodes.push("SOURCE_LICENSE_UNKNOWN");
        evidence.push("Source license not identified; geometric association only.");
      } else {
        reasonCodes.push("PUBLICATION_RIGHTS_PENDING");
        evidence.push(
          "License name identified but publication/redistribution is not approved; cannot mark VERIFIED_BOUNDARY_MATCH."
        );
      }
    }

    for (const match of matchedZones) {
      const recordReasonCodes = [...reasonCodes];
      const recordEvidence = [...evidence];
      if (match.placement === "boundary") {
        recordReasonCodes.push("SEED_ON_BOUNDARY");
        recordEvidence.push("Seed lies on gameplay zone boundary (covers semantics).");
      }

      const associationConfidence = clamp01(
        (seed.confidence ?? 0.75) * (match.placement === "boundary" ? 0.65 : 1)
      );

      associations.push({
        parentAdm2Id: input.parentAdm2Id,
        zoneId: match.zone.id,
        settlementRefId,
        name: seed.name.trim(),
        normalizedName,
        settlementKind,
        seedCoordinate: roundCoordinate(seed.coordinate),
        ...(seed.sourceId?.trim() ? { seedSourceId: seed.sourceId.trim() } : {}),
        ...(input.source.sourceSnapshotChecksum
          ? { sourceSnapshotChecksum: input.source.sourceSnapshotChecksum }
          : {}),
        associationMethod: "seed-point-in-zone",
        associationConfidence,
        associationStatus,
        evidence: [...new Set(recordEvidence)].sort(),
        reasonCodes: [...new Set(recordReasonCodes)].sort(),
        sourceLicenseStatus,
        licenseIdentified,
        publicationRightsStatus
      });
    }
  }

  associations.sort(compareAssociations);

  const associationsByZone = new Map<string, TrSettlementAssociationRecord[]>();
  for (const association of associations) {
    const existing = associationsByZone.get(association.zoneId) ?? [];
    existing.push(association);
    associationsByZone.set(association.zoneId, existing);
  }

  const zoneSummaries: TrSettlementZoneSummary[] = adm3Zones.map((zone) => {
    const zoneAssociations = associationsByZone.get(zone.id) ?? [];
    const distinctSettlementRefIds = [
      ...new Set(zoneAssociations.map((record) => record.settlementRefId))
    ].sort();
    const reasonCodes = [
      ...new Set(zoneAssociations.flatMap((record) => record.reasonCodes))
    ].sort() as TrSettlementReasonCode[];

    if (zoneAssociations.length > 1 && distinctSettlementRefIds.length > 1) {
      reasonCodes.push("MULTI_SEED_IN_ZONE");
    }

    return {
      zoneId: zone.id,
      associationStatus: deriveZoneAssociationStatus(zoneAssociations),
      associationCount: zoneAssociations.length,
      distinctSettlementRefIds,
      reasonCodes: [...new Set(reasonCodes)].sort()
    };
  });

  const byStatus = Object.fromEntries(
    TR_SETTLEMENT_ASSOCIATION_STATUSES.map((status) => [status, 0])
  ) as Record<TrSettlementAssociationStatus, number>;

  for (const summary of zoneSummaries) {
    byStatus[summary.associationStatus] += 1;
  }

  const body: Omit<TrSettlementAssociationArtifact, "contentHash"> = {
    schemaVersion: TR_SETTLEMENT_ASSOCIATION_SCHEMA_VERSION,
    datasetId: input.dataset.manifest.datasetId,
    datasetVersion: input.dataset.manifest.datasetVersion,
    canonicalGeometryHash: input.dataset.manifest.geometryHash,
    parentAdm2Id: input.parentAdm2Id,
    builtAt: input.builtAt ?? new Date(0).toISOString(),
    source: input.source,
    invalidation: {
      rebuildWhen: ["canonicalGeometryHash", "sourceSnapshotChecksum"],
      note: "Rebuild association artifact when gameplay canonicalGeometryHash or seed sourceSnapshotChecksum changes; gameplay polygons and zone IDs are not mutated by this layer. Artifact contentHash is deterministic over semantic payload and excludes builtAt; full JSON byte checksums still change when builtAt changes."
    },
    summary: {
      zoneCount: adm3Zones.length,
      associationCount: associations.length,
      byStatus,
      distinctSettlementRefs: new Set(associations.map((record) => record.settlementRefId)).size
    },
    associations,
    zoneSummaries
  };

  return {
    ...body,
    contentHash: computeTrSettlementAssociationContentHash(body)
  };
}

export function computeTrSettlementAssociationContentHash(
  artifact: Omit<TrSettlementAssociationArtifact, "contentHash"> & { contentHash?: string }
): string {
  const stableArtifact = stripContentHash(artifact);
  const { builtAt: _builtAt, ...semanticPayload } = stableArtifact;
  return `fnv1a32:${fnv1a32(stableStringify(semanticPayload))}`;
}

export function validateTrSettlementAssociationArtifact(
  dataset: TerritoryDataset,
  artifact: TrSettlementAssociationArtifact,
  options: TrSettlementAssociationValidationOptions = {}
): TrSettlementAssociationValidationReport {
  const issues: TrSettlementAssociationValidationIssue[] = [];
  const zoneIds = new Set(dataset.zones.map((zone) => zone.id));

  if (artifact.schemaVersion !== TR_SETTLEMENT_ASSOCIATION_SCHEMA_VERSION) {
    issues.push({
      code: "SCHEMA_VERSION",
      severity: "error",
      message: `Expected schema ${TR_SETTLEMENT_ASSOCIATION_SCHEMA_VERSION}.`,
      path: "$.schemaVersion"
    });
  }

  if (artifact.datasetId !== dataset.manifest.datasetId) {
    issues.push({
      code: "DATASET_ID_MISMATCH",
      severity: "error",
      message: "Artifact datasetId does not match dataset manifest.",
      path: "$.datasetId"
    });
  }

  if (artifact.datasetVersion !== dataset.manifest.datasetVersion) {
    issues.push({
      code: "DATASET_VERSION_MISMATCH",
      severity: "error",
      message: "Artifact datasetVersion does not match dataset manifest.",
      path: "$.datasetVersion"
    });
  }

  if (artifact.canonicalGeometryHash !== dataset.manifest.geometryHash) {
    issues.push({
      code: "GEOMETRY_HASH_MISMATCH",
      severity: "error",
      message: "Artifact canonicalGeometryHash does not match dataset manifest geometryHash.",
      path: "$.canonicalGeometryHash"
    });
  }

  const expectedHash = computeTrSettlementAssociationContentHash(artifact);
  if (artifact.contentHash !== expectedHash) {
    issues.push({
      code: "CONTENT_HASH_MISMATCH",
      severity: "error",
      message: "Artifact contentHash does not match deterministic payload hash.",
      path: "$.contentHash"
    });
  }

  if (options.expectedSourceSnapshotChecksum) {
    const actualChecksum = artifact.source.sourceSnapshotChecksum?.trim();
    if (actualChecksum !== options.expectedSourceSnapshotChecksum) {
      issues.push({
        code: "SOURCE_SNAPSHOT_MISMATCH",
        severity: "error",
        message: "Artifact source snapshot checksum does not match expected seed snapshot.",
        path: "$.source.sourceSnapshotChecksum"
      });
    }
  }

  for (const association of artifact.associations) {
    if (!zoneIds.has(association.zoneId)) {
      issues.push({
        code: "UNKNOWN_ZONE",
        severity: "error",
        message: `Association references unknown zone ${association.zoneId}.`,
        zoneId: association.zoneId,
        settlementRefId: association.settlementRefId
      });
    }

    if (association.associationStatus === "VERIFIED_BOUNDARY_MATCH") {
      for (const message of assessVerifiedBoundaryMatchFailures(association, artifact.source)) {
        issues.push({
          code: "UNVERIFIED_BOUNDARY",
          severity: "error",
          message,
          settlementRefId: association.settlementRefId,
          zoneId: association.zoneId
        });
      }
    }
  }

  for (const summary of artifact.zoneSummaries) {
    const zoneAssociations = artifact.associations.filter(
      (record) => record.zoneId === summary.zoneId
    );
    const distinctRefs = new Set(zoneAssociations.map((record) => record.settlementRefId));
    if (
      summary.associationStatus === "SINGLE_SEED_MATCH" &&
      (distinctRefs.size !== 1 || zoneAssociations.length === 0)
    ) {
      issues.push({
        code: "SINGLE_SEED_STATUS_INVALID",
        severity: "error",
        message: `Zone ${summary.zoneId} marked SINGLE_SEED_MATCH without exactly one settlement.`,
        zoneId: summary.zoneId
      });
    }

    if (
      summary.associationStatus === "AMBIGUOUS_REVIEW_REQUIRED" &&
      distinctRefs.size <= 1 &&
      zoneAssociations.length <= 1
    ) {
      issues.push({
        code: "AMBIGUOUS_STATUS_INVALID",
        severity: "error",
        message: `Zone ${summary.zoneId} marked ambiguous without multiple settlements.`,
        zoneId: summary.zoneId
      });
    }
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues
  };
}

export function computeTrSettlementGameplayFingerprint(
  dataset: TerritoryDataset,
  parentAdm2Id: string
): string {
  const adm3Zones = dataset.zones
    .filter((zone) => zone.level === 3 && zone.parentId === parentAdm2Id)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((zone) => {
      const geometryHash = readZoneGeometryHash(zone) ?? hashTerritoryGeometry(zone.geometry);
      return `${zone.id}|${geometryHash}|${zone.parentId ?? ""}|${[...zone.neighborIds].sort().join(",")}`;
    });

  return `fnv1a32:${fnv1a32(stableStringify(adm3Zones))}`;
}

export function compareTrSettlementGameplayGeometryInvariant(
  baseline: TerritoryDataset,
  candidate: TerritoryDataset,
  parentAdm2Id: string
): TrSettlementGeometryInvariantReport {
  const mismatches: string[] = [];
  const filterAdm3 = (dataset: TerritoryDataset) =>
    dataset.zones
      .filter((zone) => zone.level === 3 && zone.parentId === parentAdm2Id)
      .sort((left, right) => left.id.localeCompare(right.id));

  const baselineZones = filterAdm3(baseline);
  const candidateZones = filterAdm3(candidate);
  const baselineIds = new Set(baselineZones.map((zone) => zone.id));
  const candidateIds = new Set(candidateZones.map((zone) => zone.id));

  const zoneCountMatch = baselineZones.length === candidateZones.length;
  if (!zoneCountMatch) {
    mismatches.push(
      `ADM3 zone count mismatch: baseline=${baselineZones.length} candidate=${candidateZones.length}`
    );
  }

  let zoneIdSetMatch = true;
  for (const id of baselineIds) {
    if (!candidateIds.has(id)) {
      zoneIdSetMatch = false;
      mismatches.push(`Missing zone id in candidate: ${id}`);
    }
  }
  for (const id of candidateIds) {
    if (!baselineIds.has(id)) {
      zoneIdSetMatch = false;
      mismatches.push(`Unexpected zone id in candidate: ${id}`);
    }
  }

  const canonicalGeometryHashMatch =
    baseline.manifest.geometryHash === candidate.manifest.geometryHash;
  if (!canonicalGeometryHashMatch) {
    mismatches.push(
      `Manifest geometryHash mismatch (district shard wrappers may differ): ${baseline.manifest.geometryHash} vs ${candidate.manifest.geometryHash}`
    );
  }

  const baselineFingerprint = computeTrSettlementGameplayFingerprint(baseline, parentAdm2Id);
  const candidateFingerprint = computeTrSettlementGameplayFingerprint(candidate, parentAdm2Id);
  const gameplayFingerprintMatch = baselineFingerprint === candidateFingerprint;
  if (!gameplayFingerprintMatch) {
    mismatches.push(
      `Gameplay fingerprint mismatch: ${baselineFingerprint} vs ${candidateFingerprint}`
    );
  }

  let parentRelationMatch = true;
  let neighborRelationMatch = true;
  for (const baselineZone of baselineZones) {
    const candidateZone = candidateZones.find((zone) => zone.id === baselineZone.id);
    if (!candidateZone) {
      continue;
    }

    if (baselineZone.parentId !== candidateZone.parentId) {
      parentRelationMatch = false;
      mismatches.push(`Parent mismatch for ${baselineZone.id}`);
    }

    const leftNeighbors = [...baselineZone.neighborIds].sort().join("|");
    const rightNeighbors = [...candidateZone.neighborIds].sort().join("|");
    if (leftNeighbors !== rightNeighbors) {
      neighborRelationMatch = false;
      mismatches.push(`Neighbor mismatch for ${baselineZone.id}`);
    }

    const baselineHash =
      readZoneGeometryHash(baselineZone) ?? hashTerritoryGeometry(baselineZone.geometry);
    const candidateHash =
      readZoneGeometryHash(candidateZone) ?? hashTerritoryGeometry(candidateZone.geometry);
    if (baselineHash !== candidateHash) {
      mismatches.push(`Geometry hash mismatch for ${baselineZone.id}`);
    }
  }

  const ok =
    zoneCountMatch &&
    zoneIdSetMatch &&
    gameplayFingerprintMatch &&
    parentRelationMatch &&
    neighborRelationMatch;

  return {
    ok,
    zoneCountMatch,
    zoneIdSetMatch,
    canonicalGeometryHashMatch,
    gameplayFingerprintMatch,
    gameplayFingerprint: baselineFingerprint,
    parentRelationMatch,
    neighborRelationMatch,
    mismatches
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function stripContentHash<T extends { contentHash?: string }>(value: T): Omit<T, "contentHash"> {
  const { contentHash: _contentHash, ...rest } = value;
  return rest;
}

function stableStringify(input: unknown): string {
  if (input === null || typeof input !== "object") {
    return JSON.stringify(input);
  }

  if (Array.isArray(input)) {
    return `[${input.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(input as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `{${entries
    .map(([key, value]) => `${JSON.stringify(key)}:${stableStringify(value)}`)
    .join(",")}}`;
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
