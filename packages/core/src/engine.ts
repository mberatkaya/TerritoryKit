import {
  TerritoryError,
  computeGeometryBBox,
  createTerritoryAdjacencyIndex,
  loadTerritoryDataset
} from "@territory-kit/dataset";
import type {
  LngLat,
  TerritoryAdjacencyEdge,
  TerritoryAdjacencyType,
  TerritoryDataset,
  TerritoryZone
} from "@territory-kit/dataset";
import Flatbush from "flatbush";
import {
  decodeTerritoryBinarySpatialIndex,
  isTerritoryBinarySpatialIndex
} from "./binary-index.js";
import type {
  TerritoryBinarySpatialIndex,
  TerritoryBinarySpatialIndexBuffer
} from "./binary-index.js";
import { TerritoryZoneNotFoundError } from "./errors.js";
import {
  bboxIntersectsBounds,
  geometryIntersectsGeometry,
  pointIntersectsGeometry
} from "./geometry.js";
import { defaultZoomLevelStrategy } from "./zoom.js";
import type {
  BoundsQuery,
  LatLng,
  LocateOptions,
  PolygonToZonesOptions,
  TerritoryAdjacencyConnection,
  TerritoryAdjacencyConnectionType,
  TerritoryBounds,
  TerritoryEngine,
  TerritoryEngineOptions,
  TerritoryEngineSpatialIndexSummary,
  ViewportCacheKeyQuery,
  VisibleZonesQuery
} from "./types.js";

interface LevelIndex {
  source: "flatbush" | "binary";
  estimatedBytes: number;
  search(west: number, south: number, east: number, north: number): string[];
}

interface SpatialIndexBuildResult {
  indexesByLevel: Map<number, LevelIndex>;
  summary: TerritoryEngineSpatialIndexSummary;
}

