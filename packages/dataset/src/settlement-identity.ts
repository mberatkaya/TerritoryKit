import { pointIntersectsGeometry } from "./geometry.js";
import { hashTerritoryGeometry } from "./quality.js";
import type { LngLat, TerritoryGeometry, TerritoryLicenseState, TerritoryZone } from "./types.js";

export const SETTLEMENT_IDENTITY_LAYER_SCHEMA_VERSION =
  "territorykit-settlement-identity-layer@1" as const;

export const SETTLEMENT_LOCALITY_TYPES = [
  "neighbourhood",
  "suburb",
  "quarter",
  "village",
  "locality",
  "unknown"
] as const;

export const SETTLEMENT_GEOMETRY_AVAILABILITY = [
  "official-polygon",
  "osm-administrative-polygon",
  "seed-only",
  "unknown"
] as const;

export const SETTLEMENT_ASSOCIATION_METHODS = [
  "point-containment-covers",
  "point-containment-contains",
  "reviewed",
  "unknown"
] as const;

export const SETTLEMENT_ASSOCIATION_STATUSES = [
  "single-candidate",
  "multiple-candidates",
  "unseeded",
  "conflict",
  "review-required"
] as const;

export const SETTLEMENT_VERIFICATION_STATES = [
  "official-verified",
  "osm-sourced",
  "locality-seed",
  "unverified",
  "review-required"
] as const;

export const SETTLEMENT_PERMISSION_STATUSES = [
  "redistribution-approved",
  "redistribution-restricted",
  "redistribution-unknown",
  "use-restricted"
] as const;

export type SettlementLocalityType = (typeof SETTLEMENT_LOCALITY_TYPES)[number];
export type SettlementGeometryAvailability = (typeof SETTLEMENT_GEOMETRY_AVAILABILITY)[number];
export type SettlementAssociationMethod = (typeof SETTLEMENT_ASSOCIATION_METHODS)[number];
export type SettlementAssociationStatus = (typeof SETTLEMENT_ASSOCIATION_STATUSES)[number];
export type SettlementVerificationState = (typeof SETTLEMENT_VERIFICATION_STATES)[number];
export type SettlementPermissionStatus = (typeof SETTLEMENT_PERMISSION_STATUSES)[number];

export interface SettlementIdentitySourceProvenance {
  providerId: string;
  providerName?: string;
  sourceDatasetId?: string;
  sourceNativeId: string;
  sourceUrl?: string;
  snapshotDate?: string;
  snapshotChecksum?: string;
  license?: string;
  attribution?: string;
  licenseState: TerritoryLicenseState;
  permissionStatus: SettlementPermissionStatus;
}

export interface SettlementIdentity {
  settlementId: string;
  displayName: string;
  normalizedName: string;
  localityType: SettlementLocalityType;
  parentAdm0Id?: string;
  parentAdm1Id?: string;
  parentAdm2Id: string;
  seedCoordinate?: LngLat;
  provenance: SettlementIdentitySourceProvenance;
  identityLayerVersion: string;
  identityChecksum: string;
  verificationState: SettlementVerificationState;
  administrativeStatus: "active" | "unknown";
  geometryAvailability: SettlementGeometryAvailability;
  geometryAvailabilityReasonCode?: string;
  confidence?: number;
}

export interface SettlementAssociationEvidence {
  reasonCode: string;
  message: string;
  boundaryMode?: "covers" | "contains";
  seedCoordinate?: LngLat;
  duplicateOfSettlementId?: string;
}

export interface GameplayTerritoryAssociation {
  zoneId: string;
  settlementId: string;
  method: SettlementAssociationMethod;
  status: SettlementAssociationStatus;
  evidence: readonly SettlementAssociationEvidence[];
  gameplayDatasetVersion: string;
  gameplayGeometryHash: string;
  identityLayerVersion: string;
  reviewDecision?: "pending" | "approved" | "rejected";
  reviewReasonCode?: string;
}

export interface SettlementIdentityZoneSummary {
  zoneId: string;
  zoneName: string;
  containedSeedCount: number;
  distinctSettlementIds: readonly string[];
  distinctNormalizedNames: readonly string[];
  associationStatus: SettlementAssociationStatus;
  /** Consumer must not auto-apply a single mahalle display name when false. */
  autoDisplayNameAllowed: boolean;
}

