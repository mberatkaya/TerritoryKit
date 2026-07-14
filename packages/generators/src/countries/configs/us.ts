import type { TerritoryCountryDatasetConfig } from "../types.js";
import { createPilotCountryConfig } from "./utils.js";

export const unitedStatesCountryConfig: TerritoryCountryDatasetConfig = createPilotCountryConfig({
  datasetId: "us",
  countryCodeAlpha2: "US",
  countryCodeAlpha3: "USA",
  displayName: "United States",
  loaderPackageName: "@territory-kit/data-us",
  defaultLocale: "en",
  localTypes: {
    ADM0: ["country"],
    ADM1: ["state-or-equivalent", "administrative-unit"],
    ADM2: ["county-or-equivalent", "administrative-unit"]
  }
});
