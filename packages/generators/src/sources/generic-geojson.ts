import { readFile } from "node:fs/promises";
import {
  TERRITORY_SCHEMA_VERSION,
  computeGeometryBBox,
  computeGeometryCenter,
  createTerritoryGlobalId,
  normalizeTerritoryAdminLevel,
  normalizeTerritoryCountryCode,
  slugifyTerritoryIdPart
} from "@territory-kit/dataset";
import type {
  TerritoryAdminLevel,
  TerritoryDataset,
  TerritoryGeometry,
  TerritoryGlobalDatasetManifest,
  TerritoryGlobalMetadata,
  TerritoryZone
} from "@territory-kit/dataset";
import { TerritorySourceError, createSourceIssue } from "./errors.js";
import type {
  TerritorySourceAdapter,
  TerritorySourceContext,
  TerritorySourceIssue,
  TerritorySourceTransformResult
} from "./types.js";
import {
  createDatasetGeometryHash,
  isRecord,
  readStringPropertyPath,
  serializeJsonStable,
  sha256Hex
} from "./utils.js";
import { verifySourceArtifact } from "./verification.js";

export const GEOJSON_SOURCE_ADAPTER_ID = "geojson" as const;

export interface GenericGeoJsonSourceOptions {
  countryCode: string;
  adminLevel: TerritoryAdminLevel | string;
  idProperty?: string;
  sourceIdProperty?: string;
  nameProperty: string;
  parentProperty?: string;
  codeProperty?: string;
  localType?: string;
  provider?: string;
  sourceUrl?: string;
  sourceDate?: string;
  license?: string;
  attribution?: string;
  datasetId?: string;
  datasetVersion?: string;
  buildDate?: string;
}

interface GenericGeoJsonFeature {
  featureId?: string;
  sourceId?: string;
  localId: string;
  id: string;
  name: string;
  code?: string;
  parentSourceId?: string;
  geometry: TerritoryGeometry;
  properties: Record<string, unknown>;
}

export const genericGeoJsonSourceAdapter: TerritorySourceAdapter<
  GenericGeoJsonSourceOptions,
  unknown
> = {
  id: GEOJSON_SOURCE_ADAPTER_ID,
  displayName: "Generic GeoJSON",
  supportedAdminLevels: ["ADM0", "ADM1", "ADM2", "ADM3", "ADM4"],
  capabilities: {
    localFile: true,
    remoteFetch: true,
    cache: true,
    attributionRequired: true
  },
  describe() {
    return {
      id: GEOJSON_SOURCE_ADAPTER_ID,
      displayName: "Generic GeoJSON",
      supportedAdminLevels: ["ADM0", "ADM1", "ADM2", "ADM3", "ADM4"],
      supportedTransports: ["local", "remote"],
      inputFormats: ["GeoJSON FeatureCollection"],
      attributionRequired: true,
      options: [
        { name: "countryCode", required: true, description: "ISO 3166-1 alpha-2 country code." },
        { name: "adminLevel", required: true, description: "ADM0 through ADM4." },
        { name: "idProperty", required: false, description: "Stable source id property path." },
        { name: "nameProperty", required: true, description: "Display name property path." },
        {
          name: "parentProperty",
          required: false,
          description: "Optional parent id property path."
        }
      ],
      exampleCommand:
        "territory import geojson --input ./regions.geojson --output ./dist/regions --country TR --admin-level ADM2 --id-property region_code --name-property region_name"
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
          provider: GEOJSON_SOURCE_ADAPTER_ID,
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
          provider: GEOJSON_SOURCE_ADAPTER_ID,
          details: { option: "adminLevel" }
        })
      );
    }

    if (!options.nameProperty) {
      issues.push(
        createSourceIssue({
          stage: "resolve",
          code: "SOURCE_OPTIONS_INVALID",
          message: "--name-property is required for generic GeoJSON imports.",
          provider: GEOJSON_SOURCE_ADAPTER_ID,
          details: { option: "nameProperty" }
        })
      );
    }

    return issues;
  },
  fetch(request, context) {
    return context.resolveArtifact(GEOJSON_SOURCE_ADAPTER_ID, request);
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
        provider: GEOJSON_SOURCE_ADAPTER_ID,
        details: { sourcePath: artifact.localPath },
        cause: error
      });
    }
  },
  async transform(parsed, options, context) {
    return transformGenericGeoJson(parsed, options, context);
  }
};

