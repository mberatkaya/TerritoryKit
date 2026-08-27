import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  computeGeometryBBox,
  createTerritoryGlobalId,
  slugifyTerritoryIdPart,
  validateGeometryDataset
} from "@territory-kit/dataset";
import type {
  GeometryQualityIssue,
  LngLat,
  TerritoryAdminLevel,
  TerritoryBoundarySourceClass,
  TerritoryDataset,
  TerritoryGeometry,
  TerritoryLicenseState,
  TerritorySemanticAdminType,
  TerritoryZone
} from "@territory-kit/dataset";
import { computeGeometryRepresentativePoint } from "./geometry-repair.js";
import type {
  BuiltCountryZone,
  ParsedCountryFeature,
  TerritoryCountryBuildIssue,
  TerritoryCountrySourceLockLevel
} from "./countries/types.js";
import {
  TURKEY_GAZIANTEP_ADM3_ATTRIBUTION,
  TURKEY_GAZIANTEP_ADM3_DOWNLOAD_URL,
  TURKEY_GAZIANTEP_ADM3_LICENSE_URL,
  TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS,
  TURKEY_GAZIANTEP_ADM3_RETRIEVED_AT,
  TURKEY_GAZIANTEP_ADM3_SOURCE_DATE,
  TURKEY_GAZIANTEP_ADM3_SOURCE_SHA256,
  TURKEY_GAZIANTEP_ADM3_SOURCE_SIZE_BYTES,
  TURKEY_GAZIANTEP_ADM3_SOURCE_URL
} from "./turkey-adm3-pilot.js";
import {
  isRecord,
  readStringPropertyPath,
  serializeJsonStable,
  sha256Hex
} from "./sources/utils.js";
import {
  TURKEY_ADM3_IMPORTER_VERSION,
  defaultTurkeyAdm3AdapterForFormat,
  isSupportedTurkeyAdm3Adapter,
  isSupportedTurkeyAdm3Crs,
  isSupportedTurkeyAdm3SourceFormat,
  normalizeTurkeyAdm3SourceFormat,
  parseTurkeyAdm3ProviderSource
} from "./turkey-adm3-adapters.js";
import type {
  TurkeyAdm3AdapterParseReport,
  TurkeyAdm3ProviderAdapterConfig,
  TurkeyAdm3ProviderAdapterId,
  TurkeyAdm3SourceFormat
} from "./turkey-adm3-adapters.js";

export const TURKEY_ADM3_SOURCE_CATALOG_SCHEMA_VERSION = "territorykit-tr-adm3-source-catalog@1";
export const TURKEY_ADM3_SOURCE_REGISTRY_SCHEMA_VERSION = "territorykit-tr-adm3-source-registry@1";
export const TURKEY_ADM3_SOURCE_LOCK_SCHEMA_VERSION = "territorykit-tr-adm3-source-lock@1";
export const TURKEY_ADM3_COVERAGE_SCHEMA_VERSION = "territorykit-tr-adm3-coverage@1";
export const TURKEY_ADM3_QUALITY_SCHEMA_VERSION = "territorykit-tr-adm3-quality@1";
export const TURKEY_ADM3_PROVENANCE_SCHEMA_VERSION = "territorykit-tr-adm3-provenance@1";
export const TURKEY_ADM3_IMPORT_REPORT_SCHEMA_VERSION = "territorykit-tr-adm3-import-report@1";
export const TURKEY_ADM3_UNRESOLVED_REPORT_SCHEMA_VERSION =
  "territorykit-tr-adm3-unresolved-report@1";

const TURKEY_BBOX: [west: number, south: number, east: number, north: number] = [25, 35, 46, 43];
export type TurkeyAdm3ProvinceBuildStatus =
  | "available"
  | "source-unavailable"
  | "license-blocked"
  | "checksum-failed"
  | "byte-size-failed"
  | "parse-failed"
  | "build-failed"
  | "built"
  | "built-with-warnings"
  | "fallback-adm2";

export interface TurkeyAdm3SourceCatalog {
  schemaVersion: typeof TURKEY_ADM3_SOURCE_CATALOG_SCHEMA_VERSION;
  country: "TR";
  generatedAt?: string;
  provinces: Record<string, TurkeyAdm3ProvinceCatalogEntry>;
}

export interface TurkeyAdm3ProvinceCatalogEntry {
  provinceCode: string;
  provinceName: string;
  providerId: string;
  providerName: string;
  sourceId: string;
  sourceUrl: string;
  downloadUrl?: string;
  sourcePath?: string;
  sourceDate: string;
  sourceVersion?: string;
  retrievedAt?: string;
  license: string;
  licenseState?: TerritoryLicenseState;
  licenseUrl?: string;
  attribution: string;
  boundarySourceClass?: TerritoryBoundarySourceClass;
  redistributionStatus: "allowed" | "restricted" | "unknown";
  commercialUseStatus?: "allowed" | "restricted" | "unknown";
  modificationStatus?: "allowed" | "restricted" | "unknown";
  crs: string;
  format: TurkeyAdm3SourceFormat;
  expectedSha256?: string;
  expectedByteSize?: number;
  expectedFeatureCount?: number;
  adapter: TurkeyAdm3ProviderAdapterConfig;
  registryEntryId?: string;
  productionEligible?: boolean;
  sourceRegistryStatus?: string;
  sourceLifecycle?: string;
  sourceAccessType?: string;
  evidenceUrls?: string[];
  authorityType?: string;
  datasetIdentifier?: string;
  notes?: string[];
}

export interface TurkeyAdm3SourceLockExtension {
  schemaVersion: typeof TURKEY_ADM3_SOURCE_LOCK_SCHEMA_VERSION;
  catalogHash: string;
  requestedProvinceCodes: string[];
  generatedAt: string;
  provinces: Record<string, TurkeyAdm3ProvinceSourceLock>;
  summary: {
    requestedProvinceCount: number;
    availableProvinceCount: number;
    unavailableProvinceCount: number;
    blockedProvinceCount: number;
    sourceFeatureCount: number;
    sourceBytes: number;
    coverageStatus: "partial" | "source-unavailable";
  };
}

export interface TurkeyAdm3ProvinceSourceLock {
  provinceCode: string;
  provinceName: string;
  status: Exclude<TurkeyAdm3ProvinceBuildStatus, "built" | "built-with-warnings" | "fallback-adm2">;
  providerId?: string;
  providerName?: string;
  sourceId?: string;
  sourceUrl?: string;
  resolvedDownloadUrl?: string;
  sourcePath?: string;
  sourceDate?: string;
  sourceVersion?: string;
  retrievedAt?: string;
  license?: string;
  licenseState?: TerritoryLicenseState;
  licenseUrl?: string;
  attribution?: string;
  boundarySourceClass?: TerritoryBoundarySourceClass;
  redistributionStatus?: string;
  commercialUseStatus?: string;
  modificationStatus?: string;
  crs?: string;
  format?: string;
  sha256?: string;
  sourceSnapshotChecksum?: string;
  sizeBytes?: number;
  sourceFeatureCount?: number;
  adapter?: TurkeyAdm3ProviderAdapterConfig;
  registryEntryId?: string;
  productionEligible?: boolean;
  sourceRegistryStatus?: string;
  sourceLifecycle?: string;
  sourceAccessType?: string;
  evidenceUrls?: string[];
  authorityType?: string;
  datasetIdentifier?: string;
  importerVersion?: typeof TURKEY_ADM3_IMPORTER_VERSION;
  unavailableReason?: string;
  issues?: TerritoryCountryBuildIssue[];
}

export interface TurkeyAdm3AcquireSource {
  (
    source: {
      provider: string;
      sourceUrl: string;
      expectedSha256?: string;
      sourceVersion?: string;
    },
    options: {
      cwd: string;
      buildDate?: string;
      cacheDir?: string;
      noCache?: boolean;
      refresh?: boolean;
      maxSourceBytes?: number;
    }
  ): Promise<{
    localPath: string;
    sha256: string;
    sizeBytes: number;
    sourcePath?: string;
    originalUrl?: string;
  }>;
}

export interface TurkeyAdm3SourceLockCreateOptions {
  catalogPath?: string;
  registryPath?: string;
  provinceCodes: readonly string[];
  generatedAt: string;
  cwd: string;
  buildDate?: string;
  cacheDir?: string;
  noCache?: boolean;
  refresh?: boolean;
  maxSourceBytes?: number;
  acquireSource: TurkeyAdm3AcquireSource;
}

export interface TurkeyAdm3ParsedFeature extends ParsedCountryFeature {
  provinceCode: string;
  provinceName: string;
  providerId: string;
  parentAdm2Id?: string;
}

export interface TurkeyAdm3ParsedSourceResult {
  features: TurkeyAdm3ParsedFeature[];
  issues: TerritoryCountryBuildIssue[];
  sourceBytes: number;
  sourceDates: Record<string, string>;
  provinceStatuses: Record<string, TurkeyAdm3ProvinceBuildStatus>;
  qualityReport: TurkeyAdm3QualityGateReport;
  provenance: TurkeyAdm3ProvenanceReport;
  importReport: TurkeyAdm3ImportReport;
  unresolvedReport: TurkeyAdm3UnresolvedReport;
}

export interface TurkeyAdm3LoadOptions {
  extension: TurkeyAdm3SourceLockExtension;
  allowPartial?: boolean;
  cwd: string;
  buildDate: string;
  cacheDir?: string;
  noCache?: boolean;
  refresh?: boolean;
  acquireSource: TurkeyAdm3AcquireSource;
}

export interface TurkeyAdm3SourceRegistry {
  schemaVersion: typeof TURKEY_ADM3_SOURCE_REGISTRY_SCHEMA_VERSION;
  country: "TR";
  level: "ADM3";
  generatedAt: string;
  provinces: TurkeyAdm3SourceRegistryProvince[];
}

export interface TurkeyAdm3SourceRegistryProvince {
  code: string;
  name: string;
  status: string;
  sources: TurkeyAdm3SourceRegistrySource[];
}

export interface TurkeyAdm3SourceRegistrySource {
  id: string;
  sourceId: string;
  provider: {
    name: string;
    authorityType: string;
    class: string;
  };
  boundarySourceClass: TerritoryBoundarySourceClass;
  access: {
    type: string;
    formats: string[];
    geometryAvailable: true | false | "unknown";
    urls: Record<string, string>;
  };
  license: {
    state: string;
    redistribution: string;
    commercialUse: string;
    modification: string;
    name: string;
  };
  lifecycle: string;
  productionEligible: boolean;
  sourceDate: string | null;
  fields: {
    nameField?: string | null;
    sourceNativeIdField?: string | null;
    districtParentField?: string | null;
  };
  verification?: {
    checkedAt?: string;
    evidenceUrls?: string[];
    featureCount?: number | null;
    sourceDate?: string | null;
    expectedByteSize?: number;
    expectedSha256?: string;
  };
  notes?: string[];
}

export interface TurkeyAdm3CoverageManifest {
  schemaVersion: typeof TURKEY_ADM3_COVERAGE_SCHEMA_VERSION;
  country: "TR";
  level: "ADM3";
  coverageStatus: "partial" | "source-unavailable";
  generatedAt: string;
  nationalCoverageClaim: false;
  allowPartial: boolean;
  featureCount: number;
  coveredProvinceCount: number;
  requestedProvinceCount: number;
  provinces: Record<
    string,
    {
      provinceCode: string;
      provinceName: string;
      status: TurkeyAdm3ProvinceBuildStatus;
      featureCount: number;
      providerId?: string;
      providerName?: string;
      sourceId?: string;
      sourceDate?: string;
      sourceVersion?: string;
      license?: string;
      licenseUrl?: string;
      attribution?: string;
      checksum?: string;
      byteSize?: number;
      fallbackLevel: "ADM2";
      reasonCode:
        | "official-local-source-built"
        | "source-unavailable"
        | "license-blocked"
        | "checksum-failed"
        | "build-failed";
      fallbackReason?: string;
      parentAdm2Ids: string[];
      adm2: Record<
        string,
        {
          adm2Id: string;
          status: "official-local" | "unavailable" | "failed";
          reasonCode:
            | "official-local-source-built"
            | "source-unavailable"
            | "license-blocked"
            | "checksum-failed"
            | "build-failed";
          featureCount: number;
        }
      >;
    }
  >;
}

