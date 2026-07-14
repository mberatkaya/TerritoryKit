import {
  createTerritoryCountryDatasetDescriptor,
  loadTerritoryCountryDataset
} from "@territory-kit/core";
import type {
  TerritoryCountryDatasetHandle,
  TerritoryCountryDatasetLoadOptions
} from "@territory-kit/core";

export const unitedStatesDatasetDescriptor = createTerritoryCountryDatasetDescriptor({
  datasetId: "territory-kit-us",
  countryCodeAlpha2: "US",
  countryCodeAlpha3: "USA",
  packageName: "@territory-kit/data-us",
  schemaVersion: "territory-schema@1",
  supportedLevels: ["ADM0", "ADM1", "ADM2"],
  defaultLevels: ["ADM0", "ADM1", "ADM2"],
  manifestPath: "manifest.json",
  requiresResolver: true
});

export const supportedUnitedStatesAdminLevels = unitedStatesDatasetDescriptor.supportedLevels;

export function loadUnitedStatesDataset(
  options: TerritoryCountryDatasetLoadOptions
): Promise<TerritoryCountryDatasetHandle> {
  return loadTerritoryCountryDataset(unitedStatesDatasetDescriptor, options);
}
