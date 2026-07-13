import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { createTerritoryEngine } from "@territory-kit/core";
import { createTerritoryMapLibreAdapter } from "@territory-kit/maplibre";
import type { TerritoryMapLibreMap, TerritoryMapLibreState } from "@territory-kit/maplibre";
import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";

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

  const adapter = createTerritoryMapLibreAdapter({
    zones: getVisibleZonesForMap(map),
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
      adapter.updateData(getVisibleZonesForMap(map), stateByZoneId);

      if (status) {
        status.textContent = event.zoneId;
      }
    },
    onZoneHover(event) {
      if (status) {
        status.textContent = event.zoneId;
      }
    }
  });

  map.on("load", () => {
    adapter.attach(map as unknown as TerritoryMapLibreMap);
  });

  map.on("zoomend", () => {
    adapter.updateData(getVisibleZonesForMap(map), stateByZoneId);
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
