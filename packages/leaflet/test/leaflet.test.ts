import {
  createSyntheticGridDataset,
  exerciseTerritoryRendererAdapterContract
} from "@territory-kit/shared-testkit";
import { isTerritoryError } from "@territory-kit/dataset";
import { createTerritoryRuntime } from "@territory-kit/runtime";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createLeafletTerritoryAdapter,
  createTerritoryLeafletAdapter,
  createTerritoryLeafletSource,
  zonesToLeafletFeatureCollection
} from "../src/index.js";
import type {
  TerritoryLeafletGeoJsonLayer,
  TerritoryLeafletLayer,
  TerritoryLeafletMap,
  TerritoryLeafletTerritoryEvent
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

describe("leaflet adapter", () => {
  it("passes the shared renderer adapter contract", async () => {
    const harness = createLeafletHarness();
    const clicked: string[] = [];
    const hovered: string[] = [];
    const result = await exerciseTerritoryRendererAdapterContract({
      name: "leaflet",
      sourceId: "zones",
      createTarget: () => harness.map,
      createAdapter: () =>
        createTerritoryLeafletAdapter({
          zones: [],
          sourceId: "zones",
          createGeoJsonLayer: () => harness.layer,
          onTerritoryClick: (event) => clicked.push(event.territoryId),
          onTerritoryHover: (event) => hovered.push(event.territoryId)
        }),
      readSourceUpdateCount: () => harness.layer.addDataCalls,
      readListenerCount: () => harness.layer.listenerCount(),
      readLayerCount: () => harness.map.layerCount(),
      emitClick: (_target, territoryId) => harness.layer.emit("click", territoryId),
      emitHover: (_target, territoryId) => harness.layer.emit("mouseover", territoryId)
    });

    expect(result).toMatchObject({
      lifecycle: ["detached", "attached", "detached"],
      beforeAttachErrorCode: "ADAPTER_NOT_ATTACHED",
      unsupportedVectorTileErrorCode: "CAPABILITY_UNSUPPORTED",
      listenerCountAfterDetach: 0,
      layerCountAfterDetach: 0
    });
    expect(result.sourceUpdateCount).toBeGreaterThanOrEqual(1);
    expect(clicked).toHaveLength(1);
    expect(hovered).toHaveLength(1);
  });

  it("converts zones to Leaflet-ready GeoJSON", () => {
    const dataset = createSyntheticGridDataset({
      datasetId: "leaflet-grid",
      rows: 1,
      columns: 1,
      level: 1
    });
    const collection = zonesToLeafletFeatureCollection(
      dataset.zones,
      new Map([[dataset.zones[0]?.id ?? "", { selected: true }]])
    );

    expect(collection.features[0]).toMatchObject({
      id: dataset.zones[0]?.id,
      properties: {
        territoryId: dataset.zones[0]?.id,
        datasetId: "leaflet-grid",
        adminLevel: "ADM1",
        selected: true
      }
    });
  });

  it("integrates with runtime without duplicate completed viewport requests", async () => {
    const dataset = createSyntheticGridDataset({
      datasetId: "leaflet-runtime-grid",
      rows: 2,
      columns: 2,
      level: 0,
      cellSize: 1
    });
    const harness = createLeafletHarness();
    const adapter = createTerritoryLeafletAdapter({
      zones: [],
      sourceId: "runtime-zones",
      createGeoJsonLayer: () => harness.layer
    });
    const contractAdapter: TerritoryRendererAdapter<TerritoryLeafletMap> = adapter;

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
    expect(harness.layer.lastData?.features).toHaveLength(4);
  });

  it("disposes layers and rejects later operations", () => {
    const harness = createLeafletHarness();
    const adapter = createTerritoryLeafletAdapter({
      zones: [],
      sourceId: "zones",
      createGeoJsonLayer: () => harness.layer
    });

    adapter.attach(harness.map);
    adapter.dispose();

    expect(harness.layer.listenerCount()).toBe(0);
    expect(harness.map.layerCount()).toBe(0);
    expectTerritoryError(
      () =>
        adapter.setSource({
          id: "zones",
          type: "geojson",
          data: { type: "FeatureCollection", features: [] }
        }),
      "ADAPTER_DISPOSED"
    );
  });

  it("does not commit an already aborted source replacement", () => {
    const dataset = createSyntheticGridDataset({
      datasetId: "leaflet-abort-grid",
      rows: 1,
      columns: 1,
      level: 0
    });
    const harness = createLeafletHarness();
    const adapter = createTerritoryLeafletAdapter({
      zones: [],
      sourceId: "zones",
      createGeoJsonLayer: () => harness.layer
    });
    const controller = new AbortController();

    adapter.attach(harness.map);
    controller.abort();
    adapter.setSource(
      {
        id: "zones",
        type: "geojson",
        data: zonesToLeafletFeatureCollection(dataset.zones)
      },
      { requestId: "aborted", revision: 1, signal: controller.signal }
    );

    expect(harness.layer.addDataCalls).toBe(0);
    expect(harness.layer.lastData).toBeUndefined();
  });

  it("rejects unsupported source CRS and resolves registry source metadata", async () => {
    const harness = createLeafletHarness();
    const adapter = createTerritoryLeafletAdapter({
      zones: [],
      sourceId: "zones",
      createGeoJsonLayer: () => harness.layer
    });

    adapter.attach(harness.map);

    expectTerritoryError(
      () =>
        adapter.setSource({
          id: "zones",
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          metadata: { crs: "EPSG:5254" }
        }),
      "RUNTIME_CONFIGURATION_INVALID"
    );

    const registry = createRegistry("geojson");

    await expect(
      createTerritoryLeafletSource({
        registry,
        datasetId: "fixture",
        levels: ["ADM1"]
      })
    ).resolves.toMatchObject({
      source: {
        id: "territory-kit-render",
        type: "geojson",
        url: "https://cdn.example.test/fixture/adm1.geojson"
      },
      format: "geojson"
    });
  });

  it("keeps package import SSR-safe", async () => {
    await expect(import("../src/index.js")).resolves.toHaveProperty(
      "createTerritoryLeafletAdapter"
    );
  });

  it("exposes a narrow public adapter type surface", () => {
    const adapter = createTerritoryLeafletAdapter({
      zones: [],
      sourceId: "zones",
      createGeoJsonLayer: () => new LeafletGeoJsonLayerHarness()
    });
    const aliasAdapter = createLeafletTerritoryAdapter({
      createGeoJsonLayer: () => new LeafletGeoJsonLayerHarness()
    });
    const event: TerritoryLeafletTerritoryEvent = {
      territoryId: "tr:adm1:istanbul",
      originalEvent: {}
    };

    expectTypeOf(adapter).toMatchTypeOf<TerritoryRendererAdapter<TerritoryLeafletMap>>();
    expectTypeOf(aliasAdapter.updateData).parameter(0).toMatchTypeOf<readonly TerritoryZone[]>();
    expect(event.territoryId).toBe("tr:adm1:istanbul");
  });
});

function createLeafletHarness(): {
  map: LeafletMapHarness;
  layer: LeafletGeoJsonLayerHarness;
} {
  return {
    map: new LeafletMapHarness(),
    layer: new LeafletGeoJsonLayerHarness()
  };
}

class LeafletMapHarness implements TerritoryLeafletMap {
  readonly layers = new Set<TerritoryLeafletLayer>();

  addLayer(layer: TerritoryLeafletLayer): void {
    this.layers.add(layer);
  }

  removeLayer(layer: TerritoryLeafletLayer): void {
    this.layers.delete(layer);
  }

  layerCount(): number {
    return this.layers.size;
  }
}

class LeafletGeoJsonLayerHarness implements TerritoryLeafletGeoJsonLayer {
  readonly listeners = new Map<string, (event: unknown) => void>();
  addDataCalls = 0;
  lastData: FeatureCollection | undefined;
  styleUpdates = 0;

  addData(data: FeatureCollection): void {
    this.addDataCalls += 1;
    this.lastData = data;
  }

  clearLayers(): void {
    this.lastData = undefined;
  }

  setStyle(): void {
    this.styleUpdates += 1;
  }

  on(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, listener);
  }

  off(type: string): void {
    this.listeners.delete(type);
  }

  remove(): void {
    this.listeners.clear();
  }

  emit(type: string, territoryId: string): void {
    this.listeners.get(type)?.({
      target: {
        feature: {
          type: "Feature",
          id: territoryId,
          properties: { territoryId },
          geometry: null
        }
      }
    });
  }

  listenerCount(): number {
    return this.listeners.size;
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
          levels: ["ADM1"],
          source: { provider: "fixture" },
          license: { id: "Apache-2.0", attribution: "fixture" },
          artifacts: []
        },
        artifact: {
          id: "adm1-render",
          purpose: "render",
          format,
          levels: ["ADM1"],
          url: format === "geojson" ? "fixture/adm1.geojson" : "fixture/render/manifest.json",
          sha256: "0".repeat(64),
          sizeBytes: 1,
          ...(format === "mvt" ? { tileUrlTemplate: "tiles/{z}/{x}/{y}.mvt" } : {})
        },
        url:
          format === "geojson"
            ? "https://cdn.example.test/fixture/adm1.geojson"
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
