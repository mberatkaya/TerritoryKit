import {
  createSyntheticGridDataset,
  exerciseTerritoryRendererAdapterContract
} from "@territory-kit/shared-testkit";
import { isTerritoryError } from "@territory-kit/dataset";
import { createTerritoryRuntime } from "@territory-kit/runtime";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  assertOpenLayersProjectionCompatible,
  createOpenLayersTerritoryAdapter,
  createTerritoryOpenLayersAdapter,
  createTerritoryOpenLayersSource,
  readOpenLayersViewport,
  zonesToOpenLayersFeatureCollection
} from "../src/index.js";
import type {
  TerritoryOpenLayersFeature,
  TerritoryOpenLayersGeoJsonFormat,
  TerritoryOpenLayersLayer,
  TerritoryOpenLayersMap,
  TerritoryOpenLayersSource,
  TerritoryOpenLayersTerritoryEvent,
  TerritoryOpenLayersVectorTileSource
} from "../src/index.js";
import type { TerritoryRendererAdapter } from "@territory-kit/adapter-core";
import type { TerritoryZone } from "@territory-kit/dataset";
import type { TerritoryRegistryClient } from "@territory-kit/registry";
import type { FeatureCollection } from "geojson";

const VIEWPORT = {
  bounds: { west: 0, south: 0, east: 2, north: 2 },
  zoom: 4,
  level: 0
};