export interface TurkeyAdm3QualityGateReport {
  schemaVersion: typeof TURKEY_ADM3_QUALITY_SCHEMA_VERSION;
  country: "TR";
  level: "ADM3";
  generatedAt: string;
  ok: boolean;
  summary: {
    errorCount: number;
    warningCount: number;
    checkedFeatureCount: number;
    duplicateGeometryCount: number;
    excessiveOverlapCount: number;
    suspiciousAreaCount: number;
    coordinateIssueCount: number;
    blockerCount: number;
  };
  issues: TerritoryCountryBuildIssue[];
}

export interface TurkeyAdm3ProvenanceReport {
  schemaVersion: typeof TURKEY_ADM3_PROVENANCE_SCHEMA_VERSION;
  country: "TR";
  level: "ADM3";
  generatedAt: string;
  sources: Array<{
    provinceCode: string;
    provinceName: string;
    providerId?: string;
    providerName?: string;
    sourceId?: string;
    sourceUrl?: string;
    sourceDate?: string;
    sourceVersion?: string;
    retrievedAt?: string;
    license?: string;
    licenseUrl?: string;
    attribution?: string;
    sha256?: string;
    sizeBytes?: number;
    sourceFeatureCount?: number;
    registryEntryId?: string;
    productionEligible?: boolean;
    sourceRegistryStatus?: string;
    sourceLifecycle?: string;
    sourceAccessType?: string;
    evidenceUrls?: string[];
    authorityType?: string;
    datasetIdentifier?: string;
    importerVersion?: string;
    adapterId?: TurkeyAdm3ProviderAdapterId;
    status: TurkeyAdm3ProvinceBuildStatus;
  }>;
}

export interface TurkeyAdm3ImportReport {
  schemaVersion: typeof TURKEY_ADM3_IMPORT_REPORT_SCHEMA_VERSION;
  country: "TR";
  level: "ADM3";
  generatedAt: string;
  importerVersion: typeof TURKEY_ADM3_IMPORTER_VERSION;
  summary: {
    requestedProvinceCount: number;
    sourceCount: number;
    featureCount: number;
    parsedCount: number;
    acceptedCount: number;
    rejectedCount: number;
    unresolvedCount: number;
    duplicateIdCount: number;
    duplicateNameCount: number;
  };
  sources: Array<{
    provinceCode: string;
    provinceName: string;
    providerId?: string;
    providerName?: string;
    sourceId?: string;
    registryEntryId?: string;
    status: TurkeyAdm3ProvinceBuildStatus;
    adapterId?: TurkeyAdm3ProviderAdapterId;
    format?: string;
    transportType?: string;
    sourceUrl?: string;
    sha256?: string;
    sizeBytes?: number;
    sourceFeatureCount?: number;
    parsedCount: number;
    acceptedCount: number;
    rejectedCount: number;
    unresolvedCount: number;
    duplicateIds: string[];
    duplicateNames: Array<{ name: string; parent: string; count: number }>;
    geometryTypeDistribution: Record<string, number>;
    crsHandling?: TurkeyAdm3AdapterParseReport["crsHandling"];
    parentMatching: {
      mappedParentCount: number;
      rawParentCount: number;
      missingParentCount: number;
    };
  }>;
}

export interface TurkeyAdm3UnresolvedReport {
  schemaVersion: typeof TURKEY_ADM3_UNRESOLVED_REPORT_SCHEMA_VERSION;
  country: "TR";
  level: "ADM3";
  generatedAt: string;
  summary: {
    unresolvedCount: number;
    unknownDistrictCount: number;
    ambiguousParentCount: number;
    missingSourceIdCount: number;
    missingRequiredFieldCount: number;
    unsupportedGeometryCount: number;
    unknownCrsCount: number;
    licenseBlockCount: number;
  };
  records: Array<{
    provinceCode?: string;
    providerId?: string;
    featureId?: string;
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
  }>;
}

export function createDefaultTurkeyAdm3SourceCatalog(): TurkeyAdm3SourceCatalog {
  return {
    schemaVersion: TURKEY_ADM3_SOURCE_CATALOG_SCHEMA_VERSION,
    country: "TR",
    provinces: {
      "27": {
        provinceCode: "27",
        provinceName: "Gaziantep",
        providerId: "gaziantep-open-data",
        providerName: "Gaziantep Büyükşehir Belediyesi Open Data",
        sourceId: "gaziantep-mahalle-sinir-alanlari",
        sourceUrl: TURKEY_GAZIANTEP_ADM3_SOURCE_URL,
        downloadUrl: TURKEY_GAZIANTEP_ADM3_DOWNLOAD_URL,
        sourceDate: TURKEY_GAZIANTEP_ADM3_SOURCE_DATE,
        sourceVersion: TURKEY_GAZIANTEP_ADM3_SOURCE_DATE,
        retrievedAt: TURKEY_GAZIANTEP_ADM3_RETRIEVED_AT,
        license: "CC BY 4.0",
        licenseState: "approved",
        licenseUrl: TURKEY_GAZIANTEP_ADM3_LICENSE_URL,
        attribution: TURKEY_GAZIANTEP_ADM3_ATTRIBUTION,
        boundarySourceClass: "official-local",
        redistributionStatus: "allowed",
        commercialUseStatus: "allowed",
        modificationStatus: "allowed",
        crs: "EPSG:4326",
        format: "KML",
        expectedSha256: TURKEY_GAZIANTEP_ADM3_SOURCE_SHA256,
        expectedByteSize: TURKEY_GAZIANTEP_ADM3_SOURCE_SIZE_BYTES,
        expectedFeatureCount: 786,
        adapter: {
          id: "kml-description-table",
          nameField: "AD",
          sourceIdField: "KIMLIKNO",
          parentField: "ILCEID",
          defaultSemanticType: "neighbourhood",
          defaultLocalType: "Mahalle",
          parentMappings: Object.fromEntries(
            TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS.map((mapping) => [
              mapping.sourceDistrictId,
              mapping.territoryAdm2Id
            ])
          )
        },
        notes: [
          "Partial province source. This catalog entry does not claim nationwide ADM3 coverage."
        ]
      }
    }
  };
}

export async function readTurkeyAdm3SourceCatalog(
  options: {
    catalogPath?: string;
    registryPath?: string;
    cwd?: string;
  } = {}
): Promise<TurkeyAdm3SourceCatalog> {
  const catalogPath = options.catalogPath ?? "datasets/sources/TR/adm3-catalog.json";

  if (!options.catalogPath && !options.registryPath) {
    try {
      return await readTurkeyAdm3CatalogFromRegistry({
        registryPath: "datasets/sources/TR/adm3/source-registry.json",
        catalogPath,
        ...(options.cwd ? { cwd: options.cwd } : {})
      });
    } catch (error) {
      const missing =
        error instanceof Error &&
        ("code" in error
          ? (error as NodeJS.ErrnoException).code === "ENOENT"
          : error.message.includes("ENOENT"));

      if (!missing) {
        throw error;
      }
    }

    return createDefaultTurkeyAdm3SourceCatalog();
  }

  if (options.registryPath) {
    return readTurkeyAdm3CatalogFromRegistry({
      registryPath: options.registryPath,
      catalogPath,
      ...(options.cwd ? { cwd: options.cwd } : {})
    });
  }

  const input = JSON.parse(
    await readFile(resolve(options.cwd ?? process.cwd(), catalogPath), "utf8")
  ) as unknown;
  const result = validateTurkeyAdm3SourceCatalog(input);

  if (
    !isRecord(input) ||
    input.schemaVersion !== TURKEY_ADM3_SOURCE_CATALOG_SCHEMA_VERSION ||
    input.country !== "TR" ||
    !isRecord(input.provinces)
  ) {
    throw new Error(
      `Turkey ADM3 source catalog is invalid: ${result.issues
        .map((issue) => issue.message)
        .join("; ")}`
    );
  }

  return input as unknown as TurkeyAdm3SourceCatalog;
}

export async function readTurkeyAdm3SourceRegistry(
  options: {
    registryPath?: string;
    cwd?: string;
  } = {}
): Promise<TurkeyAdm3SourceRegistry> {
  const registryPath = options.registryPath ?? "datasets/sources/TR/adm3/source-registry.json";
  const input = JSON.parse(
    await readFile(resolve(options.cwd ?? process.cwd(), registryPath), "utf8")
  ) as unknown;

  if (
    !isRecord(input) ||
    input.schemaVersion !== TURKEY_ADM3_SOURCE_REGISTRY_SCHEMA_VERSION ||
    input.country !== "TR" ||
    input.level !== "ADM3" ||
    !Array.isArray(input.provinces)
  ) {
    throw new Error("Turkey ADM3 source registry is invalid.");
  }

  return input as unknown as TurkeyAdm3SourceRegistry;
}

async function readTurkeyAdm3CatalogFromRegistry(options: {
  registryPath: string;
  catalogPath: string;
  cwd?: string;
}): Promise<TurkeyAdm3SourceCatalog> {
  const cwd = options.cwd ?? process.cwd();
  const registry = await readTurkeyAdm3SourceRegistry({
    registryPath: options.registryPath,
    cwd
  });
  const technicalCatalog = await readTurkeyAdm3TechnicalCatalog({
    catalogPath: options.catalogPath,
    cwd
  }).catch(() => createDefaultTurkeyAdm3SourceCatalog());
  const technicalEntries = Object.values(technicalCatalog.provinces);
  const provinces = Object.fromEntries(
    registry.provinces
      .map((province) => {
        const source = selectRegistrySourceForProvince(province);

        if (!source) {
          return undefined;
        }

        const technical = findTechnicalCatalogEntry(province.code, source, technicalEntries);
        const entry = createCatalogEntryFromRegistry(province, source, technical);

        return [normalizeProvinceCode(province.code), entry] as const;
      })
      .filter((entry): entry is readonly [string, TurkeyAdm3ProvinceCatalogEntry] => Boolean(entry))
      .sort(([left], [right]) => left.localeCompare(right))
  );

  return {
    schemaVersion: TURKEY_ADM3_SOURCE_CATALOG_SCHEMA_VERSION,
    country: "TR",
    generatedAt: registry.generatedAt,
    provinces
  };
}

async function readTurkeyAdm3TechnicalCatalog(options: {
  catalogPath: string;
  cwd: string;
}): Promise<TurkeyAdm3SourceCatalog> {
  const input = JSON.parse(
    await readFile(resolve(options.cwd, options.catalogPath), "utf8")
  ) as unknown;

  if (
    !isRecord(input) ||
    input.schemaVersion !== TURKEY_ADM3_SOURCE_CATALOG_SCHEMA_VERSION ||
    input.country !== "TR" ||
    !isRecord(input.provinces)
  ) {
    throw new Error("Turkey ADM3 technical source catalog is invalid.");
  }

  return input as unknown as TurkeyAdm3SourceCatalog;
}

function selectRegistrySourceForProvince(
  province: TurkeyAdm3SourceRegistryProvince
): TurkeyAdm3SourceRegistrySource | undefined {
  return (
    [...province.sources]
      .sort(compareRegistrySources)
      .find((source) => isRegistrySourceOfficial(source)) ??
    [...province.sources].sort(compareRegistrySources)[0]
  );
}

function compareRegistrySources(
  left: TurkeyAdm3SourceRegistrySource,
  right: TurkeyAdm3SourceRegistrySource
): number {
  return registrySourceRank(left) - registrySourceRank(right) || left.id.localeCompare(right.id);
}

function registrySourceRank(source: TurkeyAdm3SourceRegistrySource): number {
  if (isRegistrySourceApprovedForProduction(source)) {
    return 0;
  }

  if (isRegistrySourceOfficial(source)) {
    return 1;
  }

  return 2;
}

function isRegistrySourceOfficial(source: TurkeyAdm3SourceRegistrySource): boolean {
  return (
    source.boundarySourceClass === "official-local" ||
    source.boundarySourceClass === "official-national"
  );
}

function isRegistrySourceApprovedForProduction(source: TurkeyAdm3SourceRegistrySource): boolean {
  return (
    source.productionEligible === true &&
    source.lifecycle === "approved" &&
    source.license.state === "approved" &&
    source.license.redistribution === "allowed" &&
    source.access.geometryAvailable === true &&
    (source.access.type === "public-download" || source.access.type === "public-api") &&
    isRegistrySourceOfficial(source)
  );
}

