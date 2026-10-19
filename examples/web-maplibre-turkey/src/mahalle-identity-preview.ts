import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { MapLayerMouseEvent } from "maplibre-gl";

const PREVIEW_URL = new URL(
  "../../../reports/tr-adm3/mahalle-identity-layer/fatih-map-preview.geojson",
  import.meta.url
).href;

const statusEl = document.querySelector<HTMLElement>("#status");
const detailsEl = document.querySelector<HTMLElement>("#details");

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors"
      }
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }]
  },
  center: [28.96, 41.01],
  zoom: 12.5
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

async function loadPreview() {
  const response = await fetch(PREVIEW_URL);
  if (!response.ok) {
    throw new Error(
      `Preview GeoJSON missing (${response.status}). Run data:tr:mahalle-identity:fatih.`
    );
  }
  const collection = await response.json();

  map.on("load", () => {
    map.addSource("mahalle-identity", {
      type: "geojson",
      data: collection
    });

    map.addLayer({
      id: "gameplay-zones-fill",
      type: "fill",
      source: "mahalle-identity",
      filter: ["==", ["get", "kind"], "gameplay-zone"],
      paint: {
        "fill-color": [
          "match",
          ["get", "associationStatus"],
          "single-candidate",
          "#4ade80",
          "multiple-candidates",
          "#fbbf24",
          "unseeded",
          "#94a3b8",
          "#60a5fa"
        ],
        "fill-opacity": 0.35
      }
    });

    map.addLayer({
      id: "gameplay-zones-outline",
      type: "line",
      source: "mahalle-identity",
      filter: ["==", ["get", "kind"], "gameplay-zone"],
      paint: {
        "line-color": "#1e293b",
        "line-width": 1.5
      }
    });

    map.addLayer({
      id: "locality-seeds",
      type: "circle",
      source: "mahalle-identity",
      filter: ["==", ["get", "kind"], "locality-seed"],
      paint: {
        "circle-radius": 5,
        "circle-color": "#dc2626",
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1
      }
    });

    map.on("click", "gameplay-zones-fill", (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature || !detailsEl) {
        return;
      }
      const props = feature.properties ?? {};
      detailsEl.textContent = JSON.stringify(props, null, 2);
    });

    map.on("click", "locality-seeds", (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature || !detailsEl) {
        return;
      }
      const props = feature.properties ?? {};
      detailsEl.innerHTML = `<p><strong>${props.displayName}</strong></p><pre>${JSON.stringify(
        props,
        null,
        2
      )}</pre><p>Seed point only — not an official mahalle boundary.</p>`;
    });

    if (statusEl) {
      statusEl.textContent =
        "Read-only preview — gameplay polygons are not official mahalle boundaries.";
    }
  });
}

loadPreview().catch((error) => {
  if (statusEl) {
    statusEl.textContent = String(error);
  }
  console.error(error);
});
