import {
  computeGeometryBBox,
  computeGeometryCenter,
  computeTerritoryAreaM2,
  computeTerritoryRepresentativePoint,
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
import { normalizeTerritoryBinarySpatialIndex } from "./binary-index.js";
import type {
  TerritoryBinarySpatialIndex,
  TerritoryBinarySpatialIndexBuffer
} from "./binary-index.js";
import { TerritoryZoneNotFoundError } from "./errors.js";
import { Flatbush } from "./flatbush.js";
import {
  bboxIntersectsBounds,
  geometryIntersectsGeometry,
  normalizeLongitude,
  pointIntersectsGeometry
} from "./geometry.js";
import { createTerritoryDatasetVersionInfo, createTerritoryIdentity } from "./identity.js";
import { defaultZoomLevelStrategy } from "./zoom.js";
import type {
  BoundsQuery,
  LatLng,
  LocateOptions,
  PolygonToZonesOptions,
  TerritoryBoundsLookupOptions,
  TerritoryAdjacencyConnection,
  TerritoryAdjacencyConnectionType,
  TerritoryBounds,
  TerritoryEngine,
  TerritoryEngineOptions,
  TerritoryGeometryMetrics,
  TerritoryHierarchy,
  TerritoryLevelSelector,
  TerritoryLookupResult,
  TerritoryPointLookupOptions,
  TerritoryEngineSpatialIndexSummary,
  ViewportCacheKeyQuery,
  VisibleZonesQuery
} from "./types.js";

interface LevelIndex {
  source: "flatbush" | "binary-flatbush";
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
  const identitiesByZoneId = new Map<string, ReturnType<typeof createTerritoryIdentity>>();
  const metricsByZoneId = new Map<string, TerritoryGeometryMetrics>();
  const hierarchyByZoneId = new Map<string, TerritoryHierarchy>();
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

  function getCandidateZonesForLevels(
    bounds: TerritoryBounds,
    levels: Set<number> | undefined,
    lookupMode: "index" | "brute-force" = "index"
  ): TerritoryZone[] {
    if (!levels) {
      return getCandidateZones(bounds, undefined, lookupMode);
    }

    const zonesByIdResult = new Map<string, TerritoryZone>();

    for (const level of levels) {
      for (const zone of getCandidateZones(bounds, level, lookupMode)) {
        zonesByIdResult.set(zone.id, zone);
      }
    }

    return sortZones([...zonesByIdResult.values()]);
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
    const match = findMatchingZonesAtPoint(coordinate, options)[0];

    return match?.id ?? null;
  }

  function findMatchingZonesAtPoint(
    coordinate: LatLng,
    options: TerritoryPointLookupOptions = {}
  ): TerritoryZone[] {
    const normalizedCoordinate = normalizeCoordinate(coordinate);
    const levels = resolveLevelSelectors(options);

    if (!normalizedCoordinate || levels === "invalid") {
      return [];
    }

    const lngLat: LngLat = [normalizedCoordinate.lng, normalizedCoordinate.lat];
    const boundaryMode = options.boundaryMode ?? "covers";
    const candidates = getCandidateZonesForLevels(
      {
        west: normalizedCoordinate.lng,
        south: normalizedCoordinate.lat,
        east: normalizedCoordinate.lng,
        north: normalizedCoordinate.lat
      },
      levels,
      debugBruteForceLookup ? "brute-force" : "index"
    ).sort((left, right) => right.level - left.level || left.id.localeCompare(right.id));

    return candidates.filter((zone) =>
      pointIntersectsGeometry(lngLat, zone.geometry, boundaryMode)
    );
  }

  function findZonesInBounds(
    bounds: TerritoryBounds,
    options: TerritoryBoundsLookupOptions = {}
  ): TerritoryZone[] {
    const levels = resolveLevelSelectors(options);
    const limit = normalizeLimit(options.limit);

    if (levels === "invalid" || limit === "invalid") {
      return [];
    }

    const zones = getCandidateZonesForLevels(bounds, levels);

    return limit === undefined ? zones : zones.slice(0, limit);
  }

  function createLookupResult(zone: TerritoryZone): TerritoryLookupResult {
    const identity = getCachedIdentity(zone);
    const metrics = createGeometryMetrics(zone);
    const hierarchy = createHierarchy(zone);

    return {
      territoryId: identity.territoryId,
      zone,
      identity,
      geometry: zone.geometry,
      hierarchy,
      metrics
    };
  }

  function getCachedIdentity(zone: TerritoryZone): ReturnType<typeof createTerritoryIdentity> {
    const cached = identitiesByZoneId.get(zone.id);

    if (cached) {
      return cached;
    }

    const identity = createTerritoryIdentity(dataset, zone);
    identitiesByZoneId.set(zone.id, identity);
    return identity;
  }

  function createGeometryMetrics(zone: TerritoryZone): TerritoryGeometryMetrics {
    const cached = metricsByZoneId.get(zone.id);

    if (cached) {
      return cached;
    }

    const areaM2 = computeTerritoryAreaM2(zone.geometry);

    const metrics: TerritoryGeometryMetrics = {
      areaM2,
      areaKm2: areaM2 / 1_000_000,
      centroid: computeGeometryCenter(zone.geometry),
      representativePoint: computeTerritoryRepresentativePoint(zone.geometry),
      bbox: [...zone.bbox]
    };

    metricsByZoneId.set(zone.id, metrics);
    return metrics;
  }

  function createHierarchy(zone: TerritoryZone): TerritoryHierarchy {
    const cached = hierarchyByZoneId.get(zone.id);

    if (cached) {
      return cached;
    }

    const ancestorIds: string[] = [];
    let current = zone;
    let missingParentId: string | undefined;

    while (current.parentId) {
      const parent = zonesById.get(current.parentId);

      if (!parent) {
        missingParentId = current.parentId;
        break;
      }

      ancestorIds.push(parent.id);
      current = parent;
    }

    const rootId = ancestorIds.at(-1) ?? zone.id;

    const hierarchy: TerritoryHierarchy = {
      territoryId: zone.id,
      parentId: zone.parentId ?? null,
      ancestorIds,
      childIds: [...(zone.childIds ?? [])],
      pathIds: [...ancestorIds].reverse().concat(zone.id),
      rootId,
      isRoot: !zone.parentId,
      isOrphan: Boolean(missingParentId),
      ...(missingParentId ? { missingParentId } : {})
    };

    hierarchyByZoneId.set(zone.id, hierarchy);
    return hierarchy;
  }

  function getSafeZone(zoneId: string): TerritoryZone | null {
    return zonesById.get(zoneId) ?? null;
  }

  function getLevelSelectorOption(query: {
    level?: TerritoryLevelSelector;
  }): TerritoryBoundsLookupOptions {
    return query.level === undefined ? {} : { level: query.level };
  }

  function getPolygonLevelOption(options: PolygonToZonesOptions): {
    level?: number;
    invalid: boolean;
  } {
    const level = resolveLevelSelector(options.level);

    if (level === "invalid") {
      return { invalid: true };
    }

    return level === undefined ? { invalid: false } : { level, invalid: false };
  }

  function resolveLevelSelectors(options: {
    level?: TerritoryLevelSelector;
    levels?: TerritoryLevelSelector[];
  }): Set<number> | undefined | "invalid" {
    const levels = new Set<number>();
    const level = resolveLevelSelector(options.level);

    if (level === "invalid") {
      return "invalid";
    }

    if (level !== undefined) {
      levels.add(level);
    }

    for (const selector of options.levels ?? []) {
      const resolved = resolveLevelSelector(selector);

      if (resolved === "invalid") {
        return "invalid";
      }

      if (resolved !== undefined) {
        levels.add(resolved);
      }
    }

    return levels.size > 0 ? levels : undefined;
  }

  function resolveLevelSelector(
    selector: TerritoryLevelSelector | undefined
  ): number | undefined | "invalid" {
    if (selector === undefined) {
      return undefined;
    }

    if (typeof selector === "number") {
      return isValidLevel(selector) ? selector : "invalid";
    }

    const match = /^ADM([0-5])$/.exec(selector);

    return match?.[1] ? Number(match[1]) : "invalid";
  }

  function normalizeLimit(limit: number | undefined): number | undefined | "invalid" {
    if (limit === undefined) {
      return undefined;
    }

    return Number.isInteger(limit) && limit >= 0 ? limit : "invalid";
  }

  function normalizeCoordinate(coordinate: LatLng): LatLng | null {
    if (!isValidCoordinate(coordinate)) {
      return null;
    }

    return {
      lat: coordinate.lat,
      lng: normalizeLongitude(coordinate.lng)
    };
  }

  return {
    dataset,
    availableLevels,

    findTerritoryAtPoint(coordinate, options = {}) {
      return this.findTerritoriesAtPoint(coordinate, options)[0] ?? null;
    },

    findTerritoriesAtPoint(coordinate, options = {}) {
      return findMatchingZonesAtPoint(coordinate, options).map(createLookupResult);
    },

    findTerritoriesInBounds(bounds, options = {}) {
      return findZonesInBounds(bounds, options).map(createLookupResult);
    },

    getAdjacentTerritories(zoneId, options = {}) {
      return this.zoneNeighbors(zoneId, options).map((neighborId) => requireZone(neighborId));
    },

    getById: getSafeZone,

    getChildren(zoneId) {
      return (getSafeZone(zoneId)?.childIds ?? [])
        .map((childId) => zonesById.get(childId))
        .filter((zone): zone is TerritoryZone => Boolean(zone));
    },

    getDatasetVersionInfo() {
      return createTerritoryDatasetVersionInfo(dataset);
    },

    getGeometry(zoneId) {
      return getSafeZone(zoneId)?.geometry ?? null;
    },

    getHierarchy(zoneId) {
      const zone = getSafeZone(zoneId);

      return zone ? createHierarchy(zone) : null;
    },

    getIdentity(zoneId) {
      const zone = getSafeZone(zoneId);

      return zone ? getCachedIdentity(zone) : null;
    },

    getMetrics(zoneId) {
      const zone = getSafeZone(zoneId);

      return zone ? createGeometryMetrics(zone) : null;
    },

    getParent(zoneId) {
      const parentId = getSafeZone(zoneId)?.parentId;

      return parentId ? (zonesById.get(parentId) ?? null) : null;
    },

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
      return findZonesInBounds(query, {
        ...getLevelSelectorOption(query),
        ...(query.limit === undefined ? {} : { limit: query.limit })
      });
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
      const level = getPolygonLevelOption(polygonOptions);

      if (level.invalid) {
        return [];
      }

      const candidates = getCandidateZones(
        bounds,
        level.level,
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
  const index = normalizeTerritoryBinarySpatialIndex(spatialIndex, dataset);

  const indexesByLevel = new Map<number, LevelIndex>();

  for (const level of index.metadata.levels) {
    indexesByLevel.set(level.level, {
      source: "binary-flatbush",
      estimatedBytes: level.treeByteLength + level.count * 40,
      search(west, south, east, north) {
        return index.search({ west, south, east, north }, level.level);
      }
    });
  }

  return {
    indexesByLevel,
    summary: {
      source: "binary-flatbush",
      levels: index.metadata.levels.map((level) => level.level),
      zoneCount: index.metadata.zoneCount,
      estimatedBytes: index.metadata.treeByteLength + index.metadata.bboxRecordCount * 40,
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
    coordinate.lat <= 90
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
