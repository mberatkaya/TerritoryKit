import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { basename, dirname, join, resolve } from "node:path";
import {
  TERRITORY_SCHEMA_VERSION,
  computeGeometryBBox,
  computeGeometryCenter,
  createTerritoryGlobalId,
  normalizeTerritoryCountryCode,
  validateGlobalDatasetManifest,
  validateTerritoryDataset
} from "@territory-kit/dataset";
import type {
  TerritoryDataset,
  TerritoryGeometry,
  TerritoryGlobalDatasetManifest,
  TerritoryGlobalMetadata,
  TerritoryZone
} from "@territory-kit/dataset";

export const WORLD_COUNTRIES_DATASET_ID = "world-countries" as const;
export const NATURAL_EARTH_PROVIDER = "natural-earth" as const;
export const NATURAL_EARTH_ADM0_DATASET_NAME = "ne_admin_0_countries" as const;
export const NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE = "Public Domain" as const;
export const NATURAL_EARTH_ATTRIBUTION = "Made with Natural Earth" as const;
export const NATURAL_EARTH_ADM0_SOURCE_URL =
  "https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/" as const;
export const NATURAL_EARTH_ADM0_DETAILS = ["low", "medium", "high"] as const;

export type NaturalEarthAdm0Detail = (typeof NATURAL_EARTH_ADM0_DETAILS)[number];

export interface NaturalEarthSourceDescriptor {
  provider: typeof NATURAL_EARTH_PROVIDER;
  datasetName: typeof NATURAL_EARTH_ADM0_DATASET_NAME | string;
  version: string;
  sourcePath: string;
  sourceUrl?: string | undefined;
  sourceSha256?: string | undefined;
  downloadedAt?: string | undefined;
  license: typeof NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE | string;
  attribution: typeof NATURAL_EARTH_ATTRIBUTION | string;
  sourceDate: string;
  importedAt: string;
}

export interface NaturalEarthAdm0Issue {
  code: string;
  message: string;
  severity: "error" | "warning";
  path?: string | undefined;
  detail?: NaturalEarthAdm0Detail | undefined;
  expectedSha256?: string | undefined;
  actualSha256?: string | undefined;
  featureId?: string | undefined;
  sourcePath?: string | undefined;
  territoryId?: string | undefined;
  repairSuggestion?: string | undefined;
}

export interface NaturalEarthAdm0ParseResult {
  records: NaturalEarthAdm0Record[];
  issues: NaturalEarthAdm0Issue[];
  inputFeatureCount: number;
  acceptedFeatureCount: number;
  skippedFeatureCount: number;
  duplicateCodeCount: number;
  fallbackIdCount: number;
}

export interface NaturalEarthAdm0BuildOptions {
  sourcePath: string;
  outputPath: string;
  buildDate?: string | undefined;
  datasetVersion?: string | undefined;
  details?: NaturalEarthAdm0Detail[] | undefined;
  force?: boolean | undefined;
  sourceDate?: string | undefined;
  sourceSha256?: string | undefined;
  sourceUrl?: string | undefined;
  sourceVersion?: string | undefined;
  strict?: boolean | undefined;
  env?: Record<string, string | undefined> | undefined;
}

export interface NaturalEarthAdm0CreateOptions {
  buildDate: string;
  datasetVersion?: string | undefined;
  details?: NaturalEarthAdm0Detail[] | undefined;
  source: NaturalEarthSourceDescriptor;
}

export interface NaturalEarthAdm0DetailReport {
  detail: NaturalEarthAdm0Detail;
  featureCount: number;
  polygonCount: number;
  multiPolygonCount: number;
  coordinateCount: number;
  uncompressedSizeBytes: number;
  gzipSizeBytes: number;
  geometryHash: string;
}

export interface NaturalEarthAdm0BuildReport {
  datasetId: typeof WORLD_COUNTRIES_DATASET_ID;
  inputFeatureCount: number;
  acceptedFeatureCount: number;
  skippedFeatureCount: number;
  warningCount: number;
  errorCount: number;
  duplicateCodeCount: number;
  fallbackIdCount: number;
  details: NaturalEarthAdm0DetailReport[];
  artifactSizes: Record<string, number>;
  buildDurationMs: number;
  buildDurationPolicy: "normalized-for-reproducibility";
  sourceSha256: string;
  outputChecksums: Record<string, string>;
  issues: NaturalEarthAdm0Issue[];
}

export interface NaturalEarthAdm0BuildResult {
  ok: boolean;
  outputPath: string;
  issues: NaturalEarthAdm0Issue[];
  summary?: {
    datasetId: typeof WORLD_COUNTRIES_DATASET_ID;
    details: NaturalEarthAdm0Detail[];
    featureCount: number;
    warningCount: number;
    outputPath: string;
    checksumsVerified: boolean;
  };
  manifest?: TerritoryGlobalDatasetManifest;
  checksums?: NaturalEarthChecksums;
  buildReport?: NaturalEarthAdm0BuildReport;
}

