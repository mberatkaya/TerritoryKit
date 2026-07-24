import type { TerritoryCountryDatasetConfig } from "../types.js";
import { createPilotCountryConfig } from "./utils.js";

const turkeyPilotConfig = createPilotCountryConfig({
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

export const turkeyCountryConfig: TerritoryCountryDatasetConfig = {
  ...turkeyPilotConfig,
  sourceProvider: "hdx-cod-ab",
  defaultReleaseType: "hdx-cod-ab",
  requestedLevels: ["ADM0", "ADM1", "ADM2", "ADM3", "ADM4"],
  levelMappings: {
    ...turkeyPilotConfig.levelMappings,
    ADM0: {
      ...turkeyPilotConfig.levelMappings.ADM0!,
      sourceNameProperty: "adm0_name1",
      sourceIdProperty: "adm0_pcode",
      sourceCodeProperties: ["adm0_pcode", "iso2", "iso3"],
      sourceParentProperties: [],
      expectedLocalTypes: ["country", "administrative-unit"],
      required: true,
      reviewStatus: "reviewed"
    },
    ADM1: {
      ...turkeyPilotConfig.levelMappings.ADM1!,
      sourceNameProperty: "adm1_name1",
      sourceIdProperty: "adm1_pcode",
      sourceCodeProperties: ["adm1_pcode"],
      sourceParentProperties: ["adm0_pcode"],
      expectedLocalTypes: ["province", "administrative-unit"],
      required: true,
      reviewStatus: "reviewed"
    },
    ADM2: {
      ...turkeyPilotConfig.levelMappings.ADM2!,
      sourceNameProperty: "adm2_name1",
      sourceIdProperty: "adm2_pcode",
      sourceCodeProperties: ["adm2_pcode"],
      sourceParentProperties: ["adm1_pcode"],
      expectedLocalTypes: ["district", "administrative-unit"],
      required: true,
      reviewStatus: "reviewed"
    },
    ADM3: {
      ...turkeyPilotConfig.levelMappings.ADM3!,
      expectedLocalTypes: ["neighbourhood", "village", "administrative-unit"],
      sourceNameProperty: "name",
      sourceIdProperty: "sourceId",
      sourceCodeProperties: ["officialCode", "sourceCode", "uavtCode"],
      sourceParentProperties: ["parentSourceId", "districtCode", "adm2_pcode"],
      required: false,
      reviewRequired: true,
      reviewStatus: "mapping-review-required"
    },
    ADM4: {
      adminLevel: "ADM4",
      expectedLocalTypes: ["municipality", "locality", "administrative-unit"],
      semanticType: "locality",
      localTypeName: "Yerlesim veya belediye alt birimi",
      label: "Turkey reviewed-if-sourced ADM4",
      sourceNameProperty: "name",
      sourceIdProperty: "sourceId",
      sourceCodeProperties: ["officialCode", "sourceCode", "uavtCode"],
      sourceParentProperties: ["parentSourceId", "districtCode", "adm2_pcode", "adm3_pcode"],
      required: false,
      reviewRequired: true,
      reviewStatus: "mapping-review-required"
    }
  },
  qualityPolicy: {
    rejectGeometryErrors: true,
    rejectUnresolvedParents: true,
    rejectAmbiguousParents: true,
    maximumFallbackIdentityRatio: 0
  },
  adjacencyPolicy: {
    levels: ["ADM1", "ADM2", "ADM3", "ADM4"],
    includePointTouches: false,
    minimumSharedBoundaryMeters: 0
  },
  notes: [
    "Turkey defaults to the HDX/OCHA COD-AB national ADM0-ADM2 source.",
    "ADM3 and ADM4 are configured as technical targets but remain source-unavailable until a redistributable nationwide source is locked.",
    "Turkey ADM levels map TerritoryKit technical levels to local semantics; municipality, neighbourhood, village, and locality semantics can coexist when a reviewed source supplies them."
  ]
};
