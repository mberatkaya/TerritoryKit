import "ol/ol.css";
import type Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import Map from "ol/Map.js";
import View from "ol/View.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import OSM from "ol/source/OSM.js";
import VectorSource from "ol/source/Vector.js";
import { Fill, Stroke, Style } from "ol/style.js";
import { fromLonLat, transformExtent } from "ol/proj.js";
import { createTurkeyAdm3DemoDataset } from "@territory-kit/shared-testkit";
import { createTerritoryRegistryClient } from "@territory-kit/registry";
import { createTerritoryRuntime } from "@territory-kit/runtime";
import { createTerritoryOpenLayersAdapter } from "@territory-kit/openlayers";
import type { TerritoryRuntimeViewport } from "@territory-kit/runtime";
import type {
  TerritoryOpenLayersFeature,
  TerritoryOpenLayersLayer,
  TerritoryOpenLayersSource
} from "@territory-kit/openlayers";

interface TerritoryKitOpenLayersDemoProbe {
  ready: boolean;
  disposed: boolean;
  fallbackStatus: string;
  lastError: string | undefined;
  lastZoneCount: number;
  renderedLevel: string;
  selectedTerritoryId: string | undefined;
  dispose(): boolean;
  setZoom(zoom: number): Promise<{ renderedLevel: string; zoneCount: number }>;
}

declare global {
  interface Window {
    __territoryKitOpenLayersDemo?: TerritoryKitOpenLayersDemoProbe;
  }
}

installOpenLayersDemoStyles();

const registryUrl = import.meta.env.VITE_TERRITORY_REGISTRY_URL as string | undefined;
const registryDatasetId =
  (import.meta.env.VITE_TERRITORY_DATASET_ID as string | undefined) ?? "territory-kit-tr";
const app = document.querySelector<HTMLDivElement>("#app");

if (app) {
  app.innerHTML = `
    <main class="app-shell">
      <aside class="panel">
        <div class="brand">TerritoryKit OpenLayers</div>
        <dl class="meta">
          <div><dt>Source</dt><dd>${registryUrl ? "Registry" : "Fixture"}</dd></div>
          <div><dt>Rendered</dt><dd id="rendered-level">Waiting</dd></div>
          <div><dt>Fallback</dt><dd id="fallback-status">Unknown</dd></div>
        </dl>
        <section class="selection" id="selection">
          <span>No territory selected</span>
        </section>
      </aside>
      <section class="map-wrap">
        <div id="map"></div>
        <div id="status" class="status">Loading</div>
      </section>
    </main>
  `;

  const status = document.querySelector<HTMLDivElement>("#status");
  const renderedLevel = document.querySelector<HTMLElement>("#rendered-level");
  const fallbackStatus = document.querySelector<HTMLElement>("#fallback-status");
  const selection = document.querySelector<HTMLElement>("#selection");
  const vectorSource = new VectorSource<Feature>();
  const vectorLayer = new VectorLayer({
    source: vectorSource
  });
  const map = new Map({
    target: "map",
    layers: [
      new TileLayer({
        source: new OSM()
      })
    ],
    view: new View({
      center: fromLonLat([28.97, 41.03]),
      zoom: 5
    })
  });
  const adapter = createTerritoryOpenLayersAdapter({
    geoJsonFormat: new GeoJSON(),
    vectorSource: vectorSource as unknown as TerritoryOpenLayersSource,
    vectorLayer: vectorLayer as unknown as TerritoryOpenLayersLayer,
    featureProjection: "EPSG:3857",
    sourceId: "territory-kit-zones",
    style(feature, state) {
      return new Style({
        fill: new Fill({
          color: state.selected
            ? "rgba(249, 115, 22, 0.54)"
            : state.hover
              ? "rgba(251, 191, 36, 0.48)"
              : "rgba(37, 99, 235, 0.34)"
        }),
        stroke: new Stroke({
          color: state.hover ? "#111827" : "#334155",
          width: state.hover ? 2 : 1
        })
      });
    },
    onTerritoryClick(event) {
      selection?.replaceChildren(renderSelection(event.feature));
      adapter.updateState({ selectedTerritoryIds: [event.territoryId] });
      demoProbe.selectedTerritoryId = event.territoryId;
    },
    onTerritoryHover(event) {
      adapter.updateState({ hoverTerritoryId: event.territoryId });
    }
  });

  adapter.attach(map);

  const runtime = createTerritoryRuntime({
    adapter,
    adapterSourceId: "territory-kit-zones",
    ...(registryUrl
      ? {
          registry: createTerritoryRegistryClient({ registryUrl }),
          datasetId: registryDatasetId
        }
      : {
          dataset: createTurkeyAdm3DemoDataset()
        })
  });
  const demoProbe: TerritoryKitOpenLayersDemoProbe = {
    ready: false,
    disposed: false,
    fallbackStatus: "Unknown",
    lastError: undefined,
    lastZoneCount: 0,
    renderedLevel: "Waiting",
    selectedTerritoryId: undefined,
    dispose() {
      runtime.dispose();
      adapter.dispose();
      map.setTarget(undefined);
      demoProbe.disposed = true;
      return adapter.lifecycleState === "disposed";
    },
    async setZoom(zoom) {
      if (map.getView().getZoom() !== zoom) {
        const settled = waitForOpenLayersEvent(map, "moveend");
        map.getView().setZoom(zoom);
        await settled;
      }

      await refreshViewport("probe");
      return {
        renderedLevel: demoProbe.renderedLevel,
        zoneCount: demoProbe.lastZoneCount
      };
    }
  };

  window.__territoryKitOpenLayersDemo = demoProbe;

  async function refreshViewport(reason: string): Promise<void> {
    try {
      const result = await runtime.setViewport(readRuntimeViewport(map), {
        reason,
        debounceMs: reason === "move" ? 120 : 0
      });

      if (!result?.summary) {
        return;
      }

      const nextRenderedLevel = `ADM${result.summary.level}`;
      const nextFallbackStatus = registryUrl ? "Registry coverage dependent" : "Fixture partial";

      demoProbe.ready = true;
      demoProbe.lastError = undefined;
      demoProbe.lastZoneCount = result.summary.zoneCount;
      demoProbe.renderedLevel = nextRenderedLevel;
      demoProbe.fallbackStatus = nextFallbackStatus;

      if (status) {
        status.textContent = `${result.summary.zoneCount} visible territories`;
      }

      if (renderedLevel) {
        renderedLevel.textContent = nextRenderedLevel;
      }

      if (fallbackStatus) {
        fallbackStatus.textContent = nextFallbackStatus;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown runtime error";
      demoProbe.lastError = message;

      if (status) {
        status.textContent = message;
      }

      throw error;
    }
  }

  map.on("moveend", () => {
    void refreshViewport("move");
  });

  void refreshViewport("initial");

  window.addEventListener("beforeunload", () => {
    runtime.dispose();
    adapter.dispose();
    map.setTarget(undefined);
  });
}

function readRuntimeViewport(map: Map): TerritoryRuntimeViewport {
  const view = map.getView();
  const zoom = view.getZoom() ?? 5;
  const extent = transformExtent(view.calculateExtent(map.getSize()), "EPSG:3857", "EPSG:4326");
  const [west = 0, south = 0, east = 0, north = 0] = extent;

  return {
    bounds: {
      west,
      south,
      east,
      north
    },
    zoom,
    level: zoom < 6 ? 1 : zoom < 10 ? 2 : 3
  };
}

function renderSelection(feature: TerritoryOpenLayersFeature | undefined): HTMLElement {
  const container = document.createElement("dl");
  const entries: Array<readonly [string, unknown]> = [
    ["ID", feature?.get?.("territoryId") ?? feature?.getId?.()],
    ["Name", feature?.get?.("name")],
    ["Level", feature?.get?.("adminLevel") ?? feature?.get?.("level")],
    ["Parent", feature?.get?.("parentId") ?? "None"]
  ];

  container.className = "selection-grid";

  for (const [label, value] of entries) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = String(value ?? "Unknown");
    row.append(term, detail);
    container.append(row);
  }

  return container;
}

