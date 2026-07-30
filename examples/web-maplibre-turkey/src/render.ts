import type {
  LayerSpecification,
  MapGeoJSONFeature,
  MapLayerMouseEvent,
  Map as MapLibreMap,
  SourceSpecification,
  StyleSpecification
} from "maplibre-gl";
import { territoryZonesToFeatureCollection } from "@territory-kit/adapter-core";
import {
  setTerritoryMapLibreHoverState,
  setTerritoryMapLibreSelectedState,
  type TerritoryMapLibreMap
} from "@territory-kit/maplibre";
import type { TerritoryRegistryClient } from "@territory-kit/registry";
import type { TerritoryQueryService } from "./types.js";
import type {
  DemoAdminLevel,
  RegistryRenderResolution,
  RenderRequest,
  RenderTelemetry
} from "./types.js";

const SOURCE_ID = "turkey-live-render";
const FILL_LAYER_ID = "turkey-live-fill";
const LINE_LAYER_ID = "turkey-live-line";
const DEFAULT_SOURCE_LAYER = "territory";

interface RenderCallbacks {
  onTerritoryClick(event: RenderTerritoryEvent): void;
  onTerritoryHover(event: RenderTerritoryEvent): void;
  onTerritoryLeave(): void;
}

export interface RenderTerritoryEvent {
  territoryId: string;
  level?: DemoAdminLevel;
  feature: MapGeoJSONFeature;
  originalEvent: MapLayerMouseEvent;
}

interface RegistryRenderPlan {
  sourceSpec: SourceSpecification;
  sourceLayer?: string;
  telemetry: RenderTelemetry;
}

interface RenderManifest {
  format?: "mvt" | "geojson";
  tileTemplate?: string;
  layers?: ReadonlyArray<{
    id?: string;
    adminLevels?: readonly string[];
    featureCount?: number;
    minZoom?: number;
    maxZoom?: number;
  }>;
  featureCounts?: Record<string, number>;
}

export interface TurkeyMapRenderService {
  readonly sourceId: string;
  readonly fillLayerId: string;
  readonly lineLayerId: string;
  bindInteractions(callbacks: RenderCallbacks): void;
  render(request: RenderRequest): Promise<RenderTelemetry | undefined>;
  setSelected(territoryId: string, selected: boolean): void;
  setHover(territoryId: string, hover: boolean): void;
  readDisplayedFeatureCount(): number;
  dispose(): void;
}

export function createDefaultMapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": "#eef3ef"
        }
      }
    ]
  };
}

