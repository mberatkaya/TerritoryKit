import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it, vi } from "vitest";
import {
  createTerritoryMapLibreAdapter,
  createTerritoryMapLibreLayers,
  zonesToFeatureCollection
} from "../src/index.js";
import type { TerritoryMapLibreGeoJsonSource, TerritoryMapLibreMap } from "../src/index.js";

describe("maplibre adapter", () => {
  it("converts zones into a GeoJSON feature collection", () => {
    const dataset = createSampleTerritoryDataset();
    const collection = zonesToFeatureCollection(dataset.zones);

    expect(collection.features).toHaveLength(dataset.zones.length);
    expect(collection.features[0]?.id).toBe("world:europe");
  });

  it("creates source and fill/line layer specs", () => {
    const dataset = createSampleTerritoryDataset();
    const bundle = createTerritoryMapLibreLayers(dataset.zones, { sourceId: "zones" });

    expect(bundle.source.id).toBe("zones");
    expect(bundle.layers.map((layer) => layer.type)).toEqual(["fill", "line"]);
  });

  it("attaches, updates, binds events, and detaches from a MapLibre-like map", () => {
    const dataset = createSampleTerritoryDataset();
    const source: TerritoryMapLibreGeoJsonSource = { setData: vi.fn() };
    const layers = new Set<string>();
    const sources = new Set<string>();
    const listeners = new Map<string, (event: unknown) => void>();
    const map: TerritoryMapLibreMap = {
      addLayer(layer) {
        layers.add(String(layer.id));
      },
      addSource(id) {
        sources.add(id);
      },
      getLayer(id) {
        return layers.has(id) ? { id } : undefined;
      },
      getSource(id) {
        return sources.has(id) ? source : undefined;
      },
      removeLayer(id) {
        layers.delete(id);
      },
      removeSource(id) {
        sources.delete(id);
      },
      setPaintProperty: vi.fn(),
      on(type, layerId, listener) {
        listeners.set(`${type}:${layerId}`, listener);
      },
      off(type, layerId) {
        listeners.delete(`${type}:${layerId}`);
      }
    };
    const clicked: string[] = [];
    const adapter = createTerritoryMapLibreAdapter({
      zones: dataset.zones,
      sourceId: "zones",
      fillLayerId: "zones-fill",
      lineLayerId: "zones-line",
      onZoneClick(event) {
        clicked.push(event.zoneId);
      }
    });

    adapter.attach(map);
    adapter.updateData(dataset.zones.slice(0, 1));
    adapter.updateTheme({ fillColor: "#ff0000" });
    listeners.get("click:zones-fill")?.({
      features: [{ type: "Feature", id: "tr:34", properties: {}, geometry: null }]
    });
    adapter.detach();

    expect(source.setData).toHaveBeenCalledOnce();
    expect(map.setPaintProperty).toHaveBeenCalledWith("zones-fill", "fill-color", "#ff0000");
    expect(clicked).toEqual(["tr:34"]);
    expect(layers.size).toBe(0);
    expect(sources.size).toBe(0);
  });
});
