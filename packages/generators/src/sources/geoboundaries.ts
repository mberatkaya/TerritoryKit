import { readFile } from "node:fs/promises";
import {
  TERRITORY_ADMIN_LEVELS,
  TERRITORY_SEMANTIC_ADMIN_TYPES,
  computeGeometryBBox,
  computeGeometryCenter,
  normalizeTerritoryAdminLevel,
  normalizeTerritoryCountryCode
} from "@territory-kit/dataset";
import type {
  TerritoryAdminLevel,
  TerritoryGeometry,
  TerritoryGlobalDatasetManifest,
  TerritoryGlobalMetadata,
  TerritorySemanticAdminType,
  TerritoryZone
} from "@territory-kit/dataset";
import { TerritorySourceError, createSourceIssue } from "./errors.js";
import { createMappedTerritoryId, finalizeSourceDataset } from "./generic-geojson.js";
import type {
  TerritorySourceAdapter,
  TerritorySourceContext,
  TerritorySourceIssue,
  TerritorySourceTransformResult
} from "./types.js";
import { isRecord, readStringPropertyPath, serializeJsonStable, sha256Hex } from "./utils.js";
import { verifySourceArtifact } from "./verification.js";

export const GEOBOUNDARIES_SOURCE_ADAPTER_ID = "geoboundaries" as const;
export const GEOBOUNDARIES_LICENSE = "CC BY 4.0" as const;
export const GEOBOUNDARIES_RELEASE_TYPES = ["gbOpen", "gbHumanitarian", "gbAuthoritative"] as const;

export type GeoBoundariesReleaseType = (typeof GEOBOUNDARIES_RELEASE_TYPES)[number];

export interface GeoBoundariesSourceOptions {
  countryCode: string;
  adminLevel: TerritoryAdminLevel | string;
  releaseType?: GeoBoundariesReleaseType | string;
  sourceDate?: string;
  sourceUrl?: string;
  datasetId?: string;
  datasetVersion?: string;
  buildDate?: string;
  attribution?: string;
}

interface GeoBoundariesFeature {
  featureId?: string;
  sourceId: string;
  id: string;
  name: string;
  geometry: TerritoryGeometry;
  shapeType?: string;
}

export const geoBoundariesSourceAdapter: TerritorySourceAdapter<
  GeoBoundariesSourceOptions,
  unknown
> = {
  id: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
  displayName: "geoBoundaries",
  supportedAdminLevels: TERRITORY_ADMIN_LEVELS,
  capabilities: {
    localFile: true,
    remoteFetch: true,
    cache: true,
    attributionRequired: true
  },
  describe() {
    return {
      id: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
      displayName: "geoBoundaries",
      supportedAdminLevels: TERRITORY_ADMIN_LEVELS,
      supportedTransports: ["local", "remote"],
      inputFormats: ["GeoJSON FeatureCollection"],
      defaultLicense: GEOBOUNDARIES_LICENSE,
      attributionRequired: true,
      options: [
        { name: "countryCode", required: true, description: "ISO 3166-1 alpha-2 country code." },
        { name: "adminLevel", required: true, description: "ADM0 through ADM5." },
        {
          name: "releaseType",
          required: false,
          description: "gbOpen, gbHumanitarian, or gbAuthoritative."
        }
      ],
      exampleCommand:
        "territory import geoboundaries --country TR --admin-level ADM1 --input ./geoBoundaries-TUR-ADM1.geojson --output ./dist/tr-adm1"
    };
  },
  validateOptions(options) {
    const issues: TerritorySourceIssue[] = [];

    try {
      normalizeTerritoryCountryCode(options.countryCode);
    } catch (error) {
      issues.push(
        createSourceIssue({
          stage: "resolve",
          code: "SOURCE_OPTIONS_INVALID",
          message: error instanceof Error ? error.message : String(error),
          provider: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
          details: { option: "countryCode" }
        })
      );
    }

    try {
      normalizeTerritoryAdminLevel(String(options.adminLevel));
    } catch (error) {
      issues.push(
        createSourceIssue({
          stage: "resolve",
          code: "SOURCE_OPTIONS_INVALID",
          message: error instanceof Error ? error.message : String(error),
          provider: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
          details: { option: "adminLevel" }
        })
      );
    }

    if (
      options.releaseType &&
      !GEOBOUNDARIES_RELEASE_TYPES.includes(options.releaseType as GeoBoundariesReleaseType)
    ) {
      issues.push(
        createSourceIssue({
          stage: "resolve",
          code: "SOURCE_OPTIONS_INVALID",
          message: "--release-type must be gbOpen, gbHumanitarian, or gbAuthoritative.",
          provider: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
          details: { option: "releaseType" }
        })
      );
    }

    return issues;
  },
  fetch(request, context) {
    return context.resolveArtifact(GEOBOUNDARIES_SOURCE_ADAPTER_ID, request);
  },
  verify(artifact, context) {
    return verifySourceArtifact(artifact, context, context.request);
  },
  async parse(artifact) {
    try {
      return JSON.parse(await readFile(artifact.localPath, "utf8")) as unknown;
    } catch (error) {
      throw new TerritorySourceError({
        code: "SOURCE_PARSE_FAILED",
        message: error instanceof Error ? error.message : String(error),
        stage: "parse",
        provider: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
        details: { sourcePath: artifact.localPath },
        cause: error
      });
    }
  },
  async transform(parsed, options, context) {
    return transformGeoBoundaries(parsed, options, context);
  }
};

