import { TERRITORY_SCHEMA_VERSION } from "./schema.js";
import type {
  TerritoryAdminLevel,
  TerritoryCoverageStatus,
  TerritoryGeometryDetailLevel,
  TerritoryGlobalDatasetManifest,
  TerritoryGlobalMetadata,
  TerritorySemanticReviewStatus,
  TerritorySemanticAdminType,
  TerritorySourceMetadata
} from "./types.js";

export const TERRITORY_ADMIN_LEVELS = ["ADM0", "ADM1", "ADM2", "ADM3", "ADM4", "ADM5"] as const;
export const TERRITORY_GEOMETRY_DETAIL_LEVELS = ["low", "medium", "high", "source"] as const;
export const TERRITORY_SEMANTIC_ADMIN_TYPES = [
  "world",
  "country",
  "state",
  "province",
  "region",
  "governorate",
  "prefecture",
  "county",
  "district",
  "subdistrict",
  "city",
  "municipality",
  "borough",
  "commune",
  "ward",
  "neighbourhood",
  "village",
  "locality",
  "local",
  "special-administrative-area",
  "administrative-unit",
  "game-region",
  "unknown"
] as const satisfies readonly TerritorySemanticAdminType[];
export const TERRITORY_SEMANTIC_REVIEW_STATUSES = [
  "reviewed",
  "review-required",
  "mapping-review-required",
  "not-applicable"
] as const satisfies readonly TerritorySemanticReviewStatus[];
export const TERRITORY_COVERAGE_STATUSES = [
  "verified",
  "generated",
  "generated-with-warnings",
  "partial",
  "source-unavailable",
  "licence-restricted",
  "semantic-review-required",
  "deprecated"
] as const satisfies readonly TerritoryCoverageStatus[];

export interface TerritoryGlobalIdParts {
  countryCode: string;
  adminLevel?: TerritoryAdminLevel;
  localId?: string;
}

export interface TerritoryGlobalValidationIssue {
  code: "ADMIN_LEVEL" | "GLOBAL_ID" | "GLOBAL_MANIFEST" | "GLOBAL_METADATA" | "ISO_COUNTRY_CODE";
  message: string;
  path: string;
}

export interface TerritoryGlobalValidationResult<T = undefined> {
  ok: boolean;
  issues: TerritoryGlobalValidationIssue[];
  value?: T;
}

export function normalizeTerritoryCountryCode(input: string): string {
  const countryCode = input.trim().toLowerCase();

  if (!/^[a-z]{2}$/.test(countryCode)) {
    throw new Error("Country code must be an ISO 3166-1 alpha-2 code.");
  }

  return countryCode;
}

export function normalizeTerritoryAdminLevel(input: string): TerritoryAdminLevel {
  const adminLevel = input.trim().toUpperCase();

  if (isTerritoryAdminLevel(adminLevel)) {
    return adminLevel;
  }

  throw new Error("Administrative level must be ADM0, ADM1, ADM2, ADM3, ADM4, or ADM5.");
}

export function isTerritoryAdminLevel(input: string): input is TerritoryAdminLevel {
  return TERRITORY_ADMIN_LEVELS.includes(input as TerritoryAdminLevel);
}

export function getAdminLevelDepth(level: TerritoryAdminLevel): number {
  return Number(level.slice(3));
}

export function compareAdminLevels(left: TerritoryAdminLevel, right: TerritoryAdminLevel): number {
  return getAdminLevelDepth(left) - getAdminLevelDepth(right);
}

export function getParentAdminLevel(level: TerritoryAdminLevel): TerritoryAdminLevel | undefined {
  const index = TERRITORY_ADMIN_LEVELS.indexOf(level);
  return index > 0 ? TERRITORY_ADMIN_LEVELS[index - 1] : undefined;
}

export function getChildAdminLevel(level: TerritoryAdminLevel): TerritoryAdminLevel | undefined {
  const index = TERRITORY_ADMIN_LEVELS.indexOf(level);
  return index >= 0 ? TERRITORY_ADMIN_LEVELS[index + 1] : undefined;
}

