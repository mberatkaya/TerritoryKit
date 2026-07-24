import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { TerritoryAdminLevel } from "@territory-kit/dataset";
import { fetchHttpSourceArtifact } from "../sources/transports/http.js";
import { isRecord, readStringPropertyPath } from "../sources/utils.js";
import { getTerritoryCountryConfig } from "./registry.js";
import type { TerritoryCountryBuildIssue, TerritoryResolvedBoundarySource } from "./types.js";

export interface TerritoryBoundarySourceResolveOptions {
  country: string;
  adminLevel: TerritoryAdminLevel;
  releaseType?: string;
  metadataPath?: string;
  metadataUrl?: string;
  cacheDir?: string;
  noCache?: boolean;
  refresh?: boolean;
  buildDate?: string;
  cwd?: string;
}

export interface TerritoryBoundarySourceResolveResult {
  source?: TerritoryResolvedBoundarySource;
  issues: TerritoryCountryBuildIssue[];
}

const GEOBOUNDARIES_API_BASE = "https://www.geoboundaries.org/api/current";
const TURKEY_HDX_COD_AB_RELEASE_TYPE = "hdx-cod-ab";
const TURKEY_HDX_COD_AB_PACKAGE_URL = "https://data.humdata.org/dataset/cod-ab-tur";
const TURKEY_HDX_COD_AB_DOWNLOAD_URL =
  "https://data.humdata.org/dataset/d74086a0-f398-4474-9e12-1b9a70907bd0/resource/470bd810-2240-4ce0-b5c4-17434112ce41/download/tur_admin_boundaries.geojson.zip";
const TURKEY_HDX_COD_AB_LEVELS: Partial<
  Record<
    TerritoryAdminLevel,
    {
      member: string;
      featureCount: number;
      sourceDate: string;
      sha256: string;
      sizeBytes: number;
    }
  >
> = {
  ADM0: {
    member: "tur_admin0.geojson",
    featureCount: 1,
    sourceDate: "2026-01-26",
    sha256: "d346d64aa96ea0ba2b4ad1a71af1db104a10649baf04958dc90b8a36b8e1b069",
    sizeBytes: 11_119_319
  },
  ADM1: {
    member: "tur_admin1.geojson",
    featureCount: 81,
    sourceDate: "2026-01-26",
    sha256: "56b330a4f7086b4f02f8ddac55ce480c24bf813a1da7e3fb93fe4619fb00f721",
    sizeBytes: 16_671_095
  },
  ADM2: {
    member: "tur_admin2.geojson",
    featureCount: 973,
    sourceDate: "2026-01-26",
    sha256: "91b0968125b7bf3e2eb1d682697c51154ff3384f78ecf4e5f6e9041a24a287f2",
    sizeBytes: 29_223_893
  }
};

