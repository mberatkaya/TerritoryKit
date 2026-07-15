import { mkdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createTerritoryEngine } from "@territory-kit/core";
import {
  TERRITORY_SCHEMA_VERSION,
  computeGeometryBBox,
  computeGeometryCenter,
  validateGeometryDataset,
  validateTerritoryDataset
} from "@territory-kit/dataset";
import type {
  TerritoryDataset,
  TerritoryGeometry,
  TerritoryGlobalMetadata,
  TerritoryZone
} from "@territory-kit/dataset";
import {
  NATURAL_EARTH_ADM0_DATASET_NAME,
  NATURAL_EARTH_ATTRIBUTION,
  NATURAL_EARTH_PROVIDER,
  NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
  createWorldCountriesAdm0ArtifactPlan,
  parseNaturalEarthAdm0FeatureCollection,
  resolveBuildDate
} from "./natural-earth.js";
import type { NaturalEarthAdm0Detail, NaturalEarthSourceDescriptor } from "./natural-earth.js";
import { ISO_3166_COUNTRIES } from "./countries/iso3166.js";
import type {
  TerritoryCountryBuildAllOutcome,
  TerritoryCountryBuildAllReport
} from "./countries/types.js";
import { repairTerritoryGeometries } from "./geometry-repair.js";
import { fetchHttpSourceArtifact } from "./sources/transports/http.js";
import {
  createDatasetGeometryHash,
  isRecord,
  serializeJsonStable,
  sha256Hex,
  writeFilesAtomically
} from "./sources/utils.js";

export const GLOBAL_ADMIN_DATASET_ID = "global-admin" as const;
export const GLOBAL_ADMIN_ADM0_OUTPUT = "datasets/generated/global/ADM0" as const;
export const GLOBAL_ADMIN_WORLD_ID = "territory:global-admin:WORLD" as const;
export const GLOBAL_ADMIN_COUNTRY_ARTIFACT_ROOTS = [
  "datasets/generated/global-adm0-countries",
  "datasets/generated/countries"
] as const;
export const NATURAL_EARTH_ADM0_GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson" as const;
export const GLOBAL_ADMIN_OVERVIEW_SOURCE_SCALE = "50m" as const;

export interface GlobalAdminAdm0BuildOptions {
  sourcePath?: string;
  sourceUrl?: string;
  outputPath: string;
  countryArtifactRoots?: readonly string[];
  buildReportPath?: string;
  cacheDir?: string;
  buildDate?: string;
  datasetVersion?: string;
  sourceDate?: string;
  sourceVersion?: string;
  force?: boolean;
  cwd?: string;
}

export interface GlobalAdminAdm0BuildResult {
  ok: boolean;
  outputPath: string;
  featureCount: number;
  validatedArtifactCount: number;
  issues: Array<{ code: string; message: string; severity: "error" | "warning" }>;
  smoke: GlobalAdminSmokeReport;
  files: Map<string, string>;
  coverage: GlobalAdminAdm0CoverageReport;
  unmatched: GlobalAdminAdm0UnmatchedReport;
}

export interface GlobalAdminSmokeReport {
  ok: boolean;
  checks: Array<{
    name: string;
    ok: boolean;
    expected?: string | number;
    actual?: string | null | number;
    blocking?: boolean;
  }>;
}

export type GlobalAdminAdm0CountryDetailStatus =
  | "built"
  | "source-available-not-built"
  | "source-unavailable"
  | "licence-restricted"
  | "provider-error"
  | "validation-failed"
  | "performance-deferred";

export interface GlobalAdminAdm0CoverageReport {
  coverageVersion: "1";
  generatedAt: string;
  provider: typeof NATURAL_EARTH_PROVIDER;
  artifactKind: "global-overview";
  sourceScale: typeof GLOBAL_ADMIN_OVERVIEW_SOURCE_SCALE;
  totalIsoEntities: number;
  summary: {
    totalIsoEntities: number;
    overviewBuilt: number;
    overviewMissingIso: number;
    countryDetailBuilt: number;
    countryDetailSourceAvailableNotBuilt: number;
    countryDetailSourceUnavailable: number;
    countryDetailValidationFailed: number;
    countryDetailPerformanceDeferred: number;
  };
  countries: Array<{
    iso2: string;
    iso3: string;
    name: string;
    overviewStatus: "built" | "missing";
    countryDetailStatus: GlobalAdminAdm0CountryDetailStatus;
    countryDetailArtifactPath?: string;
    featureCount?: number;
    reason?: string;
  }>;
}

