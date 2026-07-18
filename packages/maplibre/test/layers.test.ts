import {
  createSampleTerritoryDataset,
  createTurkeyAdm3DemoDataset
} from "@territory-kit/shared-testkit";
import { describe, expect, it, vi } from "vitest";
import {
  createTerritoryMapLibreAdapter,
  createTerritoryMapLibreController,
  createTerritoryMapLibreLayer,
  createTerritoryMapLibreLevelLayers,
  createTerritoryMapLibreLayers,
  createTerritoryMapLibreSource,
  setTerritoryMapLibreHoverState,
  setTerritoryMapLibreSelectedState,
  zonesToFeatureCollection
} from "../src/index.js";
import type { TerritoryMapLibreGeoJsonSource, TerritoryMapLibreMap } from "../src/index.js";
import type { TerritoryRegistryClient } from "@territory-kit/core";

describe("maplibre adapter", () => {
  it("converts zones into a GeoJSON feature collection", () => {
    const dataset = createSampleTerritoryDataset();
    const collection = zonesToFeatureCollection(dataset.zones);

    expect(collection.features).toHaveLength(dataset.zones.length);
    expect(collection.features[0]?.id).toBe("world:europe");
  });

  it("carries synthetic Turkey ADM3 neighbourhood metadata into GeoJSON features", () => {
    const collection = zonesToFeatureCollection(createTurkeyAdm3DemoDataset().zones);
    const neighbourhood = collection.features.find(
      (feature) => feature.id === "tr:adm3:demo-neighbourhood-a"
    );

    expect(neighbourhood?.properties).toMatchObject({
      id: "tr:adm3:demo-neighbourhood-a",
      level: 3,
      territory: {
        semanticType: "neighbourhood",
        localTypeName: "Mahalle",
        coverageStatus: "partial"
      }
    });
  });

  it("creates source and fill/line layer specs", () => {
    const dataset = createSampleTerritoryDataset();
    const bundle = createTerritoryMapLibreLayers(dataset.zones, {
      sourceId: "zones",
      stateByZoneId: new Map([["tr:34", { selected: true }]])
    });
    const istanbul = bundle.source.spec.data.features.find((feature) => feature.id === "tr:34");

    expect(bundle.source.id).toBe("zones");
    expect(istanbul?.properties).toMatchObject({ selected: true });
    expect(bundle.layers.map((layer) => layer.type)).toEqual(["fill", "line"]);
  });

  it("attaches, updates, binds events, and detaches from a MapLibre-like map", () => {
    const dataset = createSampleTerritoryDataset();
    const source: TerritoryMapLibreGeoJsonSource = { setData: vi.fn() };
    const layers = new Set<string>();
    const sources = new Set<string>();
    const listeners = new Map<string, (event: unknown) => void>();
    const addedSources: Record<string, Record<string, unknown>> = {};
    const map: TerritoryMapLibreMap = {
      addLayer(layer) {
        layers.add(String(layer.id));
      },
      addSource(id, spec) {
        sources.add(id);
        addedSources[id] = spec;
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
      setFeatureState: vi.fn(),
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
      stateByZoneId: new Map([["tr:34", { selected: true }]]),
      onZoneClick(event) {
        clicked.push(event.zoneId);
      }
    });

    adapter.attach(map);
    adapter.attach(map);
    adapter.updateData(dataset.zones.slice(0, 1));
    adapter.updateTheme({ fillColor: "#ff0000" });
    listeners.get("click:zones-fill")?.({
      features: [{ type: "Feature", id: "tr:34", properties: {}, geometry: null }]
    });
    adapter.detach();

    expect(source.setData).toHaveBeenCalledOnce();
    expect(addedSources.zones).toMatchObject({
      data: {
        features: expect.arrayContaining([
          expect.objectContaining({
            id: "tr:34",
            properties: expect.objectContaining({ selected: true })
          })
        ])
      }
    });
    expect(map.setPaintProperty).toHaveBeenCalledWith("zones-fill", "fill-color", "#ff0000");
    setTerritoryMapLibreHoverState(map, {
      sourceId: "zones",
      sourceLayer: "territory",
      territoryId: "tr:34",
      hover: true
    });
    setTerritoryMapLibreSelectedState(map, {
      sourceId: "zones",
      territoryId: "tr:34",
      selected: true
    });
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: "zones", sourceLayer: "territory", id: "tr:34" },
      { hover: true }
    );
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: "zones", id: "tr:34" },
      { selected: true }
    );
    expect(clicked).toEqual(["tr:34"]);
    expect(layers.size).toBe(0);
    expect(sources.size).toBe(0);
  });

  it("creates registry-backed vector sources and lazy territory resolution", async () => {
    const dataset = createSampleTerritoryDataset();
    const registry: Pick<TerritoryRegistryClient, "resolveArtifact" | "installDataset"> = {
      async resolveArtifact() {
        return {
          dataset: {
            id: "sample",
            displayName: "Sample",
            version: "1.0.0",
            schemaVersion: "territory-schema@1",
            levels: ["ADM0" as const],
            source: { provider: "fixture" },
            license: { id: "Apache-2.0", attribution: "fixture" },
            artifacts: []
          },
          artifact: {
            id: "render-manifest",
            purpose: "render",
            format: "mvt",
            url: "render/manifest.json",
            sha256: "0".repeat(64),
            sizeBytes: 1,
            tileUrlTemplate: "tiles/{z}/{x}/{y}.mvt"
          },
          url: "https://cdn.example.test/datasets/sample/render/manifest.json",
          registryHash: "hash"
        };
      },
      async installDataset() {
        const text = JSON.stringify(dataset);

        return {
          dataset: {
            id: "sample",
            displayName: "Sample",
            version: "1.0.0",
            schemaVersion: "territory-schema@1",
            levels: ["ADM0"],
            source: { provider: "fixture" },
            license: { id: "Apache-2.0", attribution: "fixture" },
            artifacts: []
          },
          registryHash: "hash",
          manifest: {
            datasetId: "sample",
            version: "1.0.0",
            artifactCount: 1,
            installedAt: "2026-01-01T00:00:00.000Z",
            verified: true,
            registryHash: "hash"
          },
          installedArtifacts: [
            {
              key: { datasetId: "sample", version: "1.0.0", artifactId: "adm0" },
              artifact: {
                id: "adm0",
                purpose: "query",
                format: "territory-json",
                path: "levels/ADM0/dataset.json",
                url: "levels/ADM0/dataset.json",
                sha256: "0".repeat(64),
                sizeBytes: text.length
              },
              metadata: {
                datasetId: "sample",
                version: "1.0.0",
                artifactId: "adm0",
                sha256: "0".repeat(64),
                sizeBytes: text.length,
                installedAt: "2026-01-01T00:00:00.000Z",
                sourceUrl: "memory://adm0",
                registryHash: "hash",
                compression: "none"
              },
              bytes: new TextEncoder().encode(text)
            }
          ],
          async readText() {
            return text;
          },
          async readBytes() {
            return new TextEncoder().encode(text);
          },
          async resolveArtifact() {
            return text;
          }
        };
      }
    };

    await expect(
      createTerritoryMapLibreSource({ registry, datasetId: "sample", levels: ["ADM0"] })
    ).resolves.toMatchObject({
      source: {
        id: "territory-kit-render",
        spec: {
          type: "vector",
          tiles: ["https://cdn.example.test/datasets/sample/render/tiles/{z}/{x}/{y}.mvt"]
        }
      },
      sourceLayer: "territory"
    });
    const territoryArtifactRequests: unknown[] = [];
    const deepestAvailableRequests: unknown[] = [];
    const lowerRegistry: Pick<
      TerritoryRegistryClient,
      "resolveArtifact" | "resolveTerritoryArtifact" | "resolveDeepestAvailableTerritoryArtifact"
    > = {
      ...registry,
      async resolveTerritoryArtifact(options) {
        territoryArtifactRequests.push(options);

        return {
          requestedLevel: "ADM3",
          resolvedLevel: "ADM3",
          exactMatch: true,
          reason: "exact-match",
          coverageStatus: "partial",
          dataset: {
            id: "tr-demo",
            displayName: "Turkey Demo",
            version: "1.0.0",
            schemaVersion: "territory-schema@1",
            country: { alpha2: "TR" },
            levels: ["ADM3"],
            source: { provider: "fixture" },
            license: { id: "Apache-2.0", attribution: "fixture" },
            artifacts: []
          },
          artifact: {
            id: "tr-adm3",
            purpose: "render",
            format: "mvt",
            levels: ["ADM3"],
            url: "tr/adm3/manifest.json",
            sha256: "1".repeat(64),
            sizeBytes: 1,
            layer: "territory_adm3",
            tileUrlTemplate: "adm3/{z}/{x}/{y}.mvt"
          },
          url: "https://cdn.example.test/tr/adm3/manifest.json",
          registryHash: "hash"
        };
      },
      async resolveDeepestAvailableTerritoryArtifact(options) {
        deepestAvailableRequests.push(options);

        return {
          requestedLevel: "ADM3",
          resolvedLevel: "ADM2",
          exactMatch: false,
          reason: "requested-level-unavailable",
          coverageStatus: "source-unavailable",
          dataset: {
            id: "tr-demo",
            displayName: "Turkey Demo",
            version: "1.0.0",
            schemaVersion: "territory-schema@1",
            country: { alpha2: "TR" },
            levels: ["ADM2"],
            source: { provider: "fixture" },
            license: { id: "Apache-2.0", attribution: "fixture" },
            artifacts: []
          },
          artifact: {
            id: "tr-adm2",
            purpose: "render",
            format: "geojson",
            levels: ["ADM2"],
            url: "tr/adm2.geojson",
            sha256: "2".repeat(64),
            sizeBytes: 1
          },
          url: "https://cdn.example.test/tr/adm2.geojson",
          registryHash: "hash"
        };
      }
    };

    await expect(
      createTerritoryMapLibreSource({ registry: lowerRegistry, country: "TR", level: "ADM3" })
    ).resolves.toMatchObject({
      source: { spec: { type: "vector" } },
      sourceLayer: "territory_adm3",
      requestedLevel: "ADM3",
      renderedLevel: "ADM3",
      exactMatch: true,
      coverageStatus: "partial",
      format: "mvt"
    });
    await expect(
      createTerritoryMapLibreSource({
        registry: lowerRegistry,
        country: "TR",
        level: "ADM3",
        parentId: "tr:adm2:covered"
      })
    ).resolves.toMatchObject({
      requestedLevel: "ADM3",
      renderedLevel: "ADM3",
      exactMatch: true
    });
    expect(territoryArtifactRequests.at(-1)).toMatchObject({
      parentId: "tr:adm2:covered"
    });
    await expect(
      createTerritoryMapLibreSource({
        registry: lowerRegistry,
        country: "TR",
        level: "ADM3",
        parentId: "tr:adm2:uncovered",
        fallback: "deepest-available"
      })
    ).resolves.toMatchObject({
      source: { spec: { type: "geojson", data: "https://cdn.example.test/tr/adm2.geojson" } },
      requestedLevel: "ADM3",
      renderedLevel: "ADM2",
      exactMatch: false,
      fallbackReason: "requested-level-unavailable",
      coverageStatus: "source-unavailable",
      format: "geojson"
    });
    expect(deepestAvailableRequests.at(-1)).toMatchObject({
      parentId: "tr:adm2:uncovered"
    });

    expect(createTerritoryMapLibreLayer({ sourceId: "render" })).toHaveLength(2);
    expect(createTerritoryMapLibreLevelLayers({ sourceId: "render" })).toHaveLength(12);

    const controller = createTerritoryMapLibreController({ registry, datasetId: "sample" });
    const clicked: string[] = [];
    const listener = controller.onTerritoryClick((event) => clicked.push(event.territoryId));
    listener({
      features: [{ type: "Feature", properties: { territoryId: "tr:34" }, geometry: null }]
    });

    await expect(controller.resolveTerritory("tr:34")).resolves.toMatchObject({ id: "tr:34" });
    expect(clicked).toEqual(["tr:34"]);
  });
});
