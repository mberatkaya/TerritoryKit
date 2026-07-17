import { readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { TERRITORY_ADMIN_LEVELS } from "@territory-kit/dataset";
import type { TerritoryAdminLevel, TerritorySemanticAdminType } from "@territory-kit/dataset";
import { ISO_3166_COUNTRIES } from "./iso3166.js";
import { getTerritoryCountryConfig } from "./registry.js";
import type {
  TerritoryArtifactStatus,
  TerritoryCountryBuildAllReport,
  TerritoryCountryDatasetConfig,
  TerritoryLifecycleStatus,
  TerritorySemanticReviewStatus
} from "./types.js";

export interface TerritoryCoverageRegistry {
  schemaVersion: "territorykit-coverage@2";
  generatedAt: string;
  levels: readonly TerritoryAdminLevel[];
  summary: {
    totalCountries: number;
    levels: Record<string, Record<TerritoryArtifactStatus, number>>;
    sourceStatus: Record<string, Record<string, number>>;
    validationStatus: Record<string, Record<string, number>>;
    semanticReviewStatus: Record<string, Record<TerritorySemanticReviewStatus, number>>;
    hierarchyStatus: Record<string, Record<string, number>>;
    adjacencyStatus: Record<string, Record<string, number>>;
    indexStatus: Record<string, Record<string, number>>;
    loaderStatus: Record<string, Record<string, number>>;
    featureCountByLevel: Record<string, number>;
    licenseRestrictedCountries: number;
    sourceMissingCountries: number;
    validationFailedCountries: number;
    builtCountries: number;
  };
  countries: TerritoryCoverageCountry[];
}

export interface TerritoryCoverageCountry {
  iso2: string;
  iso3: string;
  name: string;
  levels: Record<string, TerritoryCoverageLevel>;
  lastCheckedAt: string;
  reviewRequired: boolean;
  notes: string[];
}

export interface TerritoryCoverageLevel {
  status: TerritoryArtifactStatus;
  provider?: string;
  license?: string;
  semanticType?: TerritorySemanticAdminType;
  localTypeName?: string;
  coverageScope?: "complete" | "partial" | "unknown" | "not-applicable";
  coveragePercent?: number;
  coveredParents?: number;
  missingParents?: number;
  sourceProvider?: string;
  sourceVersion?: string;
  sourceChecksum?: string;
  licenseIdentifier?: string;
  attribution?: string;
  artifactPath?: string;
  featureCount?: number;
  validationStatus?: "not-run" | "passed" | "passed-with-warnings" | "failed";
  semanticReviewStatus?: TerritorySemanticReviewStatus;
  hierarchyStatus?: TerritoryLifecycleStatus;
  adjacencyStatus?: TerritoryLifecycleStatus;
  indexStatus?: TerritoryLifecycleStatus;
  loaderStatus?: TerritoryLifecycleStatus;
  sourceStatus?:
    | "not-reviewed"
    | "available"
    | "unavailable"
    | "not-applicable"
    | "restricted"
    | "provider-error"
    | "provider-unsupported";
}

export interface TerritoryCoverageBuildOptions {
  generatedAt: string;
  artifactRoot?: string;
  globalAdm0Path?: string;
  buildReportPath?: string;
  cwd?: string;
}

const COVERAGE_LEVELS = TERRITORY_ADMIN_LEVELS;

export async function buildTerritoryCoverageRegistryFromArtifacts(
  options: TerritoryCoverageBuildOptions
): Promise<TerritoryCoverageRegistry> {
  const cwd = options.cwd ?? process.cwd();
  const artifactRoot = resolve(cwd, options.artifactRoot ?? "datasets/generated/countries");
  const globalAdm0Path = resolve(cwd, options.globalAdm0Path ?? "datasets/generated/global/ADM0");
  const globalAdm0ArtifactPath = toPortableArtifactPath(globalAdm0Path, cwd);
  const buildAllReport = options.buildReportPath
    ? await readOptionalJson<TerritoryCountryBuildAllReport>(resolve(cwd, options.buildReportPath))
    : undefined;
  const countries: TerritoryCoverageCountry[] = [];

  for (const country of ISO_3166_COUNTRIES) {
    const config = getTerritoryCountryConfig(country.iso2);
    const countryRoot = join(artifactRoot, country.iso2);
    const buildResult = buildAllReport?.results.find((result) => result.country === country.iso2);
    const adm0BuildResult = buildAllReport?.results.find(
      (result) => result.country === country.iso2
    );
    const adm0Status = await inferAdm0Status(globalAdm0Path, country.iso2, adm0BuildResult);
    const adm0BuiltFromCountryArtifact =
      adm0BuildResult?.levels.find((level) => level.level === "ADM0")?.status === "built";
    const countryAdm0Level = await inferCountryLevelStatus({
      countryRoot,
      level: "ADM0",
      provider: config.sourceProvider,
      artifactPath: toPortableArtifactPath(join(countryRoot, "levels", "ADM0"), cwd),
      fallbackStatus: adm0Status,
      ...(adm0BuildResult ? { buildResult: adm0BuildResult } : {})
    });
    const levels = Object.fromEntries(
      await Promise.all(
        COVERAGE_LEVELS.map(async (level) => {
          if (level === "ADM0") {
            const value: TerritoryCoverageLevel =
              countryAdm0Level.status === "built" && countryAdm0Level.artifactPath
                ? countryAdm0Level
                : {
                    status: adm0Status,
                    provider: adm0BuiltFromCountryArtifact
                      ? config.sourceProvider
                      : "natural-earth",
                    sourceProvider: adm0BuiltFromCountryArtifact
                      ? config.sourceProvider
                      : "natural-earth",
                    license: adm0BuiltFromCountryArtifact ? "source-defined" : "Public Domain",
                    licenseIdentifier: adm0BuiltFromCountryArtifact
                      ? "source-defined"
                      : "Public Domain",
                    semanticType: "country",
                    coverageScope: adm0Status === "built" ? "complete" : "unknown",
                    ...(adm0Status === "built"
                      ? {
                          artifactPath: adm0BuiltFromCountryArtifact
                            ? toPortableArtifactPath(
                                join(
                                  resolve(cwd, adm0BuildResult.outputPath ?? countryRoot),
                                  "levels",
                                  "ADM0"
                                ),
                                cwd
                              )
                            : globalAdm0ArtifactPath
                        }
                      : {}),
                    validationStatus: adm0Status === "built" ? "passed" : "not-run",
                    semanticReviewStatus: "reviewed",
                    sourceStatus: "available"
                  };

            return [level, withConfigCoverageMetadata(value, config, level)];
          }

          const value = await inferCountryLevelStatus({
            countryRoot,
            level,
            provider: config.sourceProvider,
            artifactPath: toPortableArtifactPath(join(countryRoot, "levels", level), cwd),
            fallbackStatus: fallbackCoverageStatusForLevel(config, level),
            ...(buildResult ? { buildResult } : {})
          });

          return [level, withConfigCoverageMetadata(value, config, level)];
        })
      )
    ) as Record<TerritoryAdminLevel, TerritoryCoverageLevel>;

    countries.push({
      iso2: country.iso2,
      iso3: country.iso3,
      name: country.name,
      levels,
      lastCheckedAt: options.generatedAt,
      reviewRequired: Boolean(config.reviewRequired),
      notes: config.reviewRequired
        ? ["Sub-country levels require mapping review before artifact status can advance."]
        : ["Pilot config reviewed; artifact status is derived from generated build outputs."]
    });
  }

  return {
    schemaVersion: "territorykit-coverage@2",
    generatedAt: options.generatedAt,
    levels: COVERAGE_LEVELS,
    summary: summarizeCoverage(countries),
    countries
  };
}

function fallbackCoverageStatusForLevel(
  config: TerritoryCountryDatasetConfig,
  level: TerritoryAdminLevel
): TerritoryArtifactStatus {
  const mapping = config.levelMappings[level];

  if (!mapping || mapping.reviewStatus === "mapping-review-required") {
    return "not-reviewed";
  }

  return level === "ADM1" || level === "ADM2" ? "source-available" : "source-unavailable";
}

function withConfigCoverageMetadata(
  level: TerritoryCoverageLevel,
  config: TerritoryCountryDatasetConfig,
  adminLevel: TerritoryAdminLevel
): TerritoryCoverageLevel {
  const mapping = config.levelMappings[adminLevel];

  return {
    ...level,
    provider: level.provider ?? config.sourceProvider,
    sourceProvider: level.sourceProvider ?? level.provider ?? config.sourceProvider,
    ...(mapping?.semanticType ? { semanticType: mapping.semanticType } : {}),
    ...(mapping?.localTypeName ? { localTypeName: mapping.localTypeName } : {}),
    semanticReviewStatus:
      level.semanticReviewStatus ??
      (mapping?.reviewStatus === "reviewed" ? "reviewed" : "mapping-review-required"),
    coverageScope:
      level.coverageScope ??
      (level.status === "built"
        ? "complete"
        : level.status === "partial"
          ? "partial"
          : level.status === "not-applicable"
            ? "not-applicable"
            : "unknown")
  };
}

async function inferAdm0Status(
  globalAdm0Path: string,
  iso2: string,
  buildResult: TerritoryCountryBuildAllReport["results"][number] | undefined
): Promise<TerritoryArtifactStatus> {
  const adm0Build = buildResult?.levels.find((level) => level.level === "ADM0");

  if (adm0Build?.status === "built") {
    return "built";
  }

  if (adm0Build?.status) {
    return adm0Build.status;
  }

  const manifest = await readOptionalJson<{ artifactStatus?: TerritoryArtifactStatus }>(
    join(globalAdm0Path, "manifest.json")
  );
  const checksums = await fileExists(join(globalAdm0Path, "checksums.json"));
  const validation = await fileExists(join(globalAdm0Path, "validation-report.json"));
  const attribution = await fileExists(join(globalAdm0Path, "attribution.json"));
  const dataset = await readOptionalJson<{ zones?: Array<{ countryCode?: string }> }>(
    join(globalAdm0Path, "dataset.json")
  );
  const hasCountry = dataset?.zones?.some((zone) => zone.countryCode === iso2);

  return manifest?.artifactStatus === "built" &&
    checksums &&
    validation &&
    attribution &&
    hasCountry
    ? "built"
    : "source-available";
}

async function inferCountryLevelStatus(input: {
  countryRoot: string;
  level: TerritoryAdminLevel;
  provider: string;
  artifactPath: string;
  fallbackStatus: TerritoryArtifactStatus;
  buildResult?: TerritoryCountryBuildAllReport["results"][number];
}): Promise<TerritoryCoverageLevel> {
  const manifest = await readOptionalJson<{
    supportedLevels?: TerritoryAdminLevel[];
    featureCountByLevel?: Record<string, number>;
    publishReady?: boolean;
  }>(join(input.countryRoot, "manifest.json"));
  const hasDataset = await fileExists(
    join(input.countryRoot, "levels", input.level, "dataset.json")
  );
  const hasIndex = await fileExists(join(input.countryRoot, "levels", input.level, "index.json"));
  const hasValidation = await fileExists(
    join(input.countryRoot, "levels", input.level, "validation-report.json")
  );
  const hasChecksums = await fileExists(join(input.countryRoot, "checksums.json"));
  const hasAttribution =
    (await fileExists(join(input.countryRoot, "attribution.json"))) ||
    (await fileExists(join(input.countryRoot, "attribution.txt")));
  const levelResult = input.buildResult?.levels.find((level) => level.level === input.level);
  const built =
    Boolean(manifest?.supportedLevels?.includes(input.level)) &&
    Boolean(
      manifest?.publishReady ||
      levelResult?.status === "built" ||
      levelResult?.status === "built-with-warnings"
    ) &&
    hasDataset &&
    hasIndex &&
    hasValidation &&
    hasChecksums &&
    hasAttribution;

  if (built) {
    return {
      status: "built",
      provider: input.provider,
      license: "source-defined",
      artifactPath: input.artifactPath,
      ...(manifest?.featureCountByLevel?.[input.level] !== undefined
        ? { featureCount: manifest.featureCountByLevel[input.level] }
        : {}),
      validationStatus:
        levelResult?.status === "built-with-warnings" ? "passed-with-warnings" : "passed",
      ...coverageLifecycleFields(levelResult),
      sourceStatus: "available"
    };
  }

  if (levelResult?.status === "validation-failed") {
    return {
      status: "validation-failed",
      provider: input.provider,
      ...(levelResult.featureCount !== undefined ? { featureCount: levelResult.featureCount } : {}),
      validationStatus: "failed",
      ...coverageLifecycleFields(levelResult),
      sourceStatus: "available"
    };
  }

  return {
    status: levelResult?.status ?? input.fallbackStatus,
    provider: input.provider,
    ...(levelResult?.featureCount !== undefined ? { featureCount: levelResult.featureCount } : {}),
    validationStatus:
      levelResult?.status === "built-with-warnings" ? "passed-with-warnings" : "not-run",
    ...coverageLifecycleFields(levelResult),
    sourceStatus: sourceStatusForCoverage(levelResult?.status ?? input.fallbackStatus)
  };
}

function coverageLifecycleFields(
  levelResult: TerritoryCountryBuildAllReport["results"][number]["levels"][number] | undefined
): Pick<
  TerritoryCoverageLevel,
  "semanticReviewStatus" | "hierarchyStatus" | "adjacencyStatus" | "indexStatus" | "loaderStatus"
> {
  const lifecycle = levelResult?.lifecycle;

  return {
    ...(lifecycle?.semanticReviewStatus
      ? { semanticReviewStatus: lifecycle.semanticReviewStatus }
      : {}),
    ...(lifecycle?.hierarchyStatus ? { hierarchyStatus: lifecycle.hierarchyStatus } : {}),
    ...(lifecycle?.adjacencyStatus ? { adjacencyStatus: lifecycle.adjacencyStatus } : {}),
    ...(lifecycle?.indexStatus ? { indexStatus: lifecycle.indexStatus } : {}),
    ...(lifecycle?.loaderStatus ? { loaderStatus: lifecycle.loaderStatus } : {})
  };
}

function sourceStatusForCoverage(
  status: TerritoryArtifactStatus
): NonNullable<TerritoryCoverageLevel["sourceStatus"]> {
  if (status === "not-reviewed") {
    return "not-reviewed";
  }

  if (status === "source-unavailable") {
    return "unavailable";
  }

  if (status === "not-applicable") {
    return "not-applicable";
  }

  if (status === "licence-restricted" || status === "license-restricted") {
    return "restricted";
  }

  if (status === "provider-error") {
    return "provider-error";
  }

  if (status === "provider-unsupported") {
    return "provider-unsupported";
  }

  return "available";
}

function summarizeCoverage(
  countries: TerritoryCoverageCountry[]
): TerritoryCoverageRegistry["summary"] {
  const levels = Object.fromEntries(
    COVERAGE_LEVELS.map((level) => [level, summarizeLevel(countries, level)])
  ) as Record<string, Record<TerritoryArtifactStatus, number>>;

  return {
    totalCountries: countries.length,
    levels,
    sourceStatus: summarizeCoverageProperty(countries, "sourceStatus"),
    validationStatus: summarizeCoverageProperty(countries, "validationStatus"),
    semanticReviewStatus: summarizeCoverageProperty(countries, "semanticReviewStatus") as Record<
      string,
      Record<TerritorySemanticReviewStatus, number>
    >,
    hierarchyStatus: summarizeCoverageProperty(countries, "hierarchyStatus"),
    adjacencyStatus: summarizeCoverageProperty(countries, "adjacencyStatus"),
    indexStatus: summarizeCoverageProperty(countries, "indexStatus"),
    loaderStatus: summarizeCoverageProperty(countries, "loaderStatus"),
    featureCountByLevel: Object.fromEntries(
      COVERAGE_LEVELS.map((level) => [
        level,
        countries.reduce((sum, country) => sum + (country.levels[level]?.featureCount ?? 0), 0)
      ])
    ),
    licenseRestrictedCountries: countCountriesWithStatus(countries, "licence-restricted"),
    sourceMissingCountries: countries.filter((country) =>
      COVERAGE_LEVELS.filter((level) => level !== "ADM0").some(
        (level) => country.levels[level]?.status === "source-unavailable"
      )
    ).length,
    validationFailedCountries: countCountriesWithStatus(countries, "validation-failed"),
    builtCountries: countries.filter((country) =>
      Object.values(country.levels).some((level) => level.status === "built")
    ).length
  };
}

function summarizeCoverageProperty(
  countries: TerritoryCoverageCountry[],
  property: keyof TerritoryCoverageLevel
): Record<string, Record<string, number>> {
  return Object.fromEntries(
    COVERAGE_LEVELS.map((level) => {
      const counts: Record<string, number> = {};

      for (const country of countries) {
        const value = country.levels[level]?.[property];

        if (typeof value === "string") {
          counts[value] = (counts[value] ?? 0) + 1;
        }
      }

      return [level, counts];
    })
  );
}

function summarizeLevel(
  countries: TerritoryCoverageCountry[],
  level: string
): Record<TerritoryArtifactStatus, number> {
  const statuses = {} as Record<TerritoryArtifactStatus, number>;

  for (const country of countries) {
    const status = country.levels[level]?.status ?? "source-unavailable";
    statuses[status] = (statuses[status] ?? 0) + 1;
  }

  return statuses;
}

function countCountriesWithStatus(
  countries: TerritoryCoverageCountry[],
  status: TerritoryArtifactStatus,
  levels: readonly string[] = COVERAGE_LEVELS
): number {
  return countries.filter((country) =>
    levels.some((level) => country.levels[level]?.status === status)
  ).length;
}

async function readOptionalJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function toPortableArtifactPath(path: string, cwd: string): string {
  const portable = relative(resolve(cwd), path);

  return portable && !portable.startsWith("..") ? portable : path;
}