export async function resolveTerritoryBoundarySource(
  options: TerritoryBoundarySourceResolveOptions
): Promise<TerritoryBoundarySourceResolveResult> {
  const config = getTerritoryCountryConfig(options.country);
  const releaseType = options.releaseType ?? config.defaultReleaseType ?? "gbOpen";
  const metadataUrl =
    options.metadataUrl ??
    `${GEOBOUNDARIES_API_BASE}/${releaseType}/${config.countryCodeAlpha3}/${options.adminLevel}/`;
  const issues: TerritoryCountryBuildIssue[] = [];
  let metadataInput: unknown;

  if (
    config.countryCodeAlpha2 === "TR" &&
    releaseType === TURKEY_HDX_COD_AB_RELEASE_TYPE &&
    !options.metadataPath &&
    !options.metadataUrl
  ) {
    return resolveTurkeyHdxCodAbSource(config, options.adminLevel, options.buildDate);
  }

  try {
    metadataInput = options.metadataPath
      ? JSON.parse(
          await readFile(resolve(options.cwd ?? process.cwd(), options.metadataPath), "utf8")
        )
      : await readRemoteMetadata(metadataUrl, options);
  } catch (error) {
    return {
      issues: [
        createIssue(
          "SOURCE_METADATA_INVALID",
          error instanceof Error ? error.message : String(error),
          {
            level: options.adminLevel
          }
        )
      ]
    };
  }

  const matches = readMetadataRecords(metadataInput).filter((record) =>
    metadataRecordMatches(record, {
      alpha2: config.countryCodeAlpha2,
      alpha3: config.countryCodeAlpha3,
      adminLevel: options.adminLevel,
      releaseType
    })
  );

  if (matches.length === 0) {
    return {
      issues: [
        createIssue(
          "SOURCE_METADATA_NOT_FOUND",
          `No ${config.countryCodeAlpha2} ${options.adminLevel} metadata entry was found.`,
          { level: options.adminLevel }
        )
      ]
    };
  }

  if (matches.length > 1) {
    return {
      issues: [
        createIssue(
          "SOURCE_METADATA_AMBIGUOUS",
          `Multiple ${config.countryCodeAlpha2} ${options.adminLevel} metadata entries were found.`,
          { level: options.adminLevel }
        )
      ]
    };
  }

  const record = matches[0] as Record<string, unknown>;
  const sourceUrl = readFirstString(record, [
    "simplifiedGeometryGeoJSON",
    "gjDownloadURL",
    "gjDownloadUrl",
    "downloadURL",
    "downloadUrl",
    "staticDownloadLink",
    "sourceUrl",
    "url"
  ]);

  if (!sourceUrl) {
    return {
      issues: [
        createIssue("SOURCE_URL_MISSING", "Boundary metadata did not include a download URL.", {
          level: options.adminLevel
        })
      ]
    };
  }

  const protocolIssue = validateSourceUrl(sourceUrl, options.adminLevel);

  if (protocolIssue) {
    return { issues: [protocolIssue] };
  }

  const attribution =
    readFirstString(record, ["attribution", "sourceAttribution", "boundarySource"]) ??
    `geoBoundaries ${config.countryCodeAlpha2} ${options.adminLevel} (${releaseType})`;
  const license = readFirstString(record, [
    "license",
    "sourceLicense",
    "licenseType",
    "boundaryLicense"
  ]);
  const licenseUrl = readFirstString(record, ["licenseUrl", "licenseSource"]);
  const boundaryId = readFirstString(record, ["boundaryID", "boundaryId", "shapeID"]);
  const boundaryName = readFirstString(record, ["boundaryName", "shapeName", "name"]);
  const boundaryYearRepresented = readFirstString(record, [
    "boundaryYearRepresented",
    "year",
    "sourceDate"
  ]);
  const sourceVersion = readFirstString(record, ["sourceVersion", "boundaryCanonical"]);
  const licenseDetail = readFirstString(record, ["licenseDetail", "licenseUrl", "licenseSource"]);
  const sourceDate = readFirstString(record, [
    "sourceDate",
    "sourceDataUpdateDate",
    "boundaryYearRepresented",
    "buildDate"
  ]);
  const expectedSha256 = readFirstString(record, ["sha256", "checksum", "sourceSha256"]);
  const sourceFeatureCount = readFirstNumber(record, ["admUnitCount", "featureCount"]);

  if (!license) {
    issues.push(
      createIssue("SOURCE_LICENSE_MISSING", "Boundary metadata did not include license metadata.", {
        severity: "warning",
        level: options.adminLevel
      })
    );
  }

  if (!attribution) {
    issues.push(
      createIssue("SOURCE_ATTRIBUTION_MISSING", "Boundary metadata did not include attribution.", {
        severity: "warning",
        level: options.adminLevel
      })
    );
  }

  const originalFilename = inferFilename(sourceUrl);

  return {
    source: {
      provider: "geoboundaries",
      releaseType,
      countryCodeAlpha2: config.countryCodeAlpha2,
      countryCodeAlpha3: config.countryCodeAlpha3,
      adminLevel: options.adminLevel,
      ...(boundaryId ? { boundaryId } : {}),
      ...(boundaryName ? { boundaryName } : {}),
      ...(boundaryYearRepresented ? { boundaryYearRepresented } : {}),
      ...(sourceVersion ? { sourceVersion } : {}),
      sourceUrl,
      resolvedDownloadUrl: sourceUrl,
      metadataUrl: options.metadataPath
        ? resolve(options.cwd ?? process.cwd(), options.metadataPath)
        : metadataUrl,
      ...(license ? { sourceLicense: license } : {}),
      ...(licenseUrl ? { licenseUrl } : {}),
      ...(licenseDetail ? { licenseDetail } : {}),
      attribution,
      redistributionStatus: "source-defined",
      commercialUseStatus: "source-defined",
      ...(sourceDate ? { sourceDate } : {}),
      ...(options.buildDate ? { buildDate: options.buildDate } : {}),
      ...(expectedSha256 ? { expectedSha256 } : {}),
      ...(typeof record.sizeBytes === "number" ? { sizeBytes: record.sizeBytes } : {}),
      ...(sourceFeatureCount !== undefined ? { sourceFeatureCount } : {}),
      ...(originalFilename ? { originalFilename } : {}),
      originalFormat: inferFormat(sourceUrl)
    },
    issues
  };
}

