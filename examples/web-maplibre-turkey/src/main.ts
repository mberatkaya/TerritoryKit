import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import maplibregl from "maplibre-gl";
import {
  createMemoryTerritoryRegistryCache,
  createTerritoryRegistryClient
} from "@territory-kit/registry";
import type { TerritoryRegistryClient } from "@territory-kit/registry";
import { turkeyAdm3NeighbourhoodCoverage, turkeyNationalCoverage } from "@territory-kit/data-tr";
import { readDemoConfig, readUrlState, writeUrlState } from "./config.js";
import { demoLevelForZoom, isDemoAdminLevel, zoomForDemoLevel } from "./levels.js";
import {
  adm3ParentHint,
  createFixtureQueryService,
  createMetadataFromRegistryDataset,
  createRegistryQueryService
} from "./query.js";
import {
  createDefaultMapStyle,
  createTurkeyMapRenderService,
  type TurkeyMapRenderService
} from "./render.js";
import type {
  DemoAdminLevel,
  DemoMetadata,
  DemoMode,
  QueryCacheTelemetry,
  RegistryConnectionStatus,
  RenderTelemetry,
  TerritoryDetails,
  TerritoryQueryService,
  TerritorySearchResult
} from "./types.js";

interface TurkeyLiveDemoProbe {
  readonly ready: boolean;
  readonly mode: DemoMode;
  readonly registryStatus: RegistryConnectionStatus;
  readonly renderedLevel: string;
  readonly selectedTerritoryId: string | undefined;
  readonly lastError: string | undefined;
  readonly displayedFeatureCount: number;
  readonly loadMs: number;
  estimateFrameRate(durationMs?: number): Promise<number>;
  getUrlState(): string;
  focusTerritory(territoryId: string, level?: DemoAdminLevel): Promise<boolean>;
  locate(lng: number, lat: number, level?: DemoAdminLevel): Promise<string | undefined>;
  projectTerritoryCenter(
    territoryId: string,
    level?: DemoAdminLevel
  ): Promise<{ x: number; y: number } | undefined>;
  search(query: string): Promise<TerritorySearchResult[]>;
  selectTerritory(territoryId: string, level?: DemoAdminLevel): Promise<string | undefined>;
  setZoom(zoom: number): Promise<{ renderedLevel: DemoAdminLevel; displayedFeatureCount: number }>;
}

