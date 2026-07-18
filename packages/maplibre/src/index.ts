import type { Feature, FeatureCollection } from "geojson";
import {
  assertTerritoryAdapterAttached,
  assertTerritoryAdapterCapability,
  defineTerritoryAdapterCapabilities
} from "@territory-kit/adapter-core";
import type {
  TerritoryAdapterCapabilities,
  TerritoryAdapterLifecycleState,
  TerritoryRendererAdapter,
  TerritoryRenderSource,
  TerritoryRenderState,
  TerritoryRenderTheme
} from "@territory-kit/adapter-core";
import { TerritoryError, getAdminLevelDepth, loadTerritoryDataset } from "@territory-kit/dataset";
import type {
  TerritoryAdminLevel,
  TerritoryCoverageStatus,
  TerritoryZone
} from "@territory-kit/dataset";
import type { TerritoryRegistryClient } from "@territory-kit/registry";

export interface TerritoryMapLibreState {
  faction?: string;
  selected?: boolean;
  score?: number;
}

export interface TerritoryMapLibreFeatureProperties extends Record<string, unknown> {
  id: string;
  datasetId: string;
  level: number;
  parentId?: string;
  faction?: string;
  selected?: boolean;
  score?: number;
}

export interface TerritoryMapLibreLayerOptions {
  sourceId?: string;
  fillLayerId?: string;
  lineLayerId?: string;
  fillColor?: string;
  fillOpacity?: number;
  lineColor?: string;
  lineWidth?: number;
  stateByZoneId?: ReadonlyMap<string, TerritoryMapLibreState>;
}

export interface TerritoryMapLibreTheme extends TerritoryRenderTheme {
  fillColor?: string;
  fillOpacity?: number;
  lineColor?: string;
  lineWidth?: number;
}

export interface TerritoryMapLibreZoneEvent {
  zoneId: string;
  feature?: Feature;
  originalEvent: unknown;
}

export interface TerritoryMapLibreAdapterOptions extends TerritoryMapLibreLayerOptions {
  zones: TerritoryZone[];
  stateByZoneId?: ReadonlyMap<string, TerritoryMapLibreState>;
  onZoneClick?: (event: TerritoryMapLibreZoneEvent) => void;
  onZoneHover?: (event: TerritoryMapLibreZoneEvent) => void;
  onZoneLeave?: (event: TerritoryMapLibreZoneEvent) => void;
}

export interface TerritoryMapLibreGeoJsonSource {
  setData(data: FeatureCollection): void;
}

export interface TerritoryMapLibreMap {
  addLayer(layer: Record<string, unknown>): void;
  addSource(id: string, source: Record<string, unknown>): void;
  getLayer(id: string): unknown;
  getSource(id: string): TerritoryMapLibreGeoJsonSource | undefined;
  removeLayer(id: string): void;
  removeSource(id: string): void;
  setPaintProperty?(layerId: string, property: string, value: unknown): void;
  setFeatureState?(
    target: { source: string; sourceLayer?: string; id: string | number },
    state: Record<string, unknown>
  ): void;
  removeFeatureState?(
    target: { source: string; sourceLayer?: string; id: string | number },
    key?: string
  ): void;
  on?(type: string, layerId: string, listener: (event: unknown) => void): void;
  off?(type: string, layerId: string, listener: (event: unknown) => void): void;
}

export interface TerritoryMapLibreAdapter extends TerritoryRendererAdapter<TerritoryMapLibreMap> {
  readonly capabilities: TerritoryAdapterCapabilities;
  readonly lifecycleState: TerritoryAdapterLifecycleState;
  attach(map: TerritoryMapLibreMap): void;
  detach(): void;
  setSource(source: TerritoryRenderSource): void;
  updateState(state: TerritoryRenderState): void;
  updateData(
    zones: TerritoryZone[],
    stateByZoneId?: ReadonlyMap<string, TerritoryMapLibreState>
  ): void;
  updateTheme(theme: TerritoryMapLibreTheme): void;
}