describe("openlayers adapter", () => {
  it("passes the shared renderer adapter contract", async () => {
    const harness = createOpenLayersHarness();
    const clicked: string[] = [];
    const hovered: string[] = [];
    const result = await exerciseTerritoryRendererAdapterContract({
      name: "openlayers",
      sourceId: "zones",
      createTarget: () => harness.map,
      createAdapter: () =>
        createTerritoryOpenLayersAdapter({
          zones: [],
          sourceId: "zones",
          geoJsonFormat: harness.format,
          vectorSource: harness.source,
          vectorLayer: harness.layer,
          onTerritoryClick: (event) => clicked.push(event.territoryId),
          onTerritoryHover: (event) => hovered.push(event.territoryId)
        }),
      readSourceUpdateCount: () => harness.source.addFeaturesCalls,
      readListenerCount: () => harness.map.listenerCount(),
      readLayerCount: () => harness.map.layerCount(),
      emitClick: (_target, territoryId) => harness.map.emit("click", territoryId),
      emitHover: (_target, territoryId) => harness.map.emit("pointermove", territoryId)
    });

    expect(result).toMatchObject({
      lifecycle: ["detached", "attached", "detached"],
      beforeAttachErrorCode: "ADAPTER_NOT_ATTACHED",
      unsupportedVectorTileErrorCode: "CAPABILITY_UNSUPPORTED",
      listenerCountAfterDetach: 0,
      layerCountAfterDetach: 0
    });
    expect(result.sourceUpdateCount).toBeGreaterThanOrEqual(2);
    expect(clicked).toHaveLength(1);
    expect(hovered).toHaveLength(1);
  });

  it("converts zones and inspects OpenLayers viewports", () => {
    const dataset = createSyntheticGridDataset({
      datasetId: "openlayers-grid",
      rows: 1,
      columns: 1,
      level: 2
    });
    const collection = zonesToOpenLayersFeatureCollection(dataset.zones);
    const harness = createOpenLayersHarness();

    expect(collection.features[0]).toMatchObject({
      properties: {
        datasetId: "openlayers-grid",
        adminLevel: "ADM2"
      }
    });
    expect(readOpenLayersViewport(harness.map)).toMatchObject({
      bounds: { west: 0, south: 0, east: 2, north: 2 },
      zoom: 4,
      center: { lng: 1, lat: 1 }
    });
  });

  it("integrates with runtime without duplicate completed viewport requests", async () => {
    const dataset = createSyntheticGridDataset({
      datasetId: "openlayers-runtime-grid",
      rows: 2,
      columns: 2,
      level: 0,
      cellSize: 1
    });
    const harness = createOpenLayersHarness();
    const adapter = createTerritoryOpenLayersAdapter({
      zones: [],
      sourceId: "runtime-zones",
      geoJsonFormat: harness.format,
      vectorSource: harness.source,
      vectorLayer: harness.layer
    });
    const contractAdapter: TerritoryRendererAdapter<TerritoryOpenLayersMap> = adapter;

    adapter.attach(harness.map);
    const runtime = createTerritoryRuntime({
      dataset,
      adapter: contractAdapter,
      adapterSourceId: "runtime-zones",
      cache: false
    });

    const first = await runtime.setViewport(VIEWPORT);
    const duplicate = await runtime.setViewport(VIEWPORT);

    expect(first?.status).toBe("ready");
    expect(duplicate).toEqual(first);
    expect(harness.source.features).toHaveLength(4);
  });

  it("checks projection contracts and CRS metadata", () => {
    expect(() =>
      assertOpenLayersProjectionCompatible({
        dataProjection: "EPSG:4326",
        viewProjection: "EPSG:3857"
      })
    ).toThrow(expect.objectContaining({ code: "RUNTIME_CONFIGURATION_INVALID" }));

    const harness = createOpenLayersHarness({ projection: "EPSG:3857" });

    expectTerritoryError(
      () =>
        createTerritoryOpenLayersAdapter({
          zones: [],
          geoJsonFormat: harness.format,
          vectorSource: harness.source,
          vectorLayer: harness.layer
        }).attach(harness.map),
      "RUNTIME_CONFIGURATION_INVALID"
    );

    const projected = createOpenLayersHarness({ projection: "EPSG:3857" });
    const adapter = createTerritoryOpenLayersAdapter({
      zones: [],
      geoJsonFormat: projected.format,
      vectorSource: projected.source,
      vectorLayer: projected.layer,
      featureProjection: "EPSG:3857"
    });

    adapter.attach(projected.map);
    expectTerritoryError(
      () =>
        adapter.setSource({
          id: "territory-kit-zones",
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          metadata: { crs: "EPSG:5254" }
        }),
      "RUNTIME_CONFIGURATION_INVALID"
    );
  });

  it("does not commit an already aborted source replacement", () => {
    const dataset = createSyntheticGridDataset({
      datasetId: "openlayers-abort-grid",
      rows: 1,
      columns: 1,
      level: 0
    });
    const harness = createOpenLayersHarness();
    const adapter = createTerritoryOpenLayersAdapter({
      zones: [],
      sourceId: "zones",
      geoJsonFormat: harness.format,
      vectorSource: harness.source,
      vectorLayer: harness.layer
    });
    const controller = new AbortController();

    adapter.attach(harness.map);
    controller.abort();
    adapter.setSource(
      {
        id: "zones",
        type: "geojson",
        data: zonesToOpenLayersFeatureCollection(dataset.zones)
      },
      { requestId: "aborted", revision: 1, signal: controller.signal }
    );

    expect(harness.source.addFeaturesCalls).toBe(1);
    expect(harness.source.features).toHaveLength(0);
  });

  it("supports optional vector tile factories and registry MVT metadata", async () => {
    const harness = createOpenLayersHarness();
    const vectorTileSource: TerritoryOpenLayersVectorTileSource = { type: "vector-tile" };
    const vectorTileLayer = new OpenLayersLayerHarness();
    const adapter = createTerritoryOpenLayersAdapter({
      zones: [],
      sourceId: "tiles",
      geoJsonFormat: harness.format,
      vectorSource: harness.source,
      vectorLayer: harness.layer,
      createVectorTileSource: () => vectorTileSource,
      createVectorTileLayer: () => vectorTileLayer
    });

    adapter.attach(harness.map);
    adapter.setSource({
      id: "tiles",
      type: "vector-tiles",
      tiles: ["https://cdn.example.test/tiles/{z}/{x}/{y}.mvt"]
    });

    expect(adapter.capabilities.vectorTiles).toBe(true);
    expect(harness.map.layers.has(vectorTileLayer)).toBe(true);

    await expect(
      createTerritoryOpenLayersSource({
        registry: createRegistry("mvt"),
        datasetId: "fixture",
        levels: ["ADM3"]
      })
    ).resolves.toMatchObject({
      source: {
        id: "territory-kit-render",
        type: "vector-tiles",
        tiles: ["https://cdn.example.test/fixture/render/tiles/{z}/{x}/{y}.mvt"]
      },
      format: "mvt"
    });
  });

  it("keeps package import SSR-safe", async () => {
    await expect(import("../src/index.js")).resolves.toHaveProperty(
      "createTerritoryOpenLayersAdapter"
    );
  });

  it("exposes a narrow public adapter type surface", () => {
    const harness = createOpenLayersHarness();
    const adapter = createOpenLayersTerritoryAdapter({
      geoJsonFormat: harness.format,
      vectorSource: harness.source,
      vectorLayer: harness.layer
    });
    const event: TerritoryOpenLayersTerritoryEvent = {
      territoryId: "tr:adm2:fatih",
      originalEvent: {}
    };

    expectTypeOf(adapter).toMatchTypeOf<TerritoryRendererAdapter<TerritoryOpenLayersMap>>();
    expectTypeOf(adapter.updateData).parameter(0).toMatchTypeOf<readonly TerritoryZone[]>();
    expect(event.territoryId).toBe("tr:adm2:fatih");
  });
});

function createOpenLayersHarness(options: { projection?: string } = {}): {
  map: OpenLayersMapHarness;
  source: OpenLayersSourceHarness;
  layer: OpenLayersLayerHarness;
  format: OpenLayersGeoJsonFormatHarness;
} {
  const source = new OpenLayersSourceHarness();
  const layer = new OpenLayersLayerHarness();

  return {
    source,
    layer,
    format: new OpenLayersGeoJsonFormatHarness(),
    map: new OpenLayersMapHarness(options.projection ?? "EPSG:4326")
  };
}

