import type { Feature, FeatureCollection } from "geojson";
import { TerritoryDatasetValidationError } from "./errors.js";
import { computeGeometryBBox, computeGeometryCenter, geometryToPolygons } from "./geometry.js";
import { validateTerritoryDataset } from "./validation.js";
import type {
  LngLat,
  TerritoryDataset,
  TerritoryGeoJsonImportOptions,
  TerritoryGeometry,
  TerritoryValidationIssue,
  TerritoryValidationResult,
  TerritoryZone
} from "./types.js";

const DEFAULT_ID_PROPERTY = "id";
const DEFAULT_LEVEL_PROPERTY = "level";
const DEFAULT_PARENT_ID_PROPERTY = "parentId";
const DEFAULT_CHILD_IDS_PROPERTY = "childIds";
const DEFAULT_NEIGHBOR_IDS_PROPERTY = "neighborIds";

export function createTerritoryDatasetFromGeoJson(
  input: unknown,
  options: TerritoryGeoJsonImportOptions
): TerritoryValidationResult {
  const importIssues: TerritoryValidationIssue[] = [];

  if (!isFeatureCollection(input)) {
    return {
      ok: false,
      issues: [
        {
          code: "FEATURE_COLLECTION_SHAPE",
          message: "GeoJSON import input must be a FeatureCollection.",
          path: "$.type",
          severity: "error",
          ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
          repairSuggestion:
            "Wrap administrative Polygon/MultiPolygon features in a GeoJSON FeatureCollection."
        }
      ]
    };
  }

  const zones: TerritoryZone[] = [];
  const seenFeatureIds = new Set<string>();

  input.features.forEach((feature, index) => {
    const path = `$.features[${index}]`;
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const featureId = readFeatureId(feature, properties, path, options, importIssues);

    if (featureId) {
      if (seenFeatureIds.has(featureId)) {
        importIssues.push({
          code: "DUPLICATE_FEATURE_ID",
          message: `Feature id '${featureId}' is used more than once.`,
          path: `${path}.id`,
          severity: "error",
          featureId,
          ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
          repairSuggestion: "Choose a stable unique feature id before importing the dataset."
        });
      }

      seenFeatureIds.add(featureId);
    }

    const geometry = readFeatureGeometry(feature, path, options, importIssues, featureId);
    const level = readFeatureLevel(properties, path, options, importIssues, featureId);
    const parentId = readOptionalStringProperty(
      properties,
      options.parentIdProperty ?? DEFAULT_PARENT_ID_PROPERTY,
      `${path}.properties`,
      options,
      featureId,
      importIssues
    );
    const childIds = readStringArrayProperty(
      properties,
      options.childIdsProperty ?? DEFAULT_CHILD_IDS_PROPERTY,
      `${path}.properties`,
      options,
      featureId,
      importIssues
    );
    const neighborIds = readStringArrayProperty(
      properties,
      options.neighborIdsProperty ?? DEFAULT_NEIGHBOR_IDS_PROPERTY,
      `${path}.properties`,
      options,
      featureId,
      importIssues
    );

    if (!featureId || !geometry || level === undefined) {
      return;
    }

    zones.push({
      id: featureId,
      datasetId: options.manifest.datasetId,
      level,
      ...(parentId ? { parentId } : {}),
      ...(childIds ? { childIds } : {}),
      neighborIds: neighborIds ?? [],
      geometry,
      center: computeGeometryCenter(geometry),
      bbox: computeGeometryBBox(geometry),
      properties: { ...properties }
    });
  });

  const validationResult = validateTerritoryDataset({
    manifest: options.manifest,
    zones
  });
  const issues = [...importIssues, ...withImportSource(validationResult.issues, options)];
  const ok = issues.every((issue) => issue.severity !== "error");

  if (!ok || !validationResult.dataset) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    issues,
    dataset: validationResult.dataset
  };
}

export function loadTerritoryDatasetFromGeoJson(
  input: unknown,
  options: TerritoryGeoJsonImportOptions
): TerritoryDataset {
  const result = createTerritoryDatasetFromGeoJson(input, options);

  if (!result.ok || !result.dataset) {
    throw new TerritoryDatasetValidationError(result.issues);
  }

  return result.dataset;
}

function readFeatureId(
  feature: Feature,
  properties: Record<string, unknown>,
  path: string,
  options: TerritoryGeoJsonImportOptions,
  issues: TerritoryValidationIssue[]
): string | undefined {
  const idProperty = options.idProperty ?? DEFAULT_ID_PROPERTY;
  const id = feature.id ?? properties[idProperty];

  if ((typeof id === "string" && id.length > 0) || typeof id === "number") {
    return String(id);
  }

  issues.push({
    code: "FEATURE_ID",
    message: `Feature must define a stable id or properties.${idProperty}.`,
    path: `${path}.id`,
    severity: "error",
    ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
    repairSuggestion: `Set feature.id or properties.${idProperty} to a stable unique string.`
  });
  return undefined;
}