export function createTerritoryEngine(options: TerritoryEngineOptions): TerritoryEngine {
  const dataset = loadTerritoryDataset(options.dataset);
  const zonesById = new Map(dataset.zones.map((zone) => [zone.id, zone]));
  const availableLevels = [...new Set(dataset.zones.map((zone) => zone.level))].sort(
    (left, right) => left - right
  );
  const levelStrategy = options.levelStrategy ?? defaultZoomLevelStrategy;
  const spatialIndexes = buildSpatialIndexes(dataset, options.spatialIndex);
  const indexesByLevel = spatialIndexes.indexesByLevel;
  const adjacencyIndex = options.adjacency
    ? createTerritoryAdjacencyIndex(options.adjacency)
    : undefined;
  const adjacencyConnections = normalizeAdjacencyConnections(
    options.adjacencyConnections ?? []
  ).filter(
    (connection) => zonesById.has(connection.fromZoneId) && zonesById.has(connection.toZoneId)
  );
  const connectionsByZoneId = buildConnectionsByZoneId(adjacencyConnections);
  const debugBruteForceLookup = options.debug?.bruteForceLookup === true;
  const viewportCacheRevision = options.viewportCacheRevision ?? "0";

  function requireZone(zoneId: string): TerritoryZone {
    const zone = zonesById.get(zoneId);

    if (!zone) {
      throw new TerritoryZoneNotFoundError(zoneId);
    }

    return zone;
  }

  function getCandidateZones(
    bounds: TerritoryBounds,
    level?: number,
    lookupMode: "index" | "brute-force" = "index"
  ): TerritoryZone[] {
    const normalizedBounds = normalizeQueryBounds(bounds);

    if (!normalizedBounds || (level !== undefined && !isValidLevel(level))) {
      return [];
    }

    if (lookupMode === "brute-force") {
      return sortZones(
        dataset.zones.filter(
          (zone) =>
            (level === undefined || zone.level === level) &&
            bboxIntersectsBounds(zone.bbox, normalizedBounds)
        )
      );
    }

    const indexes =
      level === undefined
        ? [...indexesByLevel.values()]
        : [indexesByLevel.get(level)].filter(Boolean);
    const zones: TerritoryZone[] = [];

    for (const entry of indexes) {
      if (!entry) {
        continue;
      }

      for (const zoneId of entry.search(
        normalizedBounds.west,
        normalizedBounds.south,
        normalizedBounds.east,
        normalizedBounds.north
      )) {
        const zone = zoneId ? zonesById.get(zoneId) : undefined;

        if (zone && bboxIntersectsBounds(zone.bbox, normalizedBounds)) {
          zones.push(zone);
        }
      }
    }

    return sortZones(zones);
  }

  function resolveVisibleLevel(query: ViewportCacheKeyQuery): number {
    if (query.level !== undefined) {
      return query.level;
    }

    const strategy = query.strategy ?? levelStrategy;

    return strategy.resolveLevel({
      zoom: query.zoom ?? 0,
      dataset,
      availableLevels
    });
  }

  function createViewportCacheKey(query: ViewportCacheKeyQuery): string {
    const level = resolveVisibleLevel(query);
    const bounds = normalizeBoundsForCache(query.bounds);

    return [
      dataset.manifest.datasetId,
      dataset.manifest.datasetVersion,
      dataset.manifest.geometryHash,
      viewportCacheRevision,
      `z${level}`,
      bounds.west,
      bounds.south,
      bounds.east,
      bounds.north
    ].join(":");
  }

  function locate(coordinate: LatLng, options: LocateOptions = {}): string | null {
    if (
      !isValidCoordinate(coordinate) ||
      (options.level !== undefined && !isValidLevel(options.level))
    ) {
      return null;
    }

    const lngLat: LngLat = [coordinate.lng, coordinate.lat];
    const boundaryMode = options.boundaryMode ?? "covers";
    const level = options.level;
    const candidates = getCandidateZones(
      {
        west: coordinate.lng,
        south: coordinate.lat,
        east: coordinate.lng,
        north: coordinate.lat
      },
      level,
      debugBruteForceLookup ? "brute-force" : "index"
    )
      .filter((zone) => level === undefined || zone.level === level)
      .sort((left, right) => right.level - left.level || left.id.localeCompare(right.id));

    for (const zone of candidates) {
      if (pointIntersectsGeometry(lngLat, zone.geometry, boundaryMode)) {
        return zone.id;
      }
    }

    return null;
  }

  return {
    dataset,
    availableLevels,

    getZoneById(zoneId) {
      return zonesById.get(zoneId) ?? null;
    },

    getZoneLevel(zoneId) {
      return requireZone(zoneId).level;
    },

    getAdjacencyConnections(zoneId, options = {}) {
      requireZone(zoneId);
      return filterConnections(connectionsByZoneId.get(zoneId) ?? [], options.connectionTypes);
    },

    getAdjacencyRelations(zoneId, options = {}) {
      requireZone(zoneId);

      if (!adjacencyIndex) {
        return [];
      }

      const queryOptions = options.types ? { types: options.types } : {};

      return adjacencyIndex
        .getNeighbors(zoneId, queryOptions)
        .flatMap((neighborId) => adjacencyIndex.getRelation(zoneId, neighborId, queryOptions))
        .sort(compareAdjacencyEdges);
    },

    getSpatialIndexSummary() {
      return {
        ...spatialIndexes.summary,
        levels: [...spatialIndexes.summary.levels]
      };
    },

    getLevelTransition(query) {
      const strategy = query.strategy ?? levelStrategy;
      const fromLevel = strategy.resolveLevel({
        zoom: query.fromZoom,
        dataset,
        availableLevels
      });
      const toLevel = strategy.resolveLevel({
        zoom: query.toZoom,
        dataset,
        availableLevels
      });
      const fromZoneIds = getCandidateZones(query.bounds, fromLevel).map((zone) => zone.id);
      const toZoneIds = getCandidateZones(query.bounds, toLevel).map((zone) => zone.id);
      const fromSet = new Set(fromZoneIds);
      const toSet = new Set(toZoneIds);

      return {
        fromLevel,
        toLevel,
        fromZoneIds,
        toZoneIds,
        enteringZoneIds: toZoneIds.filter((zoneId) => !fromSet.has(zoneId)),
        exitingZoneIds: fromZoneIds.filter((zoneId) => !toSet.has(zoneId)),
        stableZoneIds: toZoneIds.filter((zoneId) => fromSet.has(zoneId))
      };
    },

    getZonesInBounds(query: BoundsQuery) {
      return getCandidateZones(query, query.level);
    },

    getViewportCacheKey: createViewportCacheKey,

    getVisibleZones(query: VisibleZonesQuery) {
      const level = resolveVisibleLevel(query);

      return getCandidateZones(query.bounds, level);
    },

    getAncestors(zoneId) {
      const ancestors: string[] = [];
      let current = requireZone(zoneId);

      while (current.parentId) {
        ancestors.push(current.parentId);
        current = requireZone(current.parentId);
      }

      return ancestors;
    },

    getDescendants(zoneId) {
      const descendants: string[] = [];
      const queue = [...this.zoneToChildren(zoneId)];

      while (queue.length > 0) {
        const nextId = queue.shift();

        if (!nextId) {
          continue;
        }

        descendants.push(nextId);
        queue.push(...this.zoneToChildren(nextId));
      }

      return descendants;
    },

    isValidZone(zoneId) {
      return zonesById.has(zoneId);
    },

    latLngToZone: locate,

    latLngToZones(coordinates, locateOptions) {
      return coordinates.map((coordinate) => locate(coordinate, locateOptions));
    },

    polygonToZones(geometry, polygonOptions: PolygonToZonesOptions = {}) {
      const bounds = bboxToBounds(computeGeometryBBox(geometry));
      const boundaryMode = polygonOptions.boundaryMode ?? "covers";
      const mode = polygonOptions.mode ?? "intersects";
      const candidates = getCandidateZones(
        bounds,
        polygonOptions.level,
        debugBruteForceLookup ? "brute-force" : "index"
      );

      return candidates.filter((zone) => {
        if (mode === "contains-center") {
          return pointIntersectsGeometry(zone.center, geometry, boundaryMode);
        }

        return geometryIntersectsGeometry(geometry, zone.geometry, boundaryMode);
      });
    },

    zoneNeighbors(zoneId, neighborOptions = {}) {
      const distance = neighborOptions.distance ?? 1;

      if (distance < 1 || !Number.isInteger(distance)) {
        return [];
      }

      const visited = new Set<string>([zoneId]);
      let frontier = [requireZone(zoneId).id];

      for (let currentDistance = 0; currentDistance < distance; currentDistance += 1) {
        const nextFrontier = new Set<string>();

        for (const currentId of frontier) {
          for (const neighborId of getDirectNeighborIds(
            currentId,
            neighborOptions.connectionTypes,
            neighborOptions.types
          )) {
            if (!visited.has(neighborId)) {
              visited.add(neighborId);
              nextFrontier.add(neighborId);
            }
          }
        }

        frontier = [...nextFrontier].sort();
      }

      visited.delete(zoneId);
      return [...visited].sort();
    },

    zoneToBoundary(zoneId) {
      return requireZone(zoneId).geometry;
    },

    zoneToCenter(zoneId) {
      return requireZone(zoneId).center;
    },

    zoneToChildren(zoneId) {
      return [...(requireZone(zoneId).childIds ?? [])];
    },

    zoneToParent(zoneId) {
      return requireZone(zoneId).parentId ?? null;
    }
  };

  function getDirectNeighborIds(
    zoneId: string,
    connectionTypes: TerritoryAdjacencyConnectionType[] | undefined,
    adjacencyTypes: TerritoryAdjacencyType[] | undefined
  ): string[] {
    const zone = requireZone(zoneId);
    const includeGeometricNeighbors =
      !adjacencyTypes &&
      (!connectionTypes || connectionTypes.length === 0 || connectionTypes.includes("geometric"));
    const neighborIds = new Set(includeGeometricNeighbors ? zone.neighborIds : []);

    if (adjacencyIndex) {
      const queryOptions = adjacencyTypes ? { types: adjacencyTypes } : {};

      for (const neighborId of adjacencyIndex.getNeighbors(zoneId, queryOptions)) {
        neighborIds.add(neighborId);
      }
    }

    for (const connection of filterConnections(
      connectionsByZoneId.get(zoneId) ?? [],
      adjacencyTypes ? [] : connectionTypes
    )) {
      neighborIds.add(connection.toZoneId);
    }

    return [...neighborIds].sort();
  }
}