declare global {
  interface Window {
    __territoryKitTurkeyDemo?: TurkeyLiveDemoProbe;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root.");
}

app.innerHTML = `
  <main class="app-shell">
    <aside class="side-panel" aria-label="TerritoryKit Türkiye demo controls">
      <header class="brand-block">
        <div>
          <p class="eyebrow">TerritoryKit</p>
          <h1>Türkiye Explorer</h1>
        </div>
        <span id="mode-badge" class="badge">Fixture</span>
      </header>

      <section class="panel-section">
        <div class="section-heading">
          <h2>Level</h2>
          <span id="rendered-level">ADM1</span>
        </div>
        <div class="segmented" role="group" aria-label="Administrative level">
          <button class="segment is-active" type="button" data-level="ADM1">İller</button>
          <button class="segment" type="button" data-level="ADM2">İlçeler</button>
          <button class="segment" type="button" data-level="ADM3">Mahalle</button>
        </div>
        <p id="adm3-warning" class="notice">ADM3 coverage is partial and appears only where reviewed artifacts exist.</p>
      </section>

      <section class="panel-section">
        <label class="field-label" for="territory-search">İl veya ilçe ara</label>
        <div class="search-row">
          <input id="territory-search" type="search" autocomplete="off" placeholder="İstanbul, Fatih" />
          <button id="clear-search" class="icon-button" type="button" aria-label="Clear search">×</button>
        </div>
        <div id="search-status" class="muted" aria-live="polite">Search is ready.</div>
        <div id="search-results" class="result-list" role="listbox" aria-label="Search results"></div>
      </section>

      <section class="panel-section">
        <h2>Koordinat</h2>
        <div class="coordinate-grid">
          <label>
            <span>Longitude</span>
            <input id="longitude-input" inputmode="decimal" value="28.97" />
          </label>
          <label>
            <span>Latitude</span>
            <input id="latitude-input" inputmode="decimal" value="41.03" />
          </label>
        </div>
        <button id="locate-button" class="primary-button" type="button">Bölgeyi Bul</button>
        <div id="locate-status" class="muted" aria-live="polite">No coordinate lookup yet.</div>
      </section>

      <section class="panel-section">
        <div class="section-heading">
          <h2>Seçim</h2>
          <button id="clear-selection" class="text-button" type="button">Temizle</button>
        </div>
        <div id="selection-panel" class="selection-panel empty-state">No territory selected.</div>
      </section>

      <section class="panel-section">
        <h2>İlişkiler</h2>
        <div id="relationship-panel" class="relationship-panel empty-state">Parent, children and neighbors will appear after selection.</div>
      </section>

      <section class="panel-section metadata-section">
        <h2>Dataset</h2>
        <dl id="metadata-grid" class="metadata-grid"></dl>
      </section>

      <section class="panel-section">
        <h2>Durum</h2>
        <dl id="runtime-grid" class="metadata-grid"></dl>
        <div id="fallback-panel" class="fallback-panel" aria-live="polite"></div>
      </section>
    </aside>

    <section class="map-region" aria-label="Türkiye map">
      <div id="map" tabindex="0" aria-label="Interactive Türkiye territory map"></div>
      <div id="map-status" class="map-status" aria-live="polite">Loading map</div>
    </section>
  </main>
`;

const elements = {
  modeBadge: requireElement<HTMLElement>("#mode-badge"),
  renderedLevel: requireElement<HTMLElement>("#rendered-level"),
  adm3Warning: requireElement<HTMLElement>("#adm3-warning"),
  searchInput: requireElement<HTMLInputElement>("#territory-search"),
  clearSearch: requireElement<HTMLButtonElement>("#clear-search"),
  searchStatus: requireElement<HTMLElement>("#search-status"),
  searchResults: requireElement<HTMLElement>("#search-results"),
  longitudeInput: requireElement<HTMLInputElement>("#longitude-input"),
  latitudeInput: requireElement<HTMLInputElement>("#latitude-input"),
  locateButton: requireElement<HTMLButtonElement>("#locate-button"),
  locateStatus: requireElement<HTMLElement>("#locate-status"),
  clearSelection: requireElement<HTMLButtonElement>("#clear-selection"),
  selectionPanel: requireElement<HTMLElement>("#selection-panel"),
  relationshipPanel: requireElement<HTMLElement>("#relationship-panel"),
  metadataGrid: requireElement<HTMLElement>("#metadata-grid"),
  runtimeGrid: requireElement<HTMLElement>("#runtime-grid"),
  fallbackPanel: requireElement<HTMLElement>("#fallback-panel"),
  mapStatus: requireElement<HTMLElement>("#map-status"),
  levelButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-level]")]
};

const config = readDemoConfig();
const initialUrlState = readUrlState();
let mode: DemoMode = config.mode;
let registryStatus: RegistryConnectionStatus = config.registryUrl ? "configured" : "not-configured";
let registry: TerritoryRegistryClient | undefined;
let query: TerritoryQueryService = createFixtureQueryService();
let metadata: DemoMetadata = query.metadata;
let renderer: TurkeyMapRenderService | undefined;
let currentLevel = initialUrlState.level ?? demoLevelForZoom(5.4);
let selectedDetails: TerritoryDetails | undefined;
let selectedTerritoryId: string | undefined = initialUrlState.territoryId;
let lastRender: RenderTelemetry | undefined;
let lastCache: QueryCacheTelemetry | undefined;
let lastError: string | undefined = config.configError;
let ready = false;
let renderController: AbortController | undefined;
let detailController: AbortController | undefined;
let searchController: AbortController | undefined;
let locateController: AbortController | undefined;