export interface TerritoryMapLibreLayerBundle {
  source: {
    id: string;
    spec: {
      type: "geojson";
      data: FeatureCollection;
      promoteId: "id";
    };
  };
  layers: Array<Record<string, unknown>>;
}

export interface TerritoryMapLibreLevelPolicy {
  level: TerritoryAdminLevel;
  minZoom: number;
  maxZoom?: number;
}

export const DEFAULT_TERRITORY_MAPLIBRE_LEVEL_POLICY: readonly TerritoryMapLibreLevelPolicy[] = [
  { level: "ADM0", minZoom: 0, maxZoom: 4 },
  { level: "ADM1", minZoom: 5, maxZoom: 7 },
  { level: "ADM2", minZoom: 8, maxZoom: 11 },
  { level: "ADM3", minZoom: 12, maxZoom: 14 },
  { level: "ADM4", minZoom: 15, maxZoom: 17 },
  { level: "ADM5", minZoom: 18 }
];

export const TERRITORY_MAPLIBRE_ADAPTER_CAPABILITIES = defineTerritoryAdapterCapabilities({
  geoJson: true,
  vectorTiles: false,
  featureState: true,
  hover: true,
  click: true,
  selection: true,
  symbols: false,
  transitions: false,
  runtimeThemeUpdates: true,
  sourceReplacement: true,
  viewportEvents: false
});

export interface TerritoryMapLibreRegistrySourceOptions {
  registry: Pick<TerritoryRegistryClient, "resolveArtifact"> &
    Partial<
      Pick<
        TerritoryRegistryClient,
        "resolveTerritoryArtifact" | "resolveDeepestAvailableTerritoryArtifact"
      >
    >;
  datasetId?: string;
  country?: string;
  level?: TerritoryAdminLevel;
  parentId?: string;
  fallback?: "none" | "deepest-available";
  levels?: readonly TerritoryAdminLevel[];
  sourceId?: string;
  sourceLayer?: string;
  formatPreference?: readonly ["mvt" | "geojson", ...Array<"mvt" | "geojson">];
}

export interface TerritoryMapLibreRegistrySourceBundle {
  source: {
    id: string;
    spec: Record<string, unknown>;
  };
  sourceLayer: string;
  artifact: unknown;
  requestedLevel?: TerritoryAdminLevel;
  renderedLevel?: TerritoryAdminLevel;
  exactMatch?: boolean;
  fallbackReason?: string;
  coverageStatus?: TerritoryCoverageStatus;
  format?: "mvt" | "geojson" | string;
}

export interface TerritoryMapLibreRegistryLayerOptions {
  sourceId?: string;
  sourceLayer?: string;
  fillLayerId?: string;
  lineLayerId?: string;
  fillColor?: string;
  fillOpacity?: number;
  lineColor?: string;
  lineWidth?: number;
  minZoom?: number;
  maxZoom?: number;
}

export interface TerritoryMapLibreControllerOptions {
  registry: Pick<TerritoryRegistryClient, "installDataset">;
  datasetId: string;
  levels?: readonly TerritoryAdminLevel[];
}

export interface TerritoryMapLibreTerritoryEvent {
  territoryId: string;
  feature?: Feature;
  originalEvent: unknown;
}

export interface TerritoryMapLibreController {
  resolveTerritory(territoryId: string): Promise<TerritoryZone | undefined>;
  onTerritoryClick(
    callback: (event: TerritoryMapLibreTerritoryEvent) => void
  ): (event: unknown) => void;
}

export function zonesToFeatureCollection(
  zones: TerritoryZone[],
  stateByZoneId: ReadonlyMap<string, TerritoryMapLibreState> = new Map()
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones.map((zone): Feature => {
      const state = stateByZoneId.get(zone.id);
      const properties: TerritoryMapLibreFeatureProperties = {
        ...zone.properties,
        id: zone.id,
        datasetId: zone.datasetId,
        level: zone.level,
        ...(zone.parentId ? { parentId: zone.parentId } : {}),
        ...(state?.faction ? { faction: state.faction } : {}),
        ...(state?.selected !== undefined ? { selected: state.selected } : {}),
        ...(state?.score !== undefined ? { score: state.score } : {})
      };

      return {
        type: "Feature",
        id: zone.id,
        geometry: zone.geometry,
        properties
      };
    })
  };
}