function buildSpatialIndexes(
  dataset: TerritoryDataset,
  spatialIndex: TerritoryBinarySpatialIndex | TerritoryBinarySpatialIndexBuffer | undefined
): SpatialIndexBuildResult {
  if (spatialIndex) {
    return buildBinaryIndexesByLevel(dataset, spatialIndex);
  }

  return buildFlatbushIndexesByLevel(dataset);
}

function buildFlatbushIndexesByLevel(dataset: TerritoryDataset): SpatialIndexBuildResult {
  const zonesByLevel = new Map<number, TerritoryZone[]>();

  for (const zone of dataset.zones) {
    const zones = zonesByLevel.get(zone.level) ?? [];
    zones.push(zone);
    zonesByLevel.set(zone.level, zones);
  }

  const indexesByLevel = new Map<number, LevelIndex>();
  let estimatedBytes = 0;

  for (const [level, zones] of zonesByLevel.entries()) {
    const index = new Flatbush(zones.length);
    const zoneIds: string[] = [];

    for (const zone of zones) {
      index.add(zone.bbox[0], zone.bbox[1], zone.bbox[2], zone.bbox[3]);
      zoneIds.push(zone.id);
    }

    index.finish();
    estimatedBytes += zones.length * 40;
    indexesByLevel.set(level, {
      source: "flatbush",
      estimatedBytes: zones.length * 40,
      search(west, south, east, north) {
        return index
          .search(west, south, east, north)
          .map((indexId) => zoneIds[indexId])
          .filter((zoneId): zoneId is string => Boolean(zoneId));
      }
    });
  }

  return {
    indexesByLevel,
    summary: {
      source: "flatbush",
      levels: [...indexesByLevel.keys()].sort((left, right) => left - right),
      zoneCount: dataset.zones.length,
      estimatedBytes
    }
  };
}

