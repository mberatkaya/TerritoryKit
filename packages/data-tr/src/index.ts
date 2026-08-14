import {
  createTerritoryCountryDatasetDescriptor,
  loadTerritoryCountryDataset
} from "@territory-kit/core";
import type {
  TerritoryCountryDatasetDescriptor,
  TerritoryCountryDatasetHandle,
  TerritoryCountryDatasetLoadOptions
} from "@territory-kit/core";

export const turkeyDatasetDescriptor = createTerritoryCountryDatasetDescriptor({
  datasetId: "territory-kit-tr",
  countryCodeAlpha2: "TR",
  countryCodeAlpha3: "TUR",
  packageName: "@territory-kit/data-tr",
  schemaVersion: "territory-schema@1",
  supportedLevels: ["ADM0", "ADM1", "ADM2", "ADM3", "ADM4"],
  defaultLevels: ["ADM0", "ADM1", "ADM2"],
  manifestPath: "manifest.json",
  requiresResolver: true
});

export const turkeyV2NationalDatasetDescriptor = createTerritoryCountryDatasetDescriptor({
  datasetId: "territory-kit-tr-v2-playable",
  countryCodeAlpha2: "TR",
  countryCodeAlpha3: "TUR",
  packageName: "@territory-kit/data-tr",
  schemaVersion: "territory-schema@1",
  supportedLevels: ["ADM0", "ADM1", "ADM2", "ADM3"],
  defaultLevels: ["ADM0", "ADM1", "ADM2"],
  manifestPath: "manifest.json",
  requiresResolver: true
});

export const supportedTurkeyAdminLevels = turkeyDatasetDescriptor.supportedLevels;
export const defaultTurkeyAdminLevels = turkeyDatasetDescriptor.defaultLevels;
export const turkeyNationalCoverage = {
  country: "TR",
  sourceProvider: "hdx-cod-ab",
  sourceId: "cod-ab-tur",
  levels: {
    ADM0: {
      status: "verified",
      semanticType: "country",
      featureCount: 1
    },
    ADM1: {
      status: "verified",
      semanticType: "province",
      featureCount: 81
    },
    ADM2: {
      status: "verified",
      semanticType: "district",
      featureCount: 973
    },
    ADM3: {
      status: "partial",
      semanticType: "neighbourhood",
      blocker:
        "No redistributable nationwide official ADM3 neighbourhood/village boundary source is locked."
    },
    ADM4: {
      status: "not-applicable",
      semanticType: "locality",
      blocker:
        "ADM4 requires a reviewed source model below neighbourhood/village or municipality/locality boundaries."
    }
  }
} as const;
export const turkeyAdm3NeighbourhoodCoverage = {
  country: "TR",
  level: "ADM3",
  semanticType: "neighbourhood",
  localTypeName: "Mahalle",
  status: "partial",
  sourceProvider: "Gaziantep Büyükşehir Belediyesi",
  datasetTitle: "Mahalle Sınır Alanları",
  license: "CC BY 4.0",
  attribution: "Gaziantep Büyükşehir Belediyesi, Mahalle Sınır Alanları, CC BY 4.0",
  coveredParentIds: [
    "tr:adm2:54988432b19771634656837",
    "tr:adm2:54988432b26387222249237",
    "tr:adm2:54988432b32789090404224",
    "tr:adm2:54988432b41731057290221",
    "tr:adm2:54988432b54960387029794",
    "tr:adm2:54988432b61004264745956",
    "tr:adm2:54988432b72028378604273",
    "tr:adm2:54988432b85612149706662",
    "tr:adm2:54988432b99023740963316"
  ]
} as const;
export const turkeyV2DataContract = {
  country: "TR",
  contractVersion: "territorykit-tr-v2-data-contract@1",
  targetDatasetVersion: "2.0.0-rc.1",
  schemaVersion: "territory-schema@1",
  adm3SemanticTypes: ["neighbourhood", "village", "generated-zone"],
  sourceClassPriority: ["official", "osm", "generated"],
  strictValidationProfile: "tr-v2",
  generatedZonesAreOfficialAdministrativeAreas: false,
  nationalAdm3PolygonBuildIncluded: true,
  nationalAdm3PolygonBuildSemantics:
    "playable official/OSM/generated hybrid coverage; generated zones are not official administrative areas",
  nationalDatasetId: turkeyV2NationalDatasetDescriptor.datasetId
} as const;
export const turkeyV2NationalPlayableCoverage = {
  country: "TR",
  datasetId: turkeyV2NationalDatasetDescriptor.datasetId,
  datasetVersion: turkeyV2DataContract.targetDatasetVersion,
  status: "resolver-required",
  releaseChannel: "prerelease",
  officialAdm0Adm2: {
    sourceProvider: "hdx-cod-ab",
    sourceId: "cod-ab-tur",
    featureCounts: {
      ADM0: 1,
      ADM1: 81,
      ADM2: 973
    }
  },
  adm3: {
    status: "playable-national-hybrid",
    sourceClassPriority: turkeyV2DataContract.sourceClassPriority,
    generatedFallback: true,
    generatedZonesAreOfficialAdministrativeAreas: false,
    minimumDistrictCoveragePercent: 99.99
  },
  packaging: {
    embedsGeometry: false,
    requiresResolver: true,
    largeArtifactsExternal: true
  }
} as const;

export function loadTurkeyDataset(
  options: TerritoryCountryDatasetLoadOptions
): Promise<TerritoryCountryDatasetHandle> {
  return loadTerritoryCountryDataset(turkeyDatasetDescriptor, options);
}

export function loadTurkeyV2NationalDataset(
  options: TerritoryCountryDatasetLoadOptions
): Promise<TerritoryCountryDatasetHandle> {
  return loadTerritoryCountryDataset(turkeyV2NationalDatasetDescriptor, options);
}

export type TurkeyDatasetVariant = "legacy" | "v2-national-playable";

export interface TurkeyDatasetResolution {
  variant: TurkeyDatasetVariant;
  descriptor: TerritoryCountryDatasetDescriptor;
  dataContract:
    typeof turkeyV2DataContract | { readonly country: "TR"; readonly contractVersion: "legacy" };
  coverage: typeof turkeyNationalCoverage | typeof turkeyV2NationalPlayableCoverage;
  load(options: TerritoryCountryDatasetLoadOptions): Promise<TerritoryCountryDatasetHandle>;
}

export function resolveTurkeyDataset(
  input: {
    variant?: TurkeyDatasetVariant;
    includePlayableAdm3?: boolean;
  } = {}
): TurkeyDatasetResolution {
  if (input.variant === "v2-national-playable" || input.includePlayableAdm3) {
    return {
      variant: "v2-national-playable",
      descriptor: turkeyV2NationalDatasetDescriptor,
      dataContract: turkeyV2DataContract,
      coverage: turkeyV2NationalPlayableCoverage,
      load: loadTurkeyV2NationalDataset
    };
  }

  return {
    variant: "legacy",
    descriptor: turkeyDatasetDescriptor,
    dataContract: { country: "TR", contractVersion: "legacy" },
    coverage: turkeyNationalCoverage,
    load: loadTurkeyDataset
  };
}

export function isTurkeyAdm3ParentCovered(parentId: string): boolean {
  return turkeyAdm3NeighbourhoodCoverage.coveredParentIds.includes(
    parentId as (typeof turkeyAdm3NeighbourhoodCoverage.coveredParentIds)[number]
  );
}
