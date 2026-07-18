import {
  normalizeTerritoryAdminLevel,
  normalizeTerritoryCountryCode
} from "@territory-kit/dataset";
import type { TerritoryAdminLevel } from "@territory-kit/dataset";
import type { TerritorySourceIssue } from "./types.js";

export interface TerritoryOfficialOpenDataSourceManifest {
  manifestVersion?: "territory-source-manifest@1";
  provider: string;
  countryCode: string;
  adminLevel: TerritoryAdminLevel | string;
  semanticType?: string;
  localTypeName?: string;
  publisher?: string;
  datasetTitle?: string;
  sourceUrl: string;
  downloadUrl?: string;
  sourceDate: string;
  license: string;
  attribution: string;
  redistributionStatus?: "allowed" | "restricted" | "unknown";
  commercialUseStatus?: "allowed" | "restricted" | "unknown";
  modificationStatus?: "allowed" | "restricted" | "unknown";
  sourceVersion?: string;
  retrievedAt?: string;
  expectedSha256?: string;
  format?: string;
}

export interface TerritoryOfficialOpenDataSourceManifestValidationResult {
  ok: boolean;
  manifest?: TerritoryOfficialOpenDataSourceManifest & {
    countryCode: string;
    adminLevel: TerritoryAdminLevel;
  };
  issues: TerritorySourceIssue[];
}

export function validateOfficialOpenDataSourceManifest(
  input: unknown,
  options: { strict?: boolean } = {}
): TerritoryOfficialOpenDataSourceManifestValidationResult {
  const issues: TerritorySourceIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [createManifestIssue("SOURCE_MANIFEST_INVALID", "Source manifest must be an object.")]
    };
  }

  const provider = readRequiredString(input.provider, "provider", issues);
  const sourceUrl = readRequiredString(input.sourceUrl, "sourceUrl", issues);
  const sourceDate = readRequiredString(input.sourceDate, "sourceDate", issues);
  const license = readRequiredString(input.license, "license", issues);
  const attribution = readRequiredString(input.attribution, "attribution", issues);
  const redistributionStatus = readOptionalStatus(
    input.redistributionStatus,
    "redistributionStatus",
    issues
  );
  const commercialUseStatus = readOptionalStatus(
    input.commercialUseStatus,
    "commercialUseStatus",
    issues
  );
  const modificationStatus = readOptionalStatus(
    input.modificationStatus,
    "modificationStatus",
    issues
  );
  let countryCode: string | undefined;
  let adminLevel: TerritoryAdminLevel | undefined;

  try {
    if (typeof input.countryCode === "string") {
      countryCode = normalizeTerritoryCountryCode(input.countryCode).toUpperCase();
    } else {
      issues.push(
        createManifestIssue("SOURCE_MANIFEST_COUNTRY_INVALID", "countryCode is required.")
      );
    }
  } catch (error) {
    issues.push(
      createManifestIssue(
        "SOURCE_MANIFEST_COUNTRY_INVALID",
        error instanceof Error ? error.message : String(error)
      )
    );
  }

  try {
    if (typeof input.adminLevel === "string") {
      adminLevel = normalizeTerritoryAdminLevel(input.adminLevel);
    } else {
      issues.push(createManifestIssue("SOURCE_MANIFEST_LEVEL_INVALID", "adminLevel is required."));
    }
  } catch (error) {
    issues.push(
      createManifestIssue(
        "SOURCE_MANIFEST_LEVEL_INVALID",
        error instanceof Error ? error.message : String(error)
      )
    );
  }

  if (options.strict) {
    if (!license || license.trim().toLowerCase() === "unknown") {
      issues.push(
        createManifestIssue(
          "SOURCE_MANIFEST_LICENSE_RESTRICTED",
          "Strict source manifests require a known redistribution-compatible license."
        )
      );
    }

    if (!attribution) {
      issues.push(
        createManifestIssue(
          "SOURCE_MANIFEST_ATTRIBUTION_MISSING",
          "Strict source manifests require attribution text."
        )
      );
    }

    if (redistributionStatus !== "allowed") {
      issues.push(
        createManifestIssue(
          "SOURCE_MANIFEST_REDISTRIBUTION_RESTRICTED",
          "Strict source manifests require redistributionStatus: allowed."
        )
      );
    }

    if (commercialUseStatus !== "allowed") {
      issues.push(
        createManifestIssue(
          "SOURCE_MANIFEST_COMMERCIAL_USE_RESTRICTED",
          "Strict source manifests require commercialUseStatus: allowed."
        )
      );
    }

    if (!input.expectedSha256 || typeof input.expectedSha256 !== "string") {
      issues.push(
        createManifestIssue(
          "SOURCE_MANIFEST_CHECKSUM_MISSING",
          "Strict source manifests require expectedSha256."
        )
      );
    }
  }

  if (
    issues.some((issue) => issue.severity === "error") ||
    !provider ||
    !countryCode ||
    !adminLevel ||
    !sourceUrl ||
    !sourceDate ||
    !license ||
    !attribution
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    manifest: {
      provider,
      countryCode,
      adminLevel,
      sourceUrl,
      sourceDate,
      license,
      attribution,
      ...(typeof input.semanticType === "string" ? { semanticType: input.semanticType } : {}),
      ...(typeof input.localTypeName === "string" ? { localTypeName: input.localTypeName } : {}),
      ...(typeof input.publisher === "string" ? { publisher: input.publisher } : {}),
      ...(typeof input.datasetTitle === "string" ? { datasetTitle: input.datasetTitle } : {}),
      ...(typeof input.downloadUrl === "string" ? { downloadUrl: input.downloadUrl } : {}),
      ...(redistributionStatus ? { redistributionStatus } : {}),
      ...(commercialUseStatus ? { commercialUseStatus } : {}),
      ...(modificationStatus ? { modificationStatus } : {}),
      ...(typeof input.sourceVersion === "string" ? { sourceVersion: input.sourceVersion } : {}),
      ...(typeof input.retrievedAt === "string" ? { retrievedAt: input.retrievedAt } : {}),
      ...(typeof input.expectedSha256 === "string" ? { expectedSha256: input.expectedSha256 } : {}),
      ...(typeof input.format === "string" ? { format: input.format } : {}),
      ...(input.manifestVersion === "territory-source-manifest@1"
        ? { manifestVersion: input.manifestVersion }
        : {})
    },
    issues
  };
}

function readRequiredString(
  input: unknown,
  field: string,
  issues: TerritorySourceIssue[]
): string | undefined {
  if (typeof input === "string" && input.trim().length > 0) {
    return input;
  }

  issues.push(createManifestIssue("SOURCE_MANIFEST_FIELD_MISSING", `${field} is required.`));
  return undefined;
}

function readOptionalStatus(
  input: unknown,
  field: string,
  issues: TerritorySourceIssue[]
): "allowed" | "restricted" | "unknown" | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (input === "allowed" || input === "restricted" || input === "unknown") {
    return input;
  }

  issues.push(
    createManifestIssue(
      "SOURCE_MANIFEST_STATUS_INVALID",
      `${field} must be allowed, restricted, or unknown.`
    )
  );
  return undefined;
}

function createManifestIssue(code: string, message: string): TerritorySourceIssue {
  return {
    stage: "resolve",
    severity: "error",
    code,
    message,
    provider: "open-data-manifest"
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