export interface NaturalEarthChecksums {
  algorithm: "sha256";
  files: Record<string, string>;
}

interface NaturalEarthAdm0Record {
  id: string;
  sourceFeatureId?: string;
  sourceCode: string;
  iso3166_1: string;
  name: string;
  englishName?: string;
  geometry: TerritoryGeometry;
  countryMetadata: Record<string, string>;
  usedFallbackId: boolean;
}

interface ArtifactPlan {
  files: Map<string, string>;
  manifest: TerritoryGlobalDatasetManifest;
  checksums: NaturalEarthChecksums;
  buildReport: NaturalEarthAdm0BuildReport;
  issues: NaturalEarthAdm0Issue[];
  details: NaturalEarthAdm0Detail[];
}

const COUNTRY_CODE_CANDIDATES = ["ISO_A2", "ISO_A2_EH", "WB_A2", "POSTAL", "FIPS_10"] as const;
const SOURCE_CODE_CANDIDATES = ["ADM0_A3", "ISO_A3", "SOV_A3", "GU_A3", "BRK_A3"] as const;
const NAME_CANDIDATES = [
  "NAME",
  "NAME_EN",
  "FORMAL_EN",
  "ADMIN",
  "SOVEREIGNT",
  "BRK_NAME"
] as const;
const COUNTRY_METADATA_FIELDS = [
  "ADM0_A3",
  "ISO_A3",
  "SOV_A3",
  "GU_A3",
  "BRK_A3",
  "CONTINENT",
  "REGION_UN",
  "SUBREGION"
] as const;

export async function buildWorldCountriesDataset(
  options: NaturalEarthAdm0BuildOptions
): Promise<NaturalEarthAdm0BuildResult> {
  const outputPath = resolve(options.outputPath);
  const sourcePath = resolve(options.sourcePath);
  const initialIssues: NaturalEarthAdm0Issue[] = [];

  if (await pathExists(outputPath)) {
    if (!options.force) {
      return {
        ok: false,
        outputPath,
        issues: [
          {
            code: "OUTPUT_EXISTS",
            message: `Output path '${outputPath}' already exists.`,
            severity: "error",
            path: outputPath,
            repairSuggestion: "Use --force or choose a new --output directory."
          }
        ]
      };
    }
  }

  let sourceContent: string;

  try {
    sourceContent = await readFile(sourcePath, "utf8");
  } catch (error) {
    return {
      ok: false,
      outputPath,
      issues: [
        {
          code: "SOURCE_NOT_FOUND",
          message: error instanceof Error ? error.message : String(error),
          severity: "error",
          sourcePath
        }
      ]
    };
  }

  const actualSha256 = sha256Hex(sourceContent);

  if (options.sourceSha256 && options.sourceSha256 !== actualSha256) {
    return {
      ok: false,
      outputPath,
      issues: [
        {
          code: "SOURCE_CHECKSUM_MISMATCH",
          message: "Source SHA-256 does not match the expected checksum.",
          severity: "error",
          sourcePath,
          expectedSha256: options.sourceSha256,
          actualSha256
        }
      ]
    };
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(sourceContent) as unknown;
  } catch (error) {
    return {
      ok: false,
      outputPath,
      issues: [
        {
          code: "INVALID_JSON",
          message: error instanceof Error ? error.message : String(error),
          severity: "error",
          sourcePath
        }
      ]
    };
  }

  const buildDate = resolveBuildDate(options.buildDate, options.env ?? process.env);
  const sourceVersion = options.sourceVersion ?? "unknown";
  const source: NaturalEarthSourceDescriptor = {
    provider: NATURAL_EARTH_PROVIDER,
    datasetName: NATURAL_EARTH_ADM0_DATASET_NAME,
    version: sourceVersion,
    sourcePath,
    sourceUrl: options.sourceUrl ?? NATURAL_EARTH_ADM0_SOURCE_URL,
    sourceSha256: actualSha256,
    license: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
    attribution: NATURAL_EARTH_ATTRIBUTION,
    sourceDate: options.sourceDate ?? sourceVersion,
    importedAt: buildDate
  };

  const createResult = createWorldCountriesAdm0ArtifactPlan(parsedJson, {
    buildDate,
    datasetVersion: options.datasetVersion,
    details: options.details,
    source
  });
  const strictWarnings = options.strict
    ? createResult.issues
        .filter((issue) => issue.severity === "warning")
        .map((issue) => ({
          ...issue,
          code: `STRICT_${issue.code}`,
          message: `Strict mode treats warning as failure: ${issue.message}`,
          severity: "error" as const
        }))
    : [];
  const issues = [...initialIssues, ...createResult.issues, ...strictWarnings];

  if (issues.some((issue) => issue.severity === "error")) {
    return {
      ok: false,
      outputPath,
      issues
    };
  }

  const tempParent = dirname(outputPath);
  await mkdir(tempParent, { recursive: true });
  const tempPath = await mkdtemp(join(tempParent, `.${basename(outputPath)}-tmp-`));

  try {
    await writeArtifactFiles(tempPath, createResult.files);

    if (await pathExists(outputPath)) {
      await rm(outputPath, { recursive: true, force: true });
    }

    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { recursive: true, force: true });

    return {
      ok: false,
      outputPath,
      issues: [
        {
          code: "OUTPUT_WRITE_FAILED",
          message: error instanceof Error ? error.message : String(error),
          severity: "error",
          path: outputPath
        }
      ]
    };
  }

  return {
    ok: true,
    outputPath,
    issues,
    manifest: createResult.manifest,
    checksums: createResult.checksums,
    buildReport: createResult.buildReport,
    summary: {
      datasetId: WORLD_COUNTRIES_DATASET_ID,
      details: createResult.details,
      featureCount: createResult.buildReport.acceptedFeatureCount,
      warningCount: createResult.buildReport.warningCount,
      outputPath,
      checksumsVerified: true
    }
  };
}

