import type { TerritoryCountryDatasetConfig } from "../types.js";
import { createPilotCountryConfig } from "./utils.js";

export const indonesiaCountryConfig: TerritoryCountryDatasetConfig = createPilotCountryConfig({
  datasetId: "id",
  countryCodeAlpha2: "ID",
  countryCodeAlpha3: "IDN",
  displayName: "Indonesia",
  loaderPackageName: "@territory-kit/data-id",
  defaultLocale: "id",
  localTypes: {
    ADM0: ["country"],
    ADM1: ["province", "administrative-unit"],
    ADM2: ["regency-or-city-equivalent", "administrative-unit"]
  }
});