export function transformGeoBoundaries(
  parsed: unknown,
  options: GeoBoundariesSourceOptions,
  context: TerritorySourceContext
): TerritorySourceTransformResult {
  const issues: TerritorySourceIssue[] = [];
  const countryCode = normalizeTerritoryCountryCode(options.countryCode);
  const adminLevel = normalizeTerritoryAdminLevel(String(options.adminLevel));
  const releaseType = (options.releaseType ?? "gbOpen") as GeoBoundariesReleaseType;
  const sourceDate = options.sourceDate ?? "unknown";
  const buildDate = options.buildDate ?? context.now();
  const attribution =
    options.attribution ??
    `geoBoundaries ${countryCode.toUpperCase()} ${adminLevel} (${releaseType})`;
  const features = readGeoBoundariesFeatures(parsed, { countryCode, adminLevel }, issues);
  const datasetId = options.datasetId ?? `geoboundaries-${countryCode}-${adminLevel.toLowerCase()}`;
  const zones = features
    .map((feature): TerritoryZone => {
      const metadata: TerritoryGlobalMetadata & Record<string, unknown> = {
        adminLevel,
        localType: feature.shapeType ?? "boundary",
        codes: {
          source: feature.sourceId,
          ...(adminLevel === "ADM0" ? { iso3166_1: countryCode.toUpperCase() } : {})
        },
        names: { default: feature.name },
        source: {
          provider: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
          sourceId: feature.sourceId,
          ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
          sourceDate,
          importedAt: buildDate,
          license: GEOBOUNDARIES_LICENSE,
          attribution
        },
        releaseType
      };

      return {
        id: feature.id,
        datasetId,
        countryCode: countryCode.toUpperCase(),
        level: Number(adminLevel.slice(3)),
        sourceAdminLevel: adminLevel,
        semanticType: semanticTypeForGeoBoundariesFeature(adminLevel, feature.shapeType),
        name: feature.name,
        neighborIds: [],
        geometry: feature.geometry,
        center: computeGeometryCenter(feature.geometry),
        bbox: computeGeometryBBox(feature.geometry),
        properties: {
          name: feature.name,
          territory: metadata
        }
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const dataset = finalizeSourceDataset({
    datasetId,
    datasetVersion: options.datasetVersion ?? "0.1.0",
    sourceDate,
    buildDate,
    name: `geoBoundaries ${countryCode.toUpperCase()} ${adminLevel}`,
    description: "geoBoundaries source converted to a TerritoryKit dataset.",
    license: GEOBOUNDARIES_LICENSE,
    attribution,
    sourceProvider: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
    countryCodes: [countryCode],
    adminLevels: [adminLevel],
    zones
  });

  return {
    dataset,
    manifestMetadata: dataset.manifest as TerritoryGlobalDatasetManifest,
    attribution: {
      provider: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
      text: attribution,
      license: GEOBOUNDARIES_LICENSE,
      ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {})
    },
    issues,
    statistics: {
      inputFeatureCount:
        isRecord(parsed) && Array.isArray(parsed.features) ? parsed.features.length : 0,
      acceptedFeatureCount: zones.length,
      skippedFeatureCount: Math.max(
        (isRecord(parsed) && Array.isArray(parsed.features) ? parsed.features.length : 0) -
          zones.length,
        0
      ),
      warningCount: issues.filter((issue) => issue.severity === "warning").length,
      errorCount: issues.filter((issue) => issue.severity === "error").length
    },
    manifest: dataset.manifest as TerritoryGlobalDatasetManifest
  };
}

function semanticTypeForGeoBoundariesFeature(
  adminLevel: TerritoryAdminLevel,
  shapeType: string | undefined
): TerritorySemanticAdminType {
  if (adminLevel === "ADM0") {
    return "country";
  }

  if (shapeType) {
    const normalized = shapeType.trim().toLowerCase().replace(/_/g, "-");

    if (TERRITORY_SEMANTIC_ADMIN_TYPES.includes(normalized as TerritorySemanticAdminType)) {
      return normalized as TerritorySemanticAdminType;
    }
  }

  return "unknown";
}

function readGeoBoundariesFeatures(
  input: unknown,
  context: { countryCode: string; adminLevel: TerritoryAdminLevel },
  issues: TerritorySourceIssue[]
): GeoBoundariesFeature[] {
  if (!isRecord(input) || input.type !== "FeatureCollection" || !Array.isArray(input.features)) {
    issues.push(
      createSourceIssue({
        stage: "parse",
        code: "SOURCE_FORMAT_UNSUPPORTED",
        message: "geoBoundaries input must be a GeoJSON FeatureCollection.",
        provider: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
        details: { path: "$.type" }
      })
    );
    return [];
  }

  return input.features
    .flatMap((rawFeature, index): GeoBoundariesFeature[] => {
      if (!isRecord(rawFeature)) {
        return [];
      }

      const featureId = readFeatureId(rawFeature);
      const properties = isRecord(rawFeature.properties) ? rawFeature.properties : {};
      const shapeGroup = readStringPropertyPath(properties, "shapeGroup");
      const shapeId = readStringPropertyPath(properties, "shapeID");
      const shapeName = readStringPropertyPath(properties, "shapeName");
      const shapeType = readStringPropertyPath(properties, "shapeType");
      const geometry = readGeometry(rawFeature.geometry, issues, {
        ...(featureId ? { featureId } : {}),
        path: `$.features[${index}].geometry`
      });

      if (shapeGroup) {
        try {
          const normalizedGroup = normalizeTerritoryCountryCode(shapeGroup);

          if (normalizedGroup !== context.countryCode) {
            issues.push(
              createSourceIssue({
                stage: "transform",
                code: "SOURCE_COUNTRY_MISMATCH",
                message: `Feature shapeGroup '${shapeGroup}' does not match requested country '${context.countryCode.toUpperCase()}'.`,
                provider: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
                ...(featureId ? { featureId } : {})
              })
            );
          }
        } catch {
          issues.push(
            createSourceIssue({
              stage: "transform",
              code: "SOURCE_COUNTRY_MISMATCH",
              message: `Feature shapeGroup '${shapeGroup}' is not an ISO alpha-2 country code.`,
              provider: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
              ...(featureId ? { featureId } : {})
            })
          );
        }
      }

      if (!shapeId) {
        issues.push(
          createSourceIssue({
            stage: "transform",
            code: "SOURCE_ID_MISSING",
            message: "geoBoundaries feature is missing properties.shapeID.",
            provider: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
            ...(featureId ? { featureId } : {})
          })
        );
      }

      if (!shapeName) {
        issues.push(
          createSourceIssue({
            stage: "transform",
            code: "SOURCE_NAME_MISSING",
            message: "geoBoundaries feature is missing properties.shapeName.",
            provider: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
            ...(featureId ? { featureId } : {})
          })
        );
      }

      if (!shapeId || !shapeName || !geometry) {
        return [];
      }

      return [
        {
          ...(featureId ? { featureId } : {}),
          sourceId: shapeId,
          id: createMappedTerritoryId({
            countryCode: context.countryCode,
            adminLevel: context.adminLevel,
            localId:
              context.adminLevel === "ADM0"
                ? context.countryCode
                : `${shapeId}-${sha256Hex(serializeJsonStable({ shapeName })).slice(0, 8)}`
          }),
          name: shapeName,
          geometry,
          ...(shapeType ? { shapeType } : {})
        }
      ];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function readGeometry(
  input: unknown,
  issues: TerritorySourceIssue[],
  context: { featureId?: string; path: string }
): TerritoryGeometry | undefined {
  if (!isRecord(input) || (input.type !== "Polygon" && input.type !== "MultiPolygon")) {
    issues.push(
      createSourceIssue({
        stage: "parse",
        code: "SOURCE_FORMAT_UNSUPPORTED",
        message: "Feature geometry must be Polygon or MultiPolygon.",
        provider: GEOBOUNDARIES_SOURCE_ADAPTER_ID,
        ...(context.featureId ? { featureId: context.featureId } : {}),
        details: { path: context.path }
      })
    );
    return undefined;
  }

  return input as unknown as TerritoryGeometry;
}

function readFeatureId(feature: Record<string, unknown>): string | undefined {
  const id = feature.id;

  if ((typeof id === "string" && id.trim().length > 0) || typeof id === "number") {
    return String(id);
  }

  return undefined;
}