function resolveTurkeyHdxCodAbSource(
  config: ReturnType<typeof getTerritoryCountryConfig>,
  adminLevel: TerritoryAdminLevel,
  buildDate: string | undefined
): TerritoryBoundarySourceResolveResult {
  const level = TURKEY_HDX_COD_AB_LEVELS[adminLevel];

  if (!level) {
    return {
      issues: [
        createIssue(
          "SOURCE_METADATA_NOT_FOUND",
          `HDX COD-AB Türkiye source catalog has no nationwide ${adminLevel} boundary. ADM3/ADM4 remain blocked until a redistributable nationwide official source is added.`,
          { severity: "warning", level: adminLevel }
        )
      ]
    };
  }

  return {
    source: {
      provider: "hdx-cod-ab",
      releaseType: TURKEY_HDX_COD_AB_RELEASE_TYPE,
      countryCodeAlpha2: config.countryCodeAlpha2,
      countryCodeAlpha3: config.countryCodeAlpha3,
      adminLevel,
      boundaryId: `cod-ab-tur-${adminLevel.toLowerCase()}`,
      boundaryName: `Türkiye COD-AB ${adminLevel}`,
      boundaryYearRepresented: "2022",
      sourceVersion: "v01",
      sourceUrl: `${TURKEY_HDX_COD_AB_DOWNLOAD_URL}#${level.member}`,
      resolvedDownloadUrl: TURKEY_HDX_COD_AB_DOWNLOAD_URL,
      metadataUrl: TURKEY_HDX_COD_AB_PACKAGE_URL,
      sourceLicense: "CC BY-IGO",
      licenseUrl: "https://data.humdata.org/dataset/cod-ab-tur",
      licenseDetail: "HDX package license_id: cc-by-igo",
      attribution: "OCHA Common Operational Dataset: Türkiye Administrative Boundaries",
      redistributionStatus: "allowed-with-attribution",
      commercialUseStatus: "allowed-with-attribution",
      sourceDate: level.sourceDate,
      ...(buildDate ? { buildDate } : {}),
      expectedSha256: level.sha256,
      sizeBytes: level.sizeBytes,
      originalFilename: level.member,
      originalFormat: "GeoJSON ZIP member",
      sourceFeatureCount: level.featureCount
    },
    issues: []
  };
}

function readMetadataRecords(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) {
    return input.filter(isRecord);
  }

  if (isRecord(input)) {
    for (const path of ["results", "boundaries", "data", "items"]) {
      const value = input[path];

      if (Array.isArray(value)) {
        return value.filter(isRecord);
      }
    }

    return [input];
  }

  throw new Error("Metadata response must be an object or array.");
}

