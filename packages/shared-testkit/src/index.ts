import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";

export interface SyntheticGridDatasetOptions {
  datasetId?: string;
  rows: number;
  columns: number;
  level?: number;
  originLng?: number;
  originLat?: number;
  cellSize?: number;
  withNeighbors?: boolean;
}

export function createSquareZone(options: {
  id: string;
  datasetId?: string;
  level: number;
  west: number;
  south: number;
  east: number;
  north: number;
  parentId?: string;
  childIds?: string[];
  neighborIds?: string[];
  properties?: Record<string, unknown>;
}): TerritoryZone {
  const datasetId = options.datasetId ?? "territorykit-sample";

  return {
    id: options.id,
    datasetId,
    level: options.level,
    ...(options.parentId ? { parentId: options.parentId } : {}),
    ...(options.childIds ? { childIds: options.childIds } : {}),
    neighborIds: options.neighborIds ?? [],
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

export function createSampleTerritoryDataset(): TerritoryDataset {
  return {
    manifest: {
      datasetId: "territorykit-sample",
      datasetVersion: "0.1.0-alpha.1",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-07",
      geometryHash: "sample-fixture-v1",
      license: "Apache-2.0",
      name: "TerritoryKit Sample"
    },
    zones: [
      createSquareZone({
        id: "world:europe",
        level: 0,
        west: 20,
        south: 35,
        east: 45,
        north: 43,
        childIds: ["tr"]
      }),
      createSquareZone({
        id: "tr",
        level: 1,
        west: 25,
        south: 36,
        east: 45,
        north: 42,
        parentId: "world:europe",
        childIds: ["tr:34"],
        properties: { name: "Turkiye" }
      }),
      createSquareZone({
        id: "tr:34",
        level: 2,
        west: 28,
        south: 40,
        east: 30,
        north: 42,
        parentId: "tr",
        childIds: ["tr:34:fatih", "tr:34:kadikoy"],
        properties: { name: "Istanbul" }
      }),
      createSquareZone({
        id: "tr:34:fatih",
        level: 3,
        west: 28.93,
        south: 41,
        east: 29,
        north: 41.05,
        parentId: "tr:34",
        neighborIds: ["tr:34:kadikoy"],
        properties: { name: "Fatih" }
      }),
      createSquareZone({
        id: "tr:34:kadikoy",
        level: 3,
        west: 29,
        south: 40.97,
        east: 29.08,
        north: 41.02,
        parentId: "tr:34",
        neighborIds: ["tr:34:fatih"],
        properties: { name: "Kadikoy" }
      })
    ]
  };
}

export function createSyntheticGridDataset(options: SyntheticGridDatasetOptions): TerritoryDataset {
  const datasetId = options.datasetId ?? `synthetic-grid-${options.rows}x${options.columns}`;
  const level = options.level ?? 0;
  const originLng = options.originLng ?? 0;
  const originLat = options.originLat ?? 0;
  const cellSize = options.cellSize ?? 0.01;
  const zones: TerritoryZone[] = [];

  for (let row = 0; row < options.rows; row += 1) {
    for (let column = 0; column < options.columns; column += 1) {
      const id = `z:${row}:${column}`;
      const west = originLng + column * cellSize;
      const south = originLat + row * cellSize;
      const east = west + cellSize;
      const north = south + cellSize;

      zones.push(
        createSquareZone({
          id,
          datasetId,
          level,
          west,
          south,
          east,
          north,
          neighborIds: options.withNeighbors
            ? getGridNeighborIds(row, column, options.rows, options.columns)
            : [],
          properties: { row, column }
        })
      );
    }
  }

  return {
    manifest: {
      datasetId,
      datasetVersion: "0.0.0-synthetic",
      schemaVersion: "territory-schema@1",
      sourceDate: "synthetic",
      geometryHash: `${options.rows}x${options.columns}:${cellSize}`,
      license: "Apache-2.0",
      name: `Synthetic grid ${options.rows}x${options.columns}`
    },
    zones
  };
}

function getGridNeighborIds(row: number, column: number, rows: number, columns: number): string[] {
  const neighbors: string[] = [];

  if (row > 0) {
    neighbors.push(`z:${row - 1}:${column}`);
  }

  if (row < rows - 1) {
    neighbors.push(`z:${row + 1}:${column}`);
  }

  if (column > 0) {
    neighbors.push(`z:${row}:${column - 1}`);
  }

  if (column < columns - 1) {
    neighbors.push(`z:${row}:${column + 1}`);
  }

  return neighbors.sort();
}