function waitForOpenLayersEvent(map: Map, type: "moveend"): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(), 350);

    map.once(type, () => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

function installOpenLayersDemoStyles(): void {
  if (document.querySelector('style[data-territory-kit-demo="openlayers"]')) {
    return;
  }

  const style = document.createElement("style");
  style.dataset.territoryKitDemo = "openlayers";
  style.textContent = `
  html,
  body,
  #app {
    height: 100%;
    margin: 0;
  }

  body {
    color: #172033;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .app-shell {
    display: grid;
    grid-template-columns: minmax(250px, 310px) 1fr;
    height: 100%;
  }

  .panel {
    background: #ffffff;
    border-right: 1px solid #d4d4d8;
    display: grid;
    gap: 14px;
    grid-auto-rows: max-content;
    padding: 18px;
    z-index: 1;
  }

  .brand {
    font-size: 18px;
    font-weight: 700;
  }

  .meta,
  .selection-grid {
    display: grid;
    gap: 8px;
    margin: 0;
  }

  .meta div,
  .selection-grid div {
    display: grid;
    gap: 4px;
  }

  dt {
    color: #5b6472;
    font-size: 12px;
  }

  dd {
    font-weight: 700;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .selection {
    border-top: 1px solid #e4e4e7;
    overflow-wrap: anywhere;
    padding-top: 14px;
  }

  .map-wrap {
    height: 100%;
    min-width: 0;
    position: relative;
  }

  #map {
    height: 100%;
    min-height: 360px;
  }

  .status {
    background: #ffffff;
    border: 1px solid #d4d4d8;
    border-radius: 6px;
    bottom: 16px;
    font-size: 13px;
    left: 16px;
    padding: 8px 10px;
    position: absolute;
  }

  @media (max-width: 760px) {
    .app-shell {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }

    .panel {
      border-bottom: 1px solid #d4d4d8;
      border-right: 0;
    }
  }
`;
  document.head.append(style);
}