export interface GlobalAdminAdm0UnmatchedReport {
  reportVersion: "1";
  generatedAt: string;
  sourceEntitiesWithoutIsoMapping: Array<Record<string, string>>;
  isoEntriesWithoutSourceGeometry: string[];
  countryDetailBuiltIsoEntities: string[];
  countryDetailSourceAvailableNotBuiltIsoEntities: string[];
  countryDetailSourceUnavailableIsoEntities: string[];
  countryDetailPerformanceDeferredIsoEntities: string[];
}

interface CountryDetailStatusEntry {
  status: GlobalAdminAdm0CountryDetailStatus;
  artifactPath?: string;
  featureCount?: number;
  reason?: string;
}

type DetailName = "low" | "medium" | "full";

const DETAIL_MAP: Record<DetailName, NaturalEarthAdm0Detail> = {
  full: "high",
  low: "low",
  medium: "medium"
};
const GLOBAL_OVERVIEW_GEOMETRY_CHECKS = {
  coordinates: true,
  rings: true,
  selfIntersections: false,
  holes: false,
  bbox: true,
  center: true,
  antimeridian: true,
  parentContainment: true,
  siblingOverlaps: false
} as const;

const GLOBAL_ADM0_SMOKE_SAMPLES = [
  { name: "Istanbul", coordinate: { lat: 41.0082, lng: 28.9784 }, country: "TR" },
  { name: "Berlin", coordinate: { lat: 52.52, lng: 13.405 }, country: "DE" },
  { name: "Tokyo", coordinate: { lat: 35.6762, lng: 139.6503 }, country: "JP" },
  { name: "New York", coordinate: { lat: 40.7128, lng: -74.006 }, country: "US" },
  { name: "Jakarta", coordinate: { lat: -6.2088, lng: 106.8456 }, country: "ID" },
  { name: "Sydney", coordinate: { lat: -33.8688, lng: 151.2093 }, country: "AU" },
  { name: "Buenos Aires", coordinate: { lat: -34.6037, lng: -58.3816 }, country: "AR" },
  { name: "Cape Town", coordinate: { lat: -33.9249, lng: 18.4241 }, country: "ZA" }
] as const;