export function createWorldCountriesAdm0ArtifactPlan(
  input: unknown,
  options: NaturalEarthAdm0CreateOptions
): ArtifactPlan {
  const details = normalizeDetails(options.details);
  const parseResult = parseNaturalEarthAdm0FeatureCollection(input, options.source);
  const issues: NaturalEarthAdm0Issue[] = [...parseResult.issues];
  const datasetFiles = new Map<string, string>();
  const detailReports: NaturalEarthAdm0DetailReport[] = [];
  const detailGeometryHashes: Record<string, string> = {};
  const countryCodes = [
    ...new Set(parseResult.records.map((record) => record.iso3166_1.toLowerCase()))
  ].sort((left, right) => left.localeCompare(right));

  for (const detail of details) {
    const dataset = createDatasetForDetail(parseResult.records, detail, options);
    const validation = validateTerritoryDataset(dataset);

    if (!validation.ok) {
      issues.push(
        ...validation.issues.map((issue): NaturalEarthAdm0Issue => ({
          code: `DATASET_${issue.code}`,
          message: issue.message,
          severity: issue.severity,
          detail,
          path: issue.path,
          territoryId: issue.zoneId,
          repairSuggestion: issue.repairSuggestion
        }))
      );
    }

    const serialized = serializeJsonStable(dataset);
    const report = createDetailReport(detail, dataset, serialized);
    datasetFiles.set(`${detail}/dataset.json`, serialized);
    detailReports.push(report);
    detailGeometryHashes[detail] = report.geometryHash;
  }

  const datasetChecksums = Object.fromEntries(
    [...datasetFiles.entries()].map(([filePath, content]) => [filePath, sha256Hex(content)])
  );
  const manifest = createRootManifest({
    buildDate: options.buildDate,
    countryCodes,
    details,
    detailGeometryHashes,
    source: options.source,
    datasetChecksums,
    ...(options.datasetVersion ? { datasetVersion: options.datasetVersion } : {})
  });
  const manifestValidation = validateGlobalDatasetManifest(manifest);

  if (!manifestValidation.ok) {
    issues.push(
      ...manifestValidation.issues.map((issue): NaturalEarthAdm0Issue => ({
        code: `MANIFEST_${issue.code}`,
        message: issue.message,
        severity: "error",
        path: issue.path
      }))
    );
  }

  const files = new Map<string, string>();

  for (const [filePath, content] of datasetFiles) {
    files.set(filePath, content);
  }

  const manifestJson = serializeJsonStable(manifest);
  const attribution = createAttributionText(manifest, options.source);
  files.set("manifest.json", manifestJson);
  files.set("attribution.txt", attribution);

  const outputChecksums = Object.fromEntries(
    [...files.entries()].map(([filePath, content]) => [filePath, sha256Hex(content)])
  );
  const artifactSizes = Object.fromEntries(
    [...files.entries()].map(([filePath, content]) => [filePath, Buffer.byteLength(content)])
  );
  const buildReport: NaturalEarthAdm0BuildReport = {
    datasetId: WORLD_COUNTRIES_DATASET_ID,
    inputFeatureCount: parseResult.inputFeatureCount,
    acceptedFeatureCount: parseResult.acceptedFeatureCount,
    skippedFeatureCount: parseResult.skippedFeatureCount,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    duplicateCodeCount: parseResult.duplicateCodeCount,
    fallbackIdCount: parseResult.fallbackIdCount,
    details: detailReports,
    artifactSizes,
    buildDurationMs: 0,
    buildDurationPolicy: "normalized-for-reproducibility",
    sourceSha256: options.source.sourceSha256 ?? "",
    outputChecksums,
    issues
  };
  const buildReportJson = serializeJsonStable(buildReport);
  files.set("build-report.json", buildReportJson);

  const checksums: NaturalEarthChecksums = {
    algorithm: "sha256",
    files: Object.fromEntries(
      [...files.entries()]
        .map(([filePath, content]) => [filePath, sha256Hex(content)] as const)
        .sort(([left], [right]) => left.localeCompare(right))
    )
  };
  files.set("checksums.json", serializeJsonStable(checksums));

  return {
    files,
    manifest,
    checksums,
    buildReport,
    issues,
    details
  };
}

