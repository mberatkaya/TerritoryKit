import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { createTerritoryEngine } from "@territory-kit/core";
import { createTerritoryMapLibreAdapter } from "@territory-kit/maplibre";
import type { TerritoryMapLibreMap, TerritoryMapLibreState } from "@territory-kit/maplibre";
import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";

type VisibleZone = ReturnType<typeof getVisibleZonesForMap>[number];

interface TerritoryKitDemoProbe {
  ready: boolean;
  attachCount: number;
  updateCount: number;
  lastClickedZoneId: string | undefined;
  lastHoveredZoneId: string | undefined;
  lastVisibleZoneIds: string[];
  lastZoom: number;
  estimateFrameRate(durationMs?: number): Promise<number>;
  projectZoneCenter(zoneId: string): { x: number; y: number } | undefined;
  queryRenderedZoneIds(): string[];
  setZoom(zoom: number): Promise<string[]>;
}

declare global {
  interface Window {
    __territoryKitDemo?: TerritoryKitDemoProbe;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
const dataset = createSampleTerritoryDataset();
const engine = createTerritoryEngine({ dataset });
const stateByZoneId = new Map<string, TerritoryMapLibreState>();
let darkTheme = false;

if (app) {
  app.innerHTML = `
    <section class="shell">
      <header class="toolbar">
        <strong>TerritoryKit MapLibre</strong>
        <span id="status">Ready</span>
        <button id="theme-button" type="button">Dark</button>
      </header>
      <div id="map"></div>
    </section>
  `;

  const status = document.querySelector<HTMLSpanElement>("#status");
  const themeButton = document.querySelector<HTMLButtonElement>("#theme-button");
  const map = new maplibregl.Map({
    container: "map",
    center: [28.995, 41.02],
    zoom: 10,
    style: {
      version: 8,
      sources: {},
      layers: [
        {
          id: "background",
          type: "background",
          paint: {
            "background-color": "#f8fafc"
          }
        }
      ]
    }
  });
  let attachCount = 0;
  let updateCount = 0;
  let lastVisibleZones = getVisibleZonesForMap(map);
  let lastClickedZoneId: string | undefined;
  let lastHoveredZoneId: string | undefined;

  const demoProbe: TerritoryKitDemoProbe = {
    ready: false,
    attachCount,
    updateCount,
    lastClickedZoneId,
    lastHoveredZoneId,
    lastVisibleZoneIds: zoneIds(lastVisibleZones),
    lastZoom: map.getZoom(),
    estimateFrameRate,
    projectZoneCenter(zoneId) {
      const zone = lastVisibleZones.find((candidate) => candidate.id === zoneId);

      if (!zone) {
        return undefined;
      }

      const point = map.project(zone.center);

      return { x: point.x, y: point.y };
    },
    queryRenderedZoneIds() {
      return queryRenderedZoneIds(map);
    },
    async setZoom(zoom) {
      const idle = waitForMapIdle(map);
      map.setZoom(zoom);
      await idle;
      updateAdapterData();

      return demoProbe.lastVisibleZoneIds;
    }
  };

  window.__territoryKitDemo = demoProbe;

  const adapter = createTerritoryMapLibreAdapter({
    zones: lastVisibleZones,
    sourceId: "territory-zones",
    fillLayerId: "territory-zones-fill",
    lineLayerId: "territory-zones-line",
    fillColor: "#0f766e",
    fillOpacity: 0.42,
    lineColor: "#0f172a",
    onZoneClick(event) {
      for (const zoneId of stateByZoneId.keys()) {
        stateByZoneId.set(zoneId, { selected: false });
      }

      stateByZoneId.set(event.zoneId, { selected: true });
      lastClickedZoneId = event.zoneId;
      updateAdapterData();

      if (status) {
        status.textContent = event.zoneId;
      }
      syncDemoProbe();
    },
    onZoneHover(event) {
      lastHoveredZoneId = event.zoneId;
      if (status) {
        status.textContent = event.zoneId;
      }
      syncDemoProbe();
    }
  });

  map.on("load", () => {
    adapter.attach(map as unknown as TerritoryMapLibreMap);
    attachCount += 1;
    demoProbe.ready = true;
    syncDemoProbe();
  });

  map.on("zoomend", () => {
    updateAdapterData();
  });

  themeButton?.addEventListener("click", () => {
    darkTheme = !darkTheme;
    themeButton.textContent = darkTheme ? "Light" : "Dark";
    map.setPaintProperty("background", "background-color", darkTheme ? "#111827" : "#f8fafc");
    adapter.updateTheme({
      fillColor: darkTheme ? "#38bdf8" : "#0f766e",
      lineColor: darkTheme ? "#e5e7eb" : "#0f172a"
    });
  });

  function updateAdapterData(): void {
    lastVisibleZones = getVisibleZonesForMap(map);
    updateCount += 1;
    adapter.updateData(lastVisibleZones, stateByZoneId);
    syncDemoProbe();
  }

  function syncDemoProbe(): void {
    demoProbe.attachCount = attachCount;
    demoProbe.updateCount = updateCount;
    demoProbe.lastClickedZoneId = lastClickedZoneId;
    demoProbe.lastHoveredZoneId = lastHoveredZoneId;
    demoProbe.lastVisibleZoneIds = zoneIds(lastVisibleZones);
    demoProbe.lastZoom = map.getZoom();
  }
}

const style = document.createElement("style");
style.textContent = `
  html,
  body,
  #app {
    height: 100%;
    margin: 0;
  }

  body {
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #0f172a;
  }

  .shell {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
    background: #f8fafc;
  }

  .toolbar {
    align-items: center;
    background: #ffffff;
    border-bottom: 1px solid #d1d5db;
    display: grid;
    gap: 12px;
    grid-template-columns: 1fr auto auto;
    min-height: 48px;
    padding: 0 16px;
  }

  #status {
    color: #475569;
    font-size: 14px;
  }

  button {
    background: #0f172a;
    border: 0;
    border-radius: 6px;
    color: #ffffff;
    cursor: pointer;
    font: inherit;
    min-width: 72px;
    padding: 7px 12px;
  }

  #map {
    min-height: 0;
  }
`;
document.head.append(style);

function getVisibleZonesForMap(map: maplibregl.Map) {
  const bounds = map.getBounds();

  return engine.getVisibleZones({
    bounds: {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth()
    },
    zoom: map.getZoom()
  });
}

function zoneIds(zones: VisibleZone[]): string[] {
  return zones.map((zone) => zone.id).sort();
}

function queryRenderedZoneIds(map: maplibregl.Map): string[] {
  return map
    .queryRenderedFeatures(undefined, { layers: ["territory-zones-fill"] })
    .map((feature) => {
      if (typeof feature.id === "string" || typeof feature.id === "number") {
        return String(feature.id);
      }

      const id = feature.properties.id;

      return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
    })
    .filter((zoneId): zoneId is string => Boolean(zoneId))
    .sort();
}

function waitForMapIdle(map: maplibregl.Map): Promise<void> {
  return new Promise((resolve) => {
    map.once("idle", () => resolve());
  });
}

function estimateFrameRate(durationMs = 500): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now();
    let frames = 0;

    function tick(time: number): void {
      frames += 1;

      if (time - start >= durationMs) {
        resolve((frames * 1000) / (time - start));
        return;
      }

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}
