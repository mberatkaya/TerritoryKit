import type { Feature, FeatureCollection } from "geojson";
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
  TerritoryRenderTheme,
  TerritoryRenderViewport
} from "@territory-kit/adapter-core";
import { TerritoryError, getAdminLevelDepth } from "@territory-kit/dataset";
import type {
  TerritoryAdminLevel,
  TerritoryCoverageStatus,
  TerritoryZone
} from "@territory-kit/dataset";
import type { TerritoryRegistryClient } from "@territory-kit/registry";

export interface TerritoryOpenLayersFeature {
  getId?(): string | number | undefined;
  get?(key: string): unknown;
  set?(key: string, value: unknown): void;
  setProperties?(values: Record<string, unknown>): void;
}

export interface TerritoryOpenLayersProjection {
  getCode?(): string;
}

export interface TerritoryOpenLayersView {
  getZoom?(): number | undefined;
  getCenter?(): readonly number[] | undefined;
  getProjection?(): TerritoryOpenLayersProjection | string | undefined;
  calculateExtent?(size?: number[]): readonly number[];
}

export interface TerritoryOpenLayersMap {
  addLayer(layer: TerritoryOpenLayersLayer): void;
  removeLayer(layer: TerritoryOpenLayersLayer): void;
  getView?(): TerritoryOpenLayersView;
  getSize?(): number[] | undefined;
  on?(type: string, listener: (event: unknown) => void): unknown;
  un?(type: string, listener: (event: unknown) => void): void;
  forEachFeatureAtPixel?(
    pixel: unknown,
    callback: (feature: unknown, layer?: unknown, geometry?: unknown) => unknown,
    options?: { layerFilter?: (layer: unknown) => boolean } & Record<string, unknown>
  ): unknown;
}

export interface TerritoryOpenLayersLayer {
  setSource?(source: TerritoryOpenLayersSource | TerritoryOpenLayersVectorTileSource): void;
  getSource?(): TerritoryOpenLayersSource | TerritoryOpenLayersVectorTileSource | undefined;
  setStyle?(style: TerritoryOpenLayersStyleLike): void;
  changed?(): void;
}

export interface TerritoryOpenLayersSource {
  clear(fast?: boolean): void;
  addFeatures(features: readonly TerritoryOpenLayersFeature[]): void;
  getFeatures?(): readonly TerritoryOpenLayersFeature[];
}

export interface TerritoryOpenLayersVectorTileSource {
  readonly type?: "vector-tile";
}

export interface TerritoryOpenLayersGeoJsonFormat {
  readFeatures(
    data: FeatureCollection,
    options?: {
      dataProjection?: string;
      featureProjection?: string;
    }
  ): TerritoryOpenLayersFeature[];
}

export interface TerritoryOpenLayersState extends Record<string, unknown> {
  selected?: boolean;
  hover?: boolean;
}

export type TerritoryOpenLayersStyleLike =
  unknown | ((feature: TerritoryOpenLayersFeature, state: TerritoryOpenLayersState) => unknown);

export type TerritoryOpenLayersStyleFunction = (
  feature: TerritoryOpenLayersFeature,
  state: TerritoryOpenLayersState
) => unknown;

export interface TerritoryOpenLayersTerritoryEvent {
  territoryId: string;
  feature?: TerritoryOpenLayersFeature;
  originalEvent: unknown;
}

export interface TerritoryOpenLayersAdapterOptions {
  zones?: readonly TerritoryZone[];
  map?: TerritoryOpenLayersMap;
  sourceId?: string;
  dataProjection?: string;
  featureProjection?: string;
  geoJsonFormat?: TerritoryOpenLayersGeoJsonFormat;
  vectorSource?: TerritoryOpenLayersSource;
  vectorLayer?: TerritoryOpenLayersLayer;
  createVectorSource?: () => TerritoryOpenLayersSource;
  createVectorLayer?: (source: TerritoryOpenLayersSource) => TerritoryOpenLayersLayer;
  createVectorTileSource?: (
    source: TerritoryRenderSource,
    context?: TerritoryAdapterOperationContext
  ) => TerritoryOpenLayersVectorTileSource;
  createVectorTileLayer?: (
    source: TerritoryOpenLayersVectorTileSource,
    renderSource: TerritoryRenderSource
  ) => TerritoryOpenLayersLayer;
  unByKey?: (key: unknown) => void;
  stateByZoneId?: ReadonlyMap<string, TerritoryOpenLayersState>;
  style?: TerritoryOpenLayersStyleFunction;
  onTerritoryClick?: (event: TerritoryOpenLayersTerritoryEvent) => void;
  onTerritoryHover?: (event: TerritoryOpenLayersTerritoryEvent) => void;
  onZoneClick?: (event: TerritoryOpenLayersTerritoryEvent) => void;
  onZoneHover?: (event: TerritoryOpenLayersTerritoryEvent) => void;
}