export function createTurkeyMapRenderService(input: {
  map: MapLibreMap;
  mode: "fixture" | "registry";
  query: TerritoryQueryService;
  registry?: TerritoryRegistryClient;
  datasetVersion: string;
  allowPrerelease: boolean;
}): TurkeyMapRenderService {
  const registryPlanCache = new Map<string, RegistryRenderPlan>();
  let activeController: AbortController | undefined;
  let currentSourceLayer: string | undefined;
  let callbacks: RenderCallbacks | undefined;
  let interactionBound = false;
  let hoveredTerritoryId: string | undefined;

  const clickListener = (event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0];
    const territoryId = readFeatureTerritoryId(feature);

    if (!feature || !territoryId) {
      return;
    }

    const level = readFeatureLevel(feature);
    callbacks?.onTerritoryClick({
      territoryId,
      ...(level ? { level } : {}),
      feature,
      originalEvent: event
    });
  };
  const hoverListener = (event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0];
    const territoryId = readFeatureTerritoryId(feature);

    if (!feature || !territoryId) {
      return;
    }

    if (hoveredTerritoryId && hoveredTerritoryId !== territoryId) {
      setHover(hoveredTerritoryId, false);
    }

    hoveredTerritoryId = territoryId;
    setHover(territoryId, true);
    const level = readFeatureLevel(feature);
    callbacks?.onTerritoryHover({
      territoryId,
      ...(level ? { level } : {}),
      feature,
      originalEvent: event
    });
  };
  const leaveListener = (): void => {
    if (hoveredTerritoryId) {
      setHover(hoveredTerritoryId, false);
      hoveredTerritoryId = undefined;
    }

    callbacks?.onTerritoryLeave();
  };

  function bindInteractions(nextCallbacks: RenderCallbacks): void {
    callbacks = nextCallbacks;

    if (input.map.getLayer(FILL_LAYER_ID) && !interactionBound) {
      input.map.on("click", FILL_LAYER_ID, clickListener);
      input.map.on("mousemove", FILL_LAYER_ID, hoverListener);
      input.map.on("mouseleave", FILL_LAYER_ID, leaveListener);
      interactionBound = true;
    }
  }

  function unbindInteractions(): void {
    if (!interactionBound) {
      return;
    }

    input.map.off("click", FILL_LAYER_ID, clickListener);
    input.map.off("mousemove", FILL_LAYER_ID, hoverListener);
    input.map.off("mouseleave", FILL_LAYER_ID, leaveListener);
    interactionBound = false;
  }

  function replaceSource(sourceSpec: SourceSpecification, sourceLayer: string | undefined): void {
    unbindInteractions();

    for (const layerId of [LINE_LAYER_ID, FILL_LAYER_ID]) {
      if (input.map.getLayer(layerId)) {
        input.map.removeLayer(layerId);
      }
    }

    if (input.map.getSource(SOURCE_ID)) {
      input.map.removeSource(SOURCE_ID);
    }

    input.map.addSource(SOURCE_ID, sourceSpec);
    currentSourceLayer = sourceLayer;

    for (const layer of createLayers(sourceLayer)) {
      input.map.addLayer(layer);
    }

    if (callbacks) {
      bindInteractions(callbacks);
    }
  }

  async function render(request: RenderRequest): Promise<RenderTelemetry | undefined> {
    activeController?.abort();
    activeController = new AbortController();
    const controller = activeController;
    const signal = linkSignals(controller, request.signal);
    const startedAt = performance.now();

    try {
      const plan =
        input.mode === "registry" && input.registry
          ? await createRegistryRenderPlan({
              registry: input.registry,
              cache: registryPlanCache,
              level: request.level,
              datasetVersion: input.datasetVersion,
              allowPrerelease: input.allowPrerelease,
              signal,
              ...(request.adm3ParentId ? { adm3ParentId: request.adm3ParentId } : {})
            })
          : createFixtureRenderPlan(input.query, request.level, request.adm3ParentId);

      assertNotAborted(signal);
      replaceSource(plan.sourceSpec, plan.sourceLayer);

      return {
        ...plan.telemetry,
        loadMs: Math.round(performance.now() - startedAt)
      };
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        return undefined;
      }

      throw error;
    }
  }

  function setSelected(territoryId: string, selected: boolean): void {
    setTerritoryMapLibreSelectedState(input.map as unknown as TerritoryMapLibreMap, {
      sourceId: SOURCE_ID,
      territoryId,
      ...(currentSourceLayer ? { sourceLayer: currentSourceLayer } : {}),
      selected
    });
  }

  function setHover(territoryId: string, hover: boolean): void {
    setTerritoryMapLibreHoverState(input.map as unknown as TerritoryMapLibreMap, {
      sourceId: SOURCE_ID,
      territoryId,
      ...(currentSourceLayer ? { sourceLayer: currentSourceLayer } : {}),
      hover
    });
  }

  return {
    sourceId: SOURCE_ID,
    fillLayerId: FILL_LAYER_ID,
    lineLayerId: LINE_LAYER_ID,
    bindInteractions,
    render,
    setSelected,
    setHover,
    readDisplayedFeatureCount() {
      if (!input.map.getLayer(FILL_LAYER_ID)) {
        return 0;
      }

      return input.map.queryRenderedFeatures(undefined, { layers: [FILL_LAYER_ID] }).length;
    },
    dispose() {
      activeController?.abort();
      unbindInteractions();
    }
  };
}