export function createTerritoryMapLibreLayers(
  zones: TerritoryZone[],
  options: TerritoryMapLibreLayerOptions = {}
): TerritoryMapLibreLayerBundle {
  const sourceId = options.sourceId ?? "territory-kit-zones";
  const fillLayerId = options.fillLayerId ?? "territory-kit-zones-fill";
  const lineLayerId = options.lineLayerId ?? "territory-kit-zones-line";

  return {
    source: {
      id: sourceId,
      spec: {
        type: "geojson",
        data: zonesToFeatureCollection(zones, options.stateByZoneId),
        promoteId: "id"
      }
    },
    layers: [
      {
        id: fillLayerId,
        type: "fill",
        source: sourceId,
        paint: {
          "fill-color": [
            "case",
            ["boolean", ["get", "selected"], false],
            "#f97316",
            ["==", ["get", "faction"], "blue"],
            "#2563eb",
            ["==", ["get", "faction"], "red"],
            "#dc2626",
            options.fillColor ?? "#1f8a70"
          ],
          "fill-opacity": options.fillOpacity ?? 0.35
        }
      },
      {
        id: lineLayerId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": options.lineColor ?? "#0f172a",
          "line-width": options.lineWidth ?? 1.25
        }
      }
    ]
  };
}

export async function createTerritoryMapLibreSource(
  options: TerritoryMapLibreRegistrySourceOptions
): Promise<TerritoryMapLibreRegistrySourceBundle> {
  const sourceId = options.sourceId ?? "territory-kit-render";
  const formatPreference =
    options.formatPreference ?? defaultFormatPreferenceForLevel(options.level);
  const resolved =
    options.country && options.level && options.registry.resolveTerritoryArtifact
      ? await resolveRegistryTerritorySource(options, formatPreference)
      : await resolveRegistryDatasetSource(options, formatPreference);
  const artifact = resolved.artifact as {
    format?: string;
    layer?: unknown;
    tileUrlTemplate?: unknown;
  };
  const sourceLayer =
    options.sourceLayer ?? (typeof artifact.layer === "string" ? artifact.layer : "territory");
  const metadata = {
    ...(resolved.requestedLevel ? { requestedLevel: resolved.requestedLevel } : {}),
    ...(resolved.resolvedLevel ? { renderedLevel: resolved.resolvedLevel } : {}),
    ...(resolved.exactMatch !== undefined ? { exactMatch: resolved.exactMatch } : {}),
    ...(resolved.reason && resolved.reason !== "exact-match"
      ? { fallbackReason: resolved.reason }
      : {}),
    ...(resolved.coverageStatus ? { coverageStatus: resolved.coverageStatus } : {}),
    ...(artifact.format ? { format: artifact.format } : {})
  };

  if (artifact.format === "geojson") {
    return {
      source: {
        id: sourceId,
        spec: {
          type: "geojson",
          data: resolved.url,
          promoteId: "territoryId"
        }
      },
      sourceLayer,
      artifact: resolved.artifact,
      ...metadata
    };
  }

  const tileTemplate =
    typeof artifact.tileUrlTemplate === "string"
      ? resolveTileTemplateUrl(artifact.tileUrlTemplate, resolved.url)
      : resolveTileTemplateUrl("tiles/{z}/{x}/{y}.mvt", resolved.url);

  return {
    source: {
      id: sourceId,
      spec: {
        type: "vector",
        tiles: [tileTemplate],
        promoteId: "territoryId"
      }
    },
    sourceLayer,
    artifact: resolved.artifact,
    ...metadata
  };
}

interface TerritoryMapLibreResolvedRegistrySource {
  artifact: unknown;
  url: string;
  requestedLevel?: TerritoryAdminLevel;
  resolvedLevel?: TerritoryAdminLevel;
  exactMatch?: boolean;
  reason?: string;
  coverageStatus?: TerritoryCoverageStatus;
}