export function slugifyTerritoryIdPart(input: string): string {
  const slug = replaceLatinSpecialCases(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (!slug) {
    throw new Error("Territory id part must contain at least one ASCII letter or digit.");
  }

  return slug;
}

export function createTerritoryGlobalId(parts: {
  adminLevel?: TerritoryAdminLevel | string;
  countryCode: string;
  localId?: string | number;
}): string {
  const countryCode = normalizeTerritoryCountryCode(parts.countryCode);

  if (parts.adminLevel === undefined) {
    if (parts.localId !== undefined) {
      throw new Error("ADM0 territory ids must not include a local id.");
    }

    return countryCode;
  }

  const adminLevel = normalizeTerritoryAdminLevel(parts.adminLevel);

  if (adminLevel === "ADM0") {
    if (parts.localId !== undefined) {
      throw new Error("ADM0 territory ids must not include a local id.");
    }

    return countryCode;
  }

  if (parts.localId === undefined || parts.localId === "") {
    throw new Error("Sub-country territory ids require a stable local id.");
  }

  return `${countryCode}:${adminLevel.toLowerCase()}:${slugifyTerritoryIdPart(String(parts.localId))}`;
}

export function validateTerritoryGlobalId(
  input: string
): TerritoryGlobalValidationResult<TerritoryGlobalIdParts> {
  const issues: TerritoryGlobalValidationIssue[] = [];
  const parts = input.split(":");
  const [countryCodeInput, adminLevelInput, localIdInput] = parts;

  if (parts.length !== 1 && parts.length !== 3) {
    issues.push({
      code: "GLOBAL_ID",
      message: "Territory id must be '<country>' or '<country>:<admin-level>:<local-id>'.",
      path: "$"
    });
  }

  const countryCode =
    countryCodeInput === undefined
      ? undefined
      : readCanonicalIdCountryCode(countryCodeInput, "$.country", issues);

  if (parts.length === 1) {
    return countryCode
      ? { ok: issues.length === 0, issues, value: { countryCode } }
      : { ok: false, issues };
  }

  const adminLevel =
    adminLevelInput === undefined
      ? undefined
      : readCanonicalIdAdminLevel(adminLevelInput, "$.adminLevel", issues);

  if (adminLevel === "ADM0") {
    issues.push({
      code: "GLOBAL_ID",
      message: "ADM0 territory ids use only the country code.",
      path: "$.adminLevel"
    });
  }

  if (localIdInput === undefined || !isValidLocalId(localIdInput)) {
    issues.push({
      code: "GLOBAL_ID",
      message:
        "Local id must contain lowercase ASCII letters or digits separated by '.', '_', or '-'.",
      path: "$.localId"
    });
  }

  if (!countryCode || !adminLevel || !localIdInput || issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    issues,
    value: {
      countryCode,
      adminLevel,
      localId: localIdInput
    }
  };
}

export function validateTerritoryGlobalMetadata(
  input: unknown
): TerritoryGlobalValidationResult<TerritoryGlobalMetadata> {
  const issues: TerritoryGlobalValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [
        {
          code: "GLOBAL_METADATA",
          message: "Global metadata must be an object.",
          path: "$"
        }
      ]
    };
  }

  const adminLevel =
    input.adminLevel === undefined
      ? undefined
      : readAdminLevel(input.adminLevel, "$.adminLevel", issues);
  const sourceAdminLevel =
    input.sourceAdminLevel === undefined
      ? undefined
      : readAdminLevel(input.sourceAdminLevel, "$.sourceAdminLevel", issues);
  const semanticType = readSemanticAdminType(input.semanticType, "$.semanticType", issues);
  const localType = readOptionalString(input.localType, "$.localType", issues);
  const localTypeName = readOptionalString(input.localTypeName, "$.localTypeName", issues);
  const hierarchyDepth = readOptionalHierarchyDepth(
    input.hierarchyDepth,
    "$.hierarchyDepth",
    issues
  );
  const parentId = readOptionalString(input.parentId, "$.parentId", issues);
  const sourceParentId = readOptionalString(input.sourceParentId, "$.sourceParentId", issues);
  const semanticReviewStatus = readSemanticReviewStatus(
    input.semanticReviewStatus,
    "$.semanticReviewStatus",
    issues
  );
  const coverageStatus = readCoverageStatus(input.coverageStatus, "$.coverageStatus", issues);
  const codes = readCodes(input.codes, "$.codes", issues);
  const names = readNames(input.names, "$.names", issues);
  const source = readRequiredSourceMetadata(input.source, "$.source", issues);

  if (
    adminLevel &&
    hierarchyDepth !== undefined &&
    hierarchyDepth !== getAdminLevelDepth(adminLevel)
  ) {
    issues.push({
      code: "GLOBAL_METADATA",
      message: `hierarchyDepth ${hierarchyDepth} does not match ${adminLevel}.`,
      path: "$.hierarchyDepth"
    });
  }

  if (issues.length > 0 || !source) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    issues,
    value: {
      ...(adminLevel ? { adminLevel } : {}),
      ...(sourceAdminLevel ? { sourceAdminLevel } : {}),
      ...(semanticType ? { semanticType } : {}),
      ...(localType ? { localType } : {}),
      ...(localTypeName ? { localTypeName } : {}),
      ...(hierarchyDepth !== undefined ? { hierarchyDepth } : {}),
      ...(parentId ? { parentId } : {}),
      ...(sourceParentId ? { sourceParentId } : {}),
      ...(semanticReviewStatus ? { semanticReviewStatus } : {}),
      ...(coverageStatus ? { coverageStatus } : {}),
      ...(codes ? { codes } : {}),
      ...(names ? { names } : {}),
      source
    }
  };
}