function createFixtureRenderPlan(
  query: TerritoryQueryService,
  level: DemoAdminLevel,
  adm3ParentId: string | undefined
): RegistryRenderPlan {
  const dataset = query.getRenderDataset(level, adm3ParentId);
  const data = territoryZonesToFeatureCollection(dataset.zones);

  return {
    sourceSpec: {
      type: "geojson",
      data,
      promoteId: "territoryId"
    } as SourceSpecification,
    telemetry: {
      cacheHit: true,
      displayedFeatureCount: dataset.zones.length,
      loadMs: 0,
      renderArtifactFormat: "fixture-geojson",
      requestedLevel: level,
      renderedLevel: level,
      exactMatch: true,
      coverageStatus: level === "ADM3" ? "partial" : "fixture",
      ...(level === "ADM3" ? { fallbackReason: "fixture-partial-adm3" } : {})
    }
  };
}

async function createRegistryRenderPlan(input: {
  registry: TerritoryRegistryClient;
  cache: Map<string, RegistryRenderPlan>;
  level: DemoAdminLevel;
  adm3ParentId?: string;
  datasetVersion: string;
  allowPrerelease: boolean;
  signal: AbortSignal;
}): Promise<RegistryRenderPlan> {
  const key = `${input.level}:${input.adm3ParentId ?? "*"}:${input.datasetVersion}`;
  const cached = input.cache.get(key);

  if (cached) {
    return {
      ...cached,
      telemetry: { ...cached.telemetry, cacheHit: true }
    };
  }

  const resolved = await resolveRegistryRender(input);
  const sourceLayer = readString(resolved.artifact.layer) ?? DEFAULT_SOURCE_LAYER;
  const artifactFormat = resolved.artifact.format === "geojson" ? "geojson" : "mvt";
  const manifest =
    artifactFormat === "mvt" ? await fetchRenderManifest(resolved.url, input.signal) : undefined;
  const tileTemplate =
    artifactFormat === "mvt"
      ? (readString(resolved.artifact.tileUrlTemplate) ??
        manifest?.tileTemplate ??
        "tiles/{z}/{x}/{y}.mvt")
      : undefined;
  const sourceSpec =
    artifactFormat === "geojson"
      ? ({
          type: "geojson",
          data: resolved.url,
          promoteId: "territoryId"
        } as SourceSpecification)
      : ({
          type: "vector",
          tiles: [resolveRelativeUrl(tileTemplate ?? "tiles/{z}/{x}/{y}.mvt", resolved.url)],
          promoteId: "territoryId"
        } as SourceSpecification);
  const featureCount =
    readFeatureCount(manifest, resolved.renderedLevel) ??
    readNumber(resolved.artifact.featureCount) ??
    0;
  const plan: RegistryRenderPlan = {
    sourceSpec,
    ...(artifactFormat === "mvt" ? { sourceLayer } : {}),
    telemetry: {
      cacheHit: false,
      displayedFeatureCount: featureCount,
      loadMs: 0,
      renderArtifactFormat: artifactFormat,
      requestedLevel: resolved.requestedLevel,
      renderedLevel: resolved.renderedLevel,
      exactMatch: resolved.exactMatch,
      coverageStatus: resolved.coverageStatus,
      ...(resolved.fallbackReason ? { fallbackReason: resolved.fallbackReason } : {}),
      ...(resolved.artifact.cacheControl
        ? { tileCacheHint: String(resolved.artifact.cacheControl) }
        : {}),
      ...(artifactFormat === "mvt" ? { renderManifestUrl: resolved.url } : {}),
      ...(tileTemplate ? { renderTileTemplate: tileTemplate } : {})
    }
  };

  input.cache.set(key, plan);
  return plan;
}