async function resolveRegistryTerritorySource(
  options: TerritoryMapLibreRegistrySourceOptions,
  formatPreference: readonly ["mvt" | "geojson", ...Array<"mvt" | "geojson">]
): Promise<TerritoryMapLibreResolvedRegistrySource> {
  if (!options.country || !options.level || !options.registry.resolveTerritoryArtifact) {
    throw new Error(
      "MapLibre country-level source resolution requires country, level, and registry support."
    );
  }

  const resolved =
    options.fallback === "deepest-available" &&
    options.registry.resolveDeepestAvailableTerritoryArtifact
      ? await options.registry.resolveDeepestAvailableTerritoryArtifact({
          country: options.country,
          requestedLevel: options.level,
          ...(options.parentId ? { parentId: options.parentId } : {}),
          purpose: "render",
          fallback: "deepest-available",
          formatPreference
        })
      : await options.registry.resolveTerritoryArtifact({
          country: options.country,
          level: options.level,
          ...(options.parentId ? { parentId: options.parentId } : {}),
          purpose: "render",
          fallback: options.fallback ?? "none",
          formatPreference
        });

  return {
    artifact: resolved.artifact,
    url: resolved.url,
    requestedLevel: resolved.requestedLevel,
    resolvedLevel: resolved.resolvedLevel,
    exactMatch: resolved.exactMatch,
    reason: resolved.reason,
    coverageStatus: resolved.coverageStatus
  };
}

async function resolveRegistryDatasetSource(
  options: TerritoryMapLibreRegistrySourceOptions,
  formatPreference: readonly ["mvt" | "geojson", ...Array<"mvt" | "geojson">]
): Promise<TerritoryMapLibreResolvedRegistrySource> {
  if (!options.datasetId) {
    throw new Error("MapLibre registry source resolution requires datasetId or country and level.");
  }

  return options.registry.resolveArtifact({
    datasetId: options.datasetId,
    purpose: "render",
    ...(options.levels ? { levels: options.levels } : {}),
    formatPreference
  });
}

function defaultFormatPreferenceForLevel(
  level: TerritoryAdminLevel | undefined
): readonly ["mvt" | "geojson", ...Array<"mvt" | "geojson">] {
  return !level || getAdminLevelDepth(level) >= 3 ? ["mvt", "geojson"] : ["geojson", "mvt"];
}

export function createTerritoryMapLibreLayer(
  options: TerritoryMapLibreRegistryLayerOptions = {}
): Array<Record<string, unknown>> {
  const sourceId = options.sourceId ?? "territory-kit-render";
  const sourceLayer = options.sourceLayer ?? "territory";
  const fillLayerId = options.fillLayerId ?? "territory-kit-render-fill";
  const lineLayerId = options.lineLayerId ?? "territory-kit-render-line";
  const zoomRange = {
    ...(options.minZoom !== undefined ? { minzoom: options.minZoom } : {}),
    ...(options.maxZoom !== undefined ? { maxzoom: options.maxZoom } : {})
  };

  return [
    {
      id: fillLayerId,
      type: "fill",
      source: sourceId,
      "source-layer": sourceLayer,
      ...zoomRange,
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "#f97316",
          ["boolean", ["feature-state", "hover"], false],
          "#fbbf24",
          options.fillColor ?? "#1f8a70"
        ],
        "fill-opacity": options.fillOpacity ?? 0.35
      }
    },
    {
      id: lineLayerId,
      type: "line",
      source: sourceId,
      "source-layer": sourceLayer,
      ...zoomRange,
      paint: {
        "line-color": options.lineColor ?? "#0f172a",
        "line-width": options.lineWidth ?? 1.25
      }
    }
  ];
}