function metadataRecordMatches(
  record: Record<string, unknown>,
  expected: { alpha2: string; alpha3: string; adminLevel: TerritoryAdminLevel; releaseType: string }
): boolean {
  const country =
    readFirstString(record, ["countryCodeAlpha3", "boundaryISO", "shapeGroup", "country"]) ?? "";
  const adminLevel =
    readFirstString(record, ["adminLevel", "boundaryType", "shapeType", "admLevel"]) ?? "";
  const releaseType = readFirstString(record, ["releaseType", "type"]) ?? expected.releaseType;

  return (
    [expected.alpha2, expected.alpha3].includes(country.toUpperCase()) &&
    adminLevel.toUpperCase() === expected.adminLevel &&
    releaseType === expected.releaseType
  );
}

function readFirstString(
  record: Record<string, unknown>,
  paths: readonly string[]
): string | undefined {
  for (const path of paths) {
    const value = normalizeMetadataString(readStringPropertyPath(record, path));

    if (value) {
      return value;
    }
  }

  return undefined;
}

function readFirstNumber(
  record: Record<string, unknown>,
  paths: readonly string[]
): number | undefined {
  for (const path of paths) {
    const value = record[path];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }

  return undefined;
}

function normalizeMetadataString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed || ["nan", "null", "undefined"].includes(trimmed.toLowerCase())) {
    return undefined;
  }

  return trimmed;
}

function inferFilename(sourceUrl: string): string | undefined {
  try {
    const pathname = new URL(sourceUrl).pathname;
    const filename = pathname.split("/").filter(Boolean).at(-1);
    return filename || undefined;
  } catch {
    const filename = sourceUrl.split(/[\\/]/).filter(Boolean).at(-1);
    return filename || undefined;
  }
}

function inferFormat(sourceUrl: string): string {
  const filename = inferFilename(sourceUrl)?.toLowerCase() ?? sourceUrl.toLowerCase();

  if (filename.endsWith(".geojson") || filename.endsWith(".json")) {
    return "GeoJSON";
  }

  if (filename.endsWith(".zip")) {
    return "ZIP";
  }

  return "unknown";
}

function validateSourceUrl(
  sourceUrl: string,
  level: TerritoryAdminLevel
): TerritoryCountryBuildIssue | undefined {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(sourceUrl)) {
    return undefined;
  }

  try {
    const url = new URL(sourceUrl);

    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "file:") {
      return undefined;
    }

    return createIssue(
      "SOURCE_PROTOCOL_UNSUPPORTED",
      `Source URL protocol '${url.protocol}' is not supported.`,
      {
        level
      }
    );
  } catch {
    return createIssue("SOURCE_URL_INVALID", `Source URL '${sourceUrl}' is invalid.`, { level });
  }
}

async function readRemoteMetadata(
  metadataUrl: string,
  options: TerritoryBoundarySourceResolveOptions
): Promise<unknown> {
  const artifact = await fetchHttpSourceArtifact({
    provider: "geoboundaries-metadata",
    url: metadataUrl,
    maxSourceSizeBytes: 5 * 1024 * 1024,
    now: () => resolveBuildTimestamp(options.buildDate)
  });

  return JSON.parse(await readFile(artifact.localPath, "utf8")) as unknown;
}

function resolveBuildTimestamp(buildDate: string | undefined): string {
  if (buildDate) {
    return new Date(buildDate).toISOString();
  }

  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;

  if (sourceDateEpoch && /^\d+$/.test(sourceDateEpoch)) {
    return new Date(Number(sourceDateEpoch) * 1000).toISOString();
  }

  return new Date().toISOString();
}

function createIssue(
  code: string,
  message: string,
  options: { severity?: "warning" | "error"; level?: TerritoryAdminLevel } = {}
): TerritoryCountryBuildIssue {
  return {
    code,
    severity: options.severity ?? "error",
    message,
    ...(options.level ? { level: options.level } : {})
  };
}
