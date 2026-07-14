import { TERRITORY_ADMIN_LEVELS } from "@territory-kit/dataset";
import type { TerritoryAdminLevel } from "@territory-kit/dataset";
import type {
  TerritoryDatasetRegistry,
  TerritoryRegistryArtifactFormat,
  TerritoryRegistryArtifactPurpose,
  TerritoryRegistryIssue,
  TerritoryRegistryValidationResult
} from "./types.js";
import { isRecord } from "./utils.js";

const purposeValues = new Set<TerritoryRegistryArtifactPurpose>([
  "query",
  "render",
  "metadata",
  "adjacency",
  "debug"
]);

const formatValues = new Set<TerritoryRegistryArtifactFormat>([
  "territory-json",
  "geojson",
  "json",
  "br",
  "gzip",
  "pmtiles",
  "mvt"
]);

const levelValues = new Set<TerritoryAdminLevel>(TERRITORY_ADMIN_LEVELS);

export function validateTerritoryDatasetRegistry(
  input: unknown
): TerritoryRegistryValidationResult {
  const issues: TerritoryRegistryIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [issue("REGISTRY_INVALID", "Registry must be a JSON object.", "$")]
    };
  }

  if (input.registryVersion !== "1") {
    issues.push(
      issue("REGISTRY_VERSION_UNSUPPORTED", "Registry version must be '1'.", "$.registryVersion")
    );
  }

  if (typeof input.generatedAt !== "string" || Number.isNaN(Date.parse(input.generatedAt))) {
    issues.push(
      issue(
        "REGISTRY_GENERATED_AT_INVALID",
        "generatedAt must be an ISO timestamp.",
        "$.generatedAt"
      )
    );
  }

  if (input.baseUrl !== undefined && !isSafeUrlValue(input.baseUrl)) {
    issues.push(
      issue(
        "REGISTRY_BASE_URL_INVALID",
        "baseUrl must be http(s), file, or a safe relative URL.",
        "$.baseUrl"
      )
    );
  }

  if (!Array.isArray(input.datasets)) {
    issues.push(issue("REGISTRY_DATASETS_INVALID", "datasets must be an array.", "$.datasets"));
  } else {
    validateDatasets(input.datasets, issues);
  }

  return {
    ok: issues.every((item) => item.severity !== "error"),
    ...(issues.every((item) => item.severity !== "error")
      ? { registry: input as unknown as TerritoryDatasetRegistry }
      : {}),
    issues
  };
}

function validateDatasets(datasets: unknown[], issues: TerritoryRegistryIssue[]): void {
  const datasetKeys = new Set<string>();

  for (const [datasetIndex, dataset] of datasets.entries()) {
    const path = `$.datasets[${datasetIndex}]`;

    if (!isRecord(dataset)) {
      issues.push(issue("DATASET_INVALID", "Dataset entry must be an object.", path));
      continue;
    }

    const id = readString(dataset.id);
    const version = readString(dataset.version);

    if (!id || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
      issues.push(
        issue("DATASET_ID_INVALID", "Dataset id is required and must be stable.", `${path}.id`)
      );
    }

    if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
      issues.push(
        issue("DATASET_VERSION_INVALID", "Dataset version must be semver.", `${path}.version`)
      );
    }

    if (id && version) {
      const key = `${id}@${version}`;

      if (datasetKeys.has(key)) {
        issues.push(issue("DATASET_DUPLICATE", `Duplicate dataset ${key}.`, path));
      }

      datasetKeys.add(key);
    }

    if (typeof dataset.displayName !== "string" || dataset.displayName.trim().length === 0) {
      issues.push(
        issue("DATASET_DISPLAY_NAME_MISSING", "displayName is required.", `${path}.displayName`)
      );
    }

    if (dataset.schemaVersion !== "territory-schema@1") {
      issues.push(
        issue(
          "DATASET_SCHEMA_UNSUPPORTED",
          "schemaVersion must be territory-schema@1.",
          `${path}.schemaVersion`
        )
      );
    }

    if (
      !Array.isArray(dataset.levels) ||
      !dataset.levels.every((level) => levelValues.has(level))
    ) {
      issues.push(
        issue("DATASET_LEVELS_INVALID", "levels must contain valid admin levels.", `${path}.levels`)
      );
    }

    if (!isRecord(dataset.source) || typeof dataset.source.provider !== "string") {
      issues.push(
        issue("DATASET_SOURCE_INVALID", "source.provider is required.", `${path}.source`)
      );
    }

    if (
      !isRecord(dataset.license) ||
      typeof dataset.license.id !== "string" ||
      typeof dataset.license.attribution !== "string"
    ) {
      issues.push(
        issue(
          "DATASET_LICENSE_INVALID",
          "license.id and license.attribution are required.",
          `${path}.license`
        )
      );
    }

    if (!Array.isArray(dataset.artifacts)) {
      issues.push(
        issue("DATASET_ARTIFACTS_INVALID", "artifacts must be an array.", `${path}.artifacts`)
      );
      continue;
    }

    validateArtifacts(dataset.artifacts, `${path}.artifacts`, issues);
  }
}

