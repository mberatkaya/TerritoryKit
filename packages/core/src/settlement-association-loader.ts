import {
  validateTrSettlementAssociationArtifact,
  type TrSettlementAssociationArtifact,
  type TrSettlementAssociationValidationOptions,
  type TrSettlementAssociationValidationReport
} from "@territory-kit/dataset/tr-settlement-association";
import type { TerritoryDataset } from "@territory-kit/dataset";
import {
  createTrSettlementAssociationQuery,
  type TrSettlementAssociationQuery
} from "./settlement-association-query.js";

export interface TrSettlementAssociationConsumerLoadOptions extends TrSettlementAssociationValidationOptions {
  dataset: TerritoryDataset;
  artifact: TrSettlementAssociationArtifact;
}

export type TrSettlementAssociationConsumerLoadResult =
  | {
      ok: true;
      validation: TrSettlementAssociationValidationReport;
      query: TrSettlementAssociationQuery;
    }
  | {
      ok: false;
      validation: TrSettlementAssociationValidationReport;
      query: null;
    };

/**
 * Fail-closed loader: consumers must not treat invalid artifacts as ready.
 * Validates dataset/artifact alignment and optional expected seed snapshot checksum.
 */
export function loadTrSettlementAssociationConsumer(
  options: TrSettlementAssociationConsumerLoadOptions
): TrSettlementAssociationConsumerLoadResult {
  const validationOptions: TrSettlementAssociationValidationOptions = {};
  if (options.expectedSourceSnapshotChecksum) {
    validationOptions.expectedSourceSnapshotChecksum = options.expectedSourceSnapshotChecksum;
  }

  const validation = validateTrSettlementAssociationArtifact(
    options.dataset,
    options.artifact,
    validationOptions
  );

  if (!validation.ok) {
    return { ok: false, validation, query: null };
  }

  return {
    ok: true,
    validation,
    query: createTrSettlementAssociationQuery(options.artifact, {
      dataset: options.dataset,
      parentAdm2Id: options.artifact.parentAdm2Id
    })
  };
}