export function parseNaturalEarthAdm0FeatureCollection(
  input: unknown,
  source: NaturalEarthSourceDescriptor
): NaturalEarthAdm0ParseResult {
  const issues: NaturalEarthAdm0Issue[] = [];

  if (!isRecord(input)) {
    return emptyParseResult([
      {
        code: "GEOJSON_ROOT",
        message: "Natural Earth input must be a GeoJSON object.",
        severity: "error",
        path: "$",
        sourcePath: source.sourcePath
      }
    ]);
  }

  if (input.type !== "FeatureCollection" || !Array.isArray(input.features)) {
    return emptyParseResult([
      {
        code: "FEATURE_COLLECTION_SHAPE",
        message: "Natural Earth input root must be a GeoJSON FeatureCollection.",
        severity: "error",
        path: "$.type",
        sourcePath: source.sourcePath
      }
    ]);
  }

  const records: NaturalEarthAdm0Record[] = [];
  const seenCountryCodes = new Set<string>();
  const seenTerritoryIds = new Set<string>();
  let duplicateCodeCount = 0;
  let fallbackIdCount = 0;

  input.features.forEach((feature, index) => {
    const path = `$.features[${index}]`;
    const featureId = readFeatureId(feature, index);

    if (!isRecord(feature) || feature.type !== "Feature") {
      issues.push({
        code: "FEATURE_SHAPE",
        message: "GeoJSON feature must be an object with type 'Feature'.",
        severity: "error",
        path,
        featureId,
        sourcePath: source.sourcePath
      });
      return;
    }

    if (!isRecord(feature.properties)) {
      issues.push({
        code: "UNSUPPORTED_PROPERTIES",
        message: "Natural Earth feature properties must be an object.",
        severity: "error",
        path: `${path}.properties`,
        featureId,
        sourcePath: source.sourcePath
      });
      return;
    }

    const geometry = readFeatureGeometry(feature.geometry, `${path}.geometry`, issues, {
      sourcePath: source.sourcePath,
      ...(featureId ? { featureId } : {})
    });
    const codeResult = readCountryCode(feature.properties);
    const sourceCode = readFirstString(feature.properties, SOURCE_CODE_CANDIDATES);
    const nameResult = readCountryName(feature.properties, codeResult.countryCode ?? sourceCode);

    if (!codeResult.countryCode) {
      issues.push({
        code: "COUNTRY_CODE_MISSING",
        message: "Feature does not contain a usable ISO alpha-2 or stable alpha-2 fallback code.",
        severity: "error",
        path: `${path}.properties`,
        featureId,
        sourcePath: source.sourcePath,
        repairSuggestion: `Populate one of ${COUNTRY_CODE_CANDIDATES.join(", ")} with a stable alpha-2 code.`
      });
    }

    if (codeResult.usedFallback) {
      fallbackIdCount += 1;
      issues.push({
        code: "FALLBACK_COUNTRY_CODE",
        message: `Using ${codeResult.sourceField} as the ADM0 id source because ISO_A2 is missing or invalid.`,
        severity: "warning",
        path: `${path}.properties.${codeResult.sourceField}`,
        featureId,
        sourcePath: source.sourcePath
      });
    }

    if (nameResult.usedFallback) {
      issues.push({
        code: "NAME_MISSING",
        message: "Feature does not contain a preferred Natural Earth name; using code fallback.",
        severity: "warning",
        path: `${path}.properties`,
        featureId,
        sourcePath: source.sourcePath
      });
    }

    if (!geometry || !codeResult.countryCode) {
      return;
    }

    const id = createTerritoryGlobalId({ countryCode: codeResult.countryCode });
    const normalizedCountryCode = normalizeTerritoryCountryCode(codeResult.countryCode);

    if (seenCountryCodes.has(normalizedCountryCode)) {
      duplicateCodeCount += 1;
      issues.push({
        code: "DUPLICATE_COUNTRY_CODE",
        message: `Country code '${normalizedCountryCode}' appears more than once.`,
        severity: "error",
        path: `${path}.properties.${codeResult.sourceField}`,
        featureId,
        sourcePath: source.sourcePath,
        territoryId: id
      });
      return;
    }

    if (seenTerritoryIds.has(id)) {
      issues.push({
        code: "DUPLICATE_TERRITORY_ID",
        message: `TerritoryKit id '${id}' appears more than once.`,
        severity: "error",
        path: `${path}.properties.${codeResult.sourceField}`,
        featureId,
        sourcePath: source.sourcePath,
        territoryId: id
      });
      return;
    }

    seenCountryCodes.add(normalizedCountryCode);
    seenTerritoryIds.add(id);

    records.push({
      id,
      ...(featureId ? { sourceFeatureId: featureId } : {}),
      sourceCode: sourceCode ?? codeResult.countryCode.toUpperCase(),
      iso3166_1: codeResult.countryCode.toUpperCase(),
      name: nameResult.name ?? codeResult.countryCode.toUpperCase(),
      ...(nameResult.englishName ? { englishName: nameResult.englishName } : {}),
      geometry,
      countryMetadata: readCountryMetadata(feature.properties),
      usedFallbackId: codeResult.usedFallback
    });
  });

  const errorFeatureIndexes = new Set(
    issues
      .filter((issue) => issue.severity === "error" && issue.path?.startsWith("$.features["))
      .map((issue) => issue.path?.match(/^\$\.features\[(\d+)\]/)?.[1])
      .filter((index): index is string => index !== undefined)
  );

  return {
    records: records.sort((left, right) => left.id.localeCompare(right.id)),
    issues,
    inputFeatureCount: input.features.length,
    acceptedFeatureCount: records.length,
    skippedFeatureCount: errorFeatureIndexes.size,
    duplicateCodeCount,
    fallbackIdCount
  };
}

