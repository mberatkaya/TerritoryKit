import { createHash } from "node:crypto";
import type { TerritoryAdjacencyConnection } from "@territory-kit/core";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";

export interface BBoxAdjacencyOptions {
  tolerance?: number;
}

export interface SyntheticGridGeneratorOptions {
  datasetId: string;
  rows: number;
  columns: number;
  level?: number;
  originLng?: number;
  originLat?: number;
  cellSize?: number;
  datasetVersion?: string;
  sourceDate?: string;
}

export interface WeightedVoronoiSeed {
  id: string;
  lng: number;
  lat: number;
  weight?: number;
  properties?: Record<string, unknown>;
}

export interface WeightedVoronoiDatasetOptions {
  datasetId: string;
  seeds: WeightedVoronoiSeed[];
  bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
  level?: number;
  datasetVersion?: string;
  sourceDate?: string;
}

export function createDatasetGeometryHash(dataset: Pick<TerritoryDataset, "zones">): string {
  const stableGeometryPayload = dataset.zones
    .map((zone) => ({
      geometry: zone.geometry,
      id: zone.id,
      level: zone.level,
      parentId: zone.parentId ?? null
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return createHash("sha256").update(JSON.stringify(stableGeometryPayload)).digest("hex");
}

export function createSyntheticGridDataset(
  options: SyntheticGridGeneratorOptions
): TerritoryDataset {
  const level = options.level ?? 0;
  const originLng = options.originLng ?? 0;
  const originLat = options.originLat ?? 0;
  const cellSize = options.cellSize ?? 0.01;
  const zones: TerritoryZone[] = [];

  assertPositiveInteger(options.rows, "rows");
  assertPositiveInteger(options.columns, "columns");
  assertNonNegativeInteger(level, "level");
  assertFiniteNumber(originLng, "originLng");
  assertFiniteNumber(originLat, "originLat");
  assertPositiveFiniteNumber(cellSize, "cellSize");

  for (let row = 0; row < options.rows; row += 1) {
    for (let column = 0; column < options.columns; column += 1) {
      const west = originLng + column * cellSize;
      const south = originLat + row * cellSize;

      zones.push(
        createSquareZone({
          id: `z:${row}:${column}`,
          datasetId: options.datasetId,
          level,
          west,
          south,
          east: west + cellSize,
          north: south + cellSize,
          properties: { row, column }
        })
      );
    }
  }

  return finalizeGeneratedDataset({
    datasetId: options.datasetId,
    name: `Synthetic grid ${options.rows}x${options.columns}`,
    zones,
    ...(options.datasetVersion ? { datasetVersion: options.datasetVersion } : {}),
    ...(options.sourceDate ? { sourceDate: options.sourceDate } : {})
  });
}

export function createWeightedVoronoiDataset(
  options: WeightedVoronoiDatasetOptions
): TerritoryDataset {
  if (options.seeds.length === 0) {
    throw new Error("At least one seed is required to generate a weighted Voronoi dataset.");
  }

  const level = options.level ?? 0;
  assertNonNegativeInteger(level, "level");
  assertBounds(options.bounds);

  for (const seed of options.seeds) {
    assertFiniteNumber(seed.lng, `seed '${seed.id}' longitude`);
    assertFiniteNumber(seed.lat, `seed '${seed.id}' latitude`);

    if (seed.weight !== undefined) {
      assertPositiveFiniteNumber(seed.weight, `seed '${seed.id}' weight`);
    }
  }

  const seeds = [...options.seeds].sort(
    (left, right) => left.lng - right.lng || left.id.localeCompare(right.id)
  );
  const totalWeight = seeds.reduce((sum, seed) => sum + Math.max(seed.weight ?? 1, 0.000001), 0);
  const width = options.bounds.east - options.bounds.west;
  let cursor = options.bounds.west;

  const zones = seeds.map((seed, index) => {
    const isLast = index === seeds.length - 1;
    const normalizedWeight = Math.max(seed.weight ?? 1, 0.000001) / totalWeight;
    const east = isLast ? options.bounds.east : cursor + width * normalizedWeight;
    const zone = createSquareZone({
      id: seed.id,
      datasetId: options.datasetId,
      level,
      west: cursor,
      south: options.bounds.south,
      east,
      north: options.bounds.north,
      properties: {
        seedLng: seed.lng,
        seedLat: seed.lat,
        weight: seed.weight ?? 1,
        ...(seed.properties ?? {})
      }
    });
    cursor = east;
    return zone;
  });

  return finalizeGeneratedDataset({
    datasetId: options.datasetId,
    name: "Weighted Voronoi MVP dataset",
    zones,
    ...(options.datasetVersion ? { datasetVersion: options.datasetVersion } : {}),
    ...(options.sourceDate ? { sourceDate: options.sourceDate } : {})
  });
}

export function inferBBoxAdjacency(
  zones: TerritoryZone[],
  options: BBoxAdjacencyOptions = {}
): Record<string, string[]> {
  const tolerance = options.tolerance ?? 1e-9;
  const adjacency: Record<string, string[]> = {};

  for (const zone of zones) {
    adjacency[zone.id] = [];
  }

  for (let leftIndex = 0; leftIndex < zones.length; leftIndex += 1) {
    const left = zones[leftIndex];

    if (!left) {
      continue;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < zones.length; rightIndex += 1) {
      const right = zones[rightIndex];

      if (right && left.level === right.level && bboxesTouch(left, right, tolerance)) {
        adjacency[left.id]?.push(right.id);
        adjacency[right.id]?.push(left.id);
      }
    }
  }

  for (const neighbors of Object.values(adjacency)) {
    neighbors.sort();
  }

  return adjacency;
}

export function inferBBoxAdjacencyConnections(
  zones: TerritoryZone[],
  options: BBoxAdjacencyOptions = {}
): TerritoryAdjacencyConnection[] {
  const adjacency = inferBBoxAdjacency(zones, options);
  const connections: TerritoryAdjacencyConnection[] = [];

  for (const [fromZoneId, neighborIds] of Object.entries(adjacency)) {
    for (const toZoneId of neighborIds) {
      if (fromZoneId < toZoneId) {
        connections.push({
          fromZoneId,
          toZoneId,
          type: "geometric"
        });
      }
    }
  }

  return connections.sort(
    (left, right) =>
      left.fromZoneId.localeCompare(right.fromZoneId) || left.toZoneId.localeCompare(right.toZoneId)
  );
}

function finalizeGeneratedDataset(options: {
  datasetId: string;
  datasetVersion?: string;
  sourceDate?: string;
  name: string;
  zones: TerritoryZone[];
}): TerritoryDataset {
  const dataset = {
    manifest: {
      datasetId: options.datasetId,
      datasetVersion: options.datasetVersion ?? "0.0.0-generated",
      schemaVersion: "territory-schema@1" as const,
      sourceDate: options.sourceDate ?? "generated",
      geometryHash: "pending",
      license: "Apache-2.0",
      name: options.name
    },
    zones: options.zones
  };

  return {
    ...dataset,
    manifest: {
      ...dataset.manifest,
      geometryHash: createDatasetGeometryHash(dataset)
    }
  };
}

function createSquareZone(options: {
  id: string;
  datasetId: string;
  level: number;
  west: number;
  south: number;
  east: number;
  north: number;
  properties?: Record<string, unknown>;
}): TerritoryZone {
  return {
    id: options.id,
    datasetId: options.datasetId,
    level: options.level,
    neighborIds: [],
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [options.west, options.south],
          [options.east, options.south],
          [options.east, options.north],
          [options.west, options.north],
          [options.west, options.south]
        ]
      ]
    },
    center: [(options.west + options.east) / 2, (options.south + options.north) / 2],
    bbox: [options.west, options.south, options.east, options.north],
    properties: options.properties ?? {}
  };
}