function findTechnicalCatalogEntry(
  provinceCode: string,
  source: TurkeyAdm3SourceRegistrySource,
  entries: readonly TurkeyAdm3ProvinceCatalogEntry[]
): TurkeyAdm3ProvinceCatalogEntry | undefined {
  const normalizedProvinceCode = normalizeProvinceCode(provinceCode);
  const sourceUrls = new Set(
    [source.access.urls.dataset, source.access.urls.download, source.access.urls.service].filter(
      (value): value is string => Boolean(value)
    )
  );

  return entries.find((entry) => {
    if (normalizeProvinceCode(entry.provinceCode) !== normalizedProvinceCode) {
      return false;
    }

    return (
      entry.registryEntryId === source.id ||
      entry.providerId === source.id ||
      entry.sourceId === source.sourceId ||
      sourceUrls.has(entry.sourceUrl) ||
      Boolean(entry.downloadUrl && sourceUrls.has(entry.downloadUrl))
    );
  });
}

function createCatalogEntryFromRegistry(
  province: TurkeyAdm3SourceRegistryProvince,
  source: TurkeyAdm3SourceRegistrySource,
  technical: TurkeyAdm3ProvinceCatalogEntry | undefined
): TurkeyAdm3ProvinceCatalogEntry {
  const format =
    normalizeTurkeyAdm3SourceFormat(source.access.formats[0] ?? technical?.format ?? "JSON") ??
    "JSON";
  const adapter =
    technical?.adapter ??
    createAdapterConfigFromRegistrySource(source, format) ??
    ({
      id: defaultTurkeyAdm3AdapterForFormat(format) ?? "json-feature-map",
      defaultSemanticType: "neighbourhood",
      defaultLocalType: "Mahalle"
    } satisfies TurkeyAdm3ProviderAdapterConfig);
  const verificationSourceDate = source.verification?.sourceDate ?? undefined;
  const sourceDate =
    source.sourceDate ?? verificationSourceDate ?? technical?.sourceDate ?? "unknown";
  const evidenceUrls = [
    ...(source.verification?.evidenceUrls ?? []),
    ...(technical?.evidenceUrls ?? [])
  ].sort();
  const sourceUrl =
    source.access.urls.dataset ?? technical?.sourceUrl ?? `registry://TR/ADM3/${source.id}`;
  const downloadUrl = source.access.urls.download ?? technical?.downloadUrl;
  const sourceVersion = technical?.sourceVersion ?? sourceDate;
  const retrievedAt = source.verification?.checkedAt ?? technical?.retrievedAt;
  const licenseUrl = source.access.urls.license ?? technical?.licenseUrl;
  const expectedSha256 = technical?.expectedSha256 ?? source.verification?.expectedSha256;
  const expectedByteSize = technical?.expectedByteSize ?? source.verification?.expectedByteSize;
  const registryFeatureCount = source.verification?.featureCount ?? undefined;
  const expectedFeatureCount = technical?.expectedFeatureCount ?? registryFeatureCount;

  return {
    provinceCode: normalizeProvinceCode(province.code),
    provinceName: province.name,
    providerId: source.id,
    providerName: source.provider.name,
    sourceId: source.sourceId,
    sourceUrl,
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(technical?.sourcePath ? { sourcePath: technical.sourcePath } : {}),
    sourceDate,
    sourceVersion,
    ...(retrievedAt ? { retrievedAt } : {}),
    license: source.license.name,
    licenseState: mapRegistryLicenseState(source.license.state),
    ...(licenseUrl ? { licenseUrl } : {}),
    attribution: technical?.attribution ?? `${source.provider.name}, ${source.sourceId}`,
    boundarySourceClass: source.boundarySourceClass,
    redistributionStatus: mapRegistryPermission(source.license.redistribution),
    commercialUseStatus: mapRegistryPermission(source.license.commercialUse),
    modificationStatus: mapRegistryPermission(source.license.modification),
    crs: technical?.crs ?? "unknown",
    format,
    ...(expectedSha256 ? { expectedSha256 } : {}),
    ...(expectedByteSize !== undefined ? { expectedByteSize } : {}),
    ...(expectedFeatureCount !== undefined ? { expectedFeatureCount } : {}),
    adapter,
    registryEntryId: source.id,
    productionEligible: isRegistrySourceApprovedForProduction(source),
    sourceRegistryStatus: province.status,
    sourceLifecycle: source.lifecycle,
    sourceAccessType: source.access.type,
    ...(evidenceUrls.length > 0 ? { evidenceUrls } : {}),
    authorityType: source.provider.authorityType,
    datasetIdentifier: source.sourceId,
    notes: [...(source.notes ?? []), ...(technical?.notes ?? [])].sort()
  };
}

function createAdapterConfigFromRegistrySource(
  source: TurkeyAdm3SourceRegistrySource,
  format: TurkeyAdm3SourceFormat
): TurkeyAdm3ProviderAdapterConfig | undefined {
  const id = defaultTurkeyAdm3AdapterForFormat(format);

  if (!id) {
    return undefined;
  }

  return {
    id,
    ...(source.fields.nameField ? { nameProperty: source.fields.nameField } : {}),
    ...(source.fields.sourceNativeIdField
      ? { sourceIdProperty: source.fields.sourceNativeIdField }
      : {}),
    ...(source.fields.districtParentField
      ? { parentProperty: source.fields.districtParentField }
      : {}),
    defaultSemanticType: "neighbourhood",
    defaultLocalType: "Mahalle"
  };
}

function mapRegistryLicenseState(input: string): TerritoryLicenseState {
  if (input === "approved") {
    return "approved";
  }

  if (input === "restricted") {
    return "restricted";
  }

  if (input === "review-required") {
    return "pending";
  }

  return "unknown";
}

function mapRegistryPermission(input: string): "allowed" | "restricted" | "unknown" {
  if (input === "allowed") {
    return "allowed";
  }

  if (input === "prohibited" || input === "not-allowed" || input === "restricted") {
    return "restricted";
  }

  return "unknown";
}

export function validateTurkeyAdm3SourceCatalog(input: unknown): {
  ok: boolean;
  catalog?: TurkeyAdm3SourceCatalog;
  issues: TerritoryCountryBuildIssue[];
} {
  const issues: TerritoryCountryBuildIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [
        createIssue("TR_ADM3_CATALOG_INVALID", "Turkey ADM3 source catalog must be an object.")
      ]
    };
  }

  if (input.schemaVersion !== TURKEY_ADM3_SOURCE_CATALOG_SCHEMA_VERSION) {
    issues.push(
      createIssue(
        "TR_ADM3_CATALOG_SCHEMA_VERSION",
        `Turkey ADM3 source catalog schemaVersion must be ${TURKEY_ADM3_SOURCE_CATALOG_SCHEMA_VERSION}.`
      )
    );
  }

  if (input.country !== "TR") {
    issues.push(createIssue("TR_ADM3_CATALOG_COUNTRY", "Turkey ADM3 catalog country must be TR."));
  }

  if (!isRecord(input.provinces)) {
    issues.push(
      createIssue("TR_ADM3_CATALOG_PROVINCES", "Turkey ADM3 catalog requires provinces object.")
    );
  } else {
    for (const [provinceCode, entry] of Object.entries(input.provinces)) {
      issues.push(...validateCatalogEntry(provinceCode, entry));
    }
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    ...(issues.every((issue) => issue.severity !== "error")
      ? { catalog: input as unknown as TurkeyAdm3SourceCatalog }
      : {}),
    issues: issues.sort(compareIssues)
  };
}

