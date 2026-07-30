import type { Feature, FeatureCollection } from "geojson";
import type * as Leaflet from "leaflet";
import {
  assertTerritoryAdapterCapability,
  assertTerritoryAdapterAttached,
  createTerritoryAdapterLifecycle,
  defineTerritoryAdapterCapabilities,
  isTerritoryFeatureCollection,
  readFirstTerritoryRenderFeature,
  readTerritoryFeatureId,
  territoryZonesToFeatureCollection
} from "@territory-kit/adapter-core";
import type {
  TerritoryAdapterCapabilities,
  TerritoryAdapterLifecycleState,
  TerritoryAdapterOperationContext,
  TerritoryRendererAdapter,
  TerritoryRenderSource,
  TerritoryRenderState,
  TerritoryRenderTheme
} from "@territory-kit/adapter-core";
import { TerritoryError, getAdminLevelDepth } from "@territory-kit/dataset";
import type {
  TerritoryAdminLevel,
  TerritoryCoverageStatus,
  TerritoryZone
} from "@territory-kit/dataset";
import type { TerritoryRegistryClient } from "@territory-kit/registry";

export interface TerritoryLeafletState extends Record<string, unknown> {
  selected?: boolean;
  hover?: boolean;
}

export interface TerritoryLeafletTerritoryEvent {
  territoryId: string;
  feature?: Feature;
  originalEvent: unknown;
}

export interface TerritoryLeafletMap {
  addLayer(layer: unknown): unknown;
  removeLayer(layer: unknown): unknown;
  on?(type: string, listener: (event: unknown) => void): unknown;
  off?(type: string, listener: (event: unknown) => void): unknown;
  getZoom?(): number;
  getBounds?(): {
    getWest(): number;
    getSouth(): number;
    getEast(): number;
    getNorth(): number;
  };
}

export interface TerritoryLeafletLayer {
  addTo?(map: unknown): unknown;
  remove?(): unknown;
  on?(type: string, listener: (event: unknown) => void): unknown;
  off?(type: string, listener: (event: unknown) => void): unknown;
}

export interface TerritoryLeafletGeoJsonLayer extends TerritoryLeafletLayer {
  addData(data: FeatureCollection): unknown;
  clearLayers(): unknown;
  setStyle?(style: Leaflet.PathOptions | Leaflet.StyleFunction): unknown;
}

export interface TerritoryLeafletNamespace {
  geoJSON(
    data?: GeoJSON.GeoJsonObject | null,
    options?: Leaflet.GeoJSONOptions
  ): TerritoryLeafletGeoJsonLayer;
}

export type TerritoryLeafletStyleFunction = (
  feature: Feature | undefined,
  state: TerritoryLeafletState
) => Leaflet.PathOptions;

export type TerritoryLeafletVectorTileLayerFactory = (
  source: TerritoryRenderSource,
  context?: TerritoryAdapterOperationContext
) => TerritoryLeafletLayer;

export interface TerritoryLeafletAdapterOptions {
  zones?: readonly TerritoryZone[];
  map?: TerritoryLeafletMap;
  leaflet?: TerritoryLeafletNamespace;
  sourceId?: string;
  fillColor?: string;
  fillOpacity?: number;
  lineColor?: string;
  lineWidth?: number;
  stateByZoneId?: ReadonlyMap<string, TerritoryLeafletState>;
  style?: TerritoryLeafletStyleFunction;
  createGeoJsonLayer?: (
    data: FeatureCollection,
    options: Leaflet.GeoJSONOptions
  ) => TerritoryLeafletGeoJsonLayer;
  createVectorTileLayer?: TerritoryLeafletVectorTileLayerFactory;
  onTerritoryClick?: (event: TerritoryLeafletTerritoryEvent) => void;
  onTerritoryHover?: (event: TerritoryLeafletTerritoryEvent) => void;
  onTerritoryLeave?: (event: TerritoryLeafletTerritoryEvent) => void;
  onZoneClick?: (event: TerritoryLeafletTerritoryEvent) => void;
  onZoneHover?: (event: TerritoryLeafletTerritoryEvent) => void;
  onZoneLeave?: (event: TerritoryLeafletTerritoryEvent) => void;
}