export function normalizeNaturalEarthDetails(
  details: NaturalEarthAdm0Detail[] | undefined
): NaturalEarthAdm0Detail[] {
  return normalizeDetails(details);
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function serializeJsonStable(input: unknown): string {
  return `${JSON.stringify(sortJson(input), null, 2)}\n`;
}

export function resolveBuildDate(
  explicitBuildDate: string | undefined,
  env: Record<string, string | undefined> = process.env
): string {
  if (explicitBuildDate) {
    return new Date(explicitBuildDate).toISOString();
  }

  const sourceDateEpoch = env.SOURCE_DATE_EPOCH;

  if (sourceDateEpoch) {
    const epochSeconds = Number(sourceDateEpoch);

    if (!Number.isFinite(epochSeconds)) {
      throw new Error("SOURCE_DATE_EPOCH must be a Unix timestamp in seconds.");
    }

    return new Date(epochSeconds * 1000).toISOString();
  }

  return new Date().toISOString();
}

function createDatasetForDetail(
  records: NaturalEarthAdm0Record[],
  detail: NaturalEarthAdm0Detail,
  options: NaturalEarthAdm0CreateOptions
): TerritoryDataset {
  const zones = records.map((record) => createZoneForDetail(record, detail, options.source));
  const dataset = {
    manifest: {
      datasetId: WORLD_COUNTRIES_DATASET_ID,
      datasetVersion: options.datasetVersion ?? "0.1.0",
      schemaVersion: TERRITORY_SCHEMA_VERSION,
      sourceDate: options.source.sourceDate,
      geometryHash: "pending",
      adminLevels: ["ADM0"],
      artifactChecksum: "recorded-in-checksums-json",
      attribution: options.source.attribution,
      boundaryPolicy: "natural-earth-source-represented",
      buildDate: options.buildDate,
      countryCodes: records.map((record) => record.iso3166_1.toLowerCase()).sort(),
      crs: "EPSG:4326",
      disputedAreaPolicy: "natural-earth-disputed-boundaries-not-authoritative",
      geometryDetail: detail,
      license: options.source.license,
      name: "World Countries ADM0",
      description:
        "Natural Earth ADM0 countries and dependent territories converted to TerritoryKit.",
      sourceProvider: options.source.provider,
      worldview: "natural-earth-international"
    },
    zones
  } satisfies TerritoryDataset;

  return {
    ...dataset,
    manifest: {
      ...dataset.manifest,
      geometryHash: createDatasetGeometryHash(dataset)
    }
  };
}

function createZoneForDetail(
  record: NaturalEarthAdm0Record,
  detail: NaturalEarthAdm0Detail,
  source: NaturalEarthSourceDescriptor
): TerritoryZone {
  const geometry = simplifyGeometry(record.geometry, detail);
  const geometryHash = sha256Hex(
    serializeJsonStable({
      detail,
      geometry,
      id: record.id
    })
  );
  const metadata: TerritoryGlobalMetadata & Record<string, unknown> = {
    adminLevel: "ADM0",
    localType: "country",
    codes: {
      iso3166_1: record.iso3166_1,
      source: record.sourceCode
    },
    names: {
      default: record.name,
      ...(record.englishName ? { en: record.englishName } : {})
    },
    source: {
      provider: source.provider,
      sourceId: record.sourceCode,
      ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
      sourceDate: source.sourceDate,
      importedAt: source.importedAt,
      license: source.license,
      attribution: source.attribution
    },
    country: record.countryMetadata,
    geometryDetail: detail,
    geometryHash,
    ...(record.usedFallbackId ? { idFallback: true } : {})
  };

  return {
    id: record.id,
    datasetId: WORLD_COUNTRIES_DATASET_ID,
    countryCode: record.iso3166_1.toUpperCase(),
    level: 0,
    sourceAdminLevel: "ADM0",
    semanticType: "country",
    name: record.name,
    ...(record.englishName && record.englishName !== record.name ? { localName: record.name } : {}),
    neighborIds: [],
    geometry,
    center: computeGeometryCenter(geometry),
    bbox: computeGeometryBBox(geometry),
    properties: {
      name: record.name,
      territory: metadata
    }
  };
}

function createRootManifest(options: {
  buildDate: string;
  countryCodes: string[];
  datasetVersion?: string;
  details: NaturalEarthAdm0Detail[];
  detailGeometryHashes: Record<string, string>;
  source: NaturalEarthSourceDescriptor;
  datasetChecksums: Record<string, string>;
}): TerritoryGlobalDatasetManifest {
  return {
    datasetId: WORLD_COUNTRIES_DATASET_ID,
    datasetVersion: options.datasetVersion ?? "0.1.0",
    schemaVersion: TERRITORY_SCHEMA_VERSION,
    sourceDate: options.source.sourceDate,
    geometryHash: sha256Hex(serializeJsonStable(options.detailGeometryHashes)),
    adminLevels: ["ADM0"],
    artifactChecksum: sha256Hex(serializeJsonStable(options.datasetChecksums)),
    attribution: options.source.attribution,
    boundaryPolicy: "natural-earth-source-represented",
    buildDate: options.buildDate,
    countryCodes: options.countryCodes,
    crs: "EPSG:4326",
    disputedAreaPolicy: "natural-earth-disputed-boundaries-not-authoritative",
    geometryDetail: "source",
    license: options.source.license,
    name: "World Countries ADM0",
    description:
      "Natural Earth ADM0 countries and dependent territories converted to TerritoryKit artifacts.",
    sourceProvider: options.source.provider,
    worldview: "natural-earth-international",
    detailLevels: options.details,
    source: {
      datasetName: options.source.datasetName,
      version: options.source.version,
      sourceUrl: options.source.sourceUrl,
      sourceSha256: options.source.sourceSha256
    },
    artifacts: options.details.map((detail) => ({
      detail,
      path: `${detail}/dataset.json`
    }))
  } as TerritoryGlobalDatasetManifest;
}

function createAttributionText(
  manifest: TerritoryGlobalDatasetManifest,
  source: NaturalEarthSourceDescriptor
): string {
  return [
    "World Countries ADM0",
    "",
    `Source: Natural Earth (${source.datasetName})`,
    `Source version: ${source.version}`,
    `Source URL: ${source.sourceUrl ?? "not provided"}`,
    `License: ${source.license}`,
    `Attribution: ${source.attribution}`,
    `Built: ${manifest.buildDate}`,
    "",
    "Natural Earth data is public domain.",
    "TerritoryKit is not the official source for any boundary represented in this artifact.",
    "Disputed boundaries follow the selected Natural Earth worldview and should not be treated as a legal boundary decision.",
    ""
  ].join("\n");
}

function createDetailReport(
  detail: NaturalEarthAdm0Detail,
  dataset: TerritoryDataset,
  serialized: string
): NaturalEarthAdm0DetailReport {
  let polygonCount = 0;
  let multiPolygonCount = 0;
  let coordinateCount = 0;

  for (const zone of dataset.zones) {
    if (zone.geometry.type === "Polygon") {
      polygonCount += 1;
      coordinateCount += countPolygonCoordinates(zone.geometry.coordinates);
    } else {
      multiPolygonCount += 1;
      coordinateCount += zone.geometry.coordinates.reduce(
        (sum, polygon) => sum + countPolygonCoordinates(polygon),
        0
      );
    }
  }

  return {
    detail,
    featureCount: dataset.zones.length,
    polygonCount,
    multiPolygonCount,
    coordinateCount,
    uncompressedSizeBytes: Buffer.byteLength(serialized),
    gzipSizeBytes: gzipSync(serialized).byteLength,
    geometryHash: createDatasetGeometryHash(dataset)
  };
}

function countPolygonCoordinates(polygon: number[][][]): number {
  return polygon.reduce((sum, ring) => sum + ring.length, 0);
}

function simplifyGeometry(
  geometry: TerritoryGeometry,
  detail: NaturalEarthAdm0Detail
): TerritoryGeometry {
  if (detail === "high") {
    return cloneGeometry(geometry);
  }

  const step = detail === "medium" ? 2 : 3;

  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) => simplifyRing(ring, step))
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((polygon) =>
      polygon.map((ring) => simplifyRing(ring, step))
    )
  };
}