export interface TerritoryOpenLayersAdapter extends TerritoryRendererAdapter<TerritoryOpenLayersMap> {
  readonly capabilities: TerritoryAdapterCapabilities;
  readonly lifecycleState: TerritoryAdapterLifecycleState;
  readonly managedSourceId: string;
  attach(map: TerritoryOpenLayersMap): void;
  detach(): void;
  dispose(): void;
  setSource(source: TerritoryRenderSource, context?: TerritoryAdapterOperationContext): void;
  updateState(state: TerritoryRenderState): void;
  updateData(
    zones: readonly TerritoryZone[],
    stateByZoneId?: ReadonlyMap<string, TerritoryOpenLayersState>
  ): void;
  updateTheme(theme: TerritoryRenderTheme): void;
}

export interface TerritoryOpenLayersRegistrySourceOptions {
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
  formatPreference?: readonly ["mvt" | "geojson", ...Array<"mvt" | "geojson">];
}

export interface TerritoryOpenLayersRegistrySourceBundle {
  source: TerritoryRenderSource;
  artifact: unknown;
  requestedLevel?: TerritoryAdminLevel;
  renderedLevel?: TerritoryAdminLevel;
  exactMatch?: boolean;
  fallbackReason?: string;
  coverageStatus?: TerritoryCoverageStatus;
  format?: "geojson" | "mvt" | string;
}

export const TERRITORY_OPENLAYERS_ADAPTER_CAPABILITIES = defineTerritoryAdapterCapabilities({
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
  viewportEvents: true
});

export function zonesToOpenLayersFeatureCollection(
  zones: readonly TerritoryZone[],
  stateByZoneId: ReadonlyMap<string, TerritoryOpenLayersState> = new Map()
): FeatureCollection {
  return territoryZonesToFeatureCollection(zones, { stateByZoneId });
}

export function readOpenLayersViewport(map: TerritoryOpenLayersMap): TerritoryRenderViewport {
  const view = map.getView?.();
  const extent = view?.calculateExtent?.(map.getSize?.());

  if (!extent) {
    throw new TerritoryError(
      "ADAPTER_TARGET_INVALID",
      "OpenLayers viewport inspection requires view.calculateExtent()."
    );
  }

  const center = view?.getCenter?.();
  const zoom = view?.getZoom?.();
  const [west = 0, south = 0, east = 0, north = 0] = extent;
  const [lng, lat] = center ?? [];

  return {
    bounds: {
      west,
      south,
      east,
      north
    },
    ...(zoom !== undefined ? { zoom } : {}),
    ...(lng !== undefined && lat !== undefined ? { center: { lng, lat } } : {})
  };
}

export function assertOpenLayersProjectionCompatible(input: {
  dataProjection: string;
  featureProjection?: string;
  viewProjection?: string;
}): void {
  if (
    input.viewProjection &&
    input.viewProjection !== input.dataProjection &&
    !input.featureProjection
  ) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      "OpenLayers adapter requires featureProjection when the map view projection differs from TerritoryKit GeoJSON data projection.",
      {
        details: {
          dataProjection: input.dataProjection,
          viewProjection: input.viewProjection
        }
      }
    );
  }
}