export interface TerritoryLeafletAdapter extends TerritoryRendererAdapter<TerritoryLeafletMap> {
  readonly capabilities: TerritoryAdapterCapabilities;
  readonly lifecycleState: TerritoryAdapterLifecycleState;
  readonly managedSourceId: string;
  attach(map: TerritoryLeafletMap): void;
  detach(): void;
  dispose(): void;
  setSource(source: TerritoryRenderSource, context?: TerritoryAdapterOperationContext): void;
  updateState(state: TerritoryRenderState): void;
  updateData(
    zones: readonly TerritoryZone[],
    stateByZoneId?: ReadonlyMap<string, TerritoryLeafletState>
  ): void;
  updateTheme(theme: TerritoryRenderTheme): void;
}

export interface TerritoryLeafletRegistrySourceOptions {
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
  formatPreference?: readonly ["geojson" | "mvt", ...Array<"geojson" | "mvt">];
}

export interface TerritoryLeafletRegistrySourceBundle {
  source: TerritoryRenderSource;
  artifact: unknown;
  requestedLevel?: TerritoryAdminLevel;
  renderedLevel?: TerritoryAdminLevel;
  exactMatch?: boolean;
  fallbackReason?: string;
  coverageStatus?: TerritoryCoverageStatus;
  format?: "geojson" | "mvt" | string;
}

export const TERRITORY_LEAFLET_ADAPTER_CAPABILITIES = defineTerritoryAdapterCapabilities({
  geoJson: true,
  vectorTiles: false,
  featureState: false,
  hover: true,
  click: true,
  selection: true,
  symbols: false,
  transitions: false,
  runtimeThemeUpdates: true,
  sourceReplacement: true,
  viewportEvents: true
});

export function zonesToLeafletFeatureCollection(
  zones: readonly TerritoryZone[],
  stateByZoneId: ReadonlyMap<string, TerritoryLeafletState> = new Map()
): FeatureCollection {
  return territoryZonesToFeatureCollection(zones, { stateByZoneId });
}