export interface SettlementIdentityLayer {
  schemaVersion: typeof SETTLEMENT_IDENTITY_LAYER_SCHEMA_VERSION;
  identityLayerVersion: string;
  generatedAt: string;
  parentAdm2Id: string;
  gameplayDatasetVersion: string;
  gameplayZoneCount: number;
  boundaryMode: "covers" | "contains";
  settlements: readonly SettlementIdentity[];
  associations: readonly GameplayTerritoryAssociation[];
  zoneSummaries: readonly SettlementIdentityZoneSummary[];
  contentChecksum: string;
}

export interface SettlementIdentitySeedInput {
  id?: string;
  name: string;
  coordinate: LngLat;
  type?: SettlementLocalityType;
  source?: string;
  sourceId?: string;
  confidence?: number;
}

export interface BuildSettlementIdentityLayerOptions {
  gameplayZones: readonly TerritoryZone[];
  parentAdm2Zone: TerritoryZone;
  parentAdm1Id?: string;
  parentAdm0Id?: string;
  seeds: readonly SettlementIdentitySeedInput[];
  gameplayDatasetVersion: string;
  identityLayerVersion: string;
  generatedAt: string;
  defaultProvenance: Omit<SettlementIdentitySourceProvenance, "sourceNativeId">;
  boundaryMode?: "covers" | "contains";
  dedupeDistanceMeters?: number;
}

