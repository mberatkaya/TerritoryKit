import {
  validateSettlementIdentityLayer,
  type SettlementIdentityLayer,
  type SettlementIdentityPinExpectations,
  type SettlementIdentityValidationReport,
  type TerritoryDataset
} from "@territory-kit/dataset";
import {
  createSettlementIdentityLookup,
  type SettlementIdentityLookup
} from "./settlement-identity-lookup.js";

export interface SettlementIdentityConsumerLoadOptions {
  layer: SettlementIdentityLayer;
  gameplayDataset: TerritoryDataset;
  pins?: SettlementIdentityPinExpectations;
}

export type SettlementIdentityConsumerLoadResult =
  | {
      ok: true;
      validation: SettlementIdentityValidationReport;
      lookup: SettlementIdentityLookup;
    }
  | {
      ok: false;
      validation: SettlementIdentityValidationReport;
      lookup: null;
    };

/**
 * Fail-closed consumer entrypoint: invalid identity layers never produce a lookup.
 */
export function loadSettlementIdentityConsumer(
  options: SettlementIdentityConsumerLoadOptions
): SettlementIdentityConsumerLoadResult {
  const parentAdm2Id = options.pins?.parentAdm2Id ?? options.layer.parentAdm2Id;
  const validation = validateSettlementIdentityLayer({
    layer: options.layer,
    gameplayDataset: options.gameplayDataset,
    ...(options.pins ? { pins: options.pins } : {})
  });

  if (!validation.ok) {
    return { ok: false, validation, lookup: null };
  }

  const gameplayZoneIds = new Set(
    options.gameplayDataset.zones
      .filter((zone) => zone.level === 3 && zone.parentId === parentAdm2Id)
      .map((zone) => zone.id)
  );

  return {
    ok: true,
    validation,
    lookup: createSettlementIdentityLookup({
      layer: options.layer,
      gameplayZoneIds,
      parentAdm2Id
    })
  };
}
