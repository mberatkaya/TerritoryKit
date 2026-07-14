import {
  createTerritoryCountryDatasetDescriptor,
  loadTerritoryCountryDataset
} from "@territory-kit/core";
import type {
  TerritoryCountryDatasetHandle,
  TerritoryCountryDatasetLoadOptions
} from "@territory-kit/core";

export const turkeyDatasetDescriptor = createTerritoryCountryDatasetDescriptor({
  datasetId: "territory-kit-tr",
  countryCodeAlpha2: "TR",
  countryCodeAlpha3: "TUR",
  packageName: "@territory-kit/data-tr",
  schemaVersion: "territory-schema@1",
  supportedLevels: ["ADM0", "ADM1", "ADM2"],
  defaultLevels: ["ADM0", "ADM1", "ADM2"],
  manifestPath: "manifest.json",
  requiresResolver: true
});

export const supportedTurkeyAdminLevels = turkeyDatasetDescriptor.supportedLevels;

export function loadTurkeyDataset(
  options: TerritoryCountryDatasetLoadOptions
): Promise<TerritoryCountryDatasetHandle> {
  return loadTerritoryCountryDataset(turkeyDatasetDescriptor, options);
}