export function transformGenericGeoJson(
  parsed: unknown,
  options: GenericGeoJsonSourceOptions,
  context: TerritorySourceContext
): TerritorySourceTransformResult {
  const issues: TerritorySourceIssue[] = [];
  const countryCode = normalizeTerritoryCountryCode(options.countryCode);
  const adminLevel = normalizeTerritoryAdminLevel(String(options.adminLevel));
  const provider = options.provider ?? GEOJSON_SOURCE_ADAPTER_ID;
  const sourceDate = options.sourceDate ?? "unknown";
  const buildDate = options.buildDate ?? context.now();
  const datasetId = options.datasetId ?? `${provider}-${countryCode}-${adminLevel.toLowerCase()}`;
  const featureCollection = readFeatureCollection(parsed, issues);
  const features = featureCollection
    ? readGenericFeatures(featureCollection, options, { countryCode, adminLevel, provider }, issues)
    : [];
  const sourceIdToTerritoryId = new Map(
    features.flatMap((feature) =>
      feature.sourceId ? ([[feature.sourceId, feature.id]] as Array<[string, string]>) : []
    )
  );

  const zones = features
    .map((feature): TerritoryZone => {
      const parentId = readParentId(feature, sourceIdToTerritoryId, issues, {
        countryCode,
        adminLevel,
        provider
      });
      const metadata: TerritoryGlobalMetadata & Record<string, unknown> = {
        adminLevel,
        ...(options.localType ? { localType: options.localType } : {}),
        codes: {
          ...(feature.code ? { source: feature.code } : {}),
          ...(adminLevel === "ADM0" ? { iso3166_1: countryCode.toUpperCase() } : {})
        },
        names: { default: feature.name },
        source: {
          provider,
          ...(feature.sourceId ? { sourceId: feature.sourceId } : {}),
          ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
          sourceDate,
          importedAt: buildDate,
          ...(options.license ? { license: options.license } : {}),
          ...(options.attribution ? { attribution: options.attribution } : {})
        }
      };

      return {
        id: feature.id,
        datasetId,
        level: adminLevelToNumber(adminLevel),
        ...(parentId ? { parentId } : {}),
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
    name: `Generic GeoJSON ${countryCode.toUpperCase()} ${adminLevel}`,
    description: "Generic GeoJSON source converted to a TerritoryKit dataset.",
    ...(options.license ? { license: options.license } : {}),
    ...(options.attribution ? { attribution: options.attribution } : {}),
    sourceProvider: provider,
    countryCodes: [countryCode],
    adminLevels: [adminLevel],
    zones
  });

  if (!options.attribution) {
    issues.push(
      createSourceIssue({
        stage: "transform",
        severity: "warning",
        code: "SOURCE_ATTRIBUTION_MISSING",
        message: "Generic GeoJSON imports should include --attribution.",
        provider: GEOJSON_SOURCE_ADAPTER_ID
      })
    );
  }

  if (!options.license) {
    issues.push(
      createSourceIssue({
        stage: "transform",
        severity: "warning",
        code: "SOURCE_LICENSE_MISSING",
        message: "Generic GeoJSON imports should include --license.",
        provider: GEOJSON_SOURCE_ADAPTER_ID
      })
    );
  }

  return {
    dataset,
    manifestMetadata: dataset.manifest as TerritoryGlobalDatasetManifest,
    attribution: {
      provider,
      text: options.attribution ?? "Attribution not provided.",
      ...(options.license ? { license: options.license } : {}),
      ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {})
    },
    issues,
    statistics: {
      inputFeatureCount: featureCollection?.features.length ?? 0,
      acceptedFeatureCount: zones.length,
      skippedFeatureCount: Math.max((featureCollection?.features.length ?? 0) - zones.length, 0),
      warningCount: issues.filter((issue) => issue.severity === "warning").length,
      errorCount: issues.filter((issue) => issue.severity === "error").length
    },
    manifest: dataset.manifest as TerritoryGlobalDatasetManifest
  };
}