export function validateGlobalDatasetManifest(
  input: unknown
): TerritoryGlobalValidationResult<TerritoryGlobalDatasetManifest> {
  const issues: TerritoryGlobalValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [
        {
          code: "GLOBAL_MANIFEST",
          message: "Global dataset manifest must be an object.",
          path: "$"
        }
      ]
    };
  }

  const datasetId = readRequiredString(input.datasetId, "$.datasetId", "GLOBAL_MANIFEST", issues);
  const datasetVersion = readRequiredString(
    input.datasetVersion,
    "$.datasetVersion",
    "GLOBAL_MANIFEST",
    issues
  );
  const schemaVersion = readRequiredString(
    input.schemaVersion,
    "$.schemaVersion",
    "GLOBAL_MANIFEST",
    issues
  );
  const countryCodes = readCountryCodes(input.countryCodes, "$.countryCodes", issues);
  const adminLevels = readAdminLevels(input.adminLevels, "$.adminLevels", issues);
  const sourceProvider = readRequiredString(
    input.sourceProvider,
    "$.sourceProvider",
    "GLOBAL_MANIFEST",
    issues
  );
  const sourceDate = readRequiredString(
    input.sourceDate,
    "$.sourceDate",
    "GLOBAL_MANIFEST",
    issues
  );
  const buildDate = readRequiredString(input.buildDate, "$.buildDate", "GLOBAL_MANIFEST", issues);
  const license = readRequiredString(input.license, "$.license", "GLOBAL_MANIFEST", issues);
  const attribution = readRequiredString(
    input.attribution,
    "$.attribution",
    "GLOBAL_MANIFEST",
    issues
  );
  const crs = readRequiredString(input.crs, "$.crs", "GLOBAL_MANIFEST", issues);
  const geometryDetail = readGeometryDetail(input.geometryDetail, "$.geometryDetail", issues);
  const geometryHash = readRequiredString(
    input.geometryHash,
    "$.geometryHash",
    "GLOBAL_MANIFEST",
    issues
  );
  const artifactChecksum = readRequiredString(
    input.artifactChecksum,
    "$.artifactChecksum",
    "GLOBAL_MANIFEST",
    issues
  );
  const boundaryPolicy = readRequiredString(
    input.boundaryPolicy,
    "$.boundaryPolicy",
    "GLOBAL_MANIFEST",
    issues
  );
  const worldview = readRequiredString(input.worldview, "$.worldview", "GLOBAL_MANIFEST", issues);
  const disputedAreaPolicy = readRequiredString(
    input.disputedAreaPolicy,
    "$.disputedAreaPolicy",
    "GLOBAL_MANIFEST",
    issues
  );

  if (schemaVersion && schemaVersion !== TERRITORY_SCHEMA_VERSION) {
    issues.push({
      code: "GLOBAL_MANIFEST",
      message: `Unsupported schema version '${schemaVersion}'.`,
      path: "$.schemaVersion"
    });
  }

  if (
    !datasetId ||
    !datasetVersion ||
    schemaVersion !== TERRITORY_SCHEMA_VERSION ||
    !countryCodes ||
    !adminLevels ||
    !sourceProvider ||
    !sourceDate ||
    !buildDate ||
    !license ||
    !attribution ||
    !crs ||
    !geometryDetail ||
    !geometryHash ||
    !artifactChecksum ||
    !boundaryPolicy ||
    !worldview ||
    !disputedAreaPolicy ||
    issues.length > 0
  ) {
    return { ok: false, issues };
  }

  const manifest: TerritoryGlobalDatasetManifest = {
    datasetId,
    datasetVersion,
    schemaVersion,
    countryCodes,
    adminLevels,
    sourceProvider,
    sourceDate,
    buildDate,
    license,
    attribution,
    crs,
    geometryDetail,
    geometryHash,
    artifactChecksum,
    boundaryPolicy,
    worldview,
    disputedAreaPolicy,
    ...(typeof input.name === "string" ? { name: input.name } : {}),
    ...(typeof input.description === "string" ? { description: input.description } : {}),
    ...(isRecord(input.compatibility)
      ? {
          compatibility: {
            ...(typeof input.compatibility.minCoreVersion === "string"
              ? { minCoreVersion: input.compatibility.minCoreVersion }
              : {}),
            ...(typeof input.compatibility.maxCoreVersion === "string"
              ? { maxCoreVersion: input.compatibility.maxCoreVersion }
              : {}),
            ...(Array.isArray(input.compatibility.notes) &&
            input.compatibility.notes.every((note) => typeof note === "string")
              ? { notes: [...input.compatibility.notes] }
              : {})
          }
        }
      : {})
  };

  return { ok: true, issues, value: manifest };
}