function bboxesTouch(left: TerritoryZone, right: TerritoryZone, tolerance: number): boolean {
  const [leftWest, leftSouth, leftEast, leftNorth] = left.bbox;
  const [rightWest, rightSouth, rightEast, rightNorth] = right.bbox;

  const verticalTouch =
    (nearlyEqual(leftEast, rightWest, tolerance) || nearlyEqual(rightEast, leftWest, tolerance)) &&
    rangesOverlap(leftSouth, leftNorth, rightSouth, rightNorth, tolerance);

  const horizontalTouch =
    (nearlyEqual(leftNorth, rightSouth, tolerance) ||
      nearlyEqual(rightNorth, leftSouth, tolerance)) &&
    rangesOverlap(leftWest, leftEast, rightWest, rightEast, tolerance);

  return verticalTouch || horizontalTouch;
}

function rangesOverlap(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
  tolerance: number
): boolean {
  return Math.max(aMin, bMin) <= Math.min(aMax, bMax) + tolerance;
}

function nearlyEqual(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

function assertBounds(bounds: WeightedVoronoiDatasetOptions["bounds"]): void {
  assertFiniteNumber(bounds.west, "bounds.west");
  assertFiniteNumber(bounds.south, "bounds.south");
  assertFiniteNumber(bounds.east, "bounds.east");
  assertFiniteNumber(bounds.north, "bounds.north");

  if (bounds.west >= bounds.east || bounds.south >= bounds.north) {
    throw new Error("bounds must be ordered west < east and south < north.");
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer.`);
  }
}

function assertPositiveFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive finite number.`);
  }
}

function assertFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`);
  }
}