async function resolveRegistryRender(input: {
  registry: TerritoryRegistryClient;
  level: DemoAdminLevel;
  adm3ParentId?: string;
  datasetVersion: string;
  allowPrerelease: boolean;
}): Promise<RegistryRenderResolution> {
  const resolved = await input.registry.resolveDeepestAvailableTerritoryArtifact({
    country: "TR",
    requestedLevel: input.level,
    purpose: "render",
    fallback: "deepest-available",
    version: input.datasetVersion,
    allowPrerelease: input.allowPrerelease,
    formatPreference: ["mvt", "geojson"],
    ...(input.adm3ParentId ? { parentId: input.adm3ParentId } : {})
  });

  return {
    dataset: resolved.dataset,
    artifact: resolved.artifact,
    registryHash: resolved.registryHash,
    requestedLevel: input.level,
    renderedLevel: resolved.resolvedLevel,
    exactMatch: resolved.exactMatch,
    coverageStatus: resolved.coverageStatus,
    ...(resolved.reason !== "exact-match" ? { fallbackReason: resolved.reason } : {}),
    url: resolved.url
  };
}

function createLayers(sourceLayer: string | undefined): LayerSpecification[] {
  const sourceLayerSpec = sourceLayer ? { "source-layer": sourceLayer } : {};

  return [
    {
      id: FILL_LAYER_ID,
      type: "fill",
      source: SOURCE_ID,
      ...sourceLayerSpec,
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "#e11d48",
          ["boolean", ["feature-state", "hover"], false],
          "#f59e0b",
          [
            "match",
            ["coalesce", ["get", "adminLevel"], ["concat", "ADM", ["to-string", ["get", "level"]]]],
            "ADM1",
            "#146c94",
            "ADM2",
            "#2f7d32",
            "ADM3",
            "#9a5b00",
            "#4b5563"
          ]
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          0.72,
          ["boolean", ["feature-state", "hover"], false],
          0.54,
          0.38
        ]
      }
    },
    {
      id: LINE_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      ...sourceLayerSpec,
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "#7f1d1d",
          "#172033"
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          2.6,
          ["boolean", ["feature-state", "hover"], false],
          2,
          1
        ]
      }
    }
  ] as LayerSpecification[];
}

async function fetchRenderManifest(url: string, signal: AbortSignal): Promise<RenderManifest> {
  assertNotAborted(signal);
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Render manifest failed: HTTP ${response.status} for ${url}`);
  }

  return (await response.json()) as RenderManifest;
}

function readFeatureCount(manifest: RenderManifest | undefined, level: string): number | undefined {
  const direct = manifest?.featureCounts?.[level];

  if (typeof direct === "number") {
    return direct;
  }

  const layerCounts = manifest?.layers
    ?.filter((layer) => !layer.adminLevels || layer.adminLevels.includes(level))
    .map((layer) => layer.featureCount ?? 0);

  return layerCounts && layerCounts.length > 0
    ? layerCounts.reduce((total, count) => total + count, 0)
    : undefined;
}

function readFeatureTerritoryId(feature: MapGeoJSONFeature | undefined): string | undefined {
  const territoryId = feature?.properties?.territoryId ?? feature?.properties?.id ?? feature?.id;

  return typeof territoryId === "string" || typeof territoryId === "number"
    ? String(territoryId)
    : undefined;
}

function readFeatureLevel(feature: MapGeoJSONFeature): DemoAdminLevel | undefined {
  const adminLevel = feature.properties?.adminLevel;

  if (adminLevel === "ADM1" || adminLevel === "ADM2" || adminLevel === "ADM3") {
    return adminLevel;
  }

  const level = feature.properties?.level;

  if (level === 1 || level === "1") {
    return "ADM1";
  }

  if (level === 2 || level === "2") {
    return "ADM2";
  }

  if (level === 3 || level === "3") {
    return "ADM3";
  }

  return undefined;
}

function resolveRelativeUrl(template: string, manifestUrl: string): string {
  try {
    return new URL(template, manifestUrl).href;
  } catch {
    return template;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function linkSignals(
  controller: AbortController,
  parentSignal: AbortSignal | undefined
): AbortSignal {
  if (!parentSignal) {
    return controller.signal;
  }

  if (parentSignal.aborted) {
    controller.abort();
    return controller.signal;
  }

  parentSignal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller.signal;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Render request was cancelled.", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