function readCountryCode(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): string | undefined {
  if (typeof input !== "string") {
    issues.push({
      code: "ISO_COUNTRY_CODE",
      message: "Country code must be a string.",
      path
    });
    return undefined;
  }

  try {
    return normalizeTerritoryCountryCode(input);
  } catch (error) {
    issues.push({
      code: "ISO_COUNTRY_CODE",
      message: error instanceof Error ? error.message : String(error),
      path
    });
    return undefined;
  }
}

function readCanonicalIdCountryCode(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): string | undefined {
  const countryCode = readCountryCode(input, path, issues);

  if (typeof input === "string" && countryCode && input !== countryCode) {
    issues.push({
      code: "ISO_COUNTRY_CODE",
      message: "Country code must be lowercase in canonical territory ids.",
      path
    });
    return undefined;
  }

  return countryCode;
}

function readAdminLevel(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): TerritoryAdminLevel | undefined {
  if (typeof input !== "string") {
    issues.push({
      code: "ADMIN_LEVEL",
      message: "Administrative level must be a string.",
      path
    });
    return undefined;
  }

  try {
    return normalizeTerritoryAdminLevel(input);
  } catch (error) {
    issues.push({
      code: "ADMIN_LEVEL",
      message: error instanceof Error ? error.message : String(error),
      path
    });
    return undefined;
  }
}