export function finalizeSourceDataset(options: {
  datasetId: string;
  datasetVersion: string;
  sourceDate: string;
  buildDate: string;
  name: string;
  description: string;
  license?: string;
  attribution?: string;
  sourceProvider: string;
  countryCodes: string[];
  adminLevels: TerritoryAdminLevel[];
  zones: TerritoryZone[];
}): TerritoryDataset {
  const dataset = {
    manifest: {
      datasetId: options.datasetId,
      datasetVersion: options.datasetVersion,
      schemaVersion: TERRITORY_SCHEMA_VERSION,
      sourceDate: options.sourceDate,
      geometryHash: "pending",
      adminLevels: options.adminLevels,
      artifactChecksum: "recorded-in-checksums-json",
      attribution: options.attribution ?? "Attribution not provided.",
      boundaryPolicy: "source-boundaries-represented-without-topology-repair",
      buildDate: options.buildDate,
      countryCodes: options.countryCodes,
      crs: "EPSG:4326",
      disputedAreaPolicy: "source-disputed-boundaries-not-authoritative",
      geometryDetail: "source",
      license: options.license ?? "unknown",
      name: options.name,
      description: options.description,
      sourceProvider: options.sourceProvider,
      worldview: "source"
    },
    zones: options.zones
  } satisfies TerritoryDataset;

  return {
    ...dataset,
    manifest: {
      ...dataset.manifest,
      geometryHash: createDatasetGeometryHash(dataset),
      artifactChecksum: sha256Hex(serializeJsonStable(dataset.zones))
    }
  };
}

function readFeatureCollection(
  input: unknown,
  issues: TerritorySourceIssue[]
): { features: Record<string, unknown>[] } | undefined {
  if (!isRecord(input) || input.type !== "FeatureCollection" || !Array.isArray(input.features)) {
    issues.push(
      createSourceIssue({
        stage: "parse",
        code: "SOURCE_FORMAT_UNSUPPORTED",
        message: "GeoJSON source must be a FeatureCollection.",
        provider: GEOJSON_SOURCE_ADAPTER_ID,
        details: { path: "$.type" }
      })
    );
    return undefined;
  }

  return {
    features: input.features.filter(isRecord)
  };
}

function readGenericFeatures(
  featureCollection: { features: Record<string, unknown>[] },
  options: GenericGeoJsonSourceOptions,
  context: { countryCode: string; adminLevel: TerritoryAdminLevel; provider: string },
  issues: TerritorySourceIssue[]
): GenericGeoJsonFeature[] {
  const features: GenericGeoJsonFeature[] = [];

  featureCollection.features.forEach((feature, index) => {
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const rawFeatureId = readFeatureId(feature);
    const geometry = readGeometry(feature.geometry, issues, {
      provider: GEOJSON_SOURCE_ADAPTER_ID,
      ...(rawFeatureId ? { featureId: rawFeatureId } : {}),
      path: `$.features[${index}].geometry`
    });
    const sourceIdPath = options.idProperty ?? options.sourceIdProperty;
    const sourceId = sourceIdPath
      ? readStringPropertyPath(properties, sourceIdPath)
      : (rawFeatureId ?? readStringPropertyPath(properties, "id"));
    const name = readStringPropertyPath(properties, options.nameProperty);
    const code = options.codeProperty
      ? readStringPropertyPath(properties, options.codeProperty)
      : undefined;
    const parentSourceId = options.parentProperty
      ? readStringPropertyPath(properties, options.parentProperty)
      : undefined;
    const featureId = rawFeatureId ?? sourceId;

    if (!name) {
      issues.push(
        createSourceIssue({
          stage: "transform",
          code: "SOURCE_NAME_MISSING",
          message: `Feature is missing name property '${options.nameProperty}'.`,
          provider: GEOJSON_SOURCE_ADAPTER_ID,
          ...(featureId ? { featureId } : {}),
          details: { path: `$.features[${index}].properties.${options.nameProperty}` }
        })
      );
    }

    if (!geometry || !name) {
      return;
    }

    const localId =
      sourceId ??
      createFallbackLocalId({
        geometry,
        name,
        ...(code ? { code } : {}),
        provider: context.provider
      });

    if (!sourceId) {
      issues.push(
        createSourceIssue({
          stage: "transform",
          severity: "warning",
          code: "SOURCE_ID_FALLBACK",
          message: "Feature is missing a stable source id; using deterministic content fallback.",
          provider: GEOJSON_SOURCE_ADAPTER_ID,
          ...(featureId ? { featureId } : {}),
          details: { localId }
        })
      );
    }

    let id: string;

    try {
      id =
        context.adminLevel === "ADM0"
          ? createTerritoryGlobalId({ countryCode: context.countryCode })
          : createTerritoryGlobalId({
              countryCode: context.countryCode,
              adminLevel: context.adminLevel,
              localId
            });
    } catch (error) {
      issues.push(
        createSourceIssue({
          stage: "transform",
          code: "SOURCE_ID_INVALID",
          message: error instanceof Error ? error.message : String(error),
          provider: GEOJSON_SOURCE_ADAPTER_ID,
          ...(featureId ? { featureId } : {}),
          details: { localId }
        })
      );
      return;
    }

    features.push({
      ...(featureId ? { featureId } : {}),
      ...(sourceId ? { sourceId } : {}),
      localId,
      id,
      name,
      ...(code ? { code } : {}),
      ...(parentSourceId ? { parentSourceId } : {}),
      geometry,
      properties
    });
  });

  return features.sort((left, right) => left.id.localeCompare(right.id));
}

