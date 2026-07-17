import type { TerritoryCountryDatasetConfig } from "../types.js";
import { createPilotCountryConfig } from "./utils.js";

export const turkeyCountryConfig: TerritoryCountryDatasetConfig = createPilotCountryConfig({
  datasetId: "tr",
  countryCodeAlpha2: "TR",
  countryCodeAlpha3: "TUR",
  displayName: "Turkiye",
  loaderPackageName: "@territory-kit/data-tr",
  defaultLocale: "tr",
  localTypes: {
    ADM0: ["country"],
    ADM1: ["province", "administrative-unit"],
    ADM2: ["district", "administrative-unit"],
    ADM3: ["neighbourhood", "Mahalle", "administrative-unit"]
  },
  semanticTypes: {
    ADM0: "country",
    ADM1: "province",
    ADM2: "district",
    ADM3: "neighbourhood"
  },
  localTypeNames: {
    ADM0: "Ulke",
    ADM1: "Il",
    ADM2: "Ilce",
    ADM3: "Mahalle"
  }
});
