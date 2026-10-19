import { hashTerritoryGeometry } from "./quality.js";
import { sha256HexFromUtf8 } from "./sha256-hex.js";
import {
  SETTLEMENT_IDENTITY_LAYER_SCHEMA_VERSION,
  computeSettlementIdentityLayerContentChecksum,
  settlementHasLawfulPolygonEvidence,
  type SettlementIdentity,
  type SettlementIdentityLayer
} from "./settlement-identity.js";
import type { TerritoryDataset, TerritoryZone } from "./types.js";

export const SETTLEMENT_IDENTITY_VALIDATION_CODES = [
  "SCHEMA_VERSION_MISMATCH",
  "DATASET_ID_MISMATCH",
  "DATASET_VERSION_MISMATCH",
  "PARENT_ADM2_MISMATCH",
  "ZONE_ID_SET_MISMATCH",
  "GEOMETRY_HASH_SET_MISMATCH",
  "ZONE_GEOMETRY_HASH_MISMATCH",
  "CONTENT_CHECKSUM_MISMATCH",
  "SOURCE_SNAPSHOT_MISMATCH",
  "SOURCE_LOCK_MISSING",
  "SOURCE_LOCK_STATE_MISMATCH",
  "UNKNOWN_ZONE_REFERENCE",
  "DUPLICATE_SETTLEMENT_ID",
  "FORGED_POLYGON_EVIDENCE",
  "UNAUTHORIZED_REDISTRIBUTION_CLAIM",
  "UNAUTHORIZED_REVIEW_APPROVAL",
  "LAYER_ZONE_SUMMARY_GAP"
] as const;

export type SettlementIdentityValidationCode =
  (typeof SETTLEMENT_IDENTITY_VALIDATION_CODES)[number];

export type SettlementIdentityValidationSeverity = "error" | "warning";

export interface SettlementIdentityValidationIssue {
  code: SettlementIdentityValidationCode;
  severity: SettlementIdentityValidationSeverity;
  message: string;
  path?: string;
  zoneId?: string;
  settlementId?: string;
}

export interface SettlementIdentityPinExpectations {
  parentAdm2Id: string;
  gameplayDatasetId?: string;
  gameplayDatasetVersion?: string;
  zoneIdSetSha256?: string;
  geometryHashSetSha256?: string;
  identityLayerContentChecksum?: string;
  expectedOsmSnapshotChecksum?: string;
  requireSourceLockVerified?: boolean;
}

export interface ValidateSettlementIdentityLayerOptions {
  layer: SettlementIdentityLayer;
  gameplayDataset: TerritoryDataset;
  pins?: SettlementIdentityPinExpectations;
}

export interface SettlementIdentityValidationReport {
  ok: boolean;
  issues: SettlementIdentityValidationIssue[];
  observed: {
    zoneIdSetSha256: string;
    geometryHashSetSha256: string;
    contentChecksum: string;
  };
}

export function sha256HexFromStableJson(input: unknown): string {
  return sha256HexFromUtf8(stableStringify(input));
}

export function computeSettlementIdentityZoneIdSetSha256(zoneIds: readonly string[]): string {
  return sha256HexFromStableJson([...zoneIds].sort((left, right) => left.localeCompare(right)));
}

export function computeSettlementIdentityGeometryHashSetSha256(
  geometryHashByZoneId: Readonly<Record<string, string>>
): string {
  const rows = Object.entries(geometryHashByZoneId)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([zoneId, hash]) => ({ zoneId, hash }));
  return sha256HexFromStableJson(rows);
}