const map = new maplibregl.Map({
  container: "map",
  center: [35.2, 39.1],
  zoom: zoomForDemoLevel(currentLevel),
  style: config.styleUrl ?? createDefaultMapStyle(),
  attributionControl: { compact: true }
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

window.__territoryKitTurkeyDemo = createProbe();

renderMetadata();
renderRuntime();
renderFallbackPanel();
wireControls();

map.on("load", () => {
  void initializeDemo();
});

map.on("zoomend", () => {
  const nextLevel = demoLevelForZoom(map.getZoom());

  if (nextLevel !== currentLevel) {
    currentLevel = nextLevel;
    void renderCurrentLevel("zoom");
  } else {
    updateDisplayedFeatureCount();
  }
});

map.on("moveend", () => {
  updateDisplayedFeatureCount();
});

map.on("error", (event) => {
  const message = event.error?.message ?? "MapLibre reported a map error.";
  lastError = message;
  elements.mapStatus.textContent = message;
  renderFallbackPanel();
});

window.addEventListener("beforeunload", () => {
  renderController?.abort();
  detailController?.abort();
  searchController?.abort();
  locateController?.abort();
  renderer?.dispose();
  map.remove();
});

async function initializeDemo(): Promise<void> {
  elements.mapStatus.textContent = "Loading registry manifest";

  if (config.mode === "registry" && config.registryUrl && !config.configError) {
    registryStatus = "connecting";
    renderRuntime();

    try {
      const registryCache = createMemoryTerritoryRegistryCache();
      registry = createTerritoryRegistryClient({
        registryUrl: config.registryUrl,
        cache: registryCache,
        timeoutMs: 12_000,
        maxArtifactBytes: 24_000_000,
        maxDecompressedBytes: 48_000_000
      });
      await registry.loadRegistry();
      const dataset = await registry.getDatasetInfo(config.datasetId, config.datasetVersion);
      metadata = createMetadataFromRegistryDataset({
        dataset,
        datasetVersionPinned: config.datasetVersionPinned
      });
      query = createRegistryQueryService({
        registry,
        datasetId: config.datasetId,
        datasetVersion: config.datasetVersion,
        datasetVersionPinned: config.datasetVersionPinned,
        allowPrerelease: config.allowPrerelease
      });
      registryStatus = "connected";
      mode = "registry";
    } catch (error) {
      activateFixtureFallback(`Registry unavailable: ${readErrorMessage(error)}`);
    }
  } else {
    mode = "fixture";
    registryStatus = config.configError ? "error" : "not-configured";
  }

  renderer = createTurkeyMapRenderService({
    map,
    mode,
    query,
    ...(registry && mode === "registry" ? { registry } : {}),
    datasetVersion: config.datasetVersion,
    allowPrerelease: config.allowPrerelease
  });
  renderer.bindInteractions({
    onTerritoryClick(event) {
      void selectTerritory(event.territoryId, event.level ?? currentLevel, { flyTo: false });
    },
    onTerritoryHover(event) {
      elements.mapStatus.textContent = event.territoryId;
    },
    onTerritoryLeave() {
      elements.mapStatus.textContent = renderMapStatusText();
    }
  });

  renderMetadata();
  renderRuntime();
  renderFallbackPanel();
  await renderCurrentLevel("initial");

  if (selectedTerritoryId) {
    await selectTerritory(selectedTerritoryId, initialUrlState.level, { flyTo: true });
  }

  ready = true;
  elements.mapStatus.textContent = renderMapStatusText();
}

function activateFixtureFallback(message: string): void {
  mode = "fixture";
  registryStatus = "error";
  registry = undefined;
  query = createFixtureQueryService();
  metadata = query.metadata;
  lastError = message;
}

async function renderCurrentLevel(reason: string): Promise<void> {
  if (!renderer) {
    return;
  }

  renderController?.abort();
  renderController = new AbortController();
  setBusy(`Loading ${currentLevel}`);

  try {
    const adm3ParentId = currentLevel === "ADM3" ? adm3ParentHint(selectedDetails) : undefined;
    const telemetry = await renderer.render({
      level: currentLevel,
      ...(adm3ParentId ? { adm3ParentId } : {}),
      signal: renderController.signal
    });

    if (!telemetry) {
      return;
    }

    lastRender = telemetry;
    lastCache = await query.getCacheTelemetry();
    updateLevelButtons();
    renderMetadata();
    renderRuntime();
    renderFallbackPanel();
    restoreSelectionHighlight();
    elements.mapStatus.textContent = reason === "initial" ? "Map ready" : renderMapStatusText();
    await waitForMapIdle();
    updateDisplayedFeatureCount();
  } catch (error) {
    if (mode === "registry") {
      activateFixtureFallback(`Render fallback: ${readErrorMessage(error)}`);
      renderer?.dispose();
      renderer = createTurkeyMapRenderService({
        map,
        mode: "fixture",
        query,
        datasetVersion: config.datasetVersion,
        allowPrerelease: config.allowPrerelease
      });
      renderer.bindInteractions({
        onTerritoryClick(event) {
          void selectTerritory(event.territoryId, event.level ?? currentLevel, { flyTo: false });
        },
        onTerritoryHover(event) {
          elements.mapStatus.textContent = event.territoryId;
        },
        onTerritoryLeave() {
          elements.mapStatus.textContent = renderMapStatusText();
        }
      });
      await renderCurrentLevel("fixture-fallback");
      return;
    }

    lastError = readErrorMessage(error);
    elements.mapStatus.textContent = lastError;
    renderFallbackPanel();
  }
}

async function selectTerritory(
  territoryId: string,
  level: DemoAdminLevel | undefined,
  options: { flyTo: boolean }
): Promise<string | undefined> {
  detailController?.abort();
  detailController = new AbortController();
  const previousSelectedId = selectedTerritoryId;
  selectedTerritoryId = territoryId;

  if (previousSelectedId && previousSelectedId !== territoryId) {
    renderer?.setSelected(previousSelectedId, false);
  }

  renderer?.setSelected(territoryId, true);
  setBusy(`Loading ${territoryId}`);

  try {
    const details = await query.getTerritoryDetails(territoryId, {
      ...(level ? { level } : {}),
      signal: detailController.signal
    });

    if (!details) {
      selectedTerritoryId = previousSelectedId;
      lastError = `Territory ${territoryId} was not found in query artifacts.`;
      renderFallbackPanel();
      return undefined;
    }

    selectedDetails = details;
    selectedTerritoryId = details.zone.id;
    lastCache = await query.getCacheTelemetry();
    renderSelection(details);
    renderRelationships(details);
    renderRuntime();
    renderFallbackPanel();
    writeUrlState({
      territoryId: details.zone.id,
      level: `ADM${details.zone.level}` as DemoAdminLevel,
      mode,
      ...(config.registryUrl ? { registryUrl: config.registryUrl } : {})
    });

    if (options.flyTo) {
      fitToZone(details.zone);
    }

    if (currentLevel === "ADM3" && adm3ParentHint(details)) {
      await renderCurrentLevel("adm3-parent-selection");
    }

    elements.mapStatus.textContent = renderMapStatusText();
    return details.zone.id;
  } catch (error) {
    if (!isAbortError(error)) {
      lastError = readErrorMessage(error);
      renderFallbackPanel();
    }

    return undefined;
  }
}

function wireControls(): void {
  for (const button of elements.levelButtons) {
    button.addEventListener("click", () => {
      const level = button.dataset.level;

      if (!isDemoAdminLevel(level)) {
        return;
      }

      currentLevel = level;
      map.easeTo({ zoom: zoomForDemoLevel(level), duration: reducedMotion() ? 0 : 250 });
      void renderCurrentLevel("level-control");
    });
  }

  elements.searchInput.addEventListener("input", () => {
    debounceSearch();
  });
  elements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      clearSearch();
    }
  });
  elements.clearSearch.addEventListener("click", clearSearch);
  elements.locateButton.addEventListener("click", () => {
    void locateCoordinate();
  });
  elements.clearSelection.addEventListener("click", () => {
    clearSelection();
  });
}

