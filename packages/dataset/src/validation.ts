import type { MultiPolygon, Polygon } from "geojson";
import { TerritoryDatasetValidationError } from "./errors.js";
import { hasRingSelfIntersection } from "./geometry.js";
import { TERRITORY_SCHEMA_VERSION } from "./schema.js";
import type {
  LngLat,
  TerritoryBBox,
  TerritoryDataset,
  TerritoryDatasetManifest,
  TerritoryGeometry,
  TerritoryValidationIssue,
  TerritoryValidationResult,
  TerritoryZone
} from "./types.js";

export function validateTerritoryDataset(input: unknown): TerritoryValidationResult {
  const issues: TerritoryValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [
        {
          code: "DATASET_SHAPE",
          message: "Dataset must be an object.",
          path: "$",
          severity: "error"
        }
      ]
    };
  }

  const manifest = readManifest(input.manifest, issues);
  const zones = readZones(input.zones, manifest?.datasetId, issues);

  if (manifest && zones.length > 0) {
    validateZoneGraph(zones, issues);
  }

  const ok = issues.every((issue) => issue.severity !== "error");

  if (!ok || !manifest) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    issues,
    dataset: {
      manifest,
      zones
    }
  };
}

export function loadTerritoryDataset(input: unknown): TerritoryDataset {
  const result = validateTerritoryDataset(input);

  if (!result.ok || !result.dataset) {
    throw new TerritoryDatasetValidationError(result.issues);
  }

  return result.dataset;
}

export function assertValidTerritoryDataset(input: unknown): asserts input is TerritoryDataset {
  const result = validateTerritoryDataset(input);

  if (!result.ok) {
    throw new TerritoryDatasetValidationError(result.issues);
  }
}