export async function buildGlobalAdminAdm0Artifacts(
  options: GlobalAdminAdm0BuildOptions
): Promise<GlobalAdminAdm0BuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const outputPath = resolve(cwd, options.outputPath);
  const buildDate = resolveBuildDate(options.buildDate, process.env);
  const datasetVersion = options.datasetVersion ?? "0.1.0";
  const countryArtifactRoots = (
    options.countryArtifactRoots ?? GLOBAL_ADMIN_COUNTRY_ARTIFACT_ROOTS
  ).map((root) => resolve(cwd, root));
  const buildReport = await readOptionalBuildReport(cwd, options.buildReportPath);
  const source = await resolveGlobalAdm0Source({
    cwd,
    buildDate,
    ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
    sourceUrl: options.sourceUrl ?? NATURAL_EARTH_ADM0_GEOJSON_URL,
    ...(options.cacheDir ? { cacheDir: options.cacheDir } : {})
  });
  const input = JSON.parse(await readFile(source.localPath, "utf8")) as unknown;
  const sourceDescriptor: NaturalEarthSourceDescriptor = {
    provider: NATURAL_EARTH_PROVIDER,
    datasetName: `${NATURAL_EARTH_ADM0_DATASET_NAME}_${GLOBAL_ADMIN_OVERVIEW_SOURCE_SCALE}`,
    version: options.sourceVersion ?? source.version ?? "natural-earth-vector-master",
    sourcePath: source.localPath,
    sourceUrl: source.sourceUrl,
    sourceSha256: source.sha256,
    license: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
    attribution: NATURAL_EARTH_ATTRIBUTION,
    sourceDate: options.sourceDate ?? options.sourceVersion ?? source.version ?? "unknown",
    importedAt: buildDate
  };
  const naturalEarthPlan = createWorldCountriesAdm0ArtifactPlan(input, {
    buildDate,
    datasetVersion,
    details: ["low", "medium", "high"],
    source: sourceDescriptor
  });
  const naturalEarthParse = parseNaturalEarthAdm0FeatureCollection(input, sourceDescriptor);
  const isoCodes = new Set(ISO_3166_COUNTRIES.map((country) => country.iso2));
  const sourceCodes = new Set(naturalEarthParse.records.map((record) => record.iso3166_1));
  const unmatchedIso = ISO_3166_COUNTRIES.filter((country) => !sourceCodes.has(country.iso2));
  const nonIsoSource = extractNonIsoSourceEntities(input, isoCodes);
  const detailDatasets = new Map<DetailName, TerritoryDataset>();
  const issues: GlobalAdminAdm0BuildResult["issues"] = naturalEarthPlan.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    severity: issue.severity === "error" ? "warning" : issue.severity
  }));

  for (const detailName of ["low", "medium", "full"] as const) {
    const naturalEarthDetail = DETAIL_MAP[detailName];
    const sourceDataset = JSON.parse(
      naturalEarthPlan.files.get(`${naturalEarthDetail}/dataset.json`) ?? "{}"
    ) as TerritoryDataset;
    const zones = await repairOverviewZones(
      sourceDataset.zones.map((zone) => rebaseAdm0Zone(zone, detailName, sourceDescriptor)),
      {
        cwd,
        detail: detailName,
        issues
      }
    );
    const world = createWorldZone({
      datasetVersion,
      buildDate,
      childIds: zones.map((zone) => zone.id).sort()
    });
    const dataset = finalizeGlobalAdminDataset({
      zones: [world, ...zones].sort((left, right) => left.id.localeCompare(right.id)),
      detail: detailName,
      buildDate,
      datasetVersion,
      sourceDate: sourceDescriptor.sourceDate
    });
    const validation = validateTerritoryDataset(dataset);
    const geometry = validateGeometryDataset(dataset, { checks: GLOBAL_OVERVIEW_GEOMETRY_CHECKS });

    if (!validation.ok) {
      issues.push(
        ...validation.issues.map((issue) => ({
          code: `DATASET_${issue.code}`,
          message: issue.message,
          severity: (detailName === "full" && issue.severity === "error" ? "error" : "warning") as
            "error" | "warning"
        }))
      );
    }

    if (!geometry.ok) {
      issues.push(
        ...geometry.issues
          .filter((issue) => issue.severity !== "info")
          .map((issue) => ({
            code: `GEOMETRY_${issue.code}`,
            message: issue.message,
            severity: (issue.severity === "error" ? "error" : "warning") as "error" | "warning"
          }))
      );
    }

    detailDatasets.set(detailName, dataset);
  }

  const fullDataset = detailDatasets.get("full");
  const mediumDataset = detailDatasets.get("medium");
  const lowDataset = detailDatasets.get("low");

  if (!fullDataset || !mediumDataset || !lowDataset) {
    throw new Error("Global ADM0 overview datasets were not created.");
  }

  const coverage = await createCoverageReport({
    cwd,
    generatedAt: buildDate,
    sourceCodes,
    countryArtifactRoots,
    ...(buildReport ? { buildReport } : {})
  });
  const unmatched = createUnmatchedReport({
    generatedAt: buildDate,
    coverage,
    unmatchedIso,
    nonIsoSource
  });
  const smoke = issues.some((issue) => issue.severity === "error")
    ? {
        ok: false,
        checks: [
          {
            name: "loader-smoke",
            ok: false,
            expected: "valid dataset",
            actual: "skipped because validation errors were reported"
          }
        ]
      }
    : smokeGlobalAdm0Dataset(fullDataset);
  const files = createGlobalAdm0Files({
    fullDataset,
    mediumDataset,
    lowDataset,
    source,
    sourceDescriptor,
    validation: {
      reportVersion: "1",
      dataset: validateTerritoryDataset(fullDataset),
      geometry: validateGeometryDataset(fullDataset, { checks: GLOBAL_OVERVIEW_GEOMETRY_CHECKS })
    },
    coverage,
    unmatched,
    smoke,
    buildDate,
    countryArtifactRoots: countryArtifactRoots.map((root) => toPortablePath(root, cwd))
  });

  if (issues.every((issue) => issue.severity !== "error")) {
    await writeFilesAtomically(outputPath, files, { force: options.force ?? false });
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error") && smoke.ok,
    outputPath,
    featureCount: fullDataset.zones.filter((zone) => zone.sourceAdminLevel === "ADM0").length,
    validatedArtifactCount: 3,
    issues,
    smoke,
    files,
    coverage,
    unmatched
  };
}

async function resolveGlobalAdm0Source(options: {
  cwd: string;
  buildDate: string;
  sourcePath?: string;
  sourceUrl: string;
  cacheDir?: string;
}): Promise<{ localPath: string; sourceUrl: string; sha256: string; version?: string }> {
  if (options.sourcePath) {
    const localPath = resolve(options.cwd, options.sourcePath);
    const content = await readFile(localPath);
    return {
      localPath,
      sourceUrl: options.sourceUrl,
      sha256: sha256Hex(new Uint8Array(content))
    };
  }

  const destinationDirectory = resolve(
    options.cwd,
    options.cacheDir ?? ".territory/cache/global-admin"
  );
  await mkdir(destinationDirectory, { recursive: true });
  const artifact = await fetchHttpSourceArtifact({
    provider: NATURAL_EARTH_PROVIDER,
    url: options.sourceUrl,
    destinationDirectory,
    maxSourceSizeBytes: 32 * 1024 * 1024,
    now: () => options.buildDate
  });

  return {
    localPath: artifact.localPath,
    sourceUrl: artifact.originalUrl ?? options.sourceUrl,
    sha256: artifact.sha256,
    ...(artifact.sourceVersion ? { version: artifact.sourceVersion } : {})
  };
}