export function collectGameplayAdm3Zones(
  dataset: TerritoryDataset,
  parentAdm2Id: string
): TerritoryZone[] {
  return dataset.zones
    .filter((zone) => zone.level === 3 && zone.parentId === parentAdm2Id)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function validateSettlementIdentityLayer(
  options: ValidateSettlementIdentityLayerOptions
): SettlementIdentityValidationReport {
  const { layer, gameplayDataset, pins } = options;
  const issues: SettlementIdentityValidationIssue[] = [];
  const parentAdm2Id = pins?.parentAdm2Id ?? layer.parentAdm2Id;

  if (layer.schemaVersion !== SETTLEMENT_IDENTITY_LAYER_SCHEMA_VERSION) {
    issues.push({
      code: "SCHEMA_VERSION_MISMATCH",
      severity: "error",
      message: `Expected schema ${SETTLEMENT_IDENTITY_LAYER_SCHEMA_VERSION}.`,
      path: "$.schemaVersion"
    });
  }

  if (layer.parentAdm2Id !== parentAdm2Id) {
    issues.push({
      code: "PARENT_ADM2_MISMATCH",
      severity: "error",
      message: "Identity layer parentAdm2Id does not match pinned parent.",
      path: "$.parentAdm2Id"
    });
  }

  if (pins?.gameplayDatasetId && gameplayDataset.manifest.datasetId !== pins.gameplayDatasetId) {
    issues.push({
      code: "DATASET_ID_MISMATCH",
      severity: "error",
      message: "Gameplay datasetId does not match pin.",
      path: "$.manifest.datasetId"
    });
  }

  const expectedVersion = pins?.gameplayDatasetVersion ?? layer.gameplayDatasetVersion;
  if (gameplayDataset.manifest.datasetVersion !== expectedVersion) {
    issues.push({
      code: "DATASET_VERSION_MISMATCH",
      severity: "error",
      message: "Gameplay datasetVersion does not match identity layer pin.",
      path: "$.manifest.datasetVersion"
    });
  }

  if (layer.gameplayDatasetVersion !== expectedVersion) {
    issues.push({
      code: "DATASET_VERSION_MISMATCH",
      severity: "error",
      message: "Identity layer gameplayDatasetVersion does not match expected version.",
      path: "$.gameplayDatasetVersion"
    });
  }

  const gameplayZones = collectGameplayAdm3Zones(gameplayDataset, parentAdm2Id);
  const gameplayZoneIds = new Set(gameplayZones.map((zone) => zone.id));
  const geometryHashByZoneId = Object.fromEntries(
    gameplayZones.map((zone) => [zone.id, hashTerritoryGeometry(zone.geometry)])
  );

  const zoneIdSetSha256 = computeSettlementIdentityZoneIdSetSha256(gameplayZones.map((z) => z.id));
  const geometryHashSetSha256 =
    computeSettlementIdentityGeometryHashSetSha256(geometryHashByZoneId);
  const contentChecksum = computeSettlementIdentityLayerContentChecksum(layer);

  if (pins?.zoneIdSetSha256 && pins.zoneIdSetSha256 !== zoneIdSetSha256) {
    issues.push({
      code: "ZONE_ID_SET_MISMATCH",
      severity: "error",
      message: "Gameplay zone ID set SHA-256 does not match pin.",
      path: "$.pins.zoneIdSetSha256"
    });
  }

  if (pins?.geometryHashSetSha256 && pins.geometryHashSetSha256 !== geometryHashSetSha256) {
    issues.push({
      code: "GEOMETRY_HASH_SET_MISMATCH",
      severity: "error",
      message: "Gameplay geometry hash set SHA-256 does not match pin.",
      path: "$.pins.geometryHashSetSha256"
    });
  }

  if (pins?.identityLayerContentChecksum && pins.identityLayerContentChecksum !== contentChecksum) {
    issues.push({
      code: "CONTENT_CHECKSUM_MISMATCH",
      severity: "error",
      message: "Identity layer content checksum does not match pin.",
      path: "$.contentChecksum"
    });
  }

  if (layer.contentChecksum !== contentChecksum) {
    issues.push({
      code: "CONTENT_CHECKSUM_MISMATCH",
      severity: "error",
      message: "Identity layer contentChecksum does not match deterministic payload hash.",
      path: "$.contentChecksum"
    });
  }

  const settlementIds = new Set<string>();
  for (const settlement of layer.settlements) {
    if (settlementIds.has(settlement.settlementId)) {
      issues.push({
        code: "DUPLICATE_SETTLEMENT_ID",
        severity: "error",
        message: `Duplicate settlementId ${settlement.settlementId}.`,
        settlementId: settlement.settlementId
      });
    }
    settlementIds.add(settlement.settlementId);

    assertSeedOnlySemantics(settlement, issues);

    if (pins?.expectedOsmSnapshotChecksum) {
      const actual = settlement.provenance.snapshotChecksum?.trim();
      if (actual !== pins.expectedOsmSnapshotChecksum) {
        issues.push({
          code: "SOURCE_SNAPSHOT_MISMATCH",
          severity: "error",
          message: `Settlement ${settlement.settlementId} snapshot checksum does not match expected OSM snapshot.`,
          settlementId: settlement.settlementId,
          path: "$.provenance.snapshotChecksum"
        });
      }
    }

    if (pins?.requireSourceLockVerified && settlement.provenance.sourceLockState !== "verified") {
      issues.push({
        code: "SOURCE_LOCK_STATE_MISMATCH",
        severity: "error",
        message: `Settlement ${settlement.settlementId} source lock is not verified.`,
        settlementId: settlement.settlementId
      });
    }

    if (
      settlement.polygonEvidenceState !== "none" &&
      settlement.polygonEvidenceState !== "unknown" &&
      !settlementHasLawfulPolygonEvidence(settlement)
    ) {
      issues.push({
        code: "FORGED_POLYGON_EVIDENCE",
        severity: "error",
        message: `Settlement ${settlement.settlementId} claims polygon evidence without verified geometry and rights.`,
        settlementId: settlement.settlementId
      });
    }
  }

  if (pins?.requireSourceLockVerified) {
    const anyMissingLock = layer.settlements.some(
      (row) => row.provenance.sourceLockState === "unknown" || !row.provenance.sourceLockState
    );
    if (anyMissingLock) {
      issues.push({
        code: "SOURCE_LOCK_MISSING",
        severity: "error",
        message: "Pinned consumer contract requires verified OSM source lock on all settlements."
      });
    }
  }

  for (const association of layer.associations) {
    if (!gameplayZoneIds.has(association.zoneId)) {
      issues.push({
        code: "UNKNOWN_ZONE_REFERENCE",
        severity: "error",
        message: `Association references unknown gameplay zone ${association.zoneId}.`,
        zoneId: association.zoneId,
        settlementId: association.settlementId
      });
    }

    const expectedHash = geometryHashByZoneId[association.zoneId];
    if (expectedHash && association.gameplayGeometryHash !== expectedHash) {
      issues.push({
        code: "ZONE_GEOMETRY_HASH_MISMATCH",
        severity: "error",
        message: `Association geometry hash mismatch for zone ${association.zoneId}.`,
        zoneId: association.zoneId
      });
    }

    if (association.reviewDecision === "approved") {
      issues.push({
        code: "UNAUTHORIZED_REVIEW_APPROVAL",
        severity: "error",
        message: `Association ${association.zoneId}/${association.settlementId} has reviewDecision=approved without reviewed method.`,
        zoneId: association.zoneId,
        settlementId: association.settlementId
      });
    }
  }

  const summaryZoneIds = new Set(layer.zoneSummaries.map((row) => row.zoneId));
  for (const zone of gameplayZones) {
    if (!summaryZoneIds.has(zone.id)) {
      issues.push({
        code: "LAYER_ZONE_SUMMARY_GAP",
        severity: "error",
        message: `Missing zone summary for gameplay zone ${zone.id}.`,
        zoneId: zone.id
      });
    }
  }

  for (const summary of layer.zoneSummaries) {
    if (!gameplayZoneIds.has(summary.zoneId)) {
      issues.push({
        code: "UNKNOWN_ZONE_REFERENCE",
        severity: "error",
        message: `Zone summary references unknown gameplay zone ${summary.zoneId}.`,
        zoneId: summary.zoneId
      });
    }
    if (summary.autoDisplayNameAllowed) {
      issues.push({
        code: "UNAUTHORIZED_REDISTRIBUTION_CLAIM",
        severity: "error",
        message: `Zone ${summary.zoneId} enables autoDisplayNameAllowed without review evidence.`,
        zoneId: summary.zoneId
      });
    }
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
    observed: {
      zoneIdSetSha256,
      geometryHashSetSha256,
      contentChecksum
    }
  };
}

function assertSeedOnlySemantics(
  settlement: SettlementIdentity,
  issues: SettlementIdentityValidationIssue[]
): void {
  if (settlement.verificationState !== "locality-seed") {
    return;
  }

  if (settlement.geometryAvailability !== "seed-only") {
    issues.push({
      code: "FORGED_POLYGON_EVIDENCE",
      severity: "error",
      message: `Seed settlement ${settlement.settlementId} must remain geometryAvailability=seed-only.`,
      settlementId: settlement.settlementId
    });
  }

  if (settlement.polygonEvidenceState !== "none") {
    issues.push({
      code: "FORGED_POLYGON_EVIDENCE",
      severity: "error",
      message: `Seed settlement ${settlement.settlementId} must remain polygonEvidenceState=none.`,
      settlementId: settlement.settlementId
    });
  }

  if (settlement.provenance.permissionStatus === "redistribution-approved") {
    issues.push({
      code: "UNAUTHORIZED_REDISTRIBUTION_CLAIM",
      severity: "error",
      message: `Seed settlement ${settlement.settlementId} cannot claim redistribution-approved.`,
      settlementId: settlement.settlementId
    });
  }
}

function stableStringify(input: unknown): string {
  return JSON.stringify(sortJson(input));
}

function sortJson(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((value) => sortJson(value));
  }

  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, sortJson(value)])
    );
  }

  return input;
}