export function createTerritoryMapLibreLevelLayers(
  options: TerritoryMapLibreRegistryLayerOptions & {
    levelPolicy?: readonly TerritoryMapLibreLevelPolicy[];
  } = {}
): Array<Record<string, unknown>> {
  const policies = options.levelPolicy ?? DEFAULT_TERRITORY_MAPLIBRE_LEVEL_POLICY;

  return policies.flatMap((policy) =>
    createTerritoryMapLibreLayer({
      ...options,
      fillLayerId: `${options.fillLayerId ?? "territory-kit-render-fill"}-${policy.level.toLowerCase()}`,
      lineLayerId: `${options.lineLayerId ?? "territory-kit-render-line"}-${policy.level.toLowerCase()}`,
      minZoom: policy.minZoom,
      ...(policy.maxZoom !== undefined ? { maxZoom: policy.maxZoom } : {})
    })
  );
}

export function setTerritoryMapLibreFeatureState(
  map: TerritoryMapLibreMap,
  input: {
    sourceId: string;
    territoryId: string | number;
    sourceLayer?: string;
    state: Record<string, unknown>;
  }
): void {
  map.setFeatureState?.(
    {
      source: input.sourceId,
      ...(input.sourceLayer ? { sourceLayer: input.sourceLayer } : {}),
      id: input.territoryId
    },
    input.state
  );
}

export function setTerritoryMapLibreHoverState(
  map: TerritoryMapLibreMap,
  input: { sourceId: string; territoryId: string | number; sourceLayer?: string; hover: boolean }
): void {
  setTerritoryMapLibreFeatureState(map, {
    sourceId: input.sourceId,
    territoryId: input.territoryId,
    ...(input.sourceLayer ? { sourceLayer: input.sourceLayer } : {}),
    state: { hover: input.hover }
  });
}

export function setTerritoryMapLibreSelectedState(
  map: TerritoryMapLibreMap,
  input: {
    sourceId: string;
    territoryId: string | number;
    sourceLayer?: string;
    selected: boolean;
  }
): void {
  setTerritoryMapLibreFeatureState(map, {
    sourceId: input.sourceId,
    territoryId: input.territoryId,
    ...(input.sourceLayer ? { sourceLayer: input.sourceLayer } : {}),
    state: { selected: input.selected }
  });
}

export function removeTerritoryMapLibreFeatureState(
  map: TerritoryMapLibreMap,
  input: { sourceId: string; territoryId: string | number; sourceLayer?: string; key?: string }
): void {
  map.removeFeatureState?.(
    {
      source: input.sourceId,
      ...(input.sourceLayer ? { sourceLayer: input.sourceLayer } : {}),
      id: input.territoryId
    },
    input.key
  );
}

export function createTerritoryMapLibreController(
  options: TerritoryMapLibreControllerOptions
): TerritoryMapLibreController {
  let zonesById: Map<string, TerritoryZone> | undefined;

  async function loadZones(): Promise<Map<string, TerritoryZone>> {
    if (zonesById) {
      return zonesById;
    }

    const installed = await options.registry.installDataset({
      datasetId: options.datasetId,
      ...(options.levels ? { levels: options.levels } : {})
    });
    const nextZones = new Map<string, TerritoryZone>();

    for (const artifact of installed.installedArtifacts) {
      const path = artifact.artifact.path;

      if (!path?.startsWith("levels/") || !path.endsWith("/dataset.json")) {
        continue;
      }

      const dataset = loadTerritoryDataset(JSON.parse(await installed.readText(path)) as unknown);

      for (const zone of dataset.zones) {
        nextZones.set(zone.id, zone);
      }
    }

    zonesById = nextZones;
    return nextZones;
  }

  return {
    async resolveTerritory(territoryId) {
      return (await loadZones()).get(territoryId);
    },
    onTerritoryClick(callback) {
      return (event: unknown): void => {
        const feature = readFirstFeature(event);
        const territoryId = readFeatureTerritoryId(feature);

        if (!territoryId) {
          return;
        }

        callback({
          territoryId,
          ...(feature ? { feature } : {}),
          originalEvent: event
        });
      };
    }
  };
}