export function createTerritoryLeafletAdapter(
  options: TerritoryLeafletAdapterOptions = {}
): TerritoryLeafletAdapter {
  const sourceId = options.sourceId ?? "territory-kit-zones";
  const lifecycle = createTerritoryAdapterLifecycle<TerritoryLeafletMap>();
  const capabilities = defineTerritoryAdapterCapabilities({
    ...TERRITORY_LEAFLET_ADAPTER_CAPABILITIES,
    vectorTiles: Boolean(options.createVectorTileLayer)
  });
  let geoJsonLayer: TerritoryLeafletGeoJsonLayer | undefined;
  let activeLayer: TerritoryLeafletLayer | undefined;
  let zones = [...(options.zones ?? [])];
  let stateByZoneId = options.stateByZoneId ?? new Map<string, TerritoryLeafletState>();
  let renderState: TerritoryRenderState = {};
  let theme: TerritoryRenderTheme = {};

  const clickListener = (event: unknown): void => {
    dispatchTerritoryEvent(event, options.onTerritoryClick ?? options.onZoneClick);
  };
  const hoverListener = (event: unknown): void => {
    dispatchTerritoryEvent(event, options.onTerritoryHover ?? options.onZoneHover);
  };
  const leaveListener = (event: unknown): void => {
    dispatchTerritoryEvent(event, options.onTerritoryLeave ?? options.onZoneLeave);
  };

  function createGeoJsonLayer(data: FeatureCollection): TerritoryLeafletGeoJsonLayer {
    const layerOptions: Leaflet.GeoJSONOptions = {
      style: (feature) => resolveFeatureStyle(feature as Feature | undefined)
    };

    if (options.createGeoJsonLayer) {
      return options.createGeoJsonLayer(data, layerOptions);
    }

    if (!options.leaflet) {
      throw new TerritoryError(
        "RUNTIME_CONFIGURATION_INVALID",
        "Leaflet adapter requires options.leaflet or options.createGeoJsonLayer.",
        { details: { sourceId } }
      );
    }

    return options.leaflet.geoJSON(data, layerOptions);
  }

  function ensureGeoJsonLayer(): TerritoryLeafletGeoJsonLayer {
    if (!geoJsonLayer) {
      geoJsonLayer = createGeoJsonLayer(zonesToLeafletFeatureCollection(zones, stateByZoneId));
    }

    return geoJsonLayer;
  }

  function bindLayerEvents(layer: TerritoryLeafletLayer): void {
    layer.on?.("click", clickListener);
    layer.on?.("mouseover", hoverListener);
    layer.on?.("mouseout", leaveListener);
  }

  function unbindLayerEvents(layer: TerritoryLeafletLayer): void {
    layer.off?.("click", clickListener);
    layer.off?.("mouseover", hoverListener);
    layer.off?.("mouseout", leaveListener);
  }

  function addLayer(layer: TerritoryLeafletLayer): void {
    lifecycle.target?.addLayer(layer);
    bindLayerEvents(layer);
    activeLayer = layer;
  }

  function removeActiveLayer(): void {
    if (!activeLayer) {
      return;
    }

    unbindLayerEvents(activeLayer);
    lifecycle.target?.removeLayer(activeLayer);
    activeLayer.remove?.();
    activeLayer = undefined;
  }

  function replaceWithGeoJsonLayer(): void {
    removeActiveLayer();
    addLayer(ensureGeoJsonLayer());
  }

  function resolveFeatureStyle(feature: Feature | undefined): Leaflet.PathOptions {
    const territoryId = readTerritoryFeatureId(feature);
    const state = territoryId ? readFeatureState(territoryId) : {};

    if (options.style) {
      return options.style(feature, state);
    }

    return {
      color: theme.lineColor ?? options.lineColor ?? "#0f172a",
      fillColor: state.selected
        ? (theme.selectedFillColor ?? "#f97316")
        : state.hover
          ? (theme.hoverFillColor ?? "#fbbf24")
          : (theme.fillColor ?? options.fillColor ?? "#1f8a70"),
      fillOpacity: theme.fillOpacity ?? options.fillOpacity ?? 0.35,
      weight: theme.lineWidth ?? options.lineWidth ?? 1.25
    };
  }

  function readFeatureState(territoryId: string): TerritoryLeafletState {
    const base = stateByZoneId.get(territoryId) ?? {};
    const selected =
      renderState.selectedTerritoryIds?.includes(territoryId) === true ||
      renderState.stateByTerritoryId?.get(territoryId)?.selected === true ||
      base.selected === true;
    const hover =
      renderState.hoverTerritoryId === territoryId ||
      renderState.stateByTerritoryId?.get(territoryId)?.hover === true ||
      base.hover === true;
    const properties = renderState.stateByTerritoryId?.get(territoryId)?.properties ?? {};

    return {
      ...base,
      ...properties,
      selected,
      hover
    };
  }

  function restyle(): void {
    geoJsonLayer?.setStyle?.((feature) => resolveFeatureStyle(feature as Feature | undefined));
  }

  function dispatchTerritoryEvent(
    event: unknown,
    callback: ((event: TerritoryLeafletTerritoryEvent) => void) | undefined
  ): void {
    if (!callback) {
      return;
    }

    const feature = readFirstTerritoryRenderFeature(event) as Feature | undefined;
    const territoryId = readTerritoryFeatureId(feature);

    if (!territoryId) {
      return;
    }

    callback({
      territoryId,
      ...(feature ? { feature } : {}),
      originalEvent: event
    });
  }

  const adapter: TerritoryLeafletAdapter = {
    get capabilities() {
      return capabilities;
    },

    get lifecycleState() {
      return lifecycle.lifecycleState;
    },

    get managedSourceId() {
      return sourceId;
    },

    attach(map) {
      lifecycle.attach(map);
      replaceWithGeoJsonLayer();
    },

    detach() {
      removeActiveLayer();
      lifecycle.detach();
    },

    dispose() {
      removeActiveLayer();
      lifecycle.dispose();
    },

    setSource(source, context) {
      assertTerritoryAdapterAttached(lifecycle.lifecycleState, "set source");

      if (context?.signal?.aborted) {
        return;
      }

      if (source.id !== sourceId) {
        throw new TerritoryError(
          "ADAPTER_TARGET_INVALID",
          "Leaflet source id does not match the configured adapter source id.",
          { details: { configuredSourceId: sourceId, sourceId: source.id } }
        );
      }

      if (source.type === "vector-tiles") {
        assertTerritoryAdapterCapability(capabilities, "vectorTiles", "set vector tile source");

        if (!options.createVectorTileLayer) {
          throw new TerritoryError(
            "CAPABILITY_UNSUPPORTED",
            "Leaflet vector tile support requires options.createVectorTileLayer.",
            { details: { sourceId } }
          );
        }

        const nextLayer = options.createVectorTileLayer(source, context);

        if (context?.signal?.aborted) {
          return;
        }

        removeActiveLayer();
        addLayer(nextLayer);
        return;
      }

      if (source.type !== "geojson") {
        throw new TerritoryError(
          "RUNTIME_CONFIGURATION_INVALID",
          "Leaflet source type is invalid.",
          {
            details: { sourceId: source.id, sourceType: source.type }
          }
        );
      }

      assertTerritoryAdapterCapability(capabilities, "geoJson", "set GeoJSON source");

      if (!isTerritoryFeatureCollection(source.data)) {
        throw new TerritoryError(
          "RUNTIME_CONFIGURATION_INVALID",
          "Leaflet source replacement requires a GeoJSON FeatureCollection.",
          { details: { sourceId: source.id, sourceType: source.type } }
        );
      }

      assertLeafletSourceCrsCompatible(source);
      const layer = ensureGeoJsonLayer();
      layer.clearLayers();

      if (context?.signal?.aborted) {
        return;
      }

      layer.addData(source.data);

      if (activeLayer !== layer) {
        replaceWithGeoJsonLayer();
      }
    },

    updateState(state) {
      assertTerritoryAdapterAttached(lifecycle.lifecycleState, "update state");
      renderState = state;
      restyle();
    },

    updateData(nextZones, nextStateByZoneId = stateByZoneId) {
      zones = [...nextZones];
      stateByZoneId = nextStateByZoneId;
      const layer = ensureGeoJsonLayer();
      layer.clearLayers();
      layer.addData(zonesToLeafletFeatureCollection(zones, stateByZoneId));
      restyle();
    },

    updateTheme(nextTheme) {
      theme = nextTheme;
      restyle();
    }
  };

  if (options.map) {
    adapter.attach(options.map);
  }

  return adapter;
}