export async function createTurkeyAdm3SourceLockExtension(
  options: TurkeyAdm3SourceLockCreateOptions
): Promise<{ extension: TurkeyAdm3SourceLockExtension; issues: TerritoryCountryBuildIssue[] }> {
  const catalog = await readTurkeyAdm3SourceCatalog({
    ...(options.catalogPath ? { catalogPath: options.catalogPath } : {}),
    ...(options.registryPath ? { registryPath: options.registryPath } : {}),
    cwd: options.cwd
  });
  const requestedProvinceCodes = normalizeProvinceCodes(options.provinceCodes);
  const issues: TerritoryCountryBuildIssue[] = [];
  const provinces: Record<string, TurkeyAdm3ProvinceSourceLock> = {};

  for (const provinceCode of requestedProvinceCodes) {
    const entry = catalog.provinces[provinceCode];

    if (!entry) {
      issues.push(
        createIssue(
          "TR_ADM3_PROVINCE_SOURCE_NOT_FOUND",
          `No Turkey ADM3 catalog entry exists for province ${provinceCode}.`,
          { severity: "warning" }
        )
      );
      provinces[provinceCode] = {
        provinceCode,
        provinceName: `TR-${provinceCode}`,
        status: "source-unavailable",
        unavailableReason: "No catalog entry exists for this province."
      };
      continue;
    }

    const entryIssues = validateCatalogEntry(provinceCode, entry);
    issues.push(...entryIssues);

    if (entryIssues.some((issue) => issue.severity === "error")) {
      provinces[provinceCode] = createBlockedProvinceLock(entry, entryIssues);
      continue;
    }

    try {
      const artifact = await options.acquireSource(
        {
          provider: entry.providerId,
          sourceUrl: resolveAdm3AcquireUrl(entry),
          ...(entry.expectedSha256 ? { expectedSha256: entry.expectedSha256 } : {}),
          ...(entry.sourceVersion ? { sourceVersion: entry.sourceVersion } : {})
        },
        {
          cwd: options.cwd,
          ...(options.buildDate ? { buildDate: options.buildDate } : {}),
          ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
          ...(options.noCache ? { noCache: true } : {}),
          ...(options.refresh ? { refresh: true } : {}),
          ...(options.maxSourceBytes ? { maxSourceBytes: options.maxSourceBytes } : {})
        }
      );

      if (entry.expectedByteSize !== undefined && artifact.sizeBytes !== entry.expectedByteSize) {
        const issue = createIssue(
          "TR_ADM3_SOURCE_BYTE_SIZE_MISMATCH",
          `Province ${provinceCode} source byte size mismatch: expected ${entry.expectedByteSize}, received ${artifact.sizeBytes}.`
        );
        issues.push(issue);
        provinces[provinceCode] = {
          ...createProvinceLock(entry),
          status: "byte-size-failed",
          sha256: artifact.sha256,
          sourceSnapshotChecksum: artifact.sha256,
          sizeBytes: artifact.sizeBytes,
          ...((artifact.sourcePath ?? entry.sourcePath)
            ? { sourcePath: artifact.sourcePath ?? entry.sourcePath }
            : {}),
          unavailableReason: issue.message,
          issues: [issue]
        };
        continue;
      }

      const sourceFeatureCount = await countProvinceSourceFeatures(entry, artifact.localPath);

      if (
        entry.expectedFeatureCount !== undefined &&
        sourceFeatureCount !== entry.expectedFeatureCount
      ) {
        issues.push(
          createIssue(
            "TR_ADM3_SOURCE_FEATURE_COUNT_MISMATCH",
            `Province ${provinceCode} source feature count mismatch: expected ${entry.expectedFeatureCount}, received ${sourceFeatureCount}.`,
            { severity: "warning" }
          )
        );
      }

      provinces[provinceCode] = {
        ...createProvinceLock(entry),
        status: "available",
        sha256: artifact.sha256,
        sourceSnapshotChecksum: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        ...(artifact.sourcePath ? { sourcePath: artifact.sourcePath } : {}),
        ...(artifact.originalUrl ? { resolvedDownloadUrl: artifact.originalUrl } : {}),
        sourceFeatureCount
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const issue = createIssue(
        message.toLowerCase().includes("sha") || message.toLowerCase().includes("checksum")
          ? "TR_ADM3_SOURCE_CHECKSUM_MISMATCH"
          : "TR_ADM3_SOURCE_ACQUIRE_FAILED",
        `Province ${provinceCode} source acquire failed: ${message}`
      );
      issues.push(issue);
      provinces[provinceCode] = {
        ...createProvinceLock(entry),
        status:
          issue.code === "TR_ADM3_SOURCE_CHECKSUM_MISMATCH"
            ? "checksum-failed"
            : "source-unavailable",
        unavailableReason: issue.message,
        issues: [issue]
      };
    }
  }

  const available = Object.values(provinces).filter((province) => province.status === "available");
  const blocked = Object.values(provinces).filter(
    (province) =>
      province.status === "license-blocked" ||
      province.status === "checksum-failed" ||
      province.status === "byte-size-failed" ||
      province.status === "parse-failed"
  );
  const extension: TurkeyAdm3SourceLockExtension = {
    schemaVersion: TURKEY_ADM3_SOURCE_LOCK_SCHEMA_VERSION,
    catalogHash: sha256Hex(serializeJsonStable(catalog)),
    requestedProvinceCodes,
    generatedAt: options.generatedAt,
    provinces: Object.fromEntries(
      Object.entries(provinces).sort(([left], [right]) => left.localeCompare(right))
    ),
    summary: {
      requestedProvinceCount: requestedProvinceCodes.length,
      availableProvinceCount: available.length,
      unavailableProvinceCount: requestedProvinceCodes.length - available.length,
      blockedProvinceCount: blocked.length,
      sourceFeatureCount: available.reduce(
        (sum, province) => sum + (province.sourceFeatureCount ?? 0),
        0
      ),
      sourceBytes: available.reduce((sum, province) => sum + (province.sizeBytes ?? 0), 0),
      coverageStatus: available.length > 0 ? "partial" : "source-unavailable"
    }
  };

  return { extension, issues: issues.sort(compareIssues) };
}

export async function verifyTurkeyAdm3SourceLockExtension(
  extension: TurkeyAdm3SourceLockExtension,
  options: {
    cwd: string;
    buildDate?: string;
    acquireSource: TurkeyAdm3AcquireSource;
  }
): Promise<TerritoryCountryBuildIssue[]> {
  const issues = validateTurkeyAdm3SourceLockExtension(extension);

  for (const province of Object.values(extension.provinces)) {
    if (province.status !== "available") {
      continue;
    }

    const sourceUrl = province.sourcePath ?? province.resolvedDownloadUrl ?? province.sourceUrl;

    if (!sourceUrl || !province.providerId) {
      issues.push(
        createIssue(
          "TR_ADM3_SOURCE_URL_MISSING",
          `Province ${province.provinceCode} available source lock entry is missing source URL.`
        )
      );
      continue;
    }

    try {
      const artifact = await options.acquireSource(
        {
          provider: province.providerId,
          sourceUrl,
          ...(province.sha256 ? { expectedSha256: province.sha256 } : {}),
          ...(province.sourceVersion ? { sourceVersion: province.sourceVersion } : {})
        },
        {
          cwd: options.cwd,
          ...(options.buildDate ? { buildDate: options.buildDate } : {})
        }
      );

      if (province.sizeBytes !== undefined && artifact.sizeBytes !== province.sizeBytes) {
        issues.push(
          createIssue(
            "TR_ADM3_SOURCE_BYTE_SIZE_MISMATCH",
            `Province ${province.provinceCode} byte size mismatch.`
          )
        );
      }
    } catch (error) {
      issues.push(
        createIssue(
          "TR_ADM3_SOURCE_VERIFY_FAILED",
          error instanceof Error ? error.message : String(error)
        )
      );
    }
  }

  return issues.sort(compareIssues);
}

export function validateTurkeyAdm3SourceLockExtension(
  extension: TurkeyAdm3SourceLockExtension
): TerritoryCountryBuildIssue[] {
  const issues: TerritoryCountryBuildIssue[] = [];

  if (extension.schemaVersion !== TURKEY_ADM3_SOURCE_LOCK_SCHEMA_VERSION) {
    issues.push(
      createIssue(
        "TR_ADM3_SOURCE_LOCK_SCHEMA_VERSION",
        `Turkey ADM3 source lock extension schemaVersion must be ${TURKEY_ADM3_SOURCE_LOCK_SCHEMA_VERSION}.`
      )
    );
  }

  for (const province of Object.values(extension.provinces)) {
    if (province.status !== "available") {
      continue;
    }

    if (!province.license || province.license.trim().toLowerCase() === "unknown") {
      issues.push(
        createIssue(
          "TR_ADM3_SOURCE_LICENSE_MISSING",
          `Province ${province.provinceCode} ADM3 source requires license metadata.`
        )
      );
    }

    if (!province.attribution) {
      issues.push(
        createIssue(
          "TR_ADM3_SOURCE_ATTRIBUTION_MISSING",
          `Province ${province.provinceCode} ADM3 source requires attribution metadata.`
        )
      );
    }

    if (!province.sha256) {
      issues.push(
        createIssue(
          "TR_ADM3_SOURCE_CHECKSUM_MISSING",
          `Province ${province.provinceCode} ADM3 source requires SHA-256.`
        )
      );
    }

    if (
      province.sourceSnapshotChecksum &&
      province.sha256 &&
      province.sourceSnapshotChecksum !== province.sha256
    ) {
      issues.push(
        createIssue(
          "TR_ADM3_SOURCE_SNAPSHOT_CHECKSUM_MISMATCH",
          `Province ${province.provinceCode} ADM3 source snapshot checksum must match SHA-256.`
        )
      );
    }

    if (province.sizeBytes === undefined) {
      issues.push(
        createIssue(
          "TR_ADM3_SOURCE_BYTE_SIZE_MISSING",
          `Province ${province.provinceCode} ADM3 source requires byte size.`
        )
      );
    }

    if (province.redistributionStatus && province.redistributionStatus !== "allowed") {
      issues.push(
        createIssue(
          "TR_ADM3_SOURCE_LICENSE_RESTRICTED",
          `Province ${province.provinceCode} ADM3 source redistribution is not allowed.`
        )
      );
    }
  }

  return issues.sort(compareIssues);
}

export function createTurkeyAdm3SyntheticSourceLockLevel(
  extension: TurkeyAdm3SourceLockExtension
): TerritoryCountrySourceLockLevel {
  const available = Object.values(extension.provinces).filter(
    (province) => province.status === "available"
  );
  const sourceDate = available
    .flatMap((province) => (province.sourceDate ? [province.sourceDate] : []))
    .sort()
    .join(",");
  const license = aggregateField(available, "license");
  const attribution = aggregateField(available, "attribution");

  return {
    adminLevel: "ADM3",
    status: available.length > 0 ? "available" : "unavailable",
    boundaryName: "Türkiye ADM3 partial province catalog",
    sourceUrl: `territorykit://TR/ADM3/${extension.requestedProvinceCodes.join(",")}`,
    sourceVersion: extension.catalogHash,
    ...(sourceDate ? { sourceDate } : {}),
    ...(license ? { license } : {}),
    licenseState: available.some((province) => province.licenseState !== "approved")
      ? "unknown"
      : "approved",
    ...(attribution ? { attribution } : {}),
    boundarySourceClass: "official-local",
    redistributionStatus: available.some((province) => province.redistributionStatus !== "allowed")
      ? "unknown"
      : "allowed",
    sourceSnapshotChecksum: sha256Hex(serializeJsonStable(extension)),
    sha256: sha256Hex(serializeJsonStable(extension)),
    sizeBytes: available.reduce((sum, province) => sum + (province.sizeBytes ?? 0), 0),
    sourceFeatureCount: available.reduce(
      (sum, province) => sum + (province.sourceFeatureCount ?? 0),
      0
    ),
    originalFormat: "Turkey ADM3 multi-provider catalog"
  };
}

export async function loadTurkeyAdm3ParsedFeatures(
  options: TurkeyAdm3LoadOptions
): Promise<TurkeyAdm3ParsedSourceResult> {
  const issues: TerritoryCountryBuildIssue[] = [];
  const features: TurkeyAdm3ParsedFeature[] = [];
  const sourceDates: Record<string, string> = {};
  const provinceStatuses: Record<string, TurkeyAdm3ProvinceBuildStatus> = {};
  const importSources: TurkeyAdm3ImportReport["sources"] = [];
  const unresolvedRecords: TurkeyAdm3UnresolvedReport["records"] = [];

  for (const province of Object.values(options.extension.provinces).sort((left, right) =>
    left.provinceCode.localeCompare(right.provinceCode)
  )) {
    if (province.status !== "available") {
      const severity = options.allowPartial ? "warning" : "error";
      provinceStatuses[province.provinceCode] = province.status;
      issues.push(
        createIssue(
          "TR_ADM3_PROVINCE_UNAVAILABLE",
          province.unavailableReason ??
            `Province ${province.provinceCode} ADM3 source is unavailable.`,
          { severity }
        )
      );
      importSources.push(createUnavailableImportReportSource(province));
      unresolvedRecords.push(
        ...createUnresolvedRecords(
          province,
          province.issues ?? [],
          province.status === "license-blocked"
            ? { fallbackCode: "TR_ADM3_SOURCE_LICENSE_BLOCK" }
            : {}
        )
      );
      continue;
    }

    if (!province.providerId || !province.adapter) {
      const issue = createIssue(
        "TR_ADM3_SOURCE_LOCK_INVALID",
        `Province ${province.provinceCode} source lock is missing provider or adapter metadata.`
      );
      issues.push(issue);
      provinceStatuses[province.provinceCode] = "build-failed";
      importSources.push(createUnavailableImportReportSource(province, "build-failed"));
      unresolvedRecords.push(...createUnresolvedRecords(province, [issue]));
      continue;
    }

    const sourceUrl = province.sourcePath ?? province.resolvedDownloadUrl ?? province.sourceUrl;

    if (!sourceUrl) {
      const issue = createIssue(
        "TR_ADM3_SOURCE_URL_MISSING",
        `Province ${province.provinceCode} source lock is missing source URL.`
      );
      issues.push(issue);
      provinceStatuses[province.provinceCode] = "source-unavailable";
      importSources.push(createUnavailableImportReportSource(province, "source-unavailable"));
      unresolvedRecords.push(...createUnresolvedRecords(province, [issue]));
      continue;
    }

    try {
      const artifact = await options.acquireSource(
        {
          provider: province.providerId,
          sourceUrl,
          ...(province.sha256 ? { expectedSha256: province.sha256 } : {}),
          ...(province.sourceVersion ? { sourceVersion: province.sourceVersion } : {})
        },
        {
          cwd: options.cwd,
          buildDate: options.buildDate,
          ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
          ...(options.noCache ? { noCache: true } : {}),
          ...(options.refresh ? { refresh: true } : {})
        }
      );

      if (province.sizeBytes !== undefined && artifact.sizeBytes !== province.sizeBytes) {
        issues.push(
          createIssue(
            "TR_ADM3_SOURCE_BYTE_SIZE_MISMATCH",
            `Province ${province.provinceCode} source byte size mismatch.`
          )
        );
        provinceStatuses[province.provinceCode] = options.allowPartial
          ? "byte-size-failed"
          : "build-failed";
        importSources.push(createUnavailableImportReportSource(province, "byte-size-failed"));
        continue;
      }

      const sourceBytes = await readFile(artifact.localPath);
      const parsed = parseTurkeyAdm3ProvinceSource(province, sourceBytes);
      features.push(...parsed.features);
      issues.push(...parsed.issues);
      unresolvedRecords.push(...createUnresolvedRecords(province, parsed.issues));
      provinceStatuses[province.provinceCode] = parsed.issues.some(
        (issue) => issue.severity === "error"
      )
        ? "build-failed"
        : parsed.issues.length > 0
          ? "built-with-warnings"
          : "built";
      importSources.push(
        createParsedImportReportSource({
          province,
          status: provinceStatuses[province.provinceCode] ?? "build-failed",
          parsed
        })
      );

      if (province.sourceDate) {
        sourceDates[province.provinceCode] = province.sourceDate;
      }
    } catch (error) {
      const severity = options.allowPartial ? "warning" : "error";
      issues.push(
        createIssue(
          "TR_ADM3_PROVINCE_PARSE_FAILED",
          `Province ${province.provinceCode} ADM3 parsing failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { severity }
        )
      );
      provinceStatuses[province.provinceCode] = "parse-failed";
      importSources.push(createUnavailableImportReportSource(province, "parse-failed"));
    }
  }

  const quality = createTurkeyAdm3SourceQualityReport({
    generatedAt: options.buildDate,
    features
  });
  issues.push(...quality.issues);

  return {
    features: features.sort(compareAdm3Features),
    issues: issues.sort(compareIssues),
    sourceBytes: Object.values(options.extension.provinces).reduce(
      (sum, province) => sum + (province.status === "available" ? (province.sizeBytes ?? 0) : 0),
      0
    ),
    sourceDates,
    provinceStatuses,
    qualityReport: quality,
    provenance: createTurkeyAdm3ProvenanceReport({
      generatedAt: options.buildDate,
      extension: options.extension,
      provinceStatuses
    }),
    importReport: createTurkeyAdm3ImportReport({
      generatedAt: options.buildDate,
      extension: options.extension,
      sources: importSources
    }),
    unresolvedReport: createTurkeyAdm3UnresolvedReport({
      generatedAt: options.buildDate,
      records: unresolvedRecords
    })
  };
}

export function createTurkeyAdm3ImportReport(input: {
  generatedAt: string;
  extension: TurkeyAdm3SourceLockExtension;
  sources: TurkeyAdm3ImportReport["sources"];
}): TurkeyAdm3ImportReport {
  const sources = input.sources.sort((left, right) =>
    left.provinceCode.localeCompare(right.provinceCode)
  );

  return {
    schemaVersion: TURKEY_ADM3_IMPORT_REPORT_SCHEMA_VERSION,
    country: "TR",
    level: "ADM3",
    generatedAt: input.generatedAt,
    importerVersion: TURKEY_ADM3_IMPORTER_VERSION,
    summary: {
      requestedProvinceCount: input.extension.requestedProvinceCodes.length,
      sourceCount: sources.length,
      featureCount: sources.reduce((sum, source) => sum + (source.sourceFeatureCount ?? 0), 0),
      parsedCount: sources.reduce((sum, source) => sum + source.parsedCount, 0),
      acceptedCount: sources.reduce((sum, source) => sum + source.acceptedCount, 0),
      rejectedCount: sources.reduce((sum, source) => sum + source.rejectedCount, 0),
      unresolvedCount: sources.reduce((sum, source) => sum + source.unresolvedCount, 0),
      duplicateIdCount: sources.reduce((sum, source) => sum + source.duplicateIds.length, 0),
      duplicateNameCount: sources.reduce((sum, source) => sum + source.duplicateNames.length, 0)
    },
    sources
  };
}

export function createTurkeyAdm3UnresolvedReport(input: {
  generatedAt: string;
  records: TurkeyAdm3UnresolvedReport["records"];
}): TurkeyAdm3UnresolvedReport {
  const records = input.records.sort(
    (left, right) =>
      (left.provinceCode ?? "").localeCompare(right.provinceCode ?? "") ||
      left.code.localeCompare(right.code) ||
      (left.featureId ?? "").localeCompare(right.featureId ?? "") ||
      left.message.localeCompare(right.message)
  );

  return {
    schemaVersion: TURKEY_ADM3_UNRESOLVED_REPORT_SCHEMA_VERSION,
    country: "TR",
    level: "ADM3",
    generatedAt: input.generatedAt,
    summary: {
      unresolvedCount: records.length,
      unknownDistrictCount: countRecords(records, [
        "TR_ADM3_PARENT_MAPPING_MISSING",
        "TR_ADM3_PARENT_MISSING",
        "PARENT_UNRESOLVED"
      ]),
      ambiguousParentCount: countRecords(records, ["PARENT_AMBIGUOUS", "TR_ADM3_PARENT_AMBIGUOUS"]),
      missingSourceIdCount: countRecords(records, ["TR_ADM3_SOURCE_ID_FINGERPRINTED"]),
      missingRequiredFieldCount: countRecords(records, [
        "TR_ADM3_REQUIRED_FIELD_MISSING",
        "TR_ADM3_SOURCE_SCHEMA_MISMATCH"
      ]),
      unsupportedGeometryCount: countRecords(records, [
        "TR_ADM3_UNSUPPORTED_GEOMETRY",
        "TR_ADM3_GEOMETRY_INVALID",
        "GEOMETRY_REPAIR_REJECTED"
      ]),
      unknownCrsCount: countRecords(records, [
        "TR_ADM3_CRS_UNKNOWN",
        "TR_ADM3_CRS_UNSUPPORTED",
        "TR_ADM3_CRS_CONFLICT"
      ]),
      licenseBlockCount: countRecords(records, [
        "TR_ADM3_SOURCE_LICENSE_BLOCK",
        "TR_ADM3_SOURCE_LICENSE_PENDING",
        "TR_ADM3_SOURCE_LICENSE_RESTRICTED",
        "TR_ADM3_SOURCE_LICENSE_UNKNOWN",
        "TR_ADM3_SOURCE_REDISTRIBUTION_RESTRICTED",
        "TR_ADM3_SOURCE_NOT_APPROVED_FOR_PRODUCTION"
      ])
    },
    records
  };
}

function createParsedImportReportSource(input: {
  province: TurkeyAdm3ProvinceSourceLock;
  status: TurkeyAdm3ProvinceBuildStatus;
  parsed: ReturnType<typeof parseTurkeyAdm3ProvinceSource>;
}): TurkeyAdm3ImportReport["sources"][number] {
  const features = input.parsed.features;
  const report = input.parsed.report;

  return {
    provinceCode: input.province.provinceCode,
    provinceName: input.province.provinceName,
    ...(input.province.providerId ? { providerId: input.province.providerId } : {}),
    ...(input.province.providerName ? { providerName: input.province.providerName } : {}),
    ...(input.province.sourceId ? { sourceId: input.province.sourceId } : {}),
    ...(input.province.registryEntryId ? { registryEntryId: input.province.registryEntryId } : {}),
    status: input.status,
    ...(input.province.adapter ? { adapterId: input.province.adapter.id } : {}),
    ...(input.province.format ? { format: input.province.format } : {}),
    ...(input.province.format
      ? { transportType: normalizeTransportLabel(input.province.format) }
      : {}),
    ...(input.province.sourceUrl ? { sourceUrl: input.province.sourceUrl } : {}),
    ...(input.province.sha256 ? { sha256: input.province.sha256 } : {}),
    ...(input.province.sizeBytes !== undefined ? { sizeBytes: input.province.sizeBytes } : {}),
    ...(input.province.sourceFeatureCount !== undefined
      ? { sourceFeatureCount: input.province.sourceFeatureCount }
      : {}),
    parsedCount: report?.rawFeatureCount ?? features.length,
    acceptedCount: features.length,
    rejectedCount: report?.rejectedFeatureCount ?? 0,
    unresolvedCount: report?.unresolvedFeatureCount ?? 0,
    duplicateIds: report?.duplicateStableSourceIds ?? [],
    duplicateNames: report?.duplicateNames ?? [],
    geometryTypeDistribution: report?.geometryTypeDistribution ?? countGeometryTypes(features),
    ...(report?.crsHandling ? { crsHandling: report.crsHandling } : {}),
    parentMatching: {
      mappedParentCount: features.filter((feature) => feature.parentAdm2Id).length,
      rawParentCount: features.filter((feature) => feature.parentSourceId).length,
      missingParentCount: features.filter((feature) => !feature.parentSourceId).length
    }
  };
}

function createUnavailableImportReportSource(
  province: TurkeyAdm3ProvinceSourceLock,
  status: TurkeyAdm3ProvinceBuildStatus = province.status
): TurkeyAdm3ImportReport["sources"][number] {
  return {
    provinceCode: province.provinceCode,
    provinceName: province.provinceName,
    ...(province.providerId ? { providerId: province.providerId } : {}),
    ...(province.providerName ? { providerName: province.providerName } : {}),
    ...(province.sourceId ? { sourceId: province.sourceId } : {}),
    ...(province.registryEntryId ? { registryEntryId: province.registryEntryId } : {}),
    status,
    ...(province.adapter ? { adapterId: province.adapter.id } : {}),
    ...(province.format ? { format: province.format } : {}),
    ...(province.format ? { transportType: normalizeTransportLabel(province.format) } : {}),
    ...(province.sourceUrl ? { sourceUrl: province.sourceUrl } : {}),
    ...(province.sha256 ? { sha256: province.sha256 } : {}),
    ...(province.sizeBytes !== undefined ? { sizeBytes: province.sizeBytes } : {}),
    ...(province.sourceFeatureCount !== undefined
      ? { sourceFeatureCount: province.sourceFeatureCount }
      : {}),
    parsedCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    unresolvedCount: province.issues?.length ?? 0,
    duplicateIds: [],
    duplicateNames: [],
    geometryTypeDistribution: {},
    parentMatching: {
      mappedParentCount: 0,
      rawParentCount: 0,
      missingParentCount: 0
    }
  };
}

function createUnresolvedRecords(
  province: TurkeyAdm3ProvinceSourceLock,
  issues: readonly TerritoryCountryBuildIssue[],
  options: { fallbackCode?: string } = {}
): TurkeyAdm3UnresolvedReport["records"] {
  const relevantIssues =
    issues.length > 0
      ? issues
      : options.fallbackCode
        ? [
            createIssue(
              options.fallbackCode,
              province.unavailableReason ??
                `Province ${province.provinceCode} ADM3 source is blocked.`
            )
          ]
        : [];

  return relevantIssues
    .filter((issue) => isUnresolvedIssueCode(issue.code) || Boolean(options.fallbackCode))
    .map((issue) => ({
      provinceCode: province.provinceCode,
      ...(province.providerId ? { providerId: province.providerId } : {}),
      ...(issue.zoneId ? { featureId: issue.zoneId } : {}),
      code: options.fallbackCode ?? issue.code,
      severity: issue.severity,
      message: issue.message
    }));
}

function isUnresolvedIssueCode(code: string): boolean {
  return (
    code.includes("PARENT") ||
    code.includes("SOURCE_ID") ||
    code.includes("REQUIRED_FIELD") ||
    code.includes("SCHEMA") ||
    code.includes("GEOMETRY") ||
    code.includes("CRS") ||
    code.includes("LICENSE") ||
    code.includes("REDISTRIBUTION") ||
    code.includes("APPROVED_FOR_PRODUCTION")
  );
}

function countRecords(
  records: readonly TurkeyAdm3UnresolvedReport["records"][number][],
  codes: readonly string[]
): number {
  return records.filter((record) => codes.includes(record.code)).length;
}

function countGeometryTypes(features: readonly TurkeyAdm3ParsedFeature[]): Record<string, number> {
  const counts = new Map<string, number>();

  for (const feature of features) {
    counts.set(feature.geometry.type, (counts.get(feature.geometry.type) ?? 0) + 1);
  }

  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
  );
}

function normalizeTransportLabel(format: string): string {
  return normalizeTurkeyAdm3SourceFormat(format) ?? format;
}

export function parseTurkeyAdm3ProvinceSource(
  province: TurkeyAdm3ProvinceSourceLock,
  sourceInput: string | Uint8Array
): {
  features: TurkeyAdm3ParsedFeature[];
  issues: TerritoryCountryBuildIssue[];
  report?: TurkeyAdm3AdapterParseReport;
} {
  if (
    !province.adapter ||
    !province.providerId ||
    !province.provinceCode ||
    !province.provinceName
  ) {
    return {
      features: [],
      issues: [
        createIssue(
          "TR_ADM3_SOURCE_LOCK_INVALID",
          "Turkey ADM3 province source lock is missing required adapter/provider metadata."
        )
      ]
    };
  }

  const providerId = province.providerId;
  const parsed = parseTurkeyAdm3ProviderSource(
    {
      provinceCode: province.provinceCode,
      provinceName: province.provinceName,
      providerId,
      ...(province.crs ? { crs: province.crs } : {}),
      ...(province.format ? { format: province.format } : {}),
      adapter: province.adapter
    },
    sourceInput
  );
  const features = parsed.features.map((feature): TurkeyAdm3ParsedFeature => {
    const parentKey = feature.parentAdm2Id ?? feature.sourceParentId ?? "unresolved-parent";
    const stableCode = createTurkeyAdm3StableKey({
      provinceCode: province.provinceCode,
      parentKey,
      sourceId: feature.sourceId,
      name: feature.name
    });

    return {
      provinceCode: province.provinceCode,
      provinceName: province.provinceName,
      providerId,
      ...(feature.parentAdm2Id ? { parentAdm2Id: feature.parentAdm2Id } : {}),
      sourceId: feature.sourceId,
      stableCode,
      ...((feature.parentAdm2Id ?? feature.sourceParentId)
        ? { parentSourceId: feature.parentAdm2Id ?? feature.sourceParentId }
        : {}),
      name: normalizeTurkeyAdm3DisplayName(feature.name),
      localType: feature.localType,
      geometry: feature.geometry,
      rawProperties: createAdm3RawProperties({
        province,
        sourceId: feature.sourceId,
        sourceObjectId: feature.sourceObjectId,
        ...(feature.sourceParentId ? { sourceParentId: feature.sourceParentId } : {}),
        ...(feature.parentAdm2Id ? { parentAdm2Id: feature.parentAdm2Id } : {}),
        name: feature.name,
        semanticType: feature.semanticType,
        localType: feature.localType,
        geometry: feature.geometry,
        originalGeometryHash: feature.originalGeometryHash,
        effectiveGeometryHash: feature.effectiveGeometryHash
      }),
      ...(feature.rawFeatureId ? { rawFeatureId: feature.rawFeatureId } : {})
    };
  });

  return {
    features: features.sort(compareAdm3Features),
    issues: parsed.issues.sort(compareIssues),
    report: parsed.report
  };
}

export function createTurkeyAdm3CoverageManifest(input: {
  generatedAt: string;
  extension: TurkeyAdm3SourceLockExtension;
  zones: readonly BuiltCountryZone[];
  allowPartial: boolean;
  provinceStatuses?: Record<string, TurkeyAdm3ProvinceBuildStatus>;
}): TurkeyAdm3CoverageManifest {
  const adm3Zones = input.zones.filter((built) => built.zone.sourceAdminLevel === "ADM3");
  const zonesByProvince = groupZonesByProvince(adm3Zones);
  const provinces = Object.fromEntries(
    Object.entries(input.extension.provinces)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([provinceCode, source]) => {
        const zones = zonesByProvince.get(provinceCode) ?? [];
        const status =
          input.provinceStatuses?.[provinceCode] ??
          (source.status === "available" && zones.length > 0
            ? "built"
            : source.status === "available"
              ? "build-failed"
              : source.status === "source-unavailable"
                ? "fallback-adm2"
                : source.status);
        const reasonCode = adm3CoverageReasonCode(status, source.status);
        const parentAdm2Ids = [
          ...new Set(zones.flatMap((built) => (built.zone.parentId ? [built.zone.parentId] : [])))
        ].sort();
        const adm2 = Object.fromEntries(
          parentAdm2Ids.map((parentId) => {
            const featureCount = zones.filter((built) => built.zone.parentId === parentId).length;

            return [
              parentId,
              {
                adm2Id: parentId,
                status: "official-local" as const,
                reasonCode: "official-local-source-built" as const,
                featureCount
              }
            ];
          })
        );

        return [
          provinceCode,
          {
            provinceCode,
            provinceName: source.provinceName,
            status,
            featureCount: zones.length,
            ...(source.providerId ? { providerId: source.providerId } : {}),
            ...(source.providerName ? { providerName: source.providerName } : {}),
            ...(source.sourceId ? { sourceId: source.sourceId } : {}),
            ...(source.sourceDate ? { sourceDate: source.sourceDate } : {}),
            ...(source.sourceVersion ? { sourceVersion: source.sourceVersion } : {}),
            ...(source.license ? { license: source.license } : {}),
            ...(source.licenseUrl ? { licenseUrl: source.licenseUrl } : {}),
            ...(source.attribution ? { attribution: source.attribution } : {}),
            ...(source.sha256 ? { checksum: source.sha256 } : {}),
            ...(source.sizeBytes !== undefined ? { byteSize: source.sizeBytes } : {}),
            fallbackLevel: "ADM2" as const,
            reasonCode,
            ...(zones.length === 0
              ? { fallbackReason: source.unavailableReason ?? "No ADM3 features built." }
              : {}),
            parentAdm2Ids,
            adm2
          }
        ];
      })
  );

  return {
    schemaVersion: TURKEY_ADM3_COVERAGE_SCHEMA_VERSION,
    country: "TR",
    level: "ADM3",
    coverageStatus: adm3Zones.length > 0 ? "partial" : "source-unavailable",
    generatedAt: input.generatedAt,
    nationalCoverageClaim: false,
    allowPartial: input.allowPartial,
    featureCount: adm3Zones.length,
    coveredProvinceCount: [...zonesByProvince.keys()].length,
    requestedProvinceCount: input.extension.requestedProvinceCodes.length,
    provinces
  };
}

function adm3CoverageReasonCode(
  status: TurkeyAdm3ProvinceBuildStatus,
  sourceStatus: TurkeyAdm3ProvinceSourceLock["status"]
): TurkeyAdm3CoverageManifest["provinces"][string]["reasonCode"] {
  if (status === "built" || status === "built-with-warnings") {
    return "official-local-source-built";
  }

  if (sourceStatus === "license-blocked" || status === "license-blocked") {
    return "license-blocked";
  }

  if (sourceStatus === "checksum-failed" || status === "checksum-failed") {
    return "checksum-failed";
  }

  if (sourceStatus === "source-unavailable" || status === "fallback-adm2") {
    return "source-unavailable";
  }

  return "build-failed";
}

export function createTurkeyAdm3SourceQualityReport(input: {
  generatedAt: string;
  features: readonly TurkeyAdm3ParsedFeature[];
}): TurkeyAdm3QualityGateReport {
  const issues: TerritoryCountryBuildIssue[] = [];
  const duplicateGeometryHashes = new Set<string>();
  const seenGeometryHashes = new Map<string, string>();
  let excessiveOverlapCount = 0;
  let suspiciousAreaCount = 0;
  let coordinateIssueCount = 0;

  for (const feature of input.features) {
    const geometryIssues = inspectSourceGeometry(feature);
    issues.push(...geometryIssues);
    coordinateIssueCount += geometryIssues.filter(
      (issue) => issue.code === "TR_ADM3_COORDINATE_RANGE"
    ).length;

    const area = bboxArea(computeGeometryBBox(feature.geometry));

    if (area > 0 && area < 0.000001) {
      suspiciousAreaCount += 1;
      issues.push(
        createIssue(
          "TR_ADM3_SUSPICIOUS_AREA",
          `ADM3 feature ${feature.sourceId ?? feature.name} has suspiciously small area.`,
          { severity: "warning" }
        )
      );
    }

    const geometryHash = hashGeometryIgnoringRingOrder(feature.geometry);
    const existing = seenGeometryHashes.get(geometryHash);

    if (existing) {
      duplicateGeometryHashes.add(geometryHash);
      issues.push(
        createIssue(
          "TR_ADM3_DUPLICATE_GEOMETRY",
          `ADM3 feature ${feature.sourceId ?? feature.name} duplicates geometry from ${existing}.`
        )
      );
    } else {
      seenGeometryHashes.set(geometryHash, feature.sourceId ?? feature.name);
    }
  }

  for (let index = 0; index < input.features.length; index += 1) {
    const left = input.features[index];

    if (!left) {
      continue;
    }

    for (let nextIndex = index + 1; nextIndex < input.features.length; nextIndex += 1) {
      const right = input.features[nextIndex];

      if (!right || left.parentSourceId !== right.parentSourceId) {
        continue;
      }

      const overlapRatio = bboxOverlapRatio(
        computeGeometryBBox(left.geometry),
        computeGeometryBBox(right.geometry)
      );

      if (overlapRatio > 0.8) {
        excessiveOverlapCount += 1;
        issues.push(
          createIssue(
            "TR_ADM3_EXCESSIVE_OVERLAP",
            `ADM3 features ${left.sourceId ?? left.name} and ${
              right.sourceId ?? right.name
            } overlap excessively under the same parent.`
          )
        );
      }
    }
  }

  const qualityDataset: TerritoryDataset = {
    manifest: {
      datasetId: "tr-adm3-source-quality",
      datasetVersion: "0.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: input.generatedAt,
      geometryHash: "source-quality"
    },
    zones: input.features.map((feature, index): TerritoryZone => {
      const bbox = computeGeometryBBox(feature.geometry);

      return {
        id: `tr:adm3-quality:${index}`,
        datasetId: "tr-adm3-source-quality",
        countryCode: "TR",
        level: 3,
        sourceAdminLevel: "ADM3",
        semanticType: "neighbourhood",
        name: feature.name,
        neighborIds: [],
        geometry: feature.geometry,
        center: computeGeometryRepresentativePoint(feature.geometry),
        bbox,
        properties: { territory: { adminLevel: "ADM3" } }
      };
    })
  };
  const geometryReport = validateGeometryDataset(qualityDataset, {
    checks: {
      coordinates: true,
      rings: true,
      selfIntersections: true,
      holes: false,
      bbox: true,
      center: true,
      antimeridian: true,
      parentContainment: false,
      siblingOverlaps: false
    },
    strict: true
  });
  issues.push(...geometryReport.issues.map(geometryIssueToBuildIssue));

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  return {
    schemaVersion: TURKEY_ADM3_QUALITY_SCHEMA_VERSION,
    country: "TR",
    level: "ADM3",
    generatedAt: input.generatedAt,
    ok: errorCount === 0,
    summary: {
      errorCount,
      warningCount,
      checkedFeatureCount: input.features.length,
      duplicateGeometryCount: duplicateGeometryHashes.size,
      excessiveOverlapCount,
      suspiciousAreaCount,
      coordinateIssueCount,
      blockerCount: errorCount
    },
    issues: issues.sort(compareIssues)
  };
}

export function createTurkeyAdm3ProvenanceReport(input: {
  generatedAt: string;
  extension: TurkeyAdm3SourceLockExtension;
  provinceStatuses?: Record<string, TurkeyAdm3ProvinceBuildStatus>;
}): TurkeyAdm3ProvenanceReport {
  return {
    schemaVersion: TURKEY_ADM3_PROVENANCE_SCHEMA_VERSION,
    country: "TR",
    level: "ADM3",
    generatedAt: input.generatedAt,
    sources: Object.values(input.extension.provinces)
      .sort((left, right) => left.provinceCode.localeCompare(right.provinceCode))
      .map((province) => ({
        provinceCode: province.provinceCode,
        provinceName: province.provinceName,
        ...(province.providerId ? { providerId: province.providerId } : {}),
        ...(province.providerName ? { providerName: province.providerName } : {}),
        ...(province.sourceId ? { sourceId: province.sourceId } : {}),
        ...(province.sourceUrl ? { sourceUrl: province.sourceUrl } : {}),
        ...(province.sourceDate ? { sourceDate: province.sourceDate } : {}),
        ...(province.sourceVersion ? { sourceVersion: province.sourceVersion } : {}),
        ...(province.retrievedAt ? { retrievedAt: province.retrievedAt } : {}),
        ...(province.license ? { license: province.license } : {}),
        ...(province.licenseUrl ? { licenseUrl: province.licenseUrl } : {}),
        ...(province.attribution ? { attribution: province.attribution } : {}),
        ...(province.sha256 ? { sha256: province.sha256 } : {}),
        ...(province.sizeBytes !== undefined ? { sizeBytes: province.sizeBytes } : {}),
        ...(province.sourceFeatureCount !== undefined
          ? { sourceFeatureCount: province.sourceFeatureCount }
          : {}),
        ...(province.registryEntryId ? { registryEntryId: province.registryEntryId } : {}),
        ...(province.productionEligible !== undefined
          ? { productionEligible: province.productionEligible }
          : {}),
        ...(province.sourceRegistryStatus
          ? { sourceRegistryStatus: province.sourceRegistryStatus }
          : {}),
        ...(province.sourceLifecycle ? { sourceLifecycle: province.sourceLifecycle } : {}),
        ...(province.sourceAccessType ? { sourceAccessType: province.sourceAccessType } : {}),
        ...(province.evidenceUrls ? { evidenceUrls: province.evidenceUrls } : {}),
        ...(province.authorityType ? { authorityType: province.authorityType } : {}),
        ...(province.datasetIdentifier ? { datasetIdentifier: province.datasetIdentifier } : {}),
        ...(province.importerVersion ? { importerVersion: province.importerVersion } : {}),
        ...(province.adapter ? { adapterId: province.adapter.id } : {}),
        status: input.provinceStatuses?.[province.provinceCode] ?? province.status
      }))
  };
}

export function createTurkeyAdm3StableKey(input: {
  provinceCode: string;
  parentKey: string;
  sourceId?: string;
  name: string;
}): string {
  const normalizedName = normalizeTurkeyAdm3Name(input.name);
  const stableSource = input.sourceId ? slugifyTerritoryIdPart(input.sourceId) : normalizedName;

  return [
    "tr",
    `il-${normalizeProvinceCode(input.provinceCode)}`,
    slugifyTerritoryIdPart(input.parentKey.replace(/^tr:adm2:/, "adm2-")),
    stableSource
  ].join("-");
}

export function createTurkeyAdm3TerritoryId(input: {
  provinceCode: string;
  parentKey: string;
  sourceId?: string;
  name: string;
}): string {
  return createTerritoryGlobalId({
    countryCode: "TR",
    adminLevel: "ADM3",
    localId: createTurkeyAdm3StableKey(input)
  });
}

export type TurkeyV2Adm3StableIdSourceClass = "official" | "osm" | "generated";

export interface TurkeyV2Adm3StableIdInput {
  provinceCode: string;
  districtCode: string;
  sourceClass: TurkeyV2Adm3StableIdSourceClass;
  sourceNativeId?: string;
  sourceDatasetId?: string;
  name?: string;
  algorithmVersion?: string;
  generationSeed?: string;
  localKey?: string;
}

export const TURKEY_V2_ADM3_STABLE_ID_STANDARD = "territorykit-tr-v2-adm3-stable-id@1" as const;

export function createTurkeyV2Adm3StableKey(input: TurkeyV2Adm3StableIdInput): string {
  const provinceCode = normalizeProvinceCode(input.provinceCode);
  const districtCode = normalizeTurkeyV2DistrictCode(input.districtCode);
  const sourceIdentity = createTurkeyV2Adm3SourceIdentity(input);

  return [
    "tr",
    `il-${provinceCode}`,
    `ilce-${districtCode}`,
    input.sourceClass,
    sourceIdentity
  ].join("-");
}

export function createTurkeyV2Adm3TerritoryId(input: TurkeyV2Adm3StableIdInput): string {
  return createTerritoryGlobalId({
    countryCode: "TR",
    adminLevel: "ADM3",
    localId: createTurkeyV2Adm3StableKey(input)
  });
}

export function normalizeTurkeyAdm3Name(input: string): string {
  return slugifyTerritoryIdPart(input.trim().replace(/\s+/g, " "));
}

export function normalizeTurkeyAdm3DisplayName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function isTurkeyAdm3SourceLockExtension(
  input: unknown
): input is TurkeyAdm3SourceLockExtension {
  return (
    isRecord(input) &&
    input.schemaVersion === TURKEY_ADM3_SOURCE_LOCK_SCHEMA_VERSION &&
    isRecord(input.provinces)
  );
}

function createBlockedProvinceLock(
  entry: TurkeyAdm3ProvinceCatalogEntry,
  issues: TerritoryCountryBuildIssue[]
): TurkeyAdm3ProvinceSourceLock {
  const gateBlocked = issues.some((issue) =>
    ["LICENSE", "REDISTRIBUTION", "APPROVED_FOR_PRODUCTION", "ACCESS_NOT_PUBLIC"].some((token) =>
      issue.code.includes(token)
    )
  );

  return {
    ...createProvinceLock(entry),
    status: gateBlocked ? "license-blocked" : "source-unavailable",
    unavailableReason: issues.map((issue) => issue.message).join("; "),
    issues
  };
}

function createProvinceLock(entry: TurkeyAdm3ProvinceCatalogEntry): TurkeyAdm3ProvinceSourceLock {
  return {
    provinceCode: normalizeProvinceCode(entry.provinceCode),
    provinceName: entry.provinceName,
    status: "source-unavailable",
    providerId: entry.providerId,
    providerName: entry.providerName,
    sourceId: entry.sourceId,
    sourceUrl: entry.sourceUrl,
    resolvedDownloadUrl: entry.downloadUrl ?? entry.sourceUrl,
    ...(entry.sourcePath ? { sourcePath: entry.sourcePath } : {}),
    sourceDate: entry.sourceDate,
    ...(entry.sourceVersion ? { sourceVersion: entry.sourceVersion } : {}),
    ...(entry.retrievedAt ? { retrievedAt: entry.retrievedAt } : {}),
    license: entry.license,
    licenseState:
      entry.licenseState ?? licenseStateFromRedistributionStatus(entry.redistributionStatus),
    ...(entry.licenseUrl ? { licenseUrl: entry.licenseUrl } : {}),
    attribution: entry.attribution,
    boundarySourceClass: entry.boundarySourceClass ?? "official-local",
    redistributionStatus: entry.redistributionStatus,
    ...(entry.commercialUseStatus ? { commercialUseStatus: entry.commercialUseStatus } : {}),
    ...(entry.modificationStatus ? { modificationStatus: entry.modificationStatus } : {}),
    crs: entry.crs,
    format: entry.format,
    adapter: entry.adapter,
    ...(entry.registryEntryId ? { registryEntryId: entry.registryEntryId } : {}),
    ...(entry.productionEligible !== undefined
      ? { productionEligible: entry.productionEligible }
      : {}),
    ...(entry.sourceRegistryStatus ? { sourceRegistryStatus: entry.sourceRegistryStatus } : {}),
    ...(entry.sourceLifecycle ? { sourceLifecycle: entry.sourceLifecycle } : {}),
    ...(entry.sourceAccessType ? { sourceAccessType: entry.sourceAccessType } : {}),
    ...(entry.evidenceUrls ? { evidenceUrls: [...entry.evidenceUrls].sort() } : {}),
    ...(entry.authorityType ? { authorityType: entry.authorityType } : {}),
    ...(entry.datasetIdentifier ? { datasetIdentifier: entry.datasetIdentifier } : {}),
    importerVersion: TURKEY_ADM3_IMPORTER_VERSION
  };
}

function resolveAdm3AcquireUrl(entry: TurkeyAdm3ProvinceCatalogEntry): string {
  if (entry.sourcePath) {
    return entry.sourcePath;
  }

  const sourceUrl = entry.downloadUrl ?? entry.sourceUrl;

  if (entry.adapter.id === "arcgis-rest-json") {
    return createArcGisQueryUrl(sourceUrl);
  }

  return sourceUrl;
}

function createArcGisQueryUrl(input: string): string {
  if (!/^https?:\/\//i.test(input)) {
    return input;
  }

  const url = new URL(input);

  if (/\/query$/i.test(url.pathname) || url.searchParams.get("f") === "json") {
    return url.href;
  }

  url.pathname = `${url.pathname.replace(/\/$/, "")}/query`;
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("f", "json");
  url.searchParams.set("outSR", "4326");

  return url.href;
}

function validateCatalogEntry(provinceCode: string, input: unknown): TerritoryCountryBuildIssue[] {
  const issues: TerritoryCountryBuildIssue[] = [];

  if (!isRecord(input)) {
    return [
      createIssue(
        "TR_ADM3_CATALOG_ENTRY_INVALID",
        `Turkey ADM3 catalog entry ${provinceCode} must be an object.`
      )
    ];
  }

  const entry = input as Partial<TurkeyAdm3ProvinceCatalogEntry>;
  const normalizedProvinceCode = normalizeProvinceCode(provinceCode);
  const gateIssues = evaluateProductionGate(entry, provinceCode);
  issues.push(...gateIssues);

  if (gateIssues.some((issue) => issue.severity === "error")) {
    return issues.sort(compareIssues);
  }

  const requiredFields = [
    "provinceCode",
    "provinceName",
    "providerId",
    "providerName",
    "sourceId",
    "sourceUrl",
    "sourceDate",
    "license",
    "attribution",
    "redistributionStatus",
    "crs",
    "format",
    "adapter"
  ] as const;

  for (const field of requiredFields) {
    if (entry[field] === undefined || entry[field] === "") {
      issues.push(
        createIssue(
          "TR_ADM3_CATALOG_FIELD_MISSING",
          `Turkey ADM3 catalog entry ${provinceCode} is missing ${field}.`
        )
      );
    }
  }

  if (
    typeof entry.provinceCode === "string" &&
    normalizeProvinceCode(entry.provinceCode) !== normalizedProvinceCode
  ) {
    issues.push(
      createIssue(
        "TR_ADM3_CATALOG_PROVINCE_CODE",
        `Turkey ADM3 catalog entry key ${provinceCode} does not match provinceCode ${entry.provinceCode}.`
      )
    );
  }

  if (!entry.license || entry.license.trim().toLowerCase() === "unknown") {
    issues.push(
      createIssue(
        "TR_ADM3_SOURCE_LICENSE_MISSING",
        `Turkey ADM3 catalog entry ${provinceCode} requires a known license.`
      )
    );
  }

  if (entry.redistributionStatus !== "allowed") {
    issues.push(
      createIssue(
        "TR_ADM3_SOURCE_LICENSE_RESTRICTED",
        `Turkey ADM3 catalog entry ${provinceCode} must declare redistributionStatus: allowed.`
      )
    );
  }

  if (!isSupportedTurkeyAdm3Crs(entry.crs)) {
    issues.push(
      createIssue(
        "TR_ADM3_CRS_UNSUPPORTED",
        `Turkey ADM3 catalog entry ${provinceCode} must declare EPSG:4326, OGC:CRS84, or a supported explicit reprojection CRS.`
      )
    );
  }

  if (!isSupportedTurkeyAdm3SourceFormat(entry.format)) {
    issues.push(
      createIssue(
        "TR_ADM3_SOURCE_FORMAT_UNSUPPORTED",
        `Turkey ADM3 catalog entry ${provinceCode} uses unsupported source format '${String(
          entry.format
        )}'.`
      )
    );
  }

  if (!isRecord(entry.adapter) || !isSupportedTurkeyAdm3Adapter(entry.adapter.id)) {
    issues.push(
      createIssue(
        "TR_ADM3_ADAPTER_UNSUPPORTED",
        `Turkey ADM3 catalog entry ${provinceCode} uses an unsupported provider adapter.`
      )
    );
  }

  return issues.sort(compareIssues);
}

