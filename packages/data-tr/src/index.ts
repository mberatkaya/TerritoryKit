import {
  createTerritoryCountryDatasetDescriptor,
  loadTerritoryCountryDataset
} from "@territory-kit/core";
import type {
  TerritoryCountryDatasetHandle,
  TerritoryCountryDatasetLoadOptions
} from "@territory-kit/core";

export const turkeyDatasetDescriptor = createTerritoryCountryDatasetDescriptor({
  datasetId: "territory-kit-tr",
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

export function loadTurkeyDataset(
  options: TerritoryCountryDatasetLoadOptions
): Promise<TerritoryCountryDatasetHandle> {
  return loadTerritoryCountryDataset(turkeyDatasetDescriptor, options);
}

export function isTurkeyAdm3ParentCovered(parentId: string): boolean {
  return turkeyAdm3NeighbourhoodCoverage.coveredParentIds.includes(
    parentId as (typeof turkeyAdm3NeighbourhoodCoverage.coveredParentIds)[number]
  );
}