function simplifyRing(ring: number[][], step: number): number[][] {
  if (ring.length <= 6) {
    return ring.map((position) => [...position]);
  }

  const first = ring[0];
  const last = ring[ring.length - 1];

  if (!first || !last) {
    return ring.map((position) => [...position]);
  }

  const simplified = [first];

  for (let index = 1; index < ring.length - 1; index += 1) {
    const position = ring[index];

    if (position && index % step === 0) {
      simplified.push(position);
    }
  }

  simplified.push(last);

  return simplified.length >= 4
    ? simplified.map((position) => [...position])
    : ring.map((p) => [...p]);
}

function cloneGeometry(geometry: TerritoryGeometry): TerritoryGeometry {
  return geometry.type === "Polygon"
    ? {
        type: "Polygon",
        coordinates: geometry.coordinates.map((ring) => ring.map((position) => [...position]))
      }
    : {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map((polygon) =>
          polygon.map((ring) => ring.map((position) => [...position]))
        )
      };
}

function readFeatureGeometry(
  input: unknown,
  path: string,
  issues: NaturalEarthAdm0Issue[],
  context: { featureId?: string; sourcePath: string }
): TerritoryGeometry | undefined {
  if (input === undefined) {
    issues.push({
      code: "GEOMETRY_MISSING",
      message: "Feature geometry is missing.",
      severity: "error",
      path,
      ...context
    });
    return undefined;
  }

  if (input === null) {
    issues.push({
      code: "GEOMETRY_NULL",
      message: "Feature geometry must not be null.",
      severity: "error",
      path,
      ...context
    });
    return undefined;
  }

  if (!isRecord(input) || (input.type !== "Polygon" && input.type !== "MultiPolygon")) {
    issues.push({
      code: "GEOMETRY_TYPE",
      message: "Feature geometry must be Polygon or MultiPolygon.",
      severity: "error",
      path: `${path}.type`,
      ...context
    });
    return undefined;
  }

  if (input.type === "Polygon") {
    const polygon = readPolygonCoordinates(
      input.coordinates,
      `${path}.coordinates`,
      issues,
      context
    );

    return polygon ? { type: "Polygon", coordinates: polygon } : undefined;
  }

  if (!Array.isArray(input.coordinates) || input.coordinates.length === 0) {
    issues.push({
      code: "GEOMETRY_COORDINATES_EMPTY",
      message: "MultiPolygon coordinates must contain at least one polygon.",
      severity: "error",
      path: `${path}.coordinates`,
      ...context
    });
    return undefined;
  }

  const polygons = input.coordinates
    .map((polygon, index) =>
      readPolygonCoordinates(polygon, `${path}.coordinates[${index}]`, issues, context)
    )
    .filter((polygon): polygon is number[][][] => polygon !== undefined);

  return polygons.length === input.coordinates.length
    ? {
        type: "MultiPolygon",
        coordinates: polygons
      }
    : undefined;
}