export function normalizeTurkishSettlementName(input: string): string {
  return input.trim().normalize("NFKC").toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

export function createSettlementIdFromSeed(seed: SettlementIdentitySeedInput): string {
  const nativeId = seed.sourceId?.trim() || seed.id?.trim();
  if (nativeId) {
    return `tr:settlement:${slugSettlementIdPart(nativeId)}`;
  }

  const normalized = normalizeTurkishSettlementName(seed.name);
  const coordinateKey = `${roundCoordinate(seed.coordinate[0])},${roundCoordinate(seed.coordinate[1])}`;
  return `tr:settlement:derived:${fnv1a32Hex(`${normalized}|${coordinateKey}`)}`;
}

export function dedupeSettlementSeeds(
  seeds: readonly SettlementIdentitySeedInput[],
  parentGeometry: TerritoryGeometry,
  options: { dedupeDistanceMeters?: number } = {}
): {
  accepted: SettlementIdentitySeedInput[];
  rejected: Array<{ seed: SettlementIdentitySeedInput; reasonCode: string; message: string }>;
} {
  const dedupeDistanceMeters = options.dedupeDistanceMeters ?? 50;
  const rejected: Array<{
    seed: SettlementIdentitySeedInput;
    reasonCode: string;
    message: string;
  }> = [];

  const filtered = seeds
    .filter((seed) => {
      if (seed.name.trim().length === 0) {
        rejected.push({
          seed,
          reasonCode: "EMPTY_NAME",
          message: "Seed name is empty after trim."
        });
        return false;
      }
      if (!Number.isFinite(seed.coordinate[0]) || !Number.isFinite(seed.coordinate[1])) {
        rejected.push({
          seed,
          reasonCode: "INVALID_COORDINATE",
          message: "Seed coordinate is not finite."
        });
        return false;
      }
      if (!pointIntersectsGeometry(seed.coordinate, parentGeometry, "covers")) {
        rejected.push({
          seed,
          reasonCode: "OUTSIDE_PARENT_ADM2",
          message: "Seed coordinate is outside the parent ADM2 polygon."
        });
        return false;
      }
      return true;
    })
    .map((seed, index) => ({
      ...seed,
      id: seed.id ?? seed.sourceId ?? `seed:${index}`,
      type: seed.type ?? "unknown"
    }))
    .sort(compareSeeds);

  const accepted: SettlementIdentitySeedInput[] = [];

  for (const seed of filtered) {
    const duplicateIndex = accepted.findIndex(
      (candidate) =>
        normalizeTurkishSettlementName(candidate.name) ===
          normalizeTurkishSettlementName(seed.name) &&
        (candidate.type ?? "unknown") === (seed.type ?? "unknown") &&
        haversineMeters(candidate.coordinate, seed.coordinate) <= dedupeDistanceMeters
    );

    if (duplicateIndex === -1) {
      accepted.push(seed);
      continue;
    }

    const duplicate = accepted[duplicateIndex]!;
    if ((seed.confidence ?? 0) > (duplicate.confidence ?? 0)) {
      rejected.push({
        seed: duplicate,
        reasonCode: "DUPLICATE_SUPERSEDED",
        message: `Superseded by higher-confidence duplicate seed ${seed.sourceId ?? seed.id}.`
      });
      accepted[duplicateIndex] = seed;
    } else {
      rejected.push({
        seed,
        reasonCode: "DUPLICATE_DISCARDED",
        message: `Duplicate of ${duplicate.sourceId ?? duplicate.id} within ${dedupeDistanceMeters}m.`
      });
    }
  }

  return { accepted: accepted.sort(compareSeeds), rejected };
}

export function resolveSettlementGeometryAvailability(
  settlement: Pick<SettlementIdentity, "verificationState" | "geometryAvailability">
): SettlementGeometryAvailability {
  if (settlement.geometryAvailability !== "unknown") {
    return settlement.geometryAvailability;
  }

  if (settlement.verificationState === "official-verified") {
    return "official-polygon";
  }

  if (settlement.verificationState === "osm-sourced") {
    return "osm-administrative-polygon";
  }

  if (settlement.verificationState === "locality-seed") {
    return "seed-only";
  }

  return "unknown";
}

export function buildSettlementIdentityLayer(
  options: BuildSettlementIdentityLayerOptions
): SettlementIdentityLayer {
  const boundaryMode = options.boundaryMode ?? "covers";
  const method: SettlementAssociationMethod =
    boundaryMode === "covers" ? "point-containment-covers" : "point-containment-contains";
  const gameplayZones = options.gameplayZones.filter((zone) => zone.level === 3);
  const geometryHashes = new Map(
    gameplayZones.map((zone) => [zone.id, hashTerritoryGeometry(zone.geometry)])
  );

  const dedupeOptions =
    options.dedupeDistanceMeters === undefined
      ? {}
      : { dedupeDistanceMeters: options.dedupeDistanceMeters };
  const { accepted: seeds } = dedupeSettlementSeeds(
    options.seeds,
    options.parentAdm2Zone.geometry,
    dedupeOptions
  );

  const settlements: SettlementIdentity[] = seeds.map((seed) => {
    const settlementId = createSettlementIdFromSeed(seed);
    const normalizedName = normalizeTurkishSettlementName(seed.name);
    const sourceNativeId = seed.sourceId?.trim() || seed.id?.trim() || settlementId;
    const identityPayload = {
      settlementId,
      displayName: seed.name.trim(),
      normalizedName,
      localityType: seed.type ?? "unknown",
      parentAdm2Id: options.parentAdm2Zone.id,
      ...(options.parentAdm1Id ? { parentAdm1Id: options.parentAdm1Id } : {}),
      ...(options.parentAdm0Id ? { parentAdm0Id: options.parentAdm0Id } : {}),
      seedCoordinate: seed.coordinate,
      sourceNativeId
    };
    const identityChecksum = `fnv1a32:${fnv1a32Hex(stableStringify(identityPayload))}`;

    return {
      ...identityPayload,
      provenance: {
        ...options.defaultProvenance,
        sourceNativeId,
        providerId: options.defaultProvenance.providerId,
        licenseState: options.defaultProvenance.licenseState,
        permissionStatus: options.defaultProvenance.permissionStatus
      },
      identityLayerVersion: options.identityLayerVersion,
      identityChecksum,
      verificationState: "locality-seed",
      administrativeStatus: "unknown",
      geometryAvailability: "seed-only",
      geometryAvailabilityReasonCode: "SEMANTIC_SEED_ONLY_NOT_OFFICIAL_BOUNDARY",
      ...(seed.confidence === undefined ? {} : { confidence: seed.confidence })
    };
  });

  const settlementById = new Map(settlements.map((row) => [row.settlementId, row]));
  const associations: GameplayTerritoryAssociation[] = [];
  const zoneSummaries: SettlementIdentityZoneSummary[] = [];

  for (const zone of gameplayZones) {
    const contained = seeds.filter((seed) =>
      pointIntersectsGeometry(seed.coordinate, zone.geometry, boundaryMode)
    );
    const distinctSettlementIds = [
      ...new Set(contained.map((seed) => createSettlementIdFromSeed(seed)))
    ];
    const distinctNormalizedNames = [
      ...new Set(contained.map((seed) => normalizeTurkishSettlementName(seed.name)))
    ];

    let associationStatus: SettlementAssociationStatus = "unseeded";
    if (distinctSettlementIds.length === 1) {
      associationStatus = "single-candidate";
    } else if (distinctSettlementIds.length > 1) {
      associationStatus = "multiple-candidates";
    }

    const zoneName = zone.name ?? zone.id;
    zoneSummaries.push({
      zoneId: zone.id,
      zoneName,
      containedSeedCount: contained.length,
      distinctSettlementIds,
      distinctNormalizedNames,
      associationStatus,
      autoDisplayNameAllowed: associationStatus === "single-candidate"
    });

    for (const seed of contained) {
      const settlementId = createSettlementIdFromSeed(seed);
      const settlement = settlementById.get(settlementId);
      if (!settlement) {
        continue;
      }

      const zonesForSeed = gameplayZones.filter((candidate) =>
        pointIntersectsGeometry(seed.coordinate, candidate.geometry, boundaryMode)
      );
      const status: SettlementAssociationStatus =
        zonesForSeed.length > 1
          ? "conflict"
          : zonesForSeed.length === 1
            ? associationStatus === "multiple-candidates"
              ? "review-required"
              : "single-candidate"
            : "unseeded";

      const reviewReasonCode =
        status === "single-candidate"
          ? undefined
          : status === "review-required" || associationStatus === "multiple-candidates"
            ? "AMBIGUOUS_REVIEW_REQUIRED"
            : status === "conflict"
              ? "SEED_SPANS_MULTIPLE_ZONES"
              : undefined;

      associations.push({
        zoneId: zone.id,
        settlementId,
        method,
        status,
        evidence: [
          {
            reasonCode: "POINT_IN_ZONE",
            message: `Seed coordinate assigned via point-in-polygon (${boundaryMode}).`,
            boundaryMode,
            seedCoordinate: seed.coordinate
          },
          ...(zonesForSeed.length > 1
            ? [
                {
                  reasonCode: "MULTI_ZONE_OVERLAP",
                  message: `Seed lies inside ${zonesForSeed.length} gameplay zones.`,
                  boundaryMode,
                  seedCoordinate: seed.coordinate
                }
              ]
            : [])
        ],
        gameplayDatasetVersion: options.gameplayDatasetVersion,
        gameplayGeometryHash: geometryHashes.get(zone.id) ?? hashTerritoryGeometry(zone.geometry),
        identityLayerVersion: options.identityLayerVersion,
        reviewDecision: status === "single-candidate" ? "approved" : "pending",
        ...(reviewReasonCode ? { reviewReasonCode } : {})
      });
    }
  }

  const layerWithoutChecksum: Omit<SettlementIdentityLayer, "contentChecksum"> = {
    schemaVersion: SETTLEMENT_IDENTITY_LAYER_SCHEMA_VERSION,
    identityLayerVersion: options.identityLayerVersion,
    generatedAt: options.generatedAt,
    parentAdm2Id: options.parentAdm2Zone.id,
    gameplayDatasetVersion: options.gameplayDatasetVersion,
    gameplayZoneCount: gameplayZones.length,
    boundaryMode,
    settlements,
    associations,
    zoneSummaries
  };

  return {
    ...layerWithoutChecksum,
    contentChecksum: `fnv1a32:${fnv1a32Hex(stableStringify(layerWithoutChecksum))}`
  };
}

function compareSeeds(
  left: SettlementIdentitySeedInput,
  right: SettlementIdentitySeedInput
): number {
  return (
    normalizeTurkishSettlementName(left.name).localeCompare(
      normalizeTurkishSettlementName(right.name),
      "tr"
    ) ||
    (left.sourceId ?? left.id ?? "").localeCompare(right.sourceId ?? right.id ?? "", "en") ||
    left.coordinate[0] - right.coordinate[0] ||
    left.coordinate[1] - right.coordinate[1]
  );
}

function slugSettlementIdPart(input: string): string {
  return input.replace(/[^a-zA-Z0-9:_-]+/g, "-").replace(/-+/g, "-");
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function haversineMeters(a: LngLat, b: LngLat): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
