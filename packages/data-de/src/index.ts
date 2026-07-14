import {
  createTerritoryCountryDatasetDescriptor,
  loadTerritoryCountryDataset
} from "@territory-kit/core";
import type {
  TerritoryCountryDatasetHandle,
  TerritoryCountryDatasetLoadOptions
} from "@territory-kit/core";

export const germanyDatasetDescriptor = createTerritoryCountryDatasetDescriptor({
  datasetId: "territory-kit-de",
  countryCodeAlpha2: "DE",
  countryCodeAlpha3: "DEU",
  packageName: "@territory-kit/data-de",
  schemaVersion: "territory-schema@1",
  supportedLevels: ["ADM0", "ADM1", "ADM2"],
  defaultLevels: ["ADM0", "ADM1", "ADM2"],
  manifestPath: "manifest.json",
  requiresResolver: true
});

export const supportedGermanyAdminLevels = germanyDatasetDescriptor.supportedLevels;

export function loadGermanyDataset(
  options: TerritoryCountryDatasetLoadOptions
): Promise<TerritoryCountryDatasetHandle> {
  return loadTerritoryCountryDataset(germanyDatasetDescriptor, options);
}