function readPolygonCoordinates(
  input: unknown,
  path: string,
  issues: NaturalEarthAdm0Issue[],
  context: { featureId?: string; sourcePath: string }
): number[][][] | undefined {
  if (!Array.isArray(input) || input.length === 0) {
    issues.push({
      code: "GEOMETRY_COORDINATES_EMPTY",
      message: "Polygon coordinates must contain at least one ring.",
      severity: "error",
      path,
      ...context
    });
    return undefined;
  }

  const rings = input
    .map((ring, index) => readRingCoordinates(ring, `${path}[${index}]`, issues, context))
    .filter((ring): ring is number[][] => ring !== undefined);

  return rings.length === input.length ? rings : undefined;
}

function readRingCoordinates(
  input: unknown,
  path: string,
  issues: NaturalEarthAdm0Issue[],
  context: { featureId?: string; sourcePath: string }
): number[][] | undefined {
  if (!Array.isArray(input) || input.length < 4) {
    issues.push({
      code: "GEOMETRY_RING",
      message: "Linear ring must contain at least four positions.",
      severity: "error",
      path,
      ...context
    });
    return undefined;
  }

  const coordinates = input
    .map((position, index) => readPosition(position, `${path}[${index}]`, issues, context))
    .filter((position): position is number[] => position !== undefined);
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];

  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
    issues.push({
      code: "GEOMETRY_RING_OPEN",
      message: "Linear ring must be closed.",
      severity: "error",
      path,
      ...context
    });
  }

  return coordinates.length === input.length &&
    first &&
    last &&
    first[0] === last[0] &&
    first[1] === last[1]
    ? coordinates
    : undefined;
}

