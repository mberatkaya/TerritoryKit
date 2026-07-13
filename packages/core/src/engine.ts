import { computeGeometryBBox, loadTerritoryDataset } from "@territory-kit/dataset";
import type { LngLat, TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import Flatbush from "flatbush";
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
  ViewportCacheKeyQuery,
  VisibleZonesQuery
} from "./types.js";

interface LevelIndex {
  index: Flatbush;
  zoneIds: string[];
}

export function createTerritoryEngine(options: TerritoryEngineOptions): TerritoryEngine {
  const dataset = loadTerritoryDataset(options.dataset);
  const zonesById = new Map(dataset.zones.map((zone) => [zone.id, zone]));
  const availableLevels = [...new Set(dataset.zones.map((zone) => zone.level))].sort(
    (left, right) => left - right
  );
  const levelStrategy = options.levelStrategy ?? defaultZoomLevelStrategy;
  const indexesByLevel = buildIndexesByLevel(dataset);
  const adjacencyConnections = normalizeAdjacencyConnections(options.adjacencyConnections ?? []);
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
    if (lookupMode === "brute-force") {
      return sortZones(
        dataset.zones.filter(
          (zone) =>
            (level === undefined || zone.level === level) && bboxIntersectsBounds(zone.bbox, bounds)
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

      for (const indexId of entry.index.search(
        bounds.west,
        bounds.south,
        bounds.east,
        bounds.north
      )) {
        const zoneId = entry.zoneIds[indexId];
        const zone = zoneId ? zonesById.get(zoneId) : undefined;

        if (zone && bboxIntersectsBounds(zone.bbox, bounds)) {
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
            neighborOptions.connectionTypes
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
    connectionTypes: TerritoryAdjacencyConnectionType[] | undefined
  ): string[] {
    const zone = requireZone(zoneId);
    const includeGeometricNeighbors =
      !connectionTypes || connectionTypes.length === 0 || connectionTypes.includes("geometric");
    const neighborIds = new Set(includeGeometricNeighbors ? zone.neighborIds : []);

    for (const connection of filterConnections(
      connectionsByZoneId.get(zoneId) ?? [],
      connectionTypes
    )) {
      neighborIds.add(connection.toZoneId);
    }

    return [...neighborIds].sort();
  }
}

function buildIndexesByLevel(dataset: TerritoryDataset): Map<number, LevelIndex> {
  const zonesByLevel = new Map<number, TerritoryZone[]>();

  for (const zone of dataset.zones) {
    const zones = zonesByLevel.get(zone.level) ?? [];
    zones.push(zone);
    zonesByLevel.set(zone.level, zones);
  }

  const indexesByLevel = new Map<number, LevelIndex>();

  for (const [level, zones] of zonesByLevel.entries()) {
    const index = new Flatbush(zones.length);
    const zoneIds: string[] = [];

    for (const zone of zones) {
      index.add(zone.bbox[0], zone.bbox[1], zone.bbox[2], zone.bbox[3]);
      zoneIds.push(zone.id);
    }

    index.finish();
    indexesByLevel.set(level, { index, zoneIds });
  }

  return indexesByLevel;
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