let searchTimer: number | undefined;

function debounceSearch(): void {
  if (searchTimer) {
    window.clearTimeout(searchTimer);
  }

  searchTimer = window.setTimeout(() => {
    void runSearch(elements.searchInput.value);
  }, 180);
}

async function runSearch(queryText: string): Promise<TerritorySearchResult[]> {
  searchController?.abort();
  searchController = new AbortController();
  const searchValue = queryText.trim();

  if (!searchValue) {
    elements.searchResults.replaceChildren();
    elements.searchStatus.textContent = "Search is ready.";
    return [];
  }

  elements.searchStatus.textContent = "Searching";

  try {
    const levels: readonly DemoAdminLevel[] =
      currentLevel === "ADM3" ? ["ADM1", "ADM2", "ADM3"] : ["ADM1", "ADM2"];
    const results = await query.search(searchValue, {
      levels,
      limit: 60,
      signal: searchController.signal
    });
    elements.searchStatus.textContent =
      results.length === 0 ? "No results." : `${results.length} results`;
    renderSearchResults(results);
    lastCache = await query.getCacheTelemetry();
    renderRuntime();
    return results;
  } catch (error) {
    if (!isAbortError(error)) {
      elements.searchStatus.textContent = readErrorMessage(error);
    }

    return [];
  }
}