function evaluateProductionGate(
  entry: Partial<TurkeyAdm3ProvinceCatalogEntry>,
  provinceCode: string
): TerritoryCountryBuildIssue[] {
  const issues: TerritoryCountryBuildIssue[] = [];
  const licenseState =
    entry.licenseState ?? licenseStateFromRedistributionStatus(entry.redistributionStatus);

  if (entry.productionEligible === false) {
    issues.push(
      createIssue(
        "TR_ADM3_SOURCE_NOT_APPROVED_FOR_PRODUCTION",
        `Turkey ADM3 catalog entry ${provinceCode} is not marked production-eligible in the source registry.`
      )
    );
  }

  if (entry.sourceLifecycle && entry.sourceLifecycle !== "approved") {
    issues.push(
      createIssue(
        "TR_ADM3_SOURCE_NOT_APPROVED_FOR_PRODUCTION",
        `Turkey ADM3 catalog entry ${provinceCode} lifecycle is '${entry.sourceLifecycle}', not approved.`
      )
    );
  }

  if (
    entry.boundarySourceClass &&
    entry.boundarySourceClass !== "official-local" &&
    entry.boundarySourceClass !== "official-national"
  ) {
    issues.push(
      createIssue(
        "TR_ADM3_SOURCE_NOT_APPROVED_FOR_PRODUCTION",
        `Turkey ADM3 catalog entry ${provinceCode} boundarySourceClass is '${entry.boundarySourceClass}', not official.`
      )
    );
  }

  if (licenseState !== "approved") {
    issues.push(
      createIssue(
        licenseState === "pending"
          ? "TR_ADM3_SOURCE_LICENSE_PENDING"
          : licenseState === "restricted"
            ? "TR_ADM3_SOURCE_LICENSE_RESTRICTED"
            : "TR_ADM3_SOURCE_LICENSE_UNKNOWN",
        `Turkey ADM3 catalog entry ${provinceCode} license state is '${licenseState}'.`
      )
    );
  }

  if (entry.redistributionStatus && entry.redistributionStatus !== "allowed") {
    issues.push(
      createIssue(
        "TR_ADM3_SOURCE_REDISTRIBUTION_RESTRICTED",
        `Turkey ADM3 catalog entry ${provinceCode} redistributionStatus is '${entry.redistributionStatus}'.`
      )
    );
  }

  if (
    entry.sourceAccessType &&
    entry.sourceAccessType !== "public-download" &&
    entry.sourceAccessType !== "public-api"
  ) {
    issues.push(
      createIssue(
        "TR_ADM3_SOURCE_ACCESS_NOT_PUBLIC",
        `Turkey ADM3 catalog entry ${provinceCode} access type is '${entry.sourceAccessType}'.`
      )
    );
  }

  return issues.sort(compareIssues);
}