export const createLeafletTerritoryAdapter = createTerritoryLeafletAdapter;

export async function createTerritoryLeafletSource(
  options: TerritoryLeafletRegistrySourceOptions
): Promise<TerritoryLeafletRegistrySourceBundle> {
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

  if (artifact.format === "mvt") {
    const tileTemplate =
      typeof artifact.tileUrlTemplate === "string"
        ? resolveTileTemplateUrl(artifact.tileUrlTemplate, resolved.url)
        : resolveTileTemplateUrl("tiles/{z}/{x}/{y}.mvt", resolved.url);

    return {
      source: {
        id: sourceId,
        type: "vector-tiles",
        tiles: [tileTemplate],
        metadata
      },
      artifact: resolved.artifact,
      ...metadata
    };
  }

  return {
    source: {
      id: sourceId,
      type: "geojson",
      url: resolved.url,
      metadata
    },
    artifact: resolved.artifact,
    ...metadata
  };
}

async function resolveRegistryTerritorySource(
  options: TerritoryLeafletRegistrySourceOptions,
  formatPreference: readonly ["geojson" | "mvt", ...Array<"geojson" | "mvt">]
): Promise<TerritoryLeafletResolvedRegistrySource> {
  if (!options.country || !options.level || !options.registry.resolveTerritoryArtifact) {
    throw new Error(
      "Leaflet country-level source resolution requires country, level, and registry support."
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
  options: TerritoryLeafletRegistrySourceOptions,
  formatPreference: readonly ["geojson" | "mvt", ...Array<"geojson" | "mvt">]
): Promise<TerritoryLeafletResolvedRegistrySource> {
  if (!options.datasetId) {
    throw new Error("Leaflet registry source resolution requires datasetId or country and level.");
  }

  return options.registry.resolveArtifact({
    datasetId: options.datasetId,
    purpose: "render",
    ...(options.levels ? { levels: options.levels } : {}),
    formatPreference
  });
}

interface TerritoryLeafletResolvedRegistrySource {
  artifact: unknown;
  url: string;
  requestedLevel?: TerritoryAdminLevel;
  resolvedLevel?: TerritoryAdminLevel;
  exactMatch?: boolean;
  reason?: string;
  coverageStatus?: TerritoryCoverageStatus;
}

function defaultFormatPreferenceForLevel(
  level: TerritoryAdminLevel | undefined
): readonly ["geojson" | "mvt", ...Array<"geojson" | "mvt">] {
  return !level || getAdminLevelDepth(level) < 3 ? ["geojson", "mvt"] : ["mvt", "geojson"];
}

function assertLeafletSourceCrsCompatible(source: TerritoryRenderSource): void {
  const crs = isRecord(source.metadata)
    ? (source.metadata.crs ?? source.metadata.dataProjection)
    : undefined;

  if (
    typeof crs !== "string" ||
    ["EPSG:4326", "OGC:CRS84", "CRS84"].includes(crs.trim().toUpperCase())
  ) {
    return;
  }

  throw new TerritoryError(
    "RUNTIME_CONFIGURATION_INVALID",
    "Leaflet GeoJSON rendering expects EPSG:4326/CRS84 coordinates.",
    {
      details: {
        sourceId: source.id,
        sourceCrs: crs
      }
    }
  );
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
