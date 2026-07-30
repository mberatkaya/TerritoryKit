import "leaflet/dist/leaflet.css";
import * as L from "leaflet";
import { createTurkeyAdm3DemoDataset } from "@territory-kit/shared-testkit";
import { createTerritoryRegistryClient } from "@territory-kit/registry";
import { createTerritoryRuntime } from "@territory-kit/runtime";
import { createTerritoryLeafletAdapter } from "@territory-kit/leaflet";
import type { TerritoryRuntimeViewport } from "@territory-kit/runtime";

interface TerritoryKitLeafletDemoProbe {
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
    __territoryKitLeafletDemo?: TerritoryKitLeafletDemoProbe;
  }
}

installLeafletDemoStyles();

const registryUrl = import.meta.env.VITE_TERRITORY_REGISTRY_URL as string | undefined;
const registryDatasetId =
  (import.meta.env.VITE_TERRITORY_DATASET_ID as string | undefined) ?? "territory-kit-tr";
const app = document.querySelector<HTMLDivElement>("#app");

if (app) {
  app.innerHTML = `
    <main class="app-shell">
      <aside class="panel">
        <div class="brand">TerritoryKit Leaflet</div>
        <dl class="meta">
          <div><dt>Source</dt><dd id="source-kind">${registryUrl ? "Registry" : "Fixture"}</dd></div>
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
  const map = L.map("map", {
    center: [41.03, 28.97],
    zoom: 5,
    zoomControl: true
  });

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const adapter = createTerritoryLeafletAdapter({
    leaflet: L,
    sourceId: "territory-kit-zones",
    zones: [],
    style: (_feature, state) => ({
      color: state.hover ? "#111827" : "#334155",
      fillColor: state.selected ? "#f97316" : state.hover ? "#fbbf24" : "#2563eb",
      fillOpacity: state.selected ? 0.54 : 0.34,
      weight: state.hover ? 2 : 1
    }),
    onTerritoryClick(event) {
      selection?.replaceChildren(renderSelection(event.feature?.properties ?? {}));
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
  const demoProbe: TerritoryKitLeafletDemoProbe = {
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
      demoProbe.disposed = true;
      return adapter.lifecycleState === "disposed";
    },
    async setZoom(zoom) {
      if (map.getZoom() !== zoom) {
        const settled = waitForLeafletEvent(map, "moveend");
        map.setZoom(zoom);
        await settled;
      }

      await refreshViewport("probe");
      return {
        renderedLevel: demoProbe.renderedLevel,
        zoneCount: demoProbe.lastZoneCount
      };
    }
  };

  window.__territoryKitLeafletDemo = demoProbe;

  async function refreshViewport(reason: string): Promise<void> {
    try {
      const result = await runtime.setViewport(readLeafletViewport(map), {
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

  map.on("moveend zoomend", () => {
    void refreshViewport("move");
  });

  void refreshViewport("initial");

  window.addEventListener("beforeunload", () => {
    runtime.dispose();
    adapter.dispose();
  });
}

function readLeafletViewport(map: L.Map): TerritoryRuntimeViewport {
  const bounds = map.getBounds();
  const zoom = map.getZoom();

  return {
    bounds: {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth()
    },
    zoom,
    level: zoom < 6 ? 1 : zoom < 10 ? 2 : 3
  };
}

function renderSelection(properties: Record<string, unknown>): HTMLElement {
  const container = document.createElement("dl");
  const entries: Array<readonly [string, unknown]> = [
    ["ID", properties.territoryId ?? properties.id],
    ["Name", properties.name],
    ["Level", properties.adminLevel ?? properties.level],
    ["Parent", properties.parentId ?? "None"]
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

function waitForLeafletEvent(map: L.Map, type: string): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(), 350);

    map.once(type, () => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

function installLeafletDemoStyles(): void {
  if (document.querySelector('style[data-territory-kit-demo="leaflet"]')) {
    return;
  }

  const style = document.createElement("style");
  style.dataset.territoryKitDemo = "leaflet";
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
    z-index: 401;
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
    z-index: 402;
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