function createGlobalAdm0Files(input: {
  fullDataset: TerritoryDataset;
  mediumDataset: TerritoryDataset;
  lowDataset: TerritoryDataset;
  source: { sourceUrl: string; sha256: string };
  sourceDescriptor: NaturalEarthSourceDescriptor;
  validation: Record<string, unknown>;
  coverage: GlobalAdminAdm0CoverageReport;
  unmatched: GlobalAdminAdm0UnmatchedReport;
  smoke: GlobalAdminSmokeReport;
  buildDate: string;
  countryArtifactRoots: string[];
}): Map<string, string> {
  const files = new Map<string, string>();
  files.set("dataset.json", serializeJsonArtifact(input.fullDataset));
  files.set("full.geojson", serializeJsonArtifact(datasetToFeatureCollection(input.fullDataset)));
  files.set(
    "medium.geojson",
    serializeJsonArtifact(datasetToFeatureCollection(input.mediumDataset))
  );
  files.set("low.geojson", serializeJsonArtifact(datasetToFeatureCollection(input.lowDataset)));
  files.set("index.json", serializeJsonArtifact(createSpatialIndex(input.fullDataset)));
  files.set("validation-report.json", serializeJsonStable(input.validation));
  files.set("coverage.json", serializeJsonStable(input.coverage));
  files.set("unmatched-report.json", serializeJsonStable(input.unmatched));
  files.set("smoke-report.json", serializeJsonStable(input.smoke));
  files.set(
    "attribution.json",
    serializeJsonStable({
      attributionVersion: "1",
      providerId: NATURAL_EARTH_PROVIDER,
      sourceProvider: NATURAL_EARTH_PROVIDER,
      sourceDatasetName: input.sourceDescriptor.datasetName,
      sourceScale: GLOBAL_ADMIN_OVERVIEW_SOURCE_SCALE,
      sourceUrl: input.source.sourceUrl,
      downloadUrl: input.source.sourceUrl,
      licence: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
      attribution: NATURAL_EARTH_ATTRIBUTION,
      redistributionPermission: true,
      commercialUsePermission: true,
      sourceDate: input.sourceDescriptor.sourceDate,
      downloadDate: input.buildDate,
      originalChecksum: input.source.sha256,
      transformedArtifactChecksum: sha256Hex(serializeJsonArtifact(input.fullDataset)),
      country: "GLOBAL",
      sourceAdministrativeLevel: "ADM0"
    })
  );
  files.set(
    "manifest.json",
    serializeJsonStable({
      manifestVersion: "1",
      datasetId: GLOBAL_ADMIN_DATASET_ID,
      datasetVersion: input.fullDataset.manifest.datasetVersion,
      schemaVersion: TERRITORY_SCHEMA_VERSION,
      artifactKind: "global-overview",
      countryDetailKind: "country-detail",
      countryDetailStrategy: "load-on-demand",
      countryDetailArtifactRoots: input.countryArtifactRoots,
      sourceProvider: NATURAL_EARTH_PROVIDER,
      sourceDatasetName: input.sourceDescriptor.datasetName,
      sourceScale: GLOBAL_ADMIN_OVERVIEW_SOURCE_SCALE,
      sourceUrl: input.source.sourceUrl,
      sourceChecksum: input.source.sha256,
      supportedLevels: ["world", "ADM0"],
      geometryVariants: {
        full: {
          path: "full.geojson",
          naturalEarthDetail: "high",
          simplification: "source-50m"
        },
        medium: {
          path: "medium.geojson",
          naturalEarthDetail: "medium",
          simplification: "overview-profile"
        },
        low: {
          path: "low.geojson",
          naturalEarthDetail: "low",
          simplification: "overview-profile"
        }
      },
      artifacts: {
        dataset: "dataset.json",
        full: "full.geojson",
        medium: "medium.geojson",
        low: "low.geojson",
        index: "index.json",
        validationReport: "validation-report.json",
        attribution: "attribution.json",
        coverage: "coverage.json",
        unmatchedReport: "unmatched-report.json",
        smokeReport: "smoke-report.json"
      },
      featureCount: input.fullDataset.zones.filter((zone) => zone.sourceAdminLevel === "ADM0")
        .length,
      rootZoneId: GLOBAL_ADMIN_WORLD_ID,
      buildDate: input.buildDate,
      license: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
      attribution: NATURAL_EARTH_ATTRIBUTION,
      artifactStatus: "built"
    })
  );

  const checksums = Object.fromEntries(
    [...files.entries()].map(([path, content]) => [path, sha256Hex(content)]).sort()
  );
  files.set("checksums.json", serializeJsonStable({ algorithm: "sha256", files: checksums }));

  return new Map([...files.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

async function repairOverviewZones(
  zones: readonly TerritoryZone[],
  input: {
    cwd: string;
    detail: DetailName;
    issues: GlobalAdminAdm0BuildResult["issues"];
  }
): Promise<TerritoryZone[]> {
  const report = await repairTerritoryGeometries(
    zones.map((zone) => ({ id: zone.id, geometry: zone.geometry })),
    { cwd: input.cwd }
  );
  const repairById = new Map(report.results.map((result) => [result.id, result]));

  if (report.featuresRepaired > 0 || report.componentsDiscarded > 0) {
    input.issues.push({
      code: "GEOMETRY_REPAIRED",
      severity: "warning",
      message: `${input.detail} overview repaired ${report.featuresRepaired} Natural Earth feature(s) with ${report.componentsDiscarded} discarded non-area component(s).`
    });
  }

  return zones.flatMap((zone) => {
    const repair = repairById.get(zone.id);

    if (!repair || repair.status === "rejected" || !repair.geometry) {
      input.issues.push({
        code: "GEOMETRY_REPAIR_REJECTED",
        severity: "error",
        message: `${input.detail} overview geometry '${zone.id}' could not be repaired: ${
          repair?.message ?? "missing repair result"
        }`
      });
      return [];
    }

    return [
      {
        ...zone,
        geometry: repair.geometry,
        center: repair.center ?? zone.center,
        bbox: repair.bbox ?? computeGeometryBBox(repair.geometry)
      }
    ];
  });
}

function rebaseAdm0Zone(
  zone: TerritoryZone,
  detail: DetailName,
  source: NaturalEarthSourceDescriptor
): TerritoryZone {
  const territory = isRecord(zone.properties.territory) ? zone.properties.territory : {};
  const codes = isRecord(territory.codes) ? territory.codes : {};
  const sourceCode =
    readString(codes.source) ?? readString(codes.iso3166_1) ?? zone.countryCode ?? zone.id;
  const countryCode = (zone.countryCode ?? readString(codes.iso3166_1) ?? zone.id).toUpperCase();
  const id = `territory:global-admin:${countryCode}:ADM0:${sourceCode.toUpperCase()}`;
  const metadata: TerritoryGlobalMetadata & Record<string, unknown> = {
    ...(isRecord(zone.properties.territory) ? zone.properties.territory : {}),
    adminLevel: "ADM0",
    localType: "country",
    source: {
      provider: NATURAL_EARTH_PROVIDER,
      sourceId: sourceCode,
      ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
      importedAt: source.importedAt,
      license: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
      attribution: NATURAL_EARTH_ATTRIBUTION
    },
    artifactKind: "global-overview",
    geometryVariant: detail,
    sourceScale: GLOBAL_ADMIN_OVERVIEW_SOURCE_SCALE
  };

  return {
    ...zone,
    id,
    datasetId: GLOBAL_ADMIN_DATASET_ID,
    level: 1,
    parentId: GLOBAL_ADMIN_WORLD_ID,
    countryCode,
    sourceAdminLevel: "ADM0",
    semanticType: "country",
    childIds: [],
    properties: {
      ...zone.properties,
      id,
      parentId: GLOBAL_ADMIN_WORLD_ID,
      countryCode,
      level: 1,
      sourceAdminLevel: "ADM0",
      semanticType: "country",
      territory: metadata
    }
  };
}

function createWorldZone(input: {
  datasetVersion: string;
  buildDate: string;
  childIds: string[];
}): TerritoryZone {
  const geometry: TerritoryGeometry = {
    type: "Polygon",
    coordinates: [
      [
        [-180, -90],
        [180, -90],
        [180, 90],
        [-180, 90],
        [-180, -90]
      ]
    ]
  };

  return {
    id: GLOBAL_ADMIN_WORLD_ID,
    datasetId: GLOBAL_ADMIN_DATASET_ID,
    level: 0,
    sourceAdminLevel: "WORLD",
    semanticType: "world",
    name: "World",
    childIds: input.childIds,
    neighborIds: [],
    geometry,
    center: computeGeometryCenter(geometry),
    bbox: computeGeometryBBox(geometry),
    properties: {
      id: GLOBAL_ADMIN_WORLD_ID,
      level: 0,
      sourceAdminLevel: "WORLD",
      semanticType: "world",
      name: "World",
      territory: {
        adminLevel: "ADM0",
        localType: "world",
        names: { default: "World" },
        source: {
          provider: "territory-kit",
          sourceId: "WORLD",
          importedAt: input.buildDate,
          license: "derived",
          attribution: "TerritoryKit generated root zone"
        },
        datasetVersion: input.datasetVersion
      }
    }
  };
}

function finalizeGlobalAdminDataset(input: {
  zones: TerritoryZone[];
  detail: DetailName;
  buildDate: string;
  datasetVersion: string;
  sourceDate: string;
}): TerritoryDataset {
  const dataset: TerritoryDataset = {
    manifest: {
      datasetId: GLOBAL_ADMIN_DATASET_ID,
      datasetVersion: input.datasetVersion,
      schemaVersion: TERRITORY_SCHEMA_VERSION,
      sourceDate: input.sourceDate,
      geometryHash: "pending",
      adminLevels: ["ADM0"],
      artifactChecksum: "recorded-in-global-admin-checksums",
      attribution: NATURAL_EARTH_ATTRIBUTION,
      boundaryPolicy: "natural-earth-50m-overview-not-cadastral",
      buildDate: input.buildDate,
      countryCodes: [
        ...new Set(
          input.zones.flatMap((zone) => (zone.countryCode ? [zone.countryCode.toLowerCase()] : []))
        )
      ].sort(),
      crs: "EPSG:4326",
      disputedAreaPolicy: "natural-earth-disputed-boundaries-not-authoritative",
      geometryDetail: input.detail === "full" ? "source" : input.detail,
      license: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
      name: "Global Administrative ADM0 Overview",
      description: "World root and Natural Earth 50m ADM0 country overview boundaries.",
      sourceProvider: NATURAL_EARTH_PROVIDER,
      worldview: "natural-earth-international"
    },
    zones: input.zones
  };
  const geometryHash = createDatasetGeometryHash(dataset);

  return {
    ...dataset,
    manifest: {
      ...dataset.manifest,
      geometryHash,
      artifactChecksum: sha256Hex(serializeJsonStable(dataset.zones))
    }
  };
}

async function createCoverageReport(input: {
  cwd: string;
  generatedAt: string;
  sourceCodes: ReadonlySet<string>;
  countryArtifactRoots: readonly string[];
  buildReport?: TerritoryCountryBuildAllReport;
}): Promise<GlobalAdminAdm0CoverageReport> {
  const countries = await Promise.all(
    ISO_3166_COUNTRIES.map(async (country) => {
      const detail = await inferCountryDetailStatus(country, input);

      return {
        iso2: country.iso2,
        iso3: country.iso3,
        name: country.name,
        overviewStatus: input.sourceCodes.has(country.iso2)
          ? ("built" as const)
          : ("missing" as const),
        countryDetailStatus: detail.status,
        ...(detail.artifactPath ? { countryDetailArtifactPath: detail.artifactPath } : {}),
        ...(detail.featureCount !== undefined ? { featureCount: detail.featureCount } : {}),
        ...(detail.reason ? { reason: detail.reason } : {})
      };
    })
  );
  const countDetailStatus = (status: GlobalAdminAdm0CountryDetailStatus) =>
    countries.filter((country) => country.countryDetailStatus === status).length;

  return {
    coverageVersion: "1",
    generatedAt: input.generatedAt,
    provider: NATURAL_EARTH_PROVIDER,
    artifactKind: "global-overview",
    sourceScale: GLOBAL_ADMIN_OVERVIEW_SOURCE_SCALE,
    totalIsoEntities: ISO_3166_COUNTRIES.length,
    summary: {
      totalIsoEntities: ISO_3166_COUNTRIES.length,
      overviewBuilt: countries.filter((country) => country.overviewStatus === "built").length,
      overviewMissingIso: countries.filter((country) => country.overviewStatus === "missing")
        .length,
      countryDetailBuilt: countDetailStatus("built"),
      countryDetailSourceAvailableNotBuilt: countDetailStatus("source-available-not-built"),
      countryDetailSourceUnavailable: countDetailStatus("source-unavailable"),
      countryDetailValidationFailed: countDetailStatus("validation-failed"),
      countryDetailPerformanceDeferred: countDetailStatus("performance-deferred")
    },
    countries: countries.sort((left, right) => left.iso2.localeCompare(right.iso2))
  };
}

async function inferCountryDetailStatus(
  country: { iso2: string; iso3: string; name: string },
  context: {
    cwd: string;
    countryArtifactRoots: readonly string[];
    buildReport?: TerritoryCountryBuildAllReport;
  }
): Promise<CountryDetailStatusEntry> {
  const buildResult = context.buildReport?.results.find(
    (result) => result.country === country.iso2
  );

  if (buildResult) {
    if (buildResult.outcome === "built") {
      const artifact = await readCountryDetailArtifact(country, context);

      if (artifact) {
        return artifact;
      }
    }

    return {
      status: mapBuildOutcomeToCountryDetailStatus(buildResult.outcome),
      ...(buildResult.outputPath ? { artifactPath: buildResult.outputPath } : {}),
      ...(buildResult.issues[0]?.message ? { reason: buildResult.issues[0].message } : {})
    };
  }

  const artifact = await readCountryDetailArtifact(country, context);

  if (artifact) {
    return artifact;
  }

  return { status: "source-available-not-built" };
}

async function readCountryDetailArtifact(
  country: { iso2: string },
  context: {
    cwd: string;
    countryArtifactRoots: readonly string[];
  }
): Promise<CountryDetailStatusEntry | undefined> {
  for (const root of context.countryArtifactRoots) {
    const artifactRoot = join(root, country.iso2);
    const datasetPath = join(artifactRoot, "levels", "ADM0", "dataset.json");

    if (!(await pathExists(datasetPath))) {
      continue;
    }

    try {
      const dataset = JSON.parse(await readFile(datasetPath, "utf8")) as TerritoryDataset;
      return {
        status: "built",
        artifactPath: toPortablePath(artifactRoot, context.cwd),
        featureCount: dataset.zones.length
      };
    } catch (error) {
      return {
        status: "validation-failed",
        artifactPath: toPortablePath(artifactRoot, context.cwd),
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return undefined;
}

function mapBuildOutcomeToCountryDetailStatus(
  outcome: TerritoryCountryBuildAllOutcome
): GlobalAdminAdm0CountryDetailStatus {
  switch (outcome) {
    case "built":
      return "built";
    case "licence-restricted":
      return "licence-restricted";
    case "performance-deferred":
      return "performance-deferred";
    case "provider-error":
    case "mapping-review-required":
      return "provider-error";
    case "validation-failed":
      return "validation-failed";
    case "source-unavailable":
      return "source-unavailable";
  }
}

function createUnmatchedReport(input: {
  generatedAt: string;
  coverage: GlobalAdminAdm0CoverageReport;
  unmatchedIso: Array<{ iso2: string }>;
  nonIsoSource: Array<Record<string, string>>;
}): GlobalAdminAdm0UnmatchedReport {
  const byDetailStatus = (status: GlobalAdminAdm0CountryDetailStatus) =>
    input.coverage.countries
      .filter((country) => country.countryDetailStatus === status)
      .map((country) => country.iso2)
      .sort();

  return {
    reportVersion: "1",
    generatedAt: input.generatedAt,
    sourceEntitiesWithoutIsoMapping: input.nonIsoSource,
    isoEntriesWithoutSourceGeometry: input.unmatchedIso.map((country) => country.iso2).sort(),
    countryDetailBuiltIsoEntities: byDetailStatus("built"),
    countryDetailSourceAvailableNotBuiltIsoEntities: byDetailStatus("source-available-not-built"),
    countryDetailSourceUnavailableIsoEntities: byDetailStatus("source-unavailable"),
    countryDetailPerformanceDeferredIsoEntities: byDetailStatus("performance-deferred")
  };
}

function extractNonIsoSourceEntities(
  input: unknown,
  isoCodes: ReadonlySet<string>
): Array<Record<string, string>> {
  if (!isRecord(input) || !Array.isArray(input.features)) {
    return [];
  }

  return input.features.flatMap((feature, index) => {
    if (!isRecord(feature) || !isRecord(feature.properties)) {
      return [];
    }

    const properties = feature.properties;
    const iso2 = readString(properties.ISO_A2) ?? readString(properties.ISO_A2_EH);
    const sourceCode =
      readString(properties.ADM0_A3) ??
      readString(properties.ISO_A3) ??
      readString(properties.SOV_A3) ??
      readString(properties.BRK_A3);

    if (!sourceCode || sourceCode === "-99") {
      return [];
    }

    if (iso2 && iso2 !== "-99" && isoCodes.has(iso2.toUpperCase())) {
      return [];
    }

    return [
      {
        sourceCode,
        name:
          readString(properties.NAME) ??
          readString(properties.ADMIN) ??
          readString(properties.SOVEREIGNT) ??
          sourceCode,
        featureIndex: String(index)
      }
    ];
  });
}

function datasetToFeatureCollection(dataset: TerritoryDataset): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    features: dataset.zones
      .filter((zone) => zone.sourceAdminLevel === "ADM0")
      .map((zone) => ({
        type: "Feature",
        id: zone.id,
        properties: {
          ...zone.properties,
          id: zone.id,
          name: zone.name,
          localName: zone.localName,
          countryCode: zone.countryCode,
          level: zone.level,
          sourceAdminLevel: zone.sourceAdminLevel,
          semanticType: zone.semanticType,
          parentId: zone.parentId,
          childIds: zone.childIds ?? [],
          neighborIds: zone.neighborIds
        },
        geometry: zone.geometry
      }))
  };
}

function createSpatialIndex(dataset: TerritoryDataset): Record<string, unknown> {
  return {
    indexVersion: "1",
    algorithm: "bbox-linear",
    datasetId: dataset.manifest.datasetId,
    datasetVersion: dataset.manifest.datasetVersion,
    geometryHash: dataset.manifest.geometryHash,
    entries: dataset.zones.map((zone) => ({
      id: zone.id,
      level: zone.level,
      sourceAdminLevel: zone.sourceAdminLevel,
      countryCode: zone.countryCode,
      bbox: zone.bbox,
      center: zone.center
    }))
  };
}

function smokeGlobalAdm0Dataset(dataset: TerritoryDataset): GlobalAdminSmokeReport {
  const engine = createTerritoryEngine({ dataset });
  const checks: GlobalAdminSmokeReport["checks"] = [];
  const datasetRoundTrip = validateTerritoryDataset(JSON.parse(serializeJsonArtifact(dataset)));
  const spatialIndex = createSpatialIndex(dataset);

  checks.push({
    name: "dataset loading",
    ok: datasetRoundTrip.ok,
    expected: "valid dataset",
    actual: datasetRoundTrip.ok ? "valid dataset" : "invalid dataset"
  });
  checks.push({
    name: "spatial index loading",
    ok: Array.isArray(spatialIndex.entries) && spatialIndex.entries.length === dataset.zones.length,
    expected: dataset.zones.length,
    actual: Array.isArray(spatialIndex.entries) ? spatialIndex.entries.length : null
  });

  for (const sample of GLOBAL_ADM0_SMOKE_SAMPLES) {
    const zone = dataset.zones.find((candidate) => candidate.countryCode === sample.country);
    const located = engine.latLngToZone(sample.coordinate, { level: 1 });
    const locatedOk = located === zone?.id;
    checks.push({
      name: `latLngToZone:${sample.name}`,
      ok: locatedOk,
      expected: sample.country,
      actual: located ?? "source-overview-coordinate-miss",
      blocking: zone ? locatedOk : true
    });

    if (!zone) {
      checks.push({
        name: `zoneToBoundary:${sample.name}`,
        ok: false,
        expected: "Polygon|MultiPolygon",
        actual: null
      });
      checks.push({
        name: `zoneToParent:${sample.name}`,
        ok: false,
        expected: GLOBAL_ADMIN_WORLD_ID,
        actual: null
      });
      continue;
    }

    if (!locatedOk) {
      const representative = { lng: zone.center[0], lat: zone.center[1] };
      checks.push({
        name: `representativePoint:${sample.name}`,
        ok: engine.latLngToZone(representative, { level: 1 }) === zone.id,
        expected: zone.id,
        actual: engine.latLngToZone(representative, { level: 1 })
      });
    }

    const boundary = engine.zoneToBoundary(zone.id);
    checks.push({
      name: `zoneToBoundary:${sample.name}`,
      ok: ["Polygon", "MultiPolygon"].includes(boundary.type),
      expected: "Polygon|MultiPolygon",
      actual: boundary.type
    });
    checks.push({
      name: `zoneToParent:${sample.name}`,
      ok: engine.zoneToParent(zone.id) === GLOBAL_ADMIN_WORLD_ID,
      expected: GLOBAL_ADMIN_WORLD_ID,
      actual: engine.zoneToParent(zone.id)
    });
  }

  const boundsHits = engine.getZonesInBounds({
    west: -10,
    south: 35,
    east: 40,
    north: 60,
    level: 1
  });
  checks.push({
    name: "getZonesInBounds:europe",
    ok: boundsHits.length > 0,
    expected: "positive",
    actual: boundsHits.length
  });

  return {
    ok: checks.every((check) => check.ok || check.blocking === false),
    checks
  };
}

async function readOptionalBuildReport(
  cwd: string,
  buildReportPath: string | undefined
): Promise<TerritoryCountryBuildAllReport | undefined> {
  const candidates = [
    ...(buildReportPath ? [resolve(cwd, buildReportPath)] : []),
    resolve(cwd, "reports/global-adm0-build-all.json")
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return JSON.parse(await readFile(candidate, "utf8")) as TerritoryCountryBuildAllReport;
    }
  }

  return undefined;
}

function serializeJsonArtifact(input: unknown): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

function readString(input: unknown): string | undefined {
  if (typeof input === "string" && input.length > 0) {
    return input;
  }

  if (typeof input === "number" && Number.isFinite(input)) {
    return String(input);
  }

  return undefined;
}

function toPortablePath(path: string, cwd: string): string {
  const portable = relative(cwd, path);
  return portable && !portable.startsWith("..") ? portable : path;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