function readManifest(
  input: unknown,
  issues: TerritoryValidationIssue[]
): TerritoryDatasetManifest | undefined {
  if (!isRecord(input)) {
    issues.push({
      code: "DATASET_SHAPE",
      message: "Dataset manifest must be an object.",
      path: "$.manifest",
      severity: "error"
    });
    return undefined;
  }

  const datasetId = readRequiredString(input.datasetId, "$.manifest.datasetId", issues);
  const datasetVersion = readRequiredString(
    input.datasetVersion,
    "$.manifest.datasetVersion",
    issues
  );
  const schemaVersion = readRequiredString(input.schemaVersion, "$.manifest.schemaVersion", issues);
  const sourceDate = readRequiredString(input.sourceDate, "$.manifest.sourceDate", issues);
  const geometryHash = readRequiredString(input.geometryHash, "$.manifest.geometryHash", issues);

  if (schemaVersion && schemaVersion !== TERRITORY_SCHEMA_VERSION) {
    issues.push({
      code: "MANIFEST_FIELD",
      message: `Unsupported schema version '${schemaVersion}'.`,
      path: "$.manifest.schemaVersion",
      severity: "error"
    });
  }

  if (
    !datasetId ||
    !datasetVersion ||
    !sourceDate ||
    !geometryHash ||
    schemaVersion !== TERRITORY_SCHEMA_VERSION
  ) {
    return undefined;
  }

  return {
    datasetId,
    datasetVersion,
    schemaVersion,
    sourceDate,
    geometryHash,
    ...(typeof input.license === "string" ? { license: input.license } : {}),
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
}

function readZones(
  input: unknown,
  manifestDatasetId: string | undefined,
  issues: TerritoryValidationIssue[]
): TerritoryZone[] {
  if (!Array.isArray(input)) {
    issues.push({
      code: "DATASET_SHAPE",
      message: "Dataset zones must be an array.",
      path: "$.zones",
      severity: "error"
    });
    return [];
  }

  const zones: TerritoryZone[] = [];
  const seenIds = new Set<string>();

  input.forEach((rawZone, index) => {
    const path = `$.zones[${index}]`;

    if (!isRecord(rawZone)) {
      issues.push({
        code: "ZONE_FIELD",
        message: "Zone must be an object.",
        path,
        severity: "error",
        repairSuggestion:
          "Provide a zone object with id, datasetId, level, geometry, center, bbox, neighborIds, and properties."
      });
      return;
    }

    const id = readRequiredString(rawZone.id, `${path}.id`, issues);
    const datasetId = readRequiredString(rawZone.datasetId, `${path}.datasetId`, issues);
    const level = readLevel(rawZone.level, `${path}.level`, issues);
    const parentId = readOptionalString(rawZone.parentId, `${path}.parentId`, issues);
    const childIds = readOptionalStringArray(rawZone.childIds, `${path}.childIds`, issues);
    const neighborIds = readRequiredStringArray(rawZone.neighborIds, `${path}.neighborIds`, issues);
    const geometry = readGeometry(rawZone.geometry, `${path}.geometry`, issues, id);
    const center = readLngLat(rawZone.center, `${path}.center`, "CENTER_FIELD", issues);
    const bbox = readBBox(rawZone.bbox, `${path}.bbox`, issues);
    const properties = isRecord(rawZone.properties) ? rawZone.properties : undefined;

    if (properties === undefined) {
      issues.push({
        code: "ZONE_FIELD",
        message: "Zone properties must be an object.",
        path: `${path}.properties`,
        severity: "error",
        ...(id ? { zoneId: id, featureId: id } : {}),
        repairSuggestion: "Set properties to an object, even when it is empty."
      });
    }

    if (id && seenIds.has(id)) {
      issues.push({
        code: "DUPLICATE_ZONE_ID",
        message: `Zone id '${id}' is used more than once.`,
        path: `${path}.id`,
        severity: "error",
        zoneId: id,
        featureId: id,
        repairSuggestion: "Use stable unique zone ids across the entire dataset."
      });
    }

    if (id) {
      seenIds.add(id);
    }

    if (manifestDatasetId && datasetId && datasetId !== manifestDatasetId) {
      issues.push({
        code: "DATASET_ID_MISMATCH",
        message: `Zone datasetId '${datasetId}' does not match manifest datasetId '${manifestDatasetId}'.`,
        path: `${path}.datasetId`,
        severity: "error",
        ...(id ? { zoneId: id, featureId: id } : {}),
        repairSuggestion: "Set every zone datasetId to the manifest datasetId."
      });
    }

    if (
      !id ||
      !datasetId ||
      level === undefined ||
      !neighborIds ||
      !geometry ||
      !center ||
      !bbox ||
      !properties
    ) {
      return;
    }

    zones.push({
      id,
      datasetId,
      level,
      ...(parentId ? { parentId } : {}),
      ...(childIds ? { childIds } : {}),
      neighborIds,
      geometry,
      center,
      bbox,
      properties
    });
  });

  return zones;
}

function validateZoneGraph(zones: TerritoryZone[], issues: TerritoryValidationIssue[]): void {
  const zonesById = new Map(zones.map((zone) => [zone.id, zone]));

  for (const zone of zones) {
    if (zone.parentId) {
      const parent = zonesById.get(zone.parentId);

      if (!parent) {
        issues.push({
          code: "PARENT_MISSING",
          message: `Parent zone '${zone.parentId}' does not exist.`,
          path: `$.zones[?(@.id=="${zone.id}")].parentId`,
          severity: "error",
          zoneId: zone.id
        });
      } else if (parent.level >= zone.level) {
        issues.push({
          code: "PARENT_LEVEL",
          message: `Parent zone '${parent.id}' must have a lower level than child '${zone.id}'.`,
          path: `$.zones[?(@.id=="${zone.id}")].parentId`,
          severity: "error",
          zoneId: zone.id
        });
      }
    }

    for (const childId of zone.childIds ?? []) {
      const child = zonesById.get(childId);

      if (!child) {
        issues.push({
          code: "CHILD_MISSING",
          message: `Child zone '${childId}' does not exist.`,
          path: `$.zones[?(@.id=="${zone.id}")].childIds`,
          severity: "error",
          zoneId: zone.id
        });
      } else if (child.parentId !== zone.id) {
        issues.push({
          code: "CHILD_PARENT_MISMATCH",
          message: `Child zone '${child.id}' does not point back to parent '${zone.id}'.`,
          path: `$.zones[?(@.id=="${zone.id}")].childIds`,
          severity: "error",
          zoneId: zone.id
        });
      }
    }

    for (const neighborId of zone.neighborIds) {
      if (!zonesById.has(neighborId)) {
        issues.push({
          code: "NEIGHBOR_MISSING",
          message: `Neighbor zone '${neighborId}' does not exist.`,
          path: `$.zones[?(@.id=="${zone.id}")].neighborIds`,
          severity: "error",
          zoneId: zone.id
        });
      }
    }

    validateParentCycle(zone, zonesById, issues);
  }
}

function validateParentCycle(
  zone: TerritoryZone,
  zonesById: Map<string, TerritoryZone>,
  issues: TerritoryValidationIssue[]
): void {
  const visited = new Set<string>();
  let current: TerritoryZone | undefined = zone;

  while (current) {
    if (visited.has(current.id)) {
      issues.push({
        code: "HIERARCHY_CYCLE",
        message: `Hierarchy cycle detected from zone '${zone.id}'.`,
        path: `$.zones[?(@.id=="${zone.id}")].parentId`,
        severity: "error",
        zoneId: zone.id
      });
      return;
    }

    visited.add(current.id);
    current = current.parentId ? zonesById.get(current.parentId) : undefined;
  }
}

function readGeometry(
  input: unknown,
  path: string,
  issues: TerritoryValidationIssue[],
  zoneId: string | undefined
): TerritoryGeometry | undefined {
  if (!isRecord(input)) {
    issues.push({
      code: "GEOMETRY_TYPE",
      message: "Geometry must be an object.",
      path,
      severity: "error",
      ...(zoneId ? { zoneId } : {})
    });
    return undefined;
  }

  if (input.type === "Polygon") {
    const polygon = readPolygonCoordinates(
      input.coordinates,
      `${path}.coordinates`,
      issues,
      zoneId
    );
    return polygon ? ({ type: "Polygon", coordinates: polygon } satisfies Polygon) : undefined;
  }

  if (input.type === "MultiPolygon") {
    if (!Array.isArray(input.coordinates)) {
      issues.push({
        code: "GEOMETRY_COORDINATES",
        message: "MultiPolygon coordinates must be an array.",
        path: `${path}.coordinates`,
        severity: "error",
        ...(zoneId ? { zoneId } : {})
      });
      return undefined;
    }

    const polygons = input.coordinates
      .map((polygon, index) =>
        readPolygonCoordinates(polygon, `${path}.coordinates[${index}]`, issues, zoneId)
      )
      .filter((polygon): polygon is LngLat[][] => Boolean(polygon));

    return polygons.length === input.coordinates.length
      ? ({ type: "MultiPolygon", coordinates: polygons } satisfies MultiPolygon)
      : undefined;
  }

  issues.push({
    code: "GEOMETRY_TYPE",
    message: "Geometry type must be Polygon or MultiPolygon.",
    path: `${path}.type`,
    severity: "error",
    ...(zoneId ? { zoneId } : {})
  });
  return undefined;
}

function readPolygonCoordinates(
  input: unknown,
  path: string,
  issues: TerritoryValidationIssue[],
  zoneId: string | undefined
): LngLat[][] | undefined {
  if (!Array.isArray(input) || input.length === 0) {
    issues.push({
      code: "GEOMETRY_COORDINATES",
      message: "Polygon coordinates must contain at least one ring.",
      path,
      severity: "error",
      ...(zoneId ? { zoneId } : {})
    });
    return undefined;
  }

  const rings = input
    .map((ring, index) => readRing(ring, `${path}[${index}]`, issues, zoneId))
    .filter((ring): ring is LngLat[] => Boolean(ring));

  return rings.length === input.length ? rings : undefined;
}

function readRing(
  input: unknown,
  path: string,
  issues: TerritoryValidationIssue[],
  zoneId: string | undefined
): LngLat[] | undefined {
  if (!Array.isArray(input) || input.length < 4) {
    issues.push({
      code: "GEOMETRY_RING",
      message: "Linear ring must contain at least four positions.",
      path,
      severity: "error",
      ...(zoneId ? { zoneId } : {})
    });
    return undefined;
  }

  const coordinates = input
    .map((position, index) =>
      readLngLat(position, `${path}[${index}]`, "GEOMETRY_COORDINATES", issues, zoneId)
    )
    .filter((position): position is LngLat => Boolean(position));

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];

  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
    issues.push({
      code: "GEOMETRY_RING",
      message: "Linear ring must be closed.",
      path,
      severity: "error",
      ...(zoneId ? { zoneId } : {})
    });
  }

  if (coordinates.length === input.length && hasRingSelfIntersection(coordinates)) {
    issues.push({
      code: "SELF_INTERSECTION",
      message: "Linear ring self-intersects.",
      path,
      severity: "error",
      ...(zoneId ? { zoneId } : {})
    });
  }

  return coordinates.length === input.length ? coordinates : undefined;
}

