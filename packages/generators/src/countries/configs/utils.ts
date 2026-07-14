import type { TerritoryAdminLevel, TerritorySemanticAdminType } from "@territory-kit/dataset";
import type { TerritoryCountryDatasetConfig } from "../types.js";

const DEFAULT_LEVELS: readonly TerritoryAdminLevel[] = ["ADM0", "ADM1", "ADM2"];

export function createPilotCountryConfig(input: {
  datasetId: string;
  countryCodeAlpha2: string;
  countryCodeAlpha3: string;
  displayName: string;
  loaderPackageName: string;
  defaultLocale: string;
  localTypes: Partial<Record<TerritoryAdminLevel, readonly string[]>>;
  semanticTypes: Partial<Record<TerritoryAdminLevel, TerritorySemanticAdminType>>;
}): TerritoryCountryDatasetConfig {
  return {
    datasetId: input.datasetId,
    countryCodeAlpha2: input.countryCodeAlpha2,
    countryCodeAlpha3: input.countryCodeAlpha3,
    displayName: input.displayName,
    defaultLocale: input.defaultLocale,
    sourceProvider: "geoboundaries",
    defaultReleaseType: "gbOpen",
    loaderPackageName: input.loaderPackageName,
    requestedLevels: DEFAULT_LEVELS,
    levelMappings: Object.fromEntries(
      DEFAULT_LEVELS.map((adminLevel) => [
        adminLevel,
        {
          adminLevel,
          expectedLocalTypes: input.localTypes[adminLevel] ?? ["administrative-unit"],
          semanticType: input.semanticTypes[adminLevel] ?? "unknown",
          label: adminLevel === "ADM0" ? "Country" : adminLevel,
          sourceNameProperty: "shapeName",
          sourceIdProperty: "shapeID",
          sourceCodeProperties: ["officialCode", "shapeISO", "shapeID"],
          sourceParentProperties: [
            "parentShapeID",
            "shapeParentID",
            "parentSourceId",
            "parentCode",
            "shapeParent"
          ],
          required: true
        }
      ])
    ),
    identityStrategy: {
      officialCodeProperties: ["officialCode", "shapeISO"],
      sourceStableCodeProperties: ["shapeID", "sourceCode"],
      sourceIdProperties: ["shapeID", "id"]
    },
    hierarchyStrategy: {
      parentIdProperties: ["parentShapeID", "shapeParentID", "parentSourceId", "shapeParent"],
      parentCodeProperties: ["parentCode", "parentOfficialCode"],
      spatialContainmentTolerance: 1e-9
    },
    qualityPolicy: {
      rejectGeometryErrors: true,
      rejectUnresolvedParents: true,
      rejectAmbiguousParents: true,
      maximumFallbackIdentityRatio: 0.25
    },
    adjacencyPolicy: {
      levels: ["ADM1", "ADM2"],
      includePointTouches: false,
      minimumSharedBoundaryMeters: 0
    },
    licensePolicy: {
      allowedReleaseTypes: ["gbOpen", "gbHumanitarian", "gbAuthoritative"],
      requireAttribution: true,
      rejectUnknownLicense: true,
      allowNonRedistributableSource: false
    },
    reviewRequired: false,
    notes: ["Pilot country config with reviewed ADM0/ADM1/ADM2 semantic mappings."]
  };
}