export function createTerritoryOpenLayersAdapter(
  options: TerritoryOpenLayersAdapterOptions = {}
): TerritoryOpenLayersAdapter {
  const sourceId = options.sourceId ?? "territory-kit-zones";
  const dataProjection = options.dataProjection ?? "EPSG:4326";
  const lifecycle = createTerritoryAdapterLifecycle<TerritoryOpenLayersMap>();
  const capabilities = defineTerritoryAdapterCapabilities({
    ...TERRITORY_OPENLAYERS_ADAPTER_CAPABILITIES,
    vectorTiles: Boolean(options.createVectorTileSource && options.createVectorTileLayer)
  });
  const format = requireGeoJsonFormat(options.geoJsonFormat);
  let vectorSource = options.vectorSource ?? options.createVectorSource?.();
  let vectorLayer =
    options.vectorLayer ?? (vectorSource ? options.createVectorLayer?.(vectorSource) : undefined);
  let activeLayer: TerritoryOpenLayersLayer | undefined;
  let listenerKeys: unknown[] = [];
  let zones = [...(options.zones ?? [])];
  let stateByZoneId = options.stateByZoneId ?? new Map<string, TerritoryOpenLayersState>();
  let renderState: TerritoryRenderState = {};
  let theme: TerritoryRenderTheme = {};

  const clickListener = (event: unknown): void => {
    dispatchTerritoryEvent(event, options.onTerritoryClick ?? options.onZoneClick);
  };
  const hoverListener = (event: unknown): void => {
    dispatchTerritoryEvent(event, options.onTerritoryHover ?? options.onZoneHover);
  };

  function ensureVectorSource(): TerritoryOpenLayersSource {
    vectorSource ??= options.createVectorSource?.();

    if (!vectorSource) {
      throw new TerritoryError(
        "RUNTIME_CONFIGURATION_INVALID",
        "OpenLayers adapter requires vectorSource or createVectorSource.",
        { details: { sourceId } }
      );
    }

    return vectorSource;
  }

  function ensureVectorLayer(): TerritoryOpenLayersLayer {
    const source = ensureVectorSource();
    vectorLayer ??= options.createVectorLayer?.(source);

    if (!vectorLayer) {
      throw new TerritoryError(
        "RUNTIME_CONFIGURATION_INVALID",
        "OpenLayers adapter requires vectorLayer or createVectorLayer.",
        { details: { sourceId } }
      );
    }

    vectorLayer.setSource?.(source);
    vectorLayer.setStyle?.((feature: TerritoryOpenLayersFeature) => resolveFeatureStyle(feature));
    return vectorLayer;
  }

  function addLayer(layer: TerritoryOpenLayersLayer): void {
    lifecycle.target?.addLayer(layer);
    activeLayer = layer;
  }

  function removeActiveLayer(): void {
    if (!activeLayer) {
      return;
    }

    lifecycle.target?.removeLayer(activeLayer);
    activeLayer = undefined;
  }

  function bindMapEvents(map: TerritoryOpenLayersMap): void {
    listenerKeys = [
      map.on?.("click", clickListener),
      map.on?.("pointermove", hoverListener)
    ].filter((key) => key !== undefined);
  }

  function unbindMapEvents(map: TerritoryOpenLayersMap): void {
    if (options.unByKey) {
      for (const key of listenerKeys) {
        options.unByKey(key);
      }
    } else {
      map.un?.("click", clickListener);
      map.un?.("pointermove", hoverListener);
    }

    listenerKeys = [];
  }

  function readProjectionFromMap(map: TerritoryOpenLayersMap): string | undefined {
    const projection = map.getView?.()?.getProjection?.();

    if (typeof projection === "string") {
      return projection;
    }

    return projection?.getCode?.();
  }

  function readFeatureState(territoryId: string): TerritoryOpenLayersState {
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

  function resolveFeatureStyle(feature: TerritoryOpenLayersFeature): unknown {
    const territoryId = readOpenLayersFeatureTerritoryId(feature);
    const state = territoryId ? readFeatureState(territoryId) : {};

    if (options.style) {
      return options.style(feature, state);
    }

    return {
      fillColor: state.selected
        ? (theme.selectedFillColor ?? "#f97316")
        : state.hover
          ? (theme.hoverFillColor ?? "#fbbf24")
          : (theme.fillColor ?? "#1f8a70"),
      fillOpacity: theme.fillOpacity ?? 0.35,
      lineColor: theme.lineColor ?? "#0f172a",
      lineWidth: theme.lineWidth ?? 1.25
    };
  }

  function restyle(): void {
    vectorLayer?.setStyle?.((feature: TerritoryOpenLayersFeature) => resolveFeatureStyle(feature));
    vectorLayer?.changed?.();
  }

  function addGeoJsonData(
    collection: FeatureCollection,
    context?: TerritoryAdapterOperationContext
  ): void {
    const targetMap = lifecycle.target;
    const viewProjection = targetMap ? readProjectionFromMap(targetMap) : undefined;
    const featureProjection = options.featureProjection ?? viewProjection;
    assertOpenLayersProjectionCompatible({
      dataProjection,
      ...(featureProjection ? { featureProjection } : {}),
      ...(viewProjection ? { viewProjection } : {})
    });
    const features = format.readFeatures(collection, {
      dataProjection,
      ...(featureProjection ? { featureProjection } : {})
    });

    if (context?.signal?.aborted) {
      return;
    }

    const source = ensureVectorSource();
    source.clear(true);
    source.addFeatures(features);

    for (const feature of features) {
      const id = readOpenLayersFeatureTerritoryId(feature);

      if (id) {
        feature.set?.("territoryId", id);
      }
    }

    if (activeLayer !== vectorLayer) {
      removeActiveLayer();
      addLayer(ensureVectorLayer());
    }

    restyle();
  }

  function dispatchTerritoryEvent(
    event: unknown,
    callback: ((event: TerritoryOpenLayersTerritoryEvent) => void) | undefined
  ): void {
    if (!callback) {
      return;
    }

    const feature = pickFeature(event);
    const territoryId = readOpenLayersFeatureTerritoryId(feature);

    if (!feature || !territoryId) {
      return;
    }

    callback({
      territoryId,
      feature,
      originalEvent: event
    });
  }

  function pickFeature(event: unknown): TerritoryOpenLayersFeature | undefined {
    const eventFeature = readFirstTerritoryRenderFeature(event);

    if (isOpenLayersFeature(eventFeature)) {
      return eventFeature;
    }

    const map = lifecycle.target;
    const pixel = isRecord(event) ? event.pixel : undefined;

    if (!map?.forEachFeatureAtPixel || pixel === undefined) {
      return undefined;
    }

    const picked = map.forEachFeatureAtPixel(
      pixel,
      (feature) => feature,
      activeLayer ? { layerFilter: (layer) => layer === activeLayer } : undefined
    );

    return isOpenLayersFeature(picked) ? picked : undefined;
  }

  const adapter: TerritoryOpenLayersAdapter = {
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
      const viewProjection = readProjectionFromMap(map);
      assertOpenLayersProjectionCompatible({
        dataProjection,
        ...(options.featureProjection ? { featureProjection: options.featureProjection } : {}),
        ...(viewProjection ? { viewProjection } : {})
      });
      addGeoJsonData(zonesToOpenLayersFeatureCollection(zones, stateByZoneId));
      bindMapEvents(map);
    },

    detach() {
      const map = lifecycle.target;

      if (map) {
        unbindMapEvents(map);
      }

      removeActiveLayer();
      lifecycle.detach();
    },

    dispose() {
      const map = lifecycle.target;

      if (map) {
        unbindMapEvents(map);
      }

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
          "OpenLayers source id does not match the configured adapter source id.",
          { details: { configuredSourceId: sourceId, sourceId: source.id } }
        );
      }

      if (source.type === "vector-tiles") {
        assertTerritoryAdapterCapability(capabilities, "vectorTiles", "set vector tile source");

        if (!options.createVectorTileSource || !options.createVectorTileLayer) {
          throw new TerritoryError(
            "CAPABILITY_UNSUPPORTED",
            "OpenLayers vector tile support requires createVectorTileSource and createVectorTileLayer.",
            { details: { sourceId } }
          );
        }

        const vectorTileSource = options.createVectorTileSource(source, context);

        if (context?.signal?.aborted) {
          return;
        }

        const layer = options.createVectorTileLayer(vectorTileSource, source);
        removeActiveLayer();
        addLayer(layer);
        return;
      }

      if (source.type !== "geojson") {
        throw new TerritoryError(
          "RUNTIME_CONFIGURATION_INVALID",
          "OpenLayers source type is invalid.",
          { details: { sourceId: source.id, sourceType: source.type } }
        );
      }

      assertTerritoryAdapterCapability(capabilities, "geoJson", "set GeoJSON source");

      if (!isTerritoryFeatureCollection(source.data)) {
        throw new TerritoryError(
          "RUNTIME_CONFIGURATION_INVALID",
          "OpenLayers source replacement requires a GeoJSON FeatureCollection.",
          { details: { sourceId: source.id, sourceType: source.type } }
        );
      }

      assertOpenLayersSourceCrsCompatible(source, dataProjection);
      addGeoJsonData(source.data, context);
    },

    updateState(state) {
      assertTerritoryAdapterAttached(lifecycle.lifecycleState, "update state");
      renderState = state;

      for (const feature of vectorSource?.getFeatures?.() ?? []) {
        const territoryId = readOpenLayersFeatureTerritoryId(feature);

        if (!territoryId) {
          continue;
        }

        const stateValue = readFeatureState(territoryId);
        feature.set?.("selected", stateValue.selected === true);
        feature.set?.("hover", stateValue.hover === true);
      }

      restyle();
    },

    updateData(nextZones, nextStateByZoneId = stateByZoneId) {
      zones = [...nextZones];
      stateByZoneId = nextStateByZoneId;
      addGeoJsonData(zonesToOpenLayersFeatureCollection(zones, stateByZoneId));
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

export const createOpenLayersTerritoryAdapter = createTerritoryOpenLayersAdapter;

export async function createTerritoryOpenLayersSource(
  options: TerritoryOpenLayersRegistrySourceOptions
): Promise<TerritoryOpenLayersRegistrySourceBundle> {
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
    ...(artifact.format ? { format: artifact.format } : {}),
    ...(typeof artifact.layer === "string" ? { sourceLayer: artifact.layer } : {})
  };

  if (artifact.format === "geojson") {
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

async function resolveRegistryTerritorySource(
  options: TerritoryOpenLayersRegistrySourceOptions,
  formatPreference: readonly ["mvt" | "geojson", ...Array<"mvt" | "geojson">]
): Promise<TerritoryOpenLayersResolvedRegistrySource> {
  if (!options.country || !options.level || !options.registry.resolveTerritoryArtifact) {
    throw new Error(
      "OpenLayers country-level source resolution requires country, level, and registry support."
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
  options: TerritoryOpenLayersRegistrySourceOptions,
  formatPreference: readonly ["mvt" | "geojson", ...Array<"mvt" | "geojson">]
): Promise<TerritoryOpenLayersResolvedRegistrySource> {
  if (!options.datasetId) {
    throw new Error(
      "OpenLayers registry source resolution requires datasetId or country and level."
    );
  }

  return options.registry.resolveArtifact({
    datasetId: options.datasetId,
    purpose: "render",
    ...(options.levels ? { levels: options.levels } : {}),
    formatPreference
  });
}

interface TerritoryOpenLayersResolvedRegistrySource {
  artifact: unknown;
  url: string;
  requestedLevel?: TerritoryAdminLevel;
  resolvedLevel?: TerritoryAdminLevel;
  exactMatch?: boolean;
  reason?: string;
  coverageStatus?: TerritoryCoverageStatus;
}

function requireGeoJsonFormat(
  format: TerritoryOpenLayersGeoJsonFormat | undefined
): TerritoryOpenLayersGeoJsonFormat {
  if (!format) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      "OpenLayers adapter requires geoJsonFormat."
    );
  }

  return format;
}

function readOpenLayersFeatureTerritoryId(
  feature: TerritoryOpenLayersFeature | Feature | undefined
): string | undefined {
  if (!feature) {
    return undefined;
  }

  if (isOpenLayersFeature(feature)) {
    const territoryId = feature.get?.("territoryId");

    if (typeof territoryId === "string" || typeof territoryId === "number") {
      return String(territoryId);
    }

    const id = feature.getId?.() ?? feature.get?.("id");

    if (typeof id === "string" || typeof id === "number") {
      return String(id);
    }
  }

  return readTerritoryFeatureId(feature);
}

function assertOpenLayersSourceCrsCompatible(
  source: TerritoryRenderSource,
  dataProjection: string
): void {
  const crs = isRecord(source.metadata)
    ? (source.metadata.crs ?? source.metadata.dataProjection)
    : undefined;

  if (typeof crs !== "string" || normalizeProjection(crs) === normalizeProjection(dataProjection)) {
    return;
  }

  throw new TerritoryError(
    "RUNTIME_CONFIGURATION_INVALID",
    "OpenLayers source CRS does not match the configured dataProjection.",
    {
      details: {
        sourceId: source.id,
        sourceCrs: crs,
        dataProjection
      }
    }
  );
}

function isOpenLayersFeature(input: unknown): input is TerritoryOpenLayersFeature {
  return isRecord(input) && (typeof input.get === "function" || typeof input.getId === "function");
}

function defaultFormatPreferenceForLevel(
  level: TerritoryAdminLevel | undefined
): readonly ["mvt" | "geojson", ...Array<"mvt" | "geojson">] {
  return !level || getAdminLevelDepth(level) >= 3 ? ["mvt", "geojson"] : ["geojson", "mvt"];
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

function normalizeProjection(value: string): string {
  return value.trim().toUpperCase();
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
