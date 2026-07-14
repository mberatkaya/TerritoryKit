import {
  createTerritoryCountryDatasetDescriptor,
  loadTerritoryCountryDataset
} from "@territory-kit/core";
import type {
  TerritoryCountryDatasetHandle,
  TerritoryCountryDatasetLoadOptions
} from "@territory-kit/core";

export const japanDatasetDescriptor = createTerritoryCountryDatasetDescriptor({
  datasetId: "territory-kit-jp",
  countryCodeAlpha2: "JP",
  countryCodeAlpha3: "JPN",
  packageName: "@territory-kit/data-jp",
  schemaVersion: "territory-schema@1",
  supportedLevels: ["ADM0", "ADM1", "ADM2"],
  defaultLevels: ["ADM0", "ADM1", "ADM2"],
  manifestPath: "manifest.json",
  requiresResolver: true
});

export const supportedJapanAdminLevels = japanDatasetDescriptor.supportedLevels;

export function loadJapanDataset(
  options: TerritoryCountryDatasetLoadOptions
): Promise<TerritoryCountryDatasetHandle> {
  return loadTerritoryCountryDataset(japanDatasetDescriptor, options);
}
