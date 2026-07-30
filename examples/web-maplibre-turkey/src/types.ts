import type {
  TerritoryAdminLevel,
  TerritoryCoverageStatus,
  TerritoryDataset,
  TerritoryZone
} from "@territory-kit/dataset";
import type { TerritoryRegistryArtifact, TerritoryRegistryDataset } from "@territory-kit/registry";

export const DEMO_ADMIN_LEVELS = ["ADM1", "ADM2", "ADM3"] as const;

export type DemoAdminLevel = (typeof DEMO_ADMIN_LEVELS)[number];
export type DemoMode = "fixture" | "registry";
export type RequestedDemoMode = "auto" | DemoMode;
export type RegistryConnectionStatus =
  "not-configured" | "configured" | "connecting" | "connected" | "error";

export interface DemoConfig {
  mode: DemoMode;
  requestedMode: RequestedDemoMode;
  datasetId: string;
  datasetVersion: string;
  datasetVersionPinned: boolean;
  allowPrerelease: boolean;
  basePath: string;
  telemetryEnabled: boolean;
  registryUrl?: string;
  styleUrl?: string;
  configError?: string;
}

export interface DemoMetadata {
  datasetId: string;
  datasetVersion: string;
  datasetVersionPinned: boolean;
  sourceProvider: string;
  sourceUrl?: string;
  sourceAttribution: string;
  license: {
    id: string;
    name?: string;
    url?: string;
    attribution: string;
  };
  coverage: Record<DemoAdminLevel, TerritoryCoverageStatus | "verified" | "partial" | "unknown">;
  registryHash?: string;
}

export interface RenderTelemetry {
  cacheHit: boolean;
  displayedFeatureCount: number;
  loadMs: number;
  renderArtifactFormat: "fixture-geojson" | "geojson" | "mvt";
  requestedLevel: DemoAdminLevel;
  renderedLevel: TerritoryAdminLevel;
  exactMatch: boolean;
  coverageStatus: TerritoryCoverageStatus | "fixture" | "unknown";
  fallbackReason?: string;
  tileCacheHint?: string;
  renderManifestUrl?: string;
  renderTileTemplate?: string;
}

export interface RenderRequest {
  level: DemoAdminLevel;
  adm3ParentId?: string;
  signal?: AbortSignal;
}

export interface TerritorySearchResult {
  id: string;
  name: string;
  level: DemoAdminLevel;
  parentId?: string;
}

export interface TerritoryDetails {
  zone: TerritoryZone;
  parent?: TerritoryZone;
  children: readonly TerritoryZone[];
  neighbors: readonly TerritoryZone[];
  childrenLimited: boolean;
  neighborsLimited: boolean;
}

export interface QueryCacheTelemetry {
  loadedLevels: readonly TerritoryAdminLevel[];
  zoneCount: number;
  artifactCount: number;
  cacheLabel: string;
}

export interface TerritoryQueryService {
  readonly metadata: DemoMetadata;
  search(
    query: string,
    options: {
      levels: readonly DemoAdminLevel[];
      limit: number;
      signal?: AbortSignal;
    }
  ): Promise<TerritorySearchResult[]>;
  locate(
    coordinate: { lng: number; lat: number },
    options: { level: DemoAdminLevel; signal?: AbortSignal }
  ): Promise<TerritoryDetails | undefined>;
  getTerritoryDetails(
    territoryId: string,
    options?: { level?: DemoAdminLevel; signal?: AbortSignal }
  ): Promise<TerritoryDetails | undefined>;
  getRenderDataset(level: DemoAdminLevel, adm3ParentId?: string): TerritoryDataset;
  getCacheTelemetry(): Promise<QueryCacheTelemetry>;
}

export interface RegistryRenderResolution {
  dataset: TerritoryRegistryDataset;
  artifact: TerritoryRegistryArtifact;
  registryHash: string;
  requestedLevel: DemoAdminLevel;
  renderedLevel: TerritoryAdminLevel;
  exactMatch: boolean;
  coverageStatus: TerritoryCoverageStatus;
  fallbackReason?: string;
  url: string;
}
