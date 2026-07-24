import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { turkeyNationalCoverage } from "@territory-kit/data-tr";

interface RenderManifest {
  format: "geojson" | "mvt";
  tileTemplate?: string;
  layers?: Array<{ id: string; minZoom: number; maxZoom: number; featureCount: number }>;
}

const registryUrl = import.meta.env.VITE_TERRITORY_REGISTRY_URL as string | undefined;
const styleUrl =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ??
  "https://demotiles.maplibre.org/style.json";
const app = document.querySelector<HTMLDivElement>("#app");

if (app) {
  app.innerHTML = `
    <main class="app-shell">
      <aside class="panel">
        <div class="brand">TerritoryKit Türkiye</div>
        <label class="search-label" for="territory-search">Search</label>
        <input id="territory-search" type="search" placeholder="İl, ilçe, mahalle" />
        <dl class="meta">
          <div><dt>ADM2</dt><dd>${turkeyNationalCoverage.levels.ADM2.status}</dd></div>
          <div><dt>ADM3</dt><dd>${turkeyNationalCoverage.levels.ADM3.status}</dd></div>
          <div><dt>ADM4</dt><dd>${turkeyNationalCoverage.levels.ADM4.status}</dd></div>
        </dl>
        <div id="selection" class="selection">No territory selected</div>
        <div id="source" class="source">${turkeyNationalCoverage.sourceProvider}</div>
      </aside>
      <section class="map-wrap">
        <div id="map"></div>
        <div id="status" class="status">Loading registry</div>
      </section>
    </main>
  `;

  const status = document.querySelector<HTMLDivElement>("#status");
  const selection = document.querySelector<HTMLDivElement>("#selection");
  const source = document.querySelector<HTMLDivElement>("#source");
  const search = document.querySelector<HTMLInputElement>("#territory-search");
  const map = new maplibregl.Map({
    container: "map",
    center: [35.2, 39.1],
    zoom: 5,
    style: styleUrl,
    attributionControl: { compact: true }
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

  map.on("load", () => {
    void attachTurkeyArtifacts(map, registryUrl, { status, selection, source });
  });

  search?.addEventListener("input", () => {
    const value = search.value.trim();

    if (status) {
      status.textContent = value ? `Search: ${value}` : "Registry ready";
    }
  });
}

async function attachTurkeyArtifacts(
  map: maplibregl.Map,
  artifactRoot: string | undefined,
  elements: {
    status: HTMLDivElement | null;
    selection: HTMLDivElement | null;
    source: HTMLDivElement | null;
  }
): Promise<void> {
  if (!artifactRoot) {
    if (elements.status) {
      elements.status.textContent = "Set VITE_TERRITORY_REGISTRY_URL";
    }

    return;
  }

  const root = artifactRoot.endsWith("/") ? artifactRoot : `${artifactRoot}/`;
  const manifestUrl = new URL("render/manifest.json", root);
  const manifest = (await fetchJson(manifestUrl.href)) as RenderManifest;

  if (manifest.format !== "mvt" || !manifest.tileTemplate) {
    throw new Error("Turkey demo expects an MVT render manifest.");
  }

  const tileUrl = new URL(`render/${manifest.tileTemplate}`, root).href;
  map.addSource("territory-turkey", {
    type: "vector",
    tiles: [tileUrl],
    minzoom: Math.min(...(manifest.layers ?? []).map((layer) => layer.minZoom), 0),
    maxzoom: Math.max(...(manifest.layers ?? []).map((layer) => layer.maxZoom), 17),
    attribution: "OCHA COD-AB, HDX"
  });
  map.addLayer({
    id: "territory-fill",
    type: "fill",
    source: "territory-turkey",
    "source-layer": "territory",
    paint: {
      "fill-color": [
        "match",
        ["get", "adminLevel"],
        "ADM1",
        "#3b82f6",
        "ADM2",
        "#10b981",
        "ADM3",
        "#f59e0b",
        "#64748b"
      ],
      "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.68, 0.36]
    }
  });
  map.addLayer({
    id: "territory-line",
    type: "line",
    source: "territory-turkey",
    "source-layer": "territory",
    paint: {
      "line-color": "#0f172a",
      "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2, 0.8]
    }
  });

  let hoveredId: string | number | undefined;
  let selectedId: string | number | undefined;

  map.on("mousemove", "territory-fill", (event) => {
    const feature = event.features?.[0];

    if (hoveredId !== undefined) {
      map.setFeatureState(
        { source: "territory-turkey", sourceLayer: "territory", id: hoveredId },
        { hover: false }
      );
    }

    hoveredId = feature?.id;

    if (hoveredId !== undefined) {
      map.setFeatureState(
        { source: "territory-turkey", sourceLayer: "territory", id: hoveredId },
        { hover: true }
      );
    }
  });
  map.on("click", "territory-fill", (event) => {
    const feature = event.features?.[0];
    const territoryId = String(feature?.properties?.territoryId ?? feature?.id ?? "");

    if (selectedId !== undefined) {
      map.setFeatureState(
        { source: "territory-turkey", sourceLayer: "territory", id: selectedId },
        { selected: false }
      );
    }

    selectedId = feature?.id;

    if (selectedId !== undefined) {
      map.setFeatureState(
        { source: "territory-turkey", sourceLayer: "territory", id: selectedId },
        { selected: true }
      );
    }

    if (elements.selection) {
      elements.selection.textContent = territoryId || "No territory id";
    }
  });

  if (elements.status) {
    elements.status.textContent = "Registry ready";
  }

  if (elements.source) {
    elements.source.textContent = "OCHA COD-AB via HDX";
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  return response.json() as Promise<unknown>;
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
    color: #0f172a;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .app-shell {
    display: grid;
    grid-template-columns: minmax(260px, 320px) 1fr;
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

  .search-label,
  .source {
    color: #52525b;
    font-size: 12px;
  }

  input {
    border: 1px solid #a1a1aa;
    border-radius: 6px;
    font: inherit;
    padding: 9px 10px;
  }

  .meta {
    display: grid;
    gap: 8px;
    margin: 0;
  }

  .meta div {
    align-items: center;
    display: flex;
    justify-content: space-between;
  }

  dt {
    color: #52525b;
  }

  dd {
    font-weight: 700;
    margin: 0;
  }

  .selection {
    border-top: 1px solid #e4e4e7;
    overflow-wrap: anywhere;
    padding-top: 14px;
  }

  .map-wrap {
    min-width: 0;
    position: relative;
  }

  #map {
    height: 100%;
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
