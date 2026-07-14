import {
  createTerritoryCountryDatasetDescriptor,
  loadTerritoryCountryDataset
} from "@territory-kit/core";
import type {
  TerritoryCountryDatasetHandle,
  TerritoryCountryDatasetLoadOptions
} from "@territory-kit/core";

export const indonesiaDatasetDescriptor = createTerritoryCountryDatasetDescriptor({
  datasetId: "territory-kit-id",
  countryCodeAlpha2: "ID",
  countryCodeAlpha3: "IDN",
  packageName: "@territory-kit/data-id",
  schemaVersion: "territory-schema@1",
  supportedLevels: ["ADM0", "ADM1", "ADM2"],
  defaultLevels: ["ADM0", "ADM1", "ADM2"],
  manifestPath: "manifest.json",
  requiresResolver: true
});

export const supportedIndonesiaAdminLevels = indonesiaDatasetDescriptor.supportedLevels;

export function loadIndonesiaDataset(
  options: TerritoryCountryDatasetLoadOptions
): Promise<TerritoryCountryDatasetHandle> {
  return loadTerritoryCountryDataset(indonesiaDatasetDescriptor, options);
}
