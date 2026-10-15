import {
  resolveSettlementGeometryAvailability,
  settlementHasLawfulPolygonEvidence,
  type GameplayTerritoryAssociation,
  type SettlementIdentity,
  type SettlementIdentityLayer
} from "@territory-kit/dataset";

export interface SettlementIdentityLookupOptions {
  layer: SettlementIdentityLayer;
}

export interface SettlementZoneLookupResult {
  zoneId: string;
  associations: readonly GameplayTerritoryAssociation[];
  settlements: readonly SettlementIdentity[];
  associationStatus: GameplayTerritoryAssociation["status"] | "unseeded";
  isAmbiguous: boolean;
  autoDisplayNameAllowed: boolean;
}

export interface SettlementSeedLookupResult {
  settlement: SettlementIdentity;
  associations: readonly GameplayTerritoryAssociation[];
  zoneIds: readonly string[];
  isAmbiguous: boolean;
  lawfulPolygonExists: boolean;
  geometryAvailability: ReturnType<typeof resolveSettlementGeometryAvailability>;
}

export interface SettlementIdentityLookup {
  readonly layer: SettlementIdentityLayer;
  listSettlementsForZone(zoneId: string): SettlementZoneLookupResult;
  findZonesForSettlement(settlementId: string): SettlementSeedLookupResult | undefined;
  getSettlement(settlementId: string): SettlementIdentity | undefined;
  describeLayerVersion(): {
    identityLayerVersion: string;
    gameplayDatasetVersion: string;
    contentChecksum: string;
    generatedAt: string;
  };
}

export function createSettlementIdentityLookup(
  options: SettlementIdentityLookupOptions
): SettlementIdentityLookup {
  const layer = options.layer;
  const settlementsById = new Map(layer.settlements.map((row) => [row.settlementId, row]));
  const associationsByZone = new Map<string, GameplayTerritoryAssociation[]>();
  const associationsBySettlement = new Map<string, GameplayTerritoryAssociation[]>();
  const zoneSummaryById = new Map(layer.zoneSummaries.map((row) => [row.zoneId, row]));

  for (const association of layer.associations) {
    const zoneBucket = associationsByZone.get(association.zoneId) ?? [];
    zoneBucket.push(association);
    associationsByZone.set(association.zoneId, zoneBucket);

    const settlementBucket = associationsBySettlement.get(association.settlementId) ?? [];
    settlementBucket.push(association);
    associationsBySettlement.set(association.settlementId, settlementBucket);
  }

  return {
    layer,
    listSettlementsForZone(zoneId) {
      const summary = zoneSummaryById.get(zoneId);
      const associations = associationsByZone.get(zoneId) ?? [];
      const settlements = associations
        .map((association) => settlementsById.get(association.settlementId))
        .filter((row): row is SettlementIdentity => row !== undefined);
      const associationStatus = summary?.associationStatus ?? "unseeded";
      const isAmbiguous =
        associationStatus === "multiple-candidates" ||
        associationStatus === "review-required" ||
        associationStatus === "conflict" ||
        associations.some(
          (row) => row.status === "multiple-candidates" || row.status === "review-required"
        );

      return {
        zoneId,
        associations,
        settlements,
        associationStatus,
        isAmbiguous,
        autoDisplayNameAllowed: summary?.autoDisplayNameAllowed ?? false
      };
    },
    findZonesForSettlement(settlementId) {
      const settlement = settlementsById.get(settlementId);
      if (!settlement) {
        return undefined;
      }

      const associations = associationsBySettlement.get(settlementId) ?? [];
      const zoneIds = [...new Set(associations.map((row) => row.zoneId))];
      const geometryAvailability = resolveSettlementGeometryAvailability(settlement);
      const lawfulPolygonExists = settlementHasLawfulPolygonEvidence(settlement);

      return {
        settlement,
        associations,
        zoneIds,
        isAmbiguous:
          zoneIds.length > 1 ||
          associations.some(
            (row) =>
              row.status === "multiple-candidates" ||
              row.status === "review-required" ||
              row.status === "conflict"
          ),
        lawfulPolygonExists,
        geometryAvailability
      };
    },
    getSettlement(settlementId) {
      return settlementsById.get(settlementId);
    },
    describeLayerVersion() {
      return {
        identityLayerVersion: layer.identityLayerVersion,
        gameplayDatasetVersion: layer.gameplayDatasetVersion,
        contentChecksum: layer.contentChecksum,
        generatedAt: layer.generatedAt
      };
    }
  };
}