function readFeatureGeometry(
  feature: Feature,
  path: string,
  options: TerritoryGeoJsonImportOptions,
  issues: TerritoryValidationIssue[],
  featureId: string | undefined
): TerritoryGeometry | undefined {
  const geometry = feature.geometry;

  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
    issues.push({
      code: "GEOMETRY_TYPE",
      message: "Feature geometry must be Polygon or MultiPolygon.",
      path: `${path}.geometry.type`,
      severity: "error",
      ...(featureId ? { featureId } : {}),
      ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
      repairSuggestion:
        "Convert the feature to Polygon/MultiPolygon or filter it out before import."
    });
    return undefined;
  }

  const typedGeometry = geometry as TerritoryGeometry;

  if (!hasUsableCoordinateShape(typedGeometry)) {
    issues.push({
      code: "GEOMETRY_COORDINATES",
      message: "Feature geometry coordinates must be numeric GeoJSON positions.",
      path: `${path}.geometry.coordinates`,
      severity: "error",
      ...(featureId ? { featureId } : {}),
      ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
      repairSuggestion:
        "Export the source as valid RFC 7946 Polygon/MultiPolygon coordinates before import."
    });
    return undefined;
  }

  const outOfRange = findOutOfRangeCoordinate(typedGeometry);

  if (outOfRange) {
    issues.push({
      code: "COORDINATE_RANGE",
      message: "GeoJSON coordinates must use [longitude, latitude] in WGS84 ranges.",
      path: `${path}.geometry.coordinates${outOfRange.path}`,
      severity: "error",
      ...(featureId ? { featureId } : {}),
      ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
      repairSuggestion:
        "Normalize source data to EPSG:4326 and keep coordinate order as [longitude, latitude]."
    });
  }

  return typedGeometry;
}

function readFeatureLevel(
  properties: Record<string, unknown>,
  path: string,
  options: TerritoryGeoJsonImportOptions,
  issues: TerritoryValidationIssue[],
  featureId: string | undefined
): number | undefined {
  const levelProperty = options.levelProperty ?? DEFAULT_LEVEL_PROPERTY;
  const level = properties[levelProperty];

  if (typeof level === "number" && Number.isInteger(level) && level >= 0) {
    return level;
  }

  issues.push({
    code: "ZONE_FIELD",
    message: `Feature properties.${levelProperty} must be a non-negative integer.`,
    path: `${path}.properties.${levelProperty}`,
    severity: "error",
    ...(featureId ? { featureId } : {}),
    ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
    repairSuggestion: `Add properties.${levelProperty} to each feature before import.`
  });
  return undefined;
}

function readOptionalStringProperty(
  properties: Record<string, unknown>,
  key: string,
  path: string,
  options: TerritoryGeoJsonImportOptions,
  featureId: string | undefined,
  issues: TerritoryValidationIssue[]
): string | undefined {
  const value = properties[key];

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  issues.push({
    code: "ZONE_FIELD",
    message: `Feature properties.${key} must be a string when present.`,
    path: `${path}.${key}`,
    severity: "error",
    ...(featureId ? { featureId } : {}),
    ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
    repairSuggestion: `Store properties.${key} as a string id, or remove it.`
  });
  return undefined;
}

function readStringArrayProperty(
  properties: Record<string, unknown>,
  key: string,
  path: string,
  options: TerritoryGeoJsonImportOptions,
  featureId: string | undefined,
  issues: TerritoryValidationIssue[]
): string[] | undefined {
  const value = properties[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)) {
    return [...value];
  }

  issues.push({
    code: "ZONE_FIELD",
    message: `Feature properties.${key} must be an array of non-empty strings when present.`,
    path: `${path}.${key}`,
    severity: "error",
    ...(featureId ? { featureId } : {}),
    ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
    repairSuggestion: `Store properties.${key} as string ids, or remove it.`
  });
  return undefined;
}

function hasUsableCoordinateShape(geometry: TerritoryGeometry): boolean {
  if (geometry.type === "Polygon") {
    return (
      Array.isArray(geometry.coordinates) &&
      geometry.coordinates.every(
        (ring) => Array.isArray(ring) && ring.every(isNumericLngLatPosition)
      )
    );
  }

  return (
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.every(
      (polygon) =>
        Array.isArray(polygon) &&
        polygon.every((ring) => Array.isArray(ring) && ring.every(isNumericLngLatPosition))
    )
  );
}

function isNumericLngLatPosition(input: unknown): input is LngLat {
  return (
    Array.isArray(input) &&
    input.length >= 2 &&
    typeof input[0] === "number" &&
    Number.isFinite(input[0]) &&
    typeof input[1] === "number" &&
    Number.isFinite(input[1])
  );
}

function findOutOfRangeCoordinate(
  geometry: TerritoryGeometry
): { coordinate: LngLat; path: string } | undefined {
  const polygons = geometryToPolygons(geometry);

  for (const [polygonIndex, polygon] of polygons.entries()) {
    for (const [ringIndex, ring] of polygon.entries()) {
      for (const [coordinateIndex, coordinate] of ring.entries()) {
        const [longitude, latitude] = coordinate;

        if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
          const path =
            geometry.type === "Polygon"
              ? `[${ringIndex}][${coordinateIndex}]`
              : `[${polygonIndex}][${ringIndex}][${coordinateIndex}]`;

          return { coordinate, path };
        }
      }
    }
  }

  return undefined;
}

function withImportSource(
  issues: TerritoryValidationIssue[],
  options: TerritoryGeoJsonImportOptions
): TerritoryValidationIssue[] {
  if (!options.sourcePath) {
    return issues;
  }

  const sourcePath = options.sourcePath;

  return issues.map((issue) => ({
    ...issue,
    sourcePath: issue.sourcePath ?? sourcePath
  }));
}

function isFeatureCollection(input: unknown): input is FeatureCollection {
  return (
    isRecord(input) &&
    input.type === "FeatureCollection" &&
    Array.isArray(input.features) &&
    input.features.every(isFeature)
  );
}

function isFeature(input: unknown): input is Feature {
  return isRecord(input) && input.type === "Feature";
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