function readCanonicalIdAdminLevel(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): TerritoryAdminLevel | undefined {
  const adminLevel = readAdminLevel(input, path, issues);
  const canonical = adminLevel?.toLowerCase();

  if (typeof input === "string" && adminLevel && input !== canonical) {
    issues.push({
      code: "ADMIN_LEVEL",
      message: "Administrative level must be lowercase in canonical territory ids.",
      path
    });
    return undefined;
  }

  return adminLevel;
}

function readCountryCodes(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): string[] | undefined {
  if (!Array.isArray(input) || input.length === 0) {
    issues.push({
      code: "GLOBAL_MANIFEST",
      message: "countryCodes must be a non-empty array of ISO 3166-1 alpha-2 codes.",
      path
    });
    return undefined;
  }

  const countryCodes = input.map((countryCode, index) =>
    readCountryCode(countryCode, `${path}[${index}]`, issues)
  );

  return countryCodes.every((countryCode): countryCode is string => countryCode !== undefined)
    ? countryCodes
    : undefined;
}

function readAdminLevels(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): TerritoryAdminLevel[] | undefined {
  if (!Array.isArray(input) || input.length === 0) {
    issues.push({
      code: "GLOBAL_MANIFEST",
      message: "adminLevels must be a non-empty array of ADM0 through ADM5 values.",
      path
    });
    return undefined;
  }

  const adminLevels = input.map((adminLevel, index) =>
    readAdminLevel(adminLevel, `${path}[${index}]`, issues)
  );

  return adminLevels.every(
    (adminLevel): adminLevel is TerritoryAdminLevel => adminLevel !== undefined
  )
    ? adminLevels
    : undefined;
}

function readGeometryDetail(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): TerritoryGeometryDetailLevel | undefined {
  if (typeof input === "string" && isTerritoryGeometryDetailLevel(input)) {
    return input;
  }

  issues.push({
    code: "GLOBAL_MANIFEST",
    message: "geometryDetail must be low, medium, high, or source.",
    path
  });
  return undefined;
}

function readSemanticAdminType(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): TerritorySemanticAdminType | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (
    typeof input === "string" &&
    TERRITORY_SEMANTIC_ADMIN_TYPES.includes(input as TerritorySemanticAdminType)
  ) {
    return input as TerritorySemanticAdminType;
  }

  issues.push({
    code: "GLOBAL_METADATA",
    message: "semanticType must be a known administrative semantic type.",
    path
  });
  return undefined;
}

function readSemanticReviewStatus(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): TerritorySemanticReviewStatus | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (
    typeof input === "string" &&
    TERRITORY_SEMANTIC_REVIEW_STATUSES.includes(input as TerritorySemanticReviewStatus)
  ) {
    return input as TerritorySemanticReviewStatus;
  }

  issues.push({
    code: "GLOBAL_METADATA",
    message:
      "semanticReviewStatus must be reviewed, review-required, mapping-review-required, or not-applicable.",
    path
  });
  return undefined;
}

function readCoverageStatus(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): TerritoryCoverageStatus | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (
    typeof input === "string" &&
    TERRITORY_COVERAGE_STATUSES.includes(input as TerritoryCoverageStatus)
  ) {
    return input as TerritoryCoverageStatus;
  }

  issues.push({
    code: "GLOBAL_METADATA",
    message: "coverageStatus must be a known lower-administrative coverage status.",
    path
  });
  return undefined;
}

function readOptionalHierarchyDepth(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): number | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input === "number" && Number.isInteger(input) && input >= 0 && input <= 5) {
    return input;
  }

  issues.push({
    code: "GLOBAL_METADATA",
    message: "hierarchyDepth must be an integer from 0 through 5.",
    path
  });
  return undefined;
}

