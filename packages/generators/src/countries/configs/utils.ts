import { TERRITORY_ADMIN_LEVELS, getAdminLevelDepth } from "@territory-kit/dataset";
import type { TerritoryAdminLevel, TerritorySemanticAdminType } from "@territory-kit/dataset";
import type { TerritoryCountryDatasetConfig } from "../types.js";

const DEFAULT_LEVELS: readonly TerritoryAdminLevel[] = ["ADM0", "ADM1", "ADM2"];
const DEFAULT_LEVEL_SET = new Set<TerritoryAdminLevel>(DEFAULT_LEVELS);
const COMMON_PARENT_PROPERTIES = [
  "parentShapeID",
  "shapeParentID",
  "parentSourceId",
  "parentCode",
  "shapeParent"
] as const;

export function createPilotCountryConfig(input: {
  datasetId: string;
  countryCodeAlpha2: string;
  countryCodeAlpha3: string;
  displayName: string;
  loaderPackageName: string;
  defaultLocale: string;
  localTypes: Partial<Record<TerritoryAdminLevel, readonly string[]>>;
  semanticTypes: Partial<Record<TerritoryAdminLevel, TerritorySemanticAdminType>>;
  localTypeNames?: Partial<Record<TerritoryAdminLevel, string>>;
}): TerritoryCountryDatasetConfig {
  const reviewedLevels = new Set(
    TERRITORY_ADMIN_LEVELS.filter((adminLevel) => Boolean(input.semanticTypes[adminLevel]))
  );
  const adjacencyLevels = TERRITORY_ADMIN_LEVELS.filter(
    (adminLevel) =>
      adminLevel !== "ADM0" && (DEFAULT_LEVEL_SET.has(adminLevel) || reviewedLevels.has(adminLevel))
  );

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
      TERRITORY_ADMIN_LEVELS.map((adminLevel) => [
        adminLevel,
        {
          adminLevel,
          expectedLocalTypes: input.localTypes[adminLevel] ?? ["administrative-unit"],
          semanticType: input.semanticTypes[adminLevel] ?? "unknown",
          ...(input.localTypeNames?.[adminLevel]
            ? { localTypeName: input.localTypeNames[adminLevel] }
            : {}),
          label: adminLevel === "ADM0" ? "Country" : adminLevel,
          sourceNameProperty: "shapeName",
          sourceIdProperty: "shapeID",
          sourceCodeProperties: ["officialCode", "shapeISO", "shapeID"],
          sourceParentProperties:
            getAdminLevelDepth(adminLevel) === 0 ? [] : COMMON_PARENT_PROPERTIES,
          required: DEFAULT_LEVEL_SET.has(adminLevel),
          reviewRequired: !reviewedLevels.has(adminLevel),
          reviewStatus: reviewedLevels.has(adminLevel) ? "reviewed" : "mapping-review-required"
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
      rejectGeometryErrors: false,
      rejectUnresolvedParents: false,
      rejectAmbiguousParents: false,
      maximumFallbackIdentityRatio: 0.25
    },
    adjacencyPolicy: {
      levels: adjacencyLevels,
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
    notes: [
      "Pilot country config with reviewed ADM0/ADM1/ADM2 semantic mappings.",
      "ADM3-ADM5 mappings are optional and require reviewed source availability unless configured for the country."
    ]
  };
}