export function createTerritoryMapLibreAdapter(
  options: TerritoryMapLibreAdapterOptions
): TerritoryMapLibreAdapter {
  const sourceId = options.sourceId ?? "territory-kit-zones";
  const fillLayerId = options.fillLayerId ?? "territory-kit-zones-fill";
  const lineLayerId = options.lineLayerId ?? "territory-kit-zones-line";
  let map: TerritoryMapLibreMap | undefined;
  let lifecycleState: TerritoryAdapterLifecycleState = "detached";
  let zones = [...options.zones];
  let stateByZoneId = options.stateByZoneId ?? new Map<string, TerritoryMapLibreState>();

  const clickListener = (event: unknown): void => {
    dispatchZoneEvent(event, options.onZoneClick);
  };
  const hoverListener = (event: unknown): void => {
    dispatchZoneEvent(event, options.onZoneHover);
  };
  const leaveListener = (event: unknown): void => {
    dispatchZoneEvent(event, options.onZoneLeave);
  };

  function currentBundle(): TerritoryMapLibreLayerBundle {
    return createTerritoryMapLibreLayers(zones, {
      sourceId,
      fillLayerId,
      lineLayerId,
      stateByZoneId,
      ...(options.fillColor === undefined ? {} : { fillColor: options.fillColor }),
      ...(options.fillOpacity === undefined ? {} : { fillOpacity: options.fillOpacity }),
      ...(options.lineColor === undefined ? {} : { lineColor: options.lineColor }),
      ...(options.lineWidth === undefined ? {} : { lineWidth: options.lineWidth })
    });
  }

  function detachCurrentMap(): void {
    if (!map) {
      lifecycleState = lifecycleState === "disposed" ? "disposed" : "detached";
      return;
    }

    lifecycleState = "detaching";
    map.off?.("click", fillLayerId, clickListener);
    map.off?.("mousemove", fillLayerId, hoverListener);
    map.off?.("mouseleave", fillLayerId, leaveListener);

    for (const layerId of [lineLayerId, fillLayerId]) {
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }
    }

    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }

    map = undefined;
    lifecycleState = "detached";
  }

  function dispatchZoneEvent(
    event: unknown,
    callback: ((event: TerritoryMapLibreZoneEvent) => void) | undefined
  ): void {
    if (!callback) {
      return;
    }

    const feature = readFirstFeature(event);
    const zoneId = readFeatureZoneId(feature);

    if (!zoneId) {
      return;
    }

    callback({
      zoneId,
      ...(feature ? { feature } : {}),
      originalEvent: event
    });
  }

  return {
    get capabilities() {
      return TERRITORY_MAPLIBRE_ADAPTER_CAPABILITIES;
    },

    get lifecycleState() {
      return lifecycleState;
    },

    attach(nextMap) {
      lifecycleState = "attaching";
      detachCurrentMap();
      lifecycleState = "attaching";
      map = nextMap;
      const bundle = currentBundle();

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, bundle.source.spec);
      }

      for (const layer of bundle.layers) {
        const layerId = String(layer.id);

        if (!map.getLayer(layerId)) {
          map.addLayer(layer);
        }
      }

      map.on?.("click", fillLayerId, clickListener);
      map.on?.("mousemove", fillLayerId, hoverListener);
      map.on?.("mouseleave", fillLayerId, leaveListener);
      lifecycleState = "attached";
    },

    detach() {
      detachCurrentMap();
    },

    setSource(source) {
      assertTerritoryAdapterAttached(lifecycleState, "set source");
      const attachedMap = requireAttachedMap(map, "set source");

      assertTerritoryAdapterCapability(
        TERRITORY_MAPLIBRE_ADAPTER_CAPABILITIES,
        source.type === "geojson" ? "geoJson" : "vectorTiles",
        "set source"
      );

      if (source.type !== "geojson" || !isFeatureCollection(source.data)) {
        throw new TerritoryError(
          "RUNTIME_CONFIGURATION_INVALID",
          "MapLibre source replacement requires a GeoJSON FeatureCollection.",
          { details: { sourceId: source.id, sourceType: source.type } }
        );
      }

      attachedMap.getSource(source.id)?.setData(source.data);
    },

    updateState(state) {
      assertTerritoryAdapterAttached(lifecycleState, "update state");
      const attachedMap = requireAttachedMap(map, "update state");

      assertTerritoryAdapterCapability(
        TERRITORY_MAPLIBRE_ADAPTER_CAPABILITIES,
        "featureState",
        "update state"
      );

      for (const territoryId of state.selectedTerritoryIds ?? []) {
        setTerritoryMapLibreSelectedState(attachedMap, {
          sourceId,
          territoryId,
          selected: true
        });
      }

      if (state.hoverTerritoryId) {
        setTerritoryMapLibreHoverState(attachedMap, {
          sourceId,
          territoryId: state.hoverTerritoryId,
          hover: true
        });
      }

      for (const [territoryId, selection] of state.stateByTerritoryId ?? new Map()) {
        setTerritoryMapLibreFeatureState(attachedMap, {
          sourceId,
          territoryId,
          state: {
            ...(selection.selected !== undefined ? { selected: selection.selected } : {}),
            ...(selection.hover !== undefined ? { hover: selection.hover } : {}),
            ...(selection.properties ?? {})
          }
        });
      }
    },

    updateData(nextZones, nextStateByZoneId = stateByZoneId) {
      zones = [...nextZones];
      stateByZoneId = nextStateByZoneId;
      map?.getSource(sourceId)?.setData(zonesToFeatureCollection(zones, stateByZoneId));
    },

    updateTheme(theme) {
      if (!map?.setPaintProperty) {
        return;
      }

      if (theme.fillColor !== undefined) {
        map.setPaintProperty(fillLayerId, "fill-color", theme.fillColor);
      }

      if (theme.fillOpacity !== undefined) {
        map.setPaintProperty(fillLayerId, "fill-opacity", theme.fillOpacity);
      }

      if (theme.lineColor !== undefined) {
        map.setPaintProperty(lineLayerId, "line-color", theme.lineColor);
      }

      if (theme.lineWidth !== undefined) {
        map.setPaintProperty(lineLayerId, "line-width", theme.lineWidth);
      }
    }
  };
}