function readRequiredString(
  input: unknown,
  path: string,
  issues: TerritoryValidationIssue[]
): string | undefined {
  if (typeof input === "string" && input.length > 0) {
    return input;
  }

  issues.push({
    code: "MANIFEST_FIELD",
    message: "Expected a non-empty string.",
    path,
    severity: "error"
  });
  return undefined;
}

function readOptionalString(
  input: unknown,
  path: string,
  issues: TerritoryValidationIssue[]
): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input === "string" && input.length > 0) {
    return input;
  }

  issues.push({
    code: "ZONE_FIELD",
    message: "Expected a non-empty string when present.",
    path,
    severity: "error"
  });
  return undefined;
}

function readRequiredStringArray(
  input: unknown,
  path: string,
  issues: TerritoryValidationIssue[]
): string[] | undefined {
  if (
    Array.isArray(input) &&
    input.every((value) => typeof value === "string" && value.length > 0)
  ) {
    return [...input];
  }

  issues.push({
    code: "ZONE_FIELD",
    message: "Expected an array of non-empty strings.",
    path,
    severity: "error"
  });
  return undefined;
}

function readOptionalStringArray(
  input: unknown,
  path: string,
  issues: TerritoryValidationIssue[]
): string[] | undefined {
  if (input === undefined) {
    return undefined;
  }

  return readRequiredStringArray(input, path, issues);
}