class OpenLayersFeatureHarness implements TerritoryOpenLayersFeature {
  readonly values = new Map<string, unknown>();

  constructor(readonly id: string) {
    this.values.set("territoryId", id);
    this.values.set("id", id);
  }

  getId(): string {
    return this.id;
  }

  get(key: string): unknown {
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

class OpenLayersGeoJsonFormatHarness implements TerritoryOpenLayersGeoJsonFormat {
  readFeatures(data: FeatureCollection): TerritoryOpenLayersFeature[] {
    return data.features.map(
      (feature) =>
        new OpenLayersFeatureHarness(
          String(feature.properties?.territoryId ?? feature.id ?? feature.properties?.id)
        )
    );
  }
}

class OpenLayersSourceHarness implements TerritoryOpenLayersSource {
  features: TerritoryOpenLayersFeature[] = [];
  addFeaturesCalls = 0;

  clear(): void {
    this.features = [];
  }

  addFeatures(features: readonly TerritoryOpenLayersFeature[]): void {
    this.addFeaturesCalls += 1;
    this.features = [...features];
  }

  getFeatures(): readonly TerritoryOpenLayersFeature[] {
    return this.features;
  }
}

class OpenLayersLayerHarness implements TerritoryOpenLayersLayer {
  source: TerritoryOpenLayersSource | TerritoryOpenLayersVectorTileSource | undefined;
  style: unknown;
  changedCalls = 0;

  setSource(source: TerritoryOpenLayersSource | TerritoryOpenLayersVectorTileSource): void {
    this.source = source;
  }

  getSource(): TerritoryOpenLayersSource | TerritoryOpenLayersVectorTileSource | undefined {
    return this.source;
  }

  setStyle(style: unknown): void {
    this.style = style;
  }

  changed(): void {
    this.changedCalls += 1;
  }
}

class OpenLayersMapHarness implements TerritoryOpenLayersMap {
  readonly layers = new Set<TerritoryOpenLayersLayer>();
  readonly listeners = new Map<string, (event: unknown) => void>();
  pickedFeature: TerritoryOpenLayersFeature | undefined;

  constructor(readonly projection: string) {}

  addLayer(layer: TerritoryOpenLayersLayer): void {
    this.layers.add(layer);
  }

  removeLayer(layer: TerritoryOpenLayersLayer): void {
    this.layers.delete(layer);
  }

  getView() {
    return {
      getZoom: () => 4,
      getCenter: () => [1, 1] as const,
      calculateExtent: () => [0, 0, 2, 2] as const,
      getProjection: () => ({
        getCode: () => this.projection
      })
    };
  }

  getSize(): number[] {
    return [256, 256];
  }

  on(type: string, listener: (event: unknown) => void): string {
    this.listeners.set(type, listener);
    return type;
  }

  un(type: string): void {
    this.listeners.delete(type);
  }

  forEachFeatureAtPixel(
    _pixel: unknown,
    callback: (feature: unknown) => unknown
  ): TerritoryOpenLayersFeature | undefined {
    return this.pickedFeature
      ? (callback(this.pickedFeature) as TerritoryOpenLayersFeature | undefined)
      : undefined;
  }

  emit(type: string, territoryId: string): void {
    this.pickedFeature = new OpenLayersFeatureHarness(territoryId);
    this.listeners.get(type)?.({ pixel: [0, 0] });
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  layerCount(): number {
    return this.layers.size;
  }
}

function createRegistry(
  format: "geojson" | "mvt"
): Pick<TerritoryRegistryClient, "resolveArtifact"> {
  return {
    async resolveArtifact() {
      return {
        dataset: {
          id: "fixture",
          displayName: "Fixture",
          version: "1.0.0",
          schemaVersion: "territory-schema@1",
          levels: ["ADM3"],
          source: { provider: "fixture" },
          license: { id: "Apache-2.0", attribution: "fixture" },
          artifacts: []
        },
        artifact: {
          id: "adm3-render",
          purpose: "render",
          format,
          levels: ["ADM3"],
          url: format === "geojson" ? "fixture/adm3.geojson" : "fixture/render/manifest.json",
          sha256: "0".repeat(64),
          sizeBytes: 1,
          ...(format === "mvt"
            ? {
                layer: "territory_adm3",
                tileUrlTemplate: "tiles/{z}/{x}/{y}.mvt"
              }
            : {})
        },
        url:
          format === "geojson"
            ? "https://cdn.example.test/fixture/adm3.geojson"
            : "https://cdn.example.test/fixture/render/manifest.json",
        registryHash: "hash"
      };
    }
  };
}

function expectTerritoryError(action: () => void, code: string): void {
  try {
    action();
    throw new Error("Expected action to throw.");
  } catch (error) {
    expect(isTerritoryError(error)).toBe(true);
    expect(error).toMatchObject({ code });
  }
}