function readCodes(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): TerritoryGlobalMetadata["codes"] | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!isRecord(input)) {
    issues.push({
      code: "GLOBAL_METADATA",
      message: "codes must be an object when present.",
      path
    });
    return undefined;
  }

  const iso3166_1 = readOptionalString(input.iso3166_1, `${path}.iso3166_1`, issues);
  const iso3166_2 = readOptionalString(input.iso3166_2, `${path}.iso3166_2`, issues);
  const official = readOptionalString(input.official, `${path}.official`, issues);
  const source = readOptionalString(input.source, `${path}.source`, issues);

  return {
    ...(iso3166_1 ? { iso3166_1 } : {}),
    ...(iso3166_2 ? { iso3166_2 } : {}),
    ...(official ? { official } : {}),
    ...(source ? { source } : {})
  };
}

function readNames(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): TerritoryGlobalMetadata["names"] | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!isRecord(input)) {
    issues.push({
      code: "GLOBAL_METADATA",
      message: "names must be an object when present.",
      path
    });
    return undefined;
  }

  if (typeof input.default !== "string" || input.default.length === 0) {
    issues.push({
      code: "GLOBAL_METADATA",
      message: "names.default is required.",
      path: `${path}.default`
    });
  }

  for (const [locale, value] of Object.entries(input)) {
    if (typeof value !== "string" || value.length === 0) {
      issues.push({
        code: "GLOBAL_METADATA",
        message: `names.${locale} must be a non-empty string.`,
        path: `${path}.${locale}`
      });
    }
  }

  return issues.some((issue) => issue.path.startsWith(path))
    ? undefined
    : (input as TerritoryGlobalMetadata["names"]);
}

function readRequiredSourceMetadata(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): TerritorySourceMetadata | undefined {
  if (!isRecord(input)) {
    issues.push({
      code: "GLOBAL_METADATA",
      message: "source metadata is required.",
      path
    });
    return undefined;
  }

  const provider = readRequiredString(
    input.provider,
    `${path}.provider`,
    "GLOBAL_METADATA",
    issues
  );
  const sourceId = readOptionalString(input.sourceId, `${path}.sourceId`, issues);
  const sourceUrl = readOptionalString(input.sourceUrl, `${path}.sourceUrl`, issues);
  const sourceDate = readRequiredString(
    input.sourceDate,
    `${path}.sourceDate`,
    "GLOBAL_METADATA",
    issues
  );
  const importedAt = readOptionalString(input.importedAt, `${path}.importedAt`, issues);
  const license = readRequiredString(input.license, `${path}.license`, "GLOBAL_METADATA", issues);
  const attribution = readRequiredString(
    input.attribution,
    `${path}.attribution`,
    "GLOBAL_METADATA",
    issues
  );

  if (!provider || !sourceDate || !license || !attribution) {
    return undefined;
  }

  return {
    provider,
    ...(sourceId ? { sourceId } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    sourceDate,
    ...(importedAt ? { importedAt } : {}),
    license,
    attribution
  };
}

function readRequiredString(
  input: unknown,
  path: string,
  code: TerritoryGlobalValidationIssue["code"],
  issues: TerritoryGlobalValidationIssue[]
): string | undefined {
  if (typeof input === "string" && input.length > 0) {
    return input;
  }

  issues.push({
    code,
    message: "Expected a non-empty string.",
    path
  });
  return undefined;
}

function readOptionalString(
  input: unknown,
  path: string,
  issues: TerritoryGlobalValidationIssue[]
): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input === "string" && input.length > 0) {
    return input;
  }

  issues.push({
    code: "GLOBAL_METADATA",
    message: "Expected a non-empty string when present.",
    path
  });
  return undefined;
}

function isTerritoryGeometryDetailLevel(input: string): input is TerritoryGeometryDetailLevel {
  return TERRITORY_GEOMETRY_DETAIL_LEVELS.includes(input as TerritoryGeometryDetailLevel);
}

function isValidLocalId(input: string): boolean {
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(input);
}

function replaceLatinSpecialCases(input: string): string {
  return input
    .replace(/[ıİ]/g, "i")
    .replace(/[ß]/g, "ss")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .replace(/[øØ]/g, "o")
    .replace(/[đĐðÐ]/g, "d")
    .replace(/[þÞ]/g, "th")
    .replace(/[łŁ]/g, "l");
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
