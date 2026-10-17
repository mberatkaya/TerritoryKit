import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { MapLayerMouseEvent } from "maplibre-gl";

const PREVIEW_BASE = new URL(
  "../../../reports/tr-adm3/sprint-2g-geometry-validation/map-preview/",
  import.meta.url
).href;

const DISTRICTS = [
  "kadikoy",
  "fatih",
  "uskudar",
  "adalar",
  "eyupsultan",
  "catalca",
  "basaksehir",
  "esenyurt"
];

const districtSelect = document.querySelector<HTMLSelectElement>("#district-select");
const statusEl = document.querySelector<HTMLElement>("#status");
const panelEl = document.querySelector<HTMLElement>("#feature-panel");
const layerRc8 = document.querySelector<HTMLInputElement>("#layer-rc8");
const layerOsm = document.querySelector<HTMLInputElement>("#layer-osm");
const layerSeeds = document.querySelector<HTMLInputElement>("#layer-seeds");

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
  center: [28.97, 41.01],
  zoom: 11
});

map.addControl(new maplibregl.NavigationControl(), "top-left");

function setStatus(message: string) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

async function loadDistrict(slug: string) {
  setStatus(`Loading ${slug}…`);
  const response = await fetch(`${PREVIEW_BASE}${slug}-geometry-comparison.geojson`);
  if (!response.ok) {
    setStatus(`Missing preview for ${slug} (run data:tr:sprint2g:geometry-validation)`);
    return;
  }
  const collection = (await response.json()) as GeoJSON.FeatureCollection;

  const sources = ["geo-compare-fill", "geo-compare-line", "geo-compare-seeds"];
  for (const id of sources) {
    if (map.getLayer(id)) {
      map.removeLayer(id);
    }
    if (map.getSource(id)) {
      map.removeSource(id);
    }
  }

  const polygons: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: collection.features.filter((f) => f.geometry.type !== "Point")
  };
  const seeds: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: collection.features.filter((f) => f.geometry.type === "Point")
  };

  map.addSource("geo-compare-fill", { type: "geojson", data: polygons });
  map.addLayer({
    id: "geo-compare-fill",
    type: "fill",
    source: "geo-compare-fill",
    paint: {
      "fill-color": [
        "match",
        ["get", "layerClass"],
        "rc8-gameplay",
        "#38bdf8",
        "osm-administrative",
        "#f97316",
        "#64748b"
      ],
      "fill-opacity": [
        "match",
        ["get", "layerClass"],
        "rc8-gameplay",
        0.25,
        "osm-administrative",
        0.35,
        0.2
      ]
    },
    filter: ["!=", ["geometry-type"], "Point"]
  });

  map.addLayer({
    id: "geo-compare-line",
    type: "line",
    source: "geo-compare-fill",
    paint: {
      "line-color": [
        "match",
        ["get", "layerClass"],
        "rc8-gameplay",
        "#0ea5e9",
        "osm-administrative",
        "#ea580c",
        "#94a3b8"
      ],
      "line-width": 1.5
    }
  });

  map.addSource("geo-compare-seeds", { type: "geojson", data: seeds });
  map.addLayer({
    id: "geo-compare-seeds",
    type: "circle",
    source: "geo-compare-seeds",
    paint: {
      "circle-radius": 4,
      "circle-color": "#a3e635",
      "circle-stroke-color": "#14532d",
      "circle-stroke-width": 1
    }
  });

  const bounds = new maplibregl.LngLatBounds();
  for (const feature of collection.features) {
    if (feature.geometry.type === "Point") {
      const [lng, lat] = feature.geometry.coordinates;
      if (typeof lng === "number" && typeof lat === "number") {
        bounds.extend([lng, lat]);
      }
    } else if (feature.geometry.type === "Polygon") {
      for (const ring of feature.geometry.coordinates) {
        for (const coord of ring) {
          bounds.extend(coord as [number, number]);
        }
      }
    }
  }
  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 48, maxZoom: 14 });
  }

  applyLayerVisibility();
  setStatus(
    `${slug}: ${collection.features.length} features (research preview — not official boundaries)`
  );
}

function applyLayerVisibility() {
  if (!map.getLayer("geo-compare-fill")) {
    return;
  }
  const rc8On = layerRc8?.checked ?? true;
  const osmOn = layerOsm?.checked ?? true;
  const seedsOn = layerSeeds?.checked ?? true;

  map.setFilter("geo-compare-fill", [
    "any",
    ["all", ["==", ["get", "layerClass"], "rc8-gameplay"], rc8On],
    ["all", ["==", ["get", "layerClass"], "osm-administrative"], osmOn]
  ]);
  map.setLayoutProperty("geo-compare-seeds", "visibility", seedsOn ? "visible" : "none");
}

function showFeature(feature: maplibregl.MapGeoJSONFeature) {
  if (!panelEl) {
    return;
  }
  const props = feature.properties ?? {};
  panelEl.innerHTML = `
    <strong>${props.layerClass ?? "feature"}</strong><br/>
    Source class: ${props.sourceClass ?? "—"}<br/>
    Polygon ID: ${props.polygonId ?? "—"}<br/>
    Settlement: ${props.settlementIdentity ?? "—"}<br/>
    Parent ADM2: ${props.parentAdm2 ?? "—"}<br/>
    Confidence: ${props.confidence ?? "—"}<br/>
    License: ${props.licenseStatus ?? "—"}<br/>
    Snapshot: ${props.sourceSnapshot ?? "—"}<br/>
    Geometry hash: ${props.geometryHash ?? "—"}
  `;
}

map.on("click", "geo-compare-fill", (event: MapLayerMouseEvent) => {
  const feature = event.features?.[0];
  if (feature) {
    showFeature(feature);
  }
});
map.on("click", "geo-compare-seeds", (event: MapLayerMouseEvent) => {
  const feature = event.features?.[0];
  if (feature) {
    showFeature(feature);
  }
});

for (const slug of DISTRICTS) {
  const option = document.createElement("option");
  option.value = slug;
  option.textContent = slug;
  districtSelect?.append(option);
}

districtSelect?.addEventListener("change", () => {
  void loadDistrict(districtSelect.value);
});
layerRc8?.addEventListener("change", applyLayerVisibility);
layerOsm?.addEventListener("change", applyLayerVisibility);
layerSeeds?.addEventListener("change", applyLayerVisibility);

void loadDistrict("fatih");
