import type {
  TerritoryAdminLevel,
  TerritoryAdjacencyArtifact,
  TerritoryAdjacencyEdge,
  TerritoryAdjacencyType,
  TerritoryBBox,
  TerritoryDataset,
  TerritoryGeometry,
  TerritorySourceClass,
  TerritoryZone
} from "@territory-kit/dataset";
import type {
  TerritoryBinarySpatialIndex,
  TerritoryBinarySpatialIndexBuffer
} from "./binary-index.js";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TerritoryBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type BoundaryMode = "covers" | "contains";
export type TerritoryLevelSelector = number | TerritoryAdminLevel;

export interface LocateOptions {
  level?: TerritoryLevelSelector;
  boundaryMode?: BoundaryMode;
}

export type PolygonToZonesMode = "intersects" | "contains-center";

export interface PolygonToZonesOptions {
  level?: TerritoryLevelSelector;
  boundaryMode?: BoundaryMode;
  mode?: PolygonToZonesMode;
}

export interface BoundsQuery extends TerritoryBounds {
  level?: TerritoryLevelSelector;
  limit?: number;
}

export interface TerritoryPointLookupOptions extends LocateOptions {
  levels?: TerritoryLevelSelector[];
}

export interface TerritoryBoundsLookupOptions {
  level?: TerritoryLevelSelector;
  levels?: TerritoryLevelSelector[];
  limit?: number;
}

export interface TerritoryDatasetVersionInfo {
  datasetId: string;
  datasetVersion: string;
  geometryHash: string;
  sourceDate: string;
  buildDate?: string;
  sourceProvider?: string;
  artifactChecksum?: string;
}

export interface TerritoryIdentity {
  territoryId: string;
  datasetId: string;
  datasetVersion: string;
  geometryVersion: string;
  geometryHash: string;
  stableId?: string;
  sourceClass?: TerritorySourceClass;
  sourceProvider?: string;
  sourceNativeId?: string;
}

export interface TerritoryGeometryMetrics {
  areaM2: number;
  areaKm2: number;
  centroid: [longitude: number, latitude: number];
  representativePoint: [longitude: number, latitude: number];
  bbox: TerritoryBBox;
}

export interface TerritoryHierarchy {
  territoryId: string;
  parentId: string | null;
  ancestorIds: string[];
  childIds: string[];
  pathIds: string[];
  rootId: string;
  isRoot: boolean;
  isOrphan: boolean;
  missingParentId?: string;
}

export interface TerritoryLookupResult {
  territoryId: string;
  zone: TerritoryZone;
  identity: TerritoryIdentity;
  geometry: TerritoryGeometry;
  hierarchy: TerritoryHierarchy;
  metrics: TerritoryGeometryMetrics;
}

export interface VisibleZonesQuery {
  bounds: TerritoryBounds;
  zoom: number;
  strategy?: ZoomLevelStrategy;
}

export interface NeighborOptions {
  distance?: number;
  types?: TerritoryAdjacencyType[];
  connectionTypes?: TerritoryAdjacencyConnectionType[];
}

export type TerritoryAdjacencyConnectionType =
  "geometric" | "bridge" | "tunnel" | "sea" | "portal" | "manual";

export interface TerritoryAdjacencyConnection {
  fromZoneId: string;
  toZoneId: string;
  type: TerritoryAdjacencyConnectionType;
  bidirectional?: boolean;
  properties?: Record<string, unknown>;
}

export interface TerritoryEngineDebugOptions {
  bruteForceLookup?: boolean;
}

export interface TerritoryEngineSpatialIndexSummary {
  source: "flatbush" | "binary-flatbush";
  levels: number[];
  zoneCount: number;
  estimatedBytes: number;
  indexHash?: string;
  byteLength?: number;
}

export interface ViewportCacheKeyQuery {
  bounds: TerritoryBounds;
  zoom?: number;
  level?: number;
  strategy?: ZoomLevelStrategy;
}

export interface LevelTransitionQuery {
  bounds: TerritoryBounds;
  fromZoom: number;
  toZoom: number;
  strategy?: ZoomLevelStrategy;
}