function readParentId(
  feature: GenericGeoJsonFeature,
  sourceIdToTerritoryId: ReadonlyMap<string, string>,
  issues: TerritorySourceIssue[],
  context: { countryCode: string; adminLevel: TerritoryAdminLevel; provider: string }
): string | undefined {
  if (!feature.parentSourceId) {
    return undefined;
  }

  const mapped = sourceIdToTerritoryId.get(feature.parentSourceId);

  if (mapped) {
    return mapped;
  }

  issues.push(
    createSourceIssue({
      stage: "transform",
      severity: "warning",
      code: "SOURCE_PARENT_MISSING",
      message: `Parent '${feature.parentSourceId}' was not found in the imported feature set.`,
      provider: GEOJSON_SOURCE_ADAPTER_ID,
      featureId: feature.featureId ?? feature.id,
      details: {
        parentSourceId: feature.parentSourceId,
        expectedParentAdminLevel: previousAdminLevel(context.adminLevel)
      }
    })
  );
  return undefined;
}

function readGeometry(
  input: unknown,
  issues: TerritorySourceIssue[],
  context: { provider: string; featureId?: string; path: string }
): TerritoryGeometry | undefined {
  if (!isRecord(input) || (input.type !== "Polygon" && input.type !== "MultiPolygon")) {
    issues.push(
      createSourceIssue({
        stage: "parse",
        code: "SOURCE_FORMAT_UNSUPPORTED",
        message: "Feature geometry must be Polygon or MultiPolygon.",
        provider: context.provider,
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

function createFallbackLocalId(input: {
  geometry: TerritoryGeometry;
  name: string;
  code?: string;
  provider: string;
}): string {
  return `feature-${sha256Hex(serializeJsonStable(input)).slice(0, 16)}`;
}

function adminLevelToNumber(adminLevel: TerritoryAdminLevel): number {
  return Number(adminLevel.slice(3));
}

function previousAdminLevel(adminLevel: TerritoryAdminLevel): TerritoryAdminLevel | "ADM0" {
  const level = adminLevelToNumber(adminLevel);
  return level <= 1 ? "ADM0" : (`ADM${level - 1}` as TerritoryAdminLevel);
}

export function createMappedTerritoryId(options: {
  countryCode: string;
  adminLevel: TerritoryAdminLevel;
  localId: string;
}): string {
  return options.adminLevel === "ADM0"
    ? createTerritoryGlobalId({ countryCode: options.countryCode })
    : createTerritoryGlobalId({
        countryCode: options.countryCode,
        adminLevel: options.adminLevel,
        localId: slugifyTerritoryIdPart(options.localId)
      });
}