function readLevel(
  input: unknown,
  path: string,
  issues: TerritoryValidationIssue[]
): number | undefined {
  if (typeof input === "number" && Number.isInteger(input) && input >= 0) {
    return input;
  }

  issues.push({
    code: "ZONE_FIELD",
    message: "Zone level must be a non-negative integer.",
    path,
    severity: "error"
  });
  return undefined;
}

function readBBox(
  input: unknown,
  path: string,
  issues: TerritoryValidationIssue[]
): TerritoryBBox | undefined {
  if (
    Array.isArray(input) &&
    input.length === 4 &&
    input.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    const [west, south, east, north] = input as TerritoryBBox;

    if (west <= east && south <= north) {
      return [west, south, east, north];
    }
  }

  issues.push({
    code: "BBOX_FIELD",
    message: "BBox must be [west, south, east, north].",
    path,
    severity: "error"
  });
  return undefined;
}

function readLngLat(
  input: unknown,
  path: string,
  code: "CENTER_FIELD" | "GEOMETRY_COORDINATES",
  issues: TerritoryValidationIssue[],
  zoneId?: string
): LngLat | undefined {
  if (
    Array.isArray(input) &&
    input.length >= 2 &&
    typeof input[0] === "number" &&
    Number.isFinite(input[0]) &&
    typeof input[1] === "number" &&
    Number.isFinite(input[1])
  ) {
    return [input[0], input[1]];
  }

  issues.push({
    code,
    message: "Expected [longitude, latitude].",
    path,
    severity: "error",
    ...(zoneId ? { zoneId } : {})
  });
  return undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