export interface LevelTransitionPayload {
  fromLevel: number;
  toLevel: number;
  fromZoneIds: string[];
  toZoneIds: string[];
  enteringZoneIds: string[];
  exitingZoneIds: string[];
  stableZoneIds: string[];
}

export interface ZoomLevelStrategy {
  resolveLevel(input: {
    zoom: number;
    dataset: TerritoryDataset;
    availableLevels: number[];
  }): number;
}

export interface TerritoryEngineOptions {
  dataset: TerritoryDataset;
  adjacency?: TerritoryAdjacencyArtifact;
  levelStrategy?: ZoomLevelStrategy;
  adjacencyConnections?: TerritoryAdjacencyConnection[];
  debug?: TerritoryEngineDebugOptions;
  spatialIndex?: TerritoryBinarySpatialIndex | TerritoryBinarySpatialIndexBuffer;
  viewportCacheRevision?: string;
}

export interface TerritoryEngine {
  readonly dataset: TerritoryDataset;
  readonly availableLevels: number[];
  findTerritoryAtPoint(
    coordinate: LatLng,
    options?: TerritoryPointLookupOptions
  ): TerritoryLookupResult | null;
  findTerritoriesAtPoint(
    coordinate: LatLng,
    options?: TerritoryPointLookupOptions
  ): TerritoryLookupResult[];
  findTerritoriesInBounds(
    bounds: TerritoryBounds,
    options?: TerritoryBoundsLookupOptions
  ): TerritoryLookupResult[];
  getAdjacentTerritories(zoneId: string, options?: NeighborOptions): TerritoryZone[];
  getById(zoneId: string): TerritoryZone | null;
  getChildren(zoneId: string): TerritoryZone[];
  getDatasetVersionInfo(): TerritoryDatasetVersionInfo;
  getGeometry(zoneId: string): TerritoryGeometry | null;
  getHierarchy(zoneId: string): TerritoryHierarchy | null;
  getIdentity(zoneId: string): TerritoryIdentity | null;
  getMetrics(zoneId: string): TerritoryGeometryMetrics | null;
  getParent(zoneId: string): TerritoryZone | null;
  getZoneById(zoneId: string): TerritoryZone | null;
  getZoneLevel(zoneId: string): number;
  getAdjacencyConnections(
    zoneId: string,
    options?: Pick<NeighborOptions, "connectionTypes">
  ): TerritoryAdjacencyConnection[];
  getAdjacencyRelations(
    zoneId: string,
    options?: Pick<NeighborOptions, "types">
  ): TerritoryAdjacencyEdge[];
  getSpatialIndexSummary(): TerritoryEngineSpatialIndexSummary;
  getLevelTransition(query: LevelTransitionQuery): LevelTransitionPayload;
  getZonesInBounds(query: BoundsQuery): TerritoryZone[];
  getViewportCacheKey(query: ViewportCacheKeyQuery): string;
  getVisibleZones(query: VisibleZonesQuery): TerritoryZone[];
  getAncestors(zoneId: string): string[];
  getDescendants(zoneId: string): string[];
  isValidZone(zoneId: string): boolean;
  latLngToZone(coordinate: LatLng, options?: LocateOptions): string | null;
  latLngToZones(coordinates: LatLng[], options?: LocateOptions): Array<string | null>;
  polygonToZones(geometry: TerritoryGeometry, options?: PolygonToZonesOptions): TerritoryZone[];
  zoneNeighbors(zoneId: string, options?: NeighborOptions): string[];
  zoneToBoundary(zoneId: string): TerritoryGeometry;
  zoneToCenter(zoneId: string): [longitude: number, latitude: number];
  zoneToChildren(zoneId: string): string[];
  zoneToParent(zoneId: string): string | null;
}

export type IndexedZone = Pick<TerritoryZone, "id" | "bbox" | "level" | "geometry">;

export function bboxToBounds(bbox: TerritoryBBox): TerritoryBounds {
  return {
    west: bbox[0],
    south: bbox[1],
    east: bbox[2],
    north: bbox[3]
  };
}