function normalizeProvinceCodes(codes: readonly string[]): string[] {
  return [...new Set(codes.map(normalizeProvinceCode))].sort();
}

function licenseStateFromRedistributionStatus(input: string | undefined): TerritoryLicenseState {
  if (input === "allowed") {
    return "approved";
  }

  if (input === "restricted") {
    return "restricted";
  }

  return "unknown";
}

function normalizeProvinceCode(code: string): string {
  const numeric = code.trim().replace(/^TR-/i, "");

  if (!/^\d{1,2}$/.test(numeric)) {
    throw new Error(`Invalid Turkey province code '${code}'.`);
  }

  return numeric.padStart(2, "0");
}

function normalizeTurkeyV2DistrictCode(code: string): string {
  const trimmed = code.trim();
  const withoutCountry = trimmed.replace(/^TR[-_:]?/i, "");
  const parts = withoutCountry.split(/[-_:]/).filter(Boolean);
  const candidate = parts.at(-1) ?? withoutCountry;

  if (/^\d{1,4}$/.test(candidate)) {
    return candidate.padStart(3, "0");
  }

  return slugifyTerritoryIdPart(withoutCountry);
}

function createTurkeyV2Adm3SourceIdentity(input: TurkeyV2Adm3StableIdInput): string {
  if (input.sourceClass === "generated") {
    if (!input.algorithmVersion) {
      throw new Error("Turkey V2 generated ADM3 stable IDs require algorithmVersion.");
    }

    const localKey =
      input.localKey ??
      input.sourceNativeId ??
      (input.generationSeed ? `seed-${sha256Hex(input.generationSeed).slice(0, 16)}` : undefined);

    if (!localKey) {
      throw new Error(
        "Turkey V2 generated ADM3 stable IDs require localKey, sourceNativeId, or generationSeed."
      );
    }

    return `${slugifyTerritoryIdPart(input.algorithmVersion)}-${slugifyTerritoryIdPart(localKey)}`;
  }

  const realSourceIdentity = input.sourceNativeId ?? input.sourceDatasetId ?? input.name;

  if (!realSourceIdentity) {
    throw new Error(
      `Turkey V2 ${input.sourceClass} ADM3 stable IDs require sourceNativeId, sourceDatasetId, or name.`
    );
  }

  return slugifyTerritoryIdPart(realSourceIdentity);
}

