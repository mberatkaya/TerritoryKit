import type {
  TrSettlementAssociationArtifact,
  TrSettlementAssociationRecord,
  TrSettlementAssociationStatus,
  TrSettlementReasonCode,
  TrSettlementZoneSummary
} from "@territory-kit/dataset/tr-settlement-association";

export interface TrSettlementAssociationQueryResult {
  zoneId: string;
  zoneSummary: TrSettlementZoneSummary | null;
  associations: TrSettlementAssociationRecord[];
  associationStatus: TrSettlementAssociationStatus;
  reasonCodes: TrSettlementReasonCode[];
  provenance: TrSettlementAssociationArtifact["source"];
}

export interface TrSettlementAssociationQuery {
  artifact: TrSettlementAssociationArtifact;
  getAssociationsForZone(zoneId: string): TrSettlementAssociationQueryResult;
  getZonesForSettlement(settlementRefId: string): string[];
  getZoneSummary(zoneId: string): TrSettlementZoneSummary | null;
}

export function createTrSettlementAssociationQuery(
  artifact: TrSettlementAssociationArtifact
): TrSettlementAssociationQuery {
  const associationsByZone = new Map<string, TrSettlementAssociationRecord[]>();
  const zonesBySettlement = new Map<string, Set<string>>();
  const summaryByZone = new Map(artifact.zoneSummaries.map((summary) => [summary.zoneId, summary]));

  for (const association of artifact.associations) {
    const zoneAssociations = associationsByZone.get(association.zoneId) ?? [];
    zoneAssociations.push(association);
    associationsByZone.set(association.zoneId, zoneAssociations);

    const zoneSet = zonesBySettlement.get(association.settlementRefId) ?? new Set<string>();
    zoneSet.add(association.zoneId);
    zonesBySettlement.set(association.settlementRefId, zoneSet);
  }

  for (const [zoneId, zoneAssociations] of associationsByZone) {
    zoneAssociations.sort((left, right) =>
      left.settlementRefId.localeCompare(right.settlementRefId)
    );
    associationsByZone.set(zoneId, zoneAssociations);
  }

  return {
    artifact,
    getAssociationsForZone(zoneId: string): TrSettlementAssociationQueryResult {
      const associations = associationsByZone.get(zoneId) ?? [];
      const zoneSummary = summaryByZone.get(zoneId) ?? null;
      const reasonCodes = [
        ...new Set([
          ...(zoneSummary?.reasonCodes ?? []),
          ...associations.flatMap((association) => association.reasonCodes)
        ])
      ].sort() as TrSettlementReasonCode[];

      return {
        zoneId,
        zoneSummary,
        associations,
        associationStatus: zoneSummary?.associationStatus ?? "UNSEEDED",
        reasonCodes,
        provenance: artifact.source
      };
    },
    getZonesForSettlement(settlementRefId: string): string[] {
      return [...(zonesBySettlement.get(settlementRefId) ?? new Set<string>())].sort();
    },
    getZoneSummary(zoneId: string): TrSettlementZoneSummary | null {
      return summaryByZone.get(zoneId) ?? null;
    }
  };
}
