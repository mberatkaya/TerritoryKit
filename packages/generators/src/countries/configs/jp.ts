import type { TerritoryCountryDatasetConfig } from "../types.js";
import { createPilotCountryConfig } from "./utils.js";

export const japanCountryConfig: TerritoryCountryDatasetConfig = createPilotCountryConfig({
  datasetId: "jp",
  countryCodeAlpha2: "JP",
  countryCodeAlpha3: "JPN",
  displayName: "Japan",
  loaderPackageName: "@territory-kit/data-jp",
  defaultLocale: "ja",
  localTypes: {
    ADM0: ["country"],
    ADM1: ["prefecture-or-equivalent", "administrative-unit"],
    ADM2: ["second-level-administrative-unit", "administrative-unit"]
  }
});