function readPosition(
  input: unknown,
  path: string,
  issues: NaturalEarthAdm0Issue[],
  context: { featureId?: string; sourcePath: string }
): number[] | undefined {
  if (
    Array.isArray(input) &&
    input.length >= 2 &&
    typeof input[0] === "number" &&
    Number.isFinite(input[0]) &&
    typeof input[1] === "number" &&
    Number.isFinite(input[1]) &&
    input[0] >= -180 &&
    input[0] <= 180 &&
    input[1] >= -90 &&
    input[1] <= 90
  ) {
    return [input[0], input[1]];
  }

  issues.push({
    code: "GEOMETRY_COORDINATE",
    message: "Coordinate must be [longitude, latitude] in EPSG:4326 ranges.",
    severity: "error",
    path,
    ...context
  });
  return undefined;
}

function readCountryCode(properties: Record<string, unknown>): {
  countryCode?: string;
  sourceField?: string;
  usedFallback: boolean;
} {
  for (const [index, field] of COUNTRY_CODE_CANDIDATES.entries()) {
    const value = properties[field];

    if (typeof value !== "string") {
      continue;
    }

    try {
      return {
        countryCode: normalizeTerritoryCountryCode(value),
        sourceField: field,
        usedFallback: index > 0 || field !== "ISO_A2"
      };
    } catch {
      // Keep scanning source-specific fallbacks.
    }
  }

  return { usedFallback: false };
}

function readCountryName(
  properties: Record<string, unknown>,
  fallback: string | undefined
): {
  name?: string | undefined;
  englishName?: string | undefined;
  usedFallback: boolean;
} {
  const name = readFirstString(properties, NAME_CANDIDATES);
  const englishName = readString(properties.NAME_EN);

  return {
    name: name ?? fallback,
    ...(englishName ? { englishName } : {}),
    usedFallback: !name
  };
}

function readCountryMetadata(properties: Record<string, unknown>): Record<string, string> {
  const metadata: Record<string, string> = {};

  for (const field of COUNTRY_METADATA_FIELDS) {
    const value = readString(properties[field]);

    if (value) {
      metadata[field] = value;
    }
  }

  return metadata;
}

function readFirstString(
  properties: Record<string, unknown>,
  fields: readonly string[]
): string | undefined {
  for (const field of fields) {
    const value = readString(properties[field]);

    if (value && value !== "-99") {
      return value;
    }
  }

  return undefined;
}

function readString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0 ? input.trim() : undefined;
}

function readFeatureId(feature: unknown, index: number): string | undefined {
  if (!isRecord(feature)) {
    return `feature-${index}`;
  }

  if (typeof feature.id === "string" || typeof feature.id === "number") {
    return String(feature.id);
  }

  return `feature-${index}`;
}

function normalizeDetails(details: NaturalEarthAdm0Detail[] | undefined): NaturalEarthAdm0Detail[] {
  const requested = details ?? [...NATURAL_EARTH_ADM0_DETAILS];
  const unique = [...new Set(requested)];

  for (const detail of unique) {
    if (!NATURAL_EARTH_ADM0_DETAILS.includes(detail)) {
      throw new Error(`Invalid detail '${detail}'. Expected low, medium, or high.`);
    }
  }

  return unique;
}

function emptyParseResult(issues: NaturalEarthAdm0Issue[]): NaturalEarthAdm0ParseResult {
  return {
    records: [],
    issues,
    inputFeatureCount: 0,
    acceptedFeatureCount: 0,
    skippedFeatureCount: 0,
    duplicateCodeCount: 0,
    fallbackIdCount: 0
  };
}

function sortJson(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(sortJson);
  }

  if (isRecord(input)) {
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(input).sort((left, right) => left.localeCompare(right))) {
      const value = input[key];

      if (value !== undefined) {
        sorted[key] = sortJson(value);
      }
    }

    return sorted;
  }

  return input;
}

function createDatasetGeometryHash(dataset: Pick<TerritoryDataset, "zones">): string {
  const stableGeometryPayload = dataset.zones
    .map((zone) => ({
      geometry: zone.geometry,
      id: zone.id,
      level: zone.level,
      parentId: zone.parentId ?? null
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return sha256Hex(JSON.stringify(stableGeometryPayload));
}

async function writeArtifactFiles(rootPath: string, files: Map<string, string>): Promise<void> {
  for (const [relativePath, content] of [...files.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const filePath = join(rootPath, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