function buildBinaryIndexesByLevel(
  dataset: TerritoryDataset,
  spatialIndex: TerritoryBinarySpatialIndex | TerritoryBinarySpatialIndexBuffer
): SpatialIndexBuildResult {
  const index = isTerritoryBinarySpatialIndex(spatialIndex)
    ? spatialIndex
    : decodeTerritoryBinarySpatialIndex(spatialIndex, {
        datasetId: dataset.manifest.datasetId,
        datasetVersion: dataset.manifest.datasetVersion,
        geometryHash: dataset.manifest.geometryHash
      });
  const zonesById = new Set(dataset.zones.map((zone) => zone.id));
  const unknownZoneId = index.zoneOrdinals.find((zoneId) => !zonesById.has(zoneId));

  if (unknownZoneId) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      `Binary spatial index references unknown zone '${unknownZoneId}'.`,
      {
        details: { zoneId: unknownZoneId }
      }
    );
  }

  const indexesByLevel = new Map<number, LevelIndex>();

  for (const level of index.metadata.levels) {
    indexesByLevel.set(level.level, {
      source: "binary",
      estimatedBytes: level.count * 40,
      search(west, south, east, north) {
        return index.search({ west, south, east, north }, level.level);
      }
    });
  }

  return {
    indexesByLevel,
    summary: {
      source: "binary",
      levels: index.metadata.levels.map((level) => level.level),
      zoneCount: index.metadata.zoneCount,
      estimatedBytes: index.metadata.bboxRecordCount * 40,
      indexHash: index.metadata.indexHash,
      byteLength: index.metadata.byteLength
    }
  };
}