function renderSearchResults(results: readonly TerritorySearchResult[]): void {
  const fragment = document.createDocumentFragment();

  for (const result of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result-button";
    button.setAttribute("role", "option");
    button.append(renderResultPrimary(result), renderResultMeta(result));
    button.addEventListener("click", () => {
      void selectTerritory(result.id, result.level, { flyTo: true });
    });
    fragment.append(button);
  }

  elements.searchResults.replaceChildren(fragment);
}

async function locateCoordinate(): Promise<void> {
  locateController?.abort();
  locateController = new AbortController();
  const lng = Number(elements.longitudeInput.value.replace(",", "."));
  const lat = Number(elements.latitudeInput.value.replace(",", "."));

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    elements.locateStatus.textContent = "Enter valid longitude and latitude.";
    return;
  }

  elements.locateStatus.textContent = "Looking up coordinate";

  try {
    const details = await query.locate(
      { lng, lat },
      { level: currentLevel, signal: locateController.signal }
    );

    if (!details) {
      elements.locateStatus.textContent = "No territory found.";
      return;
    }

    elements.locateStatus.textContent = `${displayZoneName(details.zone)} found.`;
    await selectTerritory(details.zone.id, `ADM${details.zone.level}` as DemoAdminLevel, {
      flyTo: true
    });
  } catch (error) {
    if (!isAbortError(error)) {
      elements.locateStatus.textContent = readErrorMessage(error);
    }
  }
}

function clearSearch(): void {
  searchController?.abort();
  elements.searchInput.value = "";
  elements.searchStatus.textContent = "Search is ready.";
  elements.searchResults.replaceChildren();
}

function clearSelection(): void {
  if (selectedTerritoryId) {
    renderer?.setSelected(selectedTerritoryId, false);
  }

  selectedTerritoryId = undefined;
  selectedDetails = undefined;
  elements.selectionPanel.className = "selection-panel empty-state";
  elements.selectionPanel.textContent = "No territory selected.";
  elements.relationshipPanel.className = "relationship-panel empty-state";
  elements.relationshipPanel.textContent =
    "Parent, children and neighbors will appear after selection.";
  writeUrlState({ mode, ...(config.registryUrl ? { registryUrl: config.registryUrl } : {}) });
  renderRuntime();
  renderFallbackPanel();
}

function renderSelection(details: TerritoryDetails): void {
  const rows = [
    ["Name", displayZoneName(details.zone)],
    ["ID", details.zone.id],
    ["Level", `ADM${details.zone.level}`],
    ["Parent", details.parent ? displayZoneName(details.parent) : "None"]
  ] as const;

  elements.selectionPanel.className = "selection-panel";
  elements.selectionPanel.replaceChildren(renderDefinitionGrid(rows));
}

function renderRelationships(details: TerritoryDetails): void {
  const fragment = document.createDocumentFragment();

  fragment.append(
    renderRelationshipGroup("Parent", details.parent ? [details.parent] : [], false),
    renderRelationshipGroup("Children", details.children, details.childrenLimited),
    renderRelationshipGroup("Neighbors", details.neighbors, details.neighborsLimited)
  );
  elements.relationshipPanel.className = "relationship-panel";
  elements.relationshipPanel.replaceChildren(fragment);
}