function validateArtifacts(
  artifacts: unknown[],
  path: string,
  issues: TerritoryRegistryIssue[]
): void {
  const artifactIds = new Set<string>();

  for (const [artifactIndex, artifact] of artifacts.entries()) {
    const artifactPath = `${path}[${artifactIndex}]`;

    if (!isRecord(artifact)) {
      issues.push(issue("ARTIFACT_INVALID", "Artifact entry must be an object.", artifactPath));
      continue;
    }

    const id = readString(artifact.id);

    if (!id || !/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) {
      issues.push(
        issue(
          "ARTIFACT_ID_INVALID",
          "Artifact id is required and must be stable.",
          `${artifactPath}.id`
        )
      );
    } else if (artifactIds.has(id)) {
      issues.push(issue("ARTIFACT_DUPLICATE", `Duplicate artifact ${id}.`, artifactPath));
    } else {
      artifactIds.add(id);
    }

    if (!purposeValues.has(artifact.purpose as TerritoryRegistryArtifactPurpose)) {
      issues.push(
        issue(
          "ARTIFACT_PURPOSE_INVALID",
          "Artifact purpose is not supported.",
          `${artifactPath}.purpose`
        )
      );
    }

    if (!formatValues.has(artifact.format as TerritoryRegistryArtifactFormat)) {
      issues.push(
        issue(
          "ARTIFACT_FORMAT_INVALID",
          "Artifact format is not supported.",
          `${artifactPath}.format`
        )
      );
    }

    if (artifact.levels !== undefined) {
      if (
        !Array.isArray(artifact.levels) ||
        !artifact.levels.every((level) => levelValues.has(level))
      ) {
        issues.push(
          issue(
            "ARTIFACT_LEVELS_INVALID",
            "Artifact levels must be valid admin levels.",
            `${artifactPath}.levels`
          )
        );
      }
    }

    if (typeof artifact.url !== "string" || !isSafeUrlValue(artifact.url)) {
      issues.push(
        issue(
          "ARTIFACT_URL_INVALID",
          "Artifact url must be http(s), file, or a safe relative URL.",
          `${artifactPath}.url`
        )
      );
    }

    if (
      artifact.path !== undefined &&
      (typeof artifact.path !== "string" || !isSafeRelativePath(artifact.path))
    ) {
      issues.push(
        issue(
          "ARTIFACT_PATH_INVALID",
          "Artifact path must be a safe relative path.",
          `${artifactPath}.path`
        )
      );
    }

    if (typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
      issues.push(
        issue(
          "ARTIFACT_SHA256_INVALID",
          "Artifact sha256 must be a 64-character hex digest.",
          `${artifactPath}.sha256`
        )
      );
    }

    if (
      typeof artifact.sizeBytes !== "number" ||
      !Number.isSafeInteger(artifact.sizeBytes) ||
      artifact.sizeBytes < 0
    ) {
      issues.push(
        issue(
          "ARTIFACT_SIZE_INVALID",
          "Artifact sizeBytes must be a non-negative integer.",
          `${artifactPath}.sizeBytes`
        )
      );
    }

    if (
      artifact.compression !== undefined &&
      artifact.compression !== "none" &&
      artifact.compression !== "gzip" &&
      artifact.compression !== "br"
    ) {
      issues.push(
        issue(
          "ARTIFACT_COMPRESSION_INVALID",
          "Artifact compression must be none, gzip, or br.",
          `${artifactPath}.compression`
        )
      );
    }
  }
}

function readString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0 ? input.trim() : undefined;
}

function issue(code: string, message: string, path: string): TerritoryRegistryIssue {
  return { code, message, path, severity: "error" };
}

function isSafeUrlValue(input: unknown): boolean {
  if (typeof input !== "string" || input.trim().length === 0) {
    return false;
  }

  const value = input.trim();

  if (/^(?:data|javascript|ftp):/i.test(value)) {
    return false;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return /^(?:https?|file):/i.test(value);
  }

  return isSafeRelativePath(value);
}

function isSafeRelativePath(input: string): boolean {
  try {
    const decoded = decodeURIComponent(input);
    return !input.startsWith("/") && !input.includes("\\") && !decoded.split("/").includes("..");
  } catch {
    return false;
  }
}