async function countProvinceSourceFeatures(
  entry: TurkeyAdm3ProvinceCatalogEntry,
  localPath: string
): Promise<number> {
  const sourceBytes = await readFile(localPath);
  const parsed = parseTurkeyAdm3ProviderSource(
    {
      provinceCode: entry.provinceCode,
      provinceName: entry.provinceName,
      providerId: entry.providerId,
      crs: entry.crs,
      format: entry.format,
      adapter: entry.adapter
    },
    sourceBytes
  );

  return parsed.report.rawFeatureCount;
}

function createAdm3RawProperties(input: {
  province: TurkeyAdm3ProvinceSourceLock;
  sourceId: string;
  sourceObjectId: string;
  sourceParentId?: string;
  parentAdm2Id?: string;
  name: string;
  semanticType: TerritorySemanticAdminType;
  localType: string;
  geometry: TerritoryGeometry;
  originalGeometryHash?: string;
  effectiveGeometryHash?: string;
}): Record<string, unknown> {
  const geometryHash = input.effectiveGeometryHash ?? hashGeometryIgnoringRingOrder(input.geometry);

  return {
    territorykit: {
      provinceCode: input.province.provinceCode,
      provinceName: input.province.provinceName,
      provider: input.province.providerId,
      providerName: input.province.providerName,
      sourceId: input.sourceId,
      sourceObjectId: input.sourceObjectId,
      sourceNativeId: input.sourceId,
      ...(input.sourceParentId ? { sourceParentId: input.sourceParentId } : {}),
      parentAdm2Id: input.parentAdm2Id,
      semanticType: input.semanticType,
      localType: input.localType,
      sourceClass: "official",
      boundaryKind: "administrative",
      boundarySourceClass: input.province.boundarySourceClass ?? "official-local",
      confidence: "authoritative",
      administrative: true,
      providerId: input.province.providerId,
      official: true,
      generated: false,
      sourceUrl: input.province.sourceUrl,
      sourceDate: input.province.sourceDate,
      sourceVersion: input.province.sourceVersion,
      sourceSnapshotChecksum: input.province.sourceSnapshotChecksum ?? input.province.sha256,
      licenseState:
        input.province.licenseState ??
        licenseStateFromRedistributionStatus(input.province.redistributionStatus),
      geometryHash,
      ...(input.originalGeometryHash ? { originalGeometryHash: input.originalGeometryHash } : {}),
      effectiveGeometryHash: geometryHash,
      license: input.province.license,
      attribution: input.province.attribution,
      ...(input.province.registryEntryId
        ? { registryEntryId: input.province.registryEntryId }
        : {}),
      ...(input.province.datasetIdentifier
        ? { sourceDatasetId: input.province.datasetIdentifier }
        : {}),
      ...(input.province.importerVersion
        ? { importerVersion: input.province.importerVersion }
        : {}),
      ...(input.province.evidenceUrls ? { evidenceUrls: input.province.evidenceUrls } : {})
    },
    sourceId: input.sourceId,
    parentSourceId: input.parentAdm2Id ?? input.sourceParentId,
    name: input.name
  };
}