function renderRelationshipGroup(
  title: string,
  zones: readonly TerritoryDetails["zone"][],
  limited: boolean
): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  const list = document.createElement("div");
  heading.textContent = limited ? `${title} (first ${zones.length})` : title;
  list.className = "compact-list";

  if (zones.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "None available.";
    section.append(heading, empty);
    return section;
  }

  for (const zone of zones) {
    const button = document.createElement("button");
    const level = `ADM${zone.level}` as DemoAdminLevel;
    button.type = "button";
    button.className = "list-button";
    button.textContent = `${displayZoneName(zone)} · ${level}`;
    button.addEventListener("click", () => {
      void selectTerritory(zone.id, level, { flyTo: true });
    });
    list.append(button);
  }

  section.append(heading, list);
  return section;
}

function renderMetadata(): void {
  elements.modeBadge.textContent =
    mode === "registry" ? "Registry" : registryStatus === "error" ? "Fixture fallback" : "Fixture";
  elements.modeBadge.dataset.mode = mode;
  elements.metadataGrid.replaceChildren(
    ...definitionRows([
      ["Dataset", metadata.datasetId],
      [
        "Version",
        metadata.datasetVersionPinned
          ? metadata.datasetVersion
          : `${metadata.datasetVersion} (unpinned)`
      ],
      ["Source", metadata.sourceProvider],
      ["License", metadata.license.name ?? metadata.license.id],
      ["Attribution", metadata.license.attribution || metadata.sourceAttribution],
      ["ADM1", String(metadata.coverage.ADM1)],
      ["ADM2", String(metadata.coverage.ADM2)],
      [
        "ADM3",
        `${String(metadata.coverage.ADM3)} · ${turkeyAdm3NeighbourhoodCoverage.localTypeName}`
      ]
    ])
  );
  elements.adm3Warning.textContent =
    currentLevel === "ADM3"
      ? "ADM3 is partial; uncovered parents fall back to the deepest available artifact."
      : turkeyNationalCoverage.levels.ADM3.blocker;
}

function renderRuntime(): void {
  elements.renderedLevel.textContent = currentLevel;
  updateLevelButtons();
  elements.runtimeGrid.replaceChildren(
    ...definitionRows([
      ["Registry", registryStatus],
      ["Telemetry", config.telemetryEnabled ? "enabled" : "off"],
      ["Mode", mode],
      ["Render", lastRender?.renderArtifactFormat ?? "waiting"],
      ["Load", lastRender ? `${lastRender.loadMs} ms` : "waiting"],
      ["Cache", lastCache?.cacheLabel ?? "empty"],
      ["Features", String(lastRender?.displayedFeatureCount ?? 0)],
      ["Coverage", String(lastRender?.coverageStatus ?? metadata.coverage[currentLevel])]
    ])
  );
}

function renderFallbackPanel(): void {
  const messages = [
    config.configError,
    lastError,
    lastRender?.fallbackReason
      ? `Fallback: ${lastRender.requestedLevel} rendered as ${lastRender.renderedLevel} (${lastRender.fallbackReason}).`
      : undefined,
    mode === "fixture"
      ? "Fixture mode is CI-safe and not a production deployment claim."
      : undefined,
    currentLevel === "ADM3" ? "ADM3 coverage is partial." : undefined
  ].filter((message): message is string => Boolean(message));

  if (messages.length === 0) {
    elements.fallbackPanel.replaceChildren();
    return;
  }

  const list = document.createElement("ul");

  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    list.append(item);
  }

  elements.fallbackPanel.replaceChildren(list);
}