function isFeatureCollection(input: unknown): input is FeatureCollection {
  return isRecord(input) && input.type === "FeatureCollection" && Array.isArray(input.features);
}

function requireAttachedMap(
  map: TerritoryMapLibreMap | undefined,
  action: string
): TerritoryMapLibreMap {
  if (!map) {
    throw new TerritoryError(
      "ADAPTER_NOT_ATTACHED",
      `Cannot ${action} before the adapter is attached.`,
      {
        details: { action }
      }
    );
  }

  return map;
}

function readFirstFeature(event: unknown): Feature | undefined {
  if (!isRecord(event) || !Array.isArray(event.features)) {
    return undefined;
  }

  return event.features[0] as Feature | undefined;
}

function readFeatureZoneId(feature: Feature | undefined): string | undefined {
  if (!feature) {
    return undefined;
  }

  if (typeof feature.id === "string" || typeof feature.id === "number") {
    return String(feature.id);
  }

  if (isRecord(feature.properties)) {
    const id = feature.properties.id;

    if (typeof id === "string" || typeof id === "number") {
      return String(id);
    }
  }

  return undefined;
}

function readFeatureTerritoryId(feature: Feature | undefined): string | undefined {
  if (!feature) {
    return undefined;
  }

  if (isRecord(feature.properties)) {
    const territoryId = feature.properties.territoryId;

    if (typeof territoryId === "string" || typeof territoryId === "number") {
      return String(territoryId);
    }
  }

  return readFeatureZoneId(feature);
}

function resolveTileTemplateUrl(template: string, baseUrl: string): string {
  const tokens = new Map([
    ["{z}", "__TERRITORY_KIT_Z__"],
    ["{x}", "__TERRITORY_KIT_X__"],
    ["{y}", "__TERRITORY_KIT_Y__"]
  ]);
  let safeTemplate = template;

  for (const [placeholder, token] of tokens) {
    safeTemplate = safeTemplate.replaceAll(placeholder, token);
  }

  let resolved = new URL(safeTemplate, baseUrl).toString();

  for (const [placeholder, token] of tokens) {
    resolved = resolved.replaceAll(token, placeholder);
  }

  return resolved;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