function sortZones(zones: TerritoryZone[]): TerritoryZone[] {
  return [...zones].sort(
    (left, right) => left.level - right.level || left.id.localeCompare(right.id)
  );
}

function normalizeAdjacencyConnections(
  connections: TerritoryAdjacencyConnection[]
): TerritoryAdjacencyConnection[] {
  const normalized: TerritoryAdjacencyConnection[] = [];

  for (const connection of connections) {
    if (!connection.fromZoneId || !connection.toZoneId) {
      continue;
    }

    normalized.push(connection);

    if (connection.bidirectional !== false) {
      normalized.push({
        fromZoneId: connection.toZoneId,
        toZoneId: connection.fromZoneId,
        type: connection.type,
        ...(connection.bidirectional === undefined
          ? {}
          : { bidirectional: connection.bidirectional }),
        ...(connection.properties ? { properties: connection.properties } : {})
      });
    }
  }

  return normalized;
}

function buildConnectionsByZoneId(
  connections: TerritoryAdjacencyConnection[]
): Map<string, TerritoryAdjacencyConnection[]> {
  const connectionsByZoneId = new Map<string, TerritoryAdjacencyConnection[]>();

  for (const connection of connections) {
    const zoneConnections = connectionsByZoneId.get(connection.fromZoneId) ?? [];
    zoneConnections.push(connection);
    connectionsByZoneId.set(connection.fromZoneId, zoneConnections);
  }

  return connectionsByZoneId;
}

function filterConnections(
  connections: TerritoryAdjacencyConnection[],
  connectionTypes: TerritoryAdjacencyConnectionType[] | undefined
): TerritoryAdjacencyConnection[] {
  if (!connectionTypes || connectionTypes.length === 0) {
    return [...connections].sort(compareConnections);
  }

  const allowedTypes = new Set(connectionTypes);

  return connections
    .filter((connection) => allowedTypes.has(connection.type))
    .sort(compareConnections);
}

function compareConnections(
  left: TerritoryAdjacencyConnection,
  right: TerritoryAdjacencyConnection
): number {
  return (
    left.fromZoneId.localeCompare(right.fromZoneId) ||
    left.toZoneId.localeCompare(right.toZoneId) ||
    left.type.localeCompare(right.type)
  );
}

function compareAdjacencyEdges(
  left: TerritoryAdjacencyEdge,
  right: TerritoryAdjacencyEdge
): number {
  return (
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to) ||
    left.type.localeCompare(right.type) ||
    left.source.localeCompare(right.source)
  );
}

function normalizeQueryBounds(bounds: TerritoryBounds): TerritoryBounds | undefined {
  if (
    !Number.isFinite(bounds.west) ||
    !Number.isFinite(bounds.south) ||
    !Number.isFinite(bounds.east) ||
    !Number.isFinite(bounds.north)
  ) {
    return undefined;
  }

  return {
    west: Math.min(bounds.west, bounds.east),
    south: Math.min(bounds.south, bounds.north),
    east: Math.max(bounds.west, bounds.east),
    north: Math.max(bounds.south, bounds.north)
  };
}

function isValidCoordinate(coordinate: LatLng): boolean {
  return (
    Number.isFinite(coordinate.lat) &&
    Number.isFinite(coordinate.lng) &&
    coordinate.lat >= -90 &&
    coordinate.lat <= 90 &&
    coordinate.lng >= -180 &&
    coordinate.lng <= 180
  );
}

function isValidLevel(level: number): boolean {
  return Number.isInteger(level) && level >= 0;
}

function normalizeBoundsForCache(bounds: TerritoryBounds): TerritoryBounds {
  return {
    west: roundCacheCoordinate(bounds.west),
    south: roundCacheCoordinate(bounds.south),
    east: roundCacheCoordinate(bounds.east),
    north: roundCacheCoordinate(bounds.north)
  };
}

function roundCacheCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function bboxToBounds(
  bbox: [west: number, south: number, east: number, north: number]
): TerritoryBounds {
  return {
    west: bbox[0],
    south: bbox[1],
    east: bbox[2],
    north: bbox[3]
  };
}
