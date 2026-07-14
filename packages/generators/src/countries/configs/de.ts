import type { TerritoryCountryDatasetConfig } from "../types.js";
import { createPilotCountryConfig } from "./utils.js";

export const germanyCountryConfig: TerritoryCountryDatasetConfig = createPilotCountryConfig({
  datasetId: "de",
  countryCodeAlpha2: "DE",
  countryCodeAlpha3: "DEU",
  displayName: "Germany",
  loaderPackageName: "@territory-kit/data-de",
  defaultLocale: "de",
  localTypes: {
    ADM0: ["country"],
    ADM1: ["state", "administrative-unit"],
    ADM2: ["district-or-equivalent", "administrative-unit"]
  }
});
