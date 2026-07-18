import type {
  TerritoryAdjacencyArtifact,
  TerritoryAdjacencyEdge,
  TerritoryAdjacencyType,
  TerritoryBBox,
  TerritoryDataset,
  TerritoryGeometry,
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

export interface LocateOptions {
  level?: number;
  boundaryMode?: BoundaryMode;
}

export type PolygonToZonesMode = "intersects" | "contains-center";

export interface PolygonToZonesOptions {
  level?: number;
  boundaryMode?: BoundaryMode;
  mode?: PolygonToZonesMode;
}

export interface BoundsQuery extends TerritoryBounds {
  level?: number;
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
