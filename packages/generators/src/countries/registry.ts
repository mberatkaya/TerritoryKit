import type { TerritoryCountryDatasetConfig } from "./types.js";
import { germanyCountryConfig } from "./configs/de.js";
import { indonesiaCountryConfig } from "./configs/id.js";
import { japanCountryConfig } from "./configs/jp.js";
import { turkeyCountryConfig } from "./configs/tr.js";
import { unitedStatesCountryConfig } from "./configs/us.js";
import { ISO_3166_COUNTRIES } from "./iso3166.js";
import type { TerritoryIsoCountryEntry } from "./iso3166.js";

export class TerritoryCountryConfigRegistry {
  readonly #configsByAlpha2 = new Map<string, TerritoryCountryDatasetConfig>();
  readonly #alpha3Aliases = new Map<string, string>();

  constructor(configs: readonly TerritoryCountryDatasetConfig[]) {
    for (const config of configs) {
      this.register(config);
    }
  }

  register(config: TerritoryCountryDatasetConfig): void {
    const alpha2 = normalizeCountryLookup(config.countryCodeAlpha2);
    const alpha3 = config.countryCodeAlpha3.trim().toUpperCase();

    if (this.#configsByAlpha2.has(alpha2)) {
      throw new Error(`Country config '${alpha2}' is already registered.`);
    }

    if (this.#alpha3Aliases.has(alpha3)) {
      throw new Error(`Country alpha-3 alias '${alpha3}' is already registered.`);
    }

    this.#configsByAlpha2.set(alpha2, {
      ...config,
      countryCodeAlpha2: alpha2,
      countryCodeAlpha3: alpha3
    });
    this.#alpha3Aliases.set(alpha3, alpha2);
  }

  has(countryCode: string): boolean {
    return this.resolveCode(countryCode) !== undefined;
  }

  get(countryCode: string): TerritoryCountryDatasetConfig {
    const resolved = this.resolveCode(countryCode);

    if (!resolved) {
      throw new Error(`Country config '${countryCode}' is not registered.`);
    }

    return resolved;
  }

  list(): TerritoryCountryDatasetConfig[] {
    return [...this.#configsByAlpha2.values()].sort((left, right) =>
      left.countryCodeAlpha2.localeCompare(right.countryCodeAlpha2)
    );
  }

  private resolveCode(countryCode: string): TerritoryCountryDatasetConfig | undefined {
    const normalized = countryCode.trim();
    const alpha2 =
      normalized.length === 3
        ? this.#alpha3Aliases.get(normalized.toUpperCase())
        : normalized.toUpperCase();

    return alpha2 ? this.#configsByAlpha2.get(alpha2) : undefined;
  }
}

export function createTerritoryCountryConfigRegistry(
  configs: readonly TerritoryCountryDatasetConfig[]
): TerritoryCountryConfigRegistry {
  return new TerritoryCountryConfigRegistry(configs);
}

export function createDefaultTerritoryCountryConfigRegistry(): TerritoryCountryConfigRegistry {
  const pilotConfigs = [
    germanyCountryConfig,
    indonesiaCountryConfig,
    japanCountryConfig,
    turkeyCountryConfig,
    unitedStatesCountryConfig
  ] as const;
  const pilotCountryCodes = new Set(pilotConfigs.map((config) => config.countryCodeAlpha2));
  const fallbackConfigs = ISO_3166_COUNTRIES.filter(
    (country) => !pilotCountryCodes.has(country.iso2)
  ).map(createFallbackIsoCountryConfig);

  return createTerritoryCountryConfigRegistry([...pilotConfigs, ...fallbackConfigs]);
}

export function listTerritoryCountryConfigs(): TerritoryCountryDatasetConfig[] {
  return createDefaultTerritoryCountryConfigRegistry().list();
}

export function getTerritoryCountryConfig(countryCode: string): TerritoryCountryDatasetConfig {
  return createDefaultTerritoryCountryConfigRegistry().get(countryCode);
}

export function hasTerritoryCountryConfig(countryCode: string): boolean {
  return createDefaultTerritoryCountryConfigRegistry().has(countryCode);
}

function normalizeCountryLookup(countryCode: string): string {
  const normalized = countryCode.trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new Error("Country config code must be ISO alpha-2.");
  }

  return normalized;
}

function createFallbackIsoCountryConfig(
  country: TerritoryIsoCountryEntry
): TerritoryCountryDatasetConfig {
  return {
    datasetId: country.iso2.toLowerCase(),
    countryCodeAlpha2: country.iso2,
    countryCodeAlpha3: country.iso3,
    displayName: country.name,
    defaultLocale: "en",
    sourceProvider: "geoboundaries",
    defaultReleaseType: "gbOpen",
    loaderPackageName: `@territory-kit/data-${country.iso2.toLowerCase()}`,
    requestedLevels: ["ADM0", "ADM1", "ADM2"],
    levelMappings: {
      ADM0: {
        adminLevel: "ADM0",
        expectedLocalTypes: ["country"],
        semanticType: "country",
        label: "Country",
        sourceNameProperty: "shapeName",
        sourceIdProperty: "shapeID",
        sourceCodeProperties: ["officialCode", "shapeISO", "shapeID"],
        sourceParentProperties: [],
        required: true,
        reviewRequired: false
      },
      ADM1: {
        adminLevel: "ADM1",
        expectedLocalTypes: ["administrative-unit"],
        semanticType: "unknown",
        label: "First-level administrative unit",
        sourceNameProperty: "shapeName",
        sourceIdProperty: "shapeID",
        sourceCodeProperties: ["officialCode", "shapeISO", "shapeID"],
        sourceParentProperties: ["parentShapeID", "shapeParentID", "parentSourceId"],
        required: false,
        reviewRequired: true
      },
      ADM2: {
        adminLevel: "ADM2",
        expectedLocalTypes: ["administrative-unit"],
        semanticType: "unknown",
        label: "Second-level administrative unit",
        sourceNameProperty: "shapeName",
        sourceIdProperty: "shapeID",
        sourceCodeProperties: ["officialCode", "shapeISO", "shapeID"],
        sourceParentProperties: ["parentShapeID", "shapeParentID", "parentSourceId"],
        required: false,
        reviewRequired: true
      }
    },
    notes: [
      "Fallback ISO country config. ADM1/ADM2 semantic mappings are not reviewed for this country.",
      `UN M49 numeric code: ${country.numeric}.`
    ],
    reviewRequired: true,
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
      rejectUnresolvedParents: false,
      rejectAmbiguousParents: true,
      maximumFallbackIdentityRatio: 0.5
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
    }
  };
}