function updateLevelButtons(): void {
  for (const button of elements.levelButtons) {
    const active = button.dataset.level === currentLevel;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function updateDisplayedFeatureCount(): void {
  if (!renderer || !lastRender) {
    return;
  }

  lastRender = {
    ...lastRender,
    displayedFeatureCount: renderer.readDisplayedFeatureCount()
  };
  renderRuntime();
  elements.mapStatus.textContent = renderMapStatusText();
}

function restoreSelectionHighlight(): void {
  if (selectedTerritoryId) {
    renderer?.setSelected(selectedTerritoryId, true);
  }
}

function setBusy(message: string): void {
  elements.mapStatus.textContent = message;
}

function renderMapStatusText(): string {
  const featureCount = lastRender?.displayedFeatureCount ?? 0;
  return `${currentLevel} · ${featureCount} features · ${mode}`;
}

function fitToZone(zone: TerritoryDetails["zone"]): void {
  const [west, south, east, north] = zone.bbox;
  map.fitBounds(
    [
      [west, south],
      [east, north]
    ],
    {
      padding: { top: 70, right: 70, bottom: 70, left: 70 },
      maxZoom: Math.max(map.getZoom(), zoomForDemoLevel(`ADM${zone.level}` as DemoAdminLevel)),
      duration: reducedMotion() ? 0 : 350
    }
  );
}

function renderDefinitionGrid(rows: readonly (readonly [string, string])[]): HTMLElement {
  const grid = document.createElement("dl");
  grid.className = "metadata-grid";
  grid.replaceChildren(...definitionRows(rows));
  return grid;
}

function definitionRows(rows: readonly (readonly [string, string])[]): HTMLElement[] {
  return rows.map(([label, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    row.append(term, detail);
    return row;
  });
}

function renderResultPrimary(result: TerritorySearchResult): HTMLElement {
  const primary = document.createElement("span");
  primary.className = "result-primary";
  primary.textContent = result.name;
  return primary;
}

function renderResultMeta(result: TerritorySearchResult): HTMLElement {
  const meta = document.createElement("span");
  meta.className = "result-meta";
  meta.textContent = `${result.level} · ${result.id}`;
  return meta;
}

function displayZoneName(zone: TerritoryDetails["zone"]): string {
  return zone.localName ?? zone.name ?? String(zone.properties.name ?? zone.id);
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing element ${selector}.`);
  }

  return element;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function waitForMapIdle(): Promise<void> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, 900);

    map.once("idle", () => {
      window.clearTimeout(timeout);
      resolve();
    });
  });
}

function createProbe(): TurkeyLiveDemoProbe {
  return {
    get ready() {
      return ready;
    },
    get mode() {
      return mode;
    },
    get registryStatus() {
      return registryStatus;
    },
    get renderedLevel() {
      return currentLevel;
    },
    get selectedTerritoryId() {
      return selectedTerritoryId;
    },
    get lastError() {
      return lastError;
    },
    get displayedFeatureCount() {
      return lastRender?.displayedFeatureCount ?? 0;
    },
    get loadMs() {
      return lastRender?.loadMs ?? 0;
    },
    estimateFrameRate,
    getUrlState() {
      return window.location.search;
    },
    async focusTerritory(territoryId, level) {
      const details = await query.getTerritoryDetails(territoryId, { ...(level ? { level } : {}) });

      if (!details) {
        return false;
      }

      fitToZone(details.zone);
      await waitForMapIdle();
      return true;
    },
    async locate(lng, lat, level = currentLevel) {
      const details = await query.locate({ lng, lat }, { level });
      return details?.zone.id;
    },
    async projectTerritoryCenter(territoryId, level) {
      const details = await query.getTerritoryDetails(territoryId, { ...(level ? { level } : {}) });
      const center = details?.zone.center;

      if (!center) {
        return undefined;
      }

      const point = map.project(center);
      return { x: point.x, y: point.y };
    },
    search(queryText) {
      return query.search(queryText, {
        levels: currentLevel === "ADM3" ? ["ADM1", "ADM2", "ADM3"] : ["ADM1", "ADM2"],
        limit: 60
      });
    },
    selectTerritory(territoryId, level) {
      return selectTerritory(territoryId, level, { flyTo: true });
    },
    async setZoom(zoom) {
      const idle = waitForMapIdle();
      map.setZoom(zoom);
      await idle;
      currentLevel = demoLevelForZoom(map.getZoom());
      await renderCurrentLevel("probe");
      return {
        renderedLevel: currentLevel,
        displayedFeatureCount: lastRender?.displayedFeatureCount ?? 0
      };
    }
  };
}

function estimateFrameRate(durationMs = 500): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now();
    let frames = 0;

    function tick(time: number): void {
      frames += 1;

      if (time - start >= durationMs) {
        resolve((frames * 1000) / Math.max(1, time - start));
        return;
      }

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}