function inspectSourceGeometry(feature: TurkeyAdm3ParsedFeature): TerritoryCountryBuildIssue[] {
  const issues: TerritoryCountryBuildIssue[] = [];
  const coordinates =
    feature.geometry.type === "Polygon"
      ? feature.geometry.coordinates.flat()
      : feature.geometry.coordinates.flat(2);

  if (coordinates.length === 0) {
    issues.push(
      createIssue(
        "TR_ADM3_EMPTY_GEOMETRY",
        `ADM3 feature ${feature.sourceId ?? feature.name} has empty geometry.`
      )
    );
  }

  if (
    coordinates.some(
      (point) =>
        !Number.isFinite(point?.[0]) ||
        !Number.isFinite(point?.[1]) ||
        (point?.[0] ?? 0) < -180 ||
        (point?.[0] ?? 0) > 180 ||
        (point?.[1] ?? 0) < -90 ||
        (point?.[1] ?? 0) > 90
    )
  ) {
    issues.push(
      createIssue(
        "TR_ADM3_COORDINATE_RANGE",
        `ADM3 feature ${feature.sourceId ?? feature.name} has coordinates outside lon/lat range.`
      )
    );
  }

  const bbox = computeGeometryBBox(feature.geometry);

  if (!bboxesIntersect(bbox, TURKEY_BBOX)) {
    issues.push(
      createIssue(
        "TR_ADM3_COORDINATE_REFERENCE_SUSPECT",
        `ADM3 feature ${feature.sourceId ?? feature.name} is outside the expected Turkey lon/lat extent.`
      )
    );
  }

  if (!feature.parentSourceId) {
    issues.push(
      createIssue(
        "TR_ADM3_PARENT_MISSING",
        `ADM3 feature ${feature.sourceId ?? feature.name} is missing parent district reference.`
      )
    );
  }

  return issues;
}

function geometryIssueToBuildIssue(issue: GeometryQualityIssue): TerritoryCountryBuildIssue {
  return {
    code: `TR_ADM3_${issue.code}`,
    severity: issue.severity,
    message: issue.message,
    ...(issue.zoneId ? { zoneId: issue.zoneId } : {})
  };
}

function hashGeometryIgnoringRingOrder(geometry: TerritoryGeometry): string {
  return sha256Hex(JSON.stringify(canonicalGeometry(geometry)));
}

function canonicalGeometry(geometry: TerritoryGeometry): unknown {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : (geometry.coordinates as LngLat[][][]);

  return polygons
    .map((polygon) =>
      polygon
        .map((ring) => canonicalRing(ring as LngLat[]))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    )
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function canonicalRing(ring: LngLat[]): LngLat[] {
  const open = ring.length > 1 && pointsEqual(ring[0], ring.at(-1)) ? ring.slice(0, -1) : ring;
  const normalized = open.map((point): LngLat => [
    Number(point[0].toFixed(7)),
    Number(point[1].toFixed(7))
  ]);
  const forward = rotateToSmallestPoint(normalized);
  const reverse = rotateToSmallestPoint([...normalized].reverse());

  return JSON.stringify(forward).localeCompare(JSON.stringify(reverse)) <= 0 ? forward : reverse;
}

function rotateToSmallestPoint(ring: LngLat[]): LngLat[] {
  if (ring.length === 0) {
    return [];
  }

  let minIndex = 0;

  for (let index = 1; index < ring.length; index += 1) {
    if (comparePoints(ring[index]!, ring[minIndex]!) < 0) {
      minIndex = index;
    }
  }

  return [...ring.slice(minIndex), ...ring.slice(0, minIndex)];
}

function comparePoints(left: LngLat, right: LngLat): number {
  return left[0] - right[0] || left[1] - right[1];
}

function pointsEqual(left: LngLat | undefined, right: LngLat | undefined): boolean {
  return Boolean(left && right && left[0] === right[0] && left[1] === right[1]);
}

function bboxArea(bbox: readonly number[]): number {
  return (
    Math.max(0, (bbox[2] ?? 0) - (bbox[0] ?? 0)) * Math.max(0, (bbox[3] ?? 0) - (bbox[1] ?? 0))
  );
}

function bboxOverlapRatio(left: readonly number[], right: readonly number[]): number {
  const west = Math.max(left[0] ?? 0, right[0] ?? 0);
  const south = Math.max(left[1] ?? 0, right[1] ?? 0);
  const east = Math.min(left[2] ?? 0, right[2] ?? 0);
  const north = Math.min(left[3] ?? 0, right[3] ?? 0);
  const overlap = bboxArea([west, south, east, north]);
  const smaller = Math.min(bboxArea(left), bboxArea(right));

  return smaller === 0 ? 0 : overlap / smaller;
}

function bboxesIntersect(left: readonly number[], right: readonly number[]): boolean {
  return !(
    (left[2] ?? 0) < (right[0] ?? 0) ||
    (right[2] ?? 0) < (left[0] ?? 0) ||
    (left[3] ?? 0) < (right[1] ?? 0) ||
    (right[3] ?? 0) < (left[1] ?? 0)
  );
}

function groupZonesByProvince(zones: readonly BuiltCountryZone[]): Map<string, BuiltCountryZone[]> {
  const grouped = new Map<string, BuiltCountryZone[]>();

  for (const built of zones) {
    const territory = isRecord(built.zone.properties.territory)
      ? built.zone.properties.territory
      : {};
    const provinceCode = readStringPropertyPath(territory, "adm3.provinceCode");

    if (!provinceCode) {
      continue;
    }

    grouped.set(provinceCode, [...(grouped.get(provinceCode) ?? []), built]);
  }

  return grouped;
}

function aggregateField(
  provinces: readonly TurkeyAdm3ProvinceSourceLock[],
  field: "license" | "attribution"
): string {
  return [...new Set(provinces.flatMap((province) => (province[field] ? [province[field]] : [])))]
    .sort()
    .join("\n");
}

function compareAdm3Features(
  left: TurkeyAdm3ParsedFeature,
  right: TurkeyAdm3ParsedFeature
): number {
  return (
    left.provinceCode.localeCompare(right.provinceCode) ||
    (left.parentSourceId ?? "").localeCompare(right.parentSourceId ?? "") ||
    (left.sourceId ?? "").localeCompare(right.sourceId ?? "") ||
    left.name.localeCompare(right.name)
  );
}

function createIssue(
  code: string,
  message: string,
  options: { severity?: "info" | "warning" | "error"; level?: TerritoryAdminLevel } = {}
): TerritoryCountryBuildIssue {
  return {
    code,
    severity: options.severity ?? "error",
    message,
    level: options.level ?? "ADM3"
  };
}

function compareIssues(
  left: TerritoryCountryBuildIssue,
  right: TerritoryCountryBuildIssue
): number {
  return (
    (left.level ?? "").localeCompare(right.level ?? "") ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}
