import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { TerritoryRegistryClient } from "@territory-kit/registry";
import { TerritoryError } from "@territory-kit/dataset";
import { createDefaultMapStyle, createTurkeyMapRenderService } from "../src/render.js";
import { createFixtureQueryService } from "../src/query.js";
import { demoLevelForZoom, zoomForDemoLevel } from "../src/levels.js";

describe("turkey live demo render helpers", () => {
  it("uses a token-free default MapLibre style", () => {
    const style = createDefaultMapStyle();

    expect(style.sources).toEqual({});
    expect(style.layers).toHaveLength(1);
    expect(JSON.stringify(style)).not.toContain("token");
  });

  it("maps zoom levels to ADM0, ADM1, ADM2 and ADM3", () => {
    expect(demoLevelForZoom(3)).toBe("ADM0");
    expect(demoLevelForZoom(5)).toBe("ADM1");
    expect(demoLevelForZoom(9)).toBe("ADM2");
    expect(demoLevelForZoom(12)).toBe("ADM3");
    expect(zoomForDemoLevel("ADM3")).toBeGreaterThan(12);
  });

  it("keeps one active source and removes old interactive layers", async () => {
    const harness = createMapHarness();
    const renderer = createTurkeyMapRenderService({
      map: harness.map,
      mode: "fixture",
      query: createFixtureQueryService(),
      datasetVersion: "test",
      allowPrerelease: false
    });
    await renderer.render({ level: "ADM0" });
    await renderer.render({ level: "ADM1" });
    await renderer.render({ level: "ADM2" });
    expect(harness.sources.size).toBe(1);
    expect(harness.layers.size).toBe(2);
    expect(harness.removedSources).toBe(2);
    expect(harness.removedLayers).toBe(4);
  });

  it("cannot let a stale deeper request replace a newer shallow render", async () => {
    const harness = createMapHarness();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requested: string[] = [];
    const registry = {
      async resolveDeepestAvailableTerritoryArtifact(options: { requestedLevel: string }) {
        requested.push(options.requestedLevel);
        if (options.requestedLevel === "ADM3") await pending;
        return {
          dataset: { version: "1" },
          artifact: {
            format: options.requestedLevel === "ADM3" ? "mvt" : "geojson",
            layer: "territory"
          },
          registryHash: "test",
          requestedLevel: options.requestedLevel,
          resolvedLevel: options.requestedLevel,
          exactMatch: true,
          coverageStatus: "verified",
          reason: "exact-match",
          url: `https://example.test/${options.requestedLevel}.geojson`
        };
      }
    } as unknown as TerritoryRegistryClient;
    const renderer = createTurkeyMapRenderService({
      map: harness.map,
      mode: "registry",
      query: createFixtureQueryService(),
      registry,
      datasetVersion: "1",
      allowPrerelease: false
    });
    const deep = renderer.render({ level: "ADM3" });
    const shallow = await renderer.render({ level: "ADM2" });
    release();
    expect(await deep).toBeUndefined();
    expect(shallow?.renderedLevel).toBe("ADM2");
    expect(harness.sources.get("turkey-live-render")).toMatchObject({
      data: "https://example.test/ADM2.geojson"
    });
    expect(requested).toEqual(["ADM3", "ADM2"]);
  });

  it("refuses a national ADM3 GeoJSON render artifact", async () => {
    const harness = createMapHarness();
    const preferences: string[][] = [];
    const registry = {
      async resolveDeepestAvailableTerritoryArtifact(options: { formatPreference: string[] }) {
        preferences.push(options.formatPreference);
        return {
          dataset: { version: "1" },
          artifact: { format: "geojson", path: "levels/ADM3/full.geojson" },
          registryHash: "test",
          requestedLevel: "ADM3",
          resolvedLevel: "ADM3",
          exactMatch: true,
          coverageStatus: "verified",
          reason: "exact-match",
          url: "https://example.test/levels/ADM3/full.geojson"
        };
      }
    } as unknown as TerritoryRegistryClient;
    const renderer = createTurkeyMapRenderService({
      map: harness.map,
      mode: "registry",
      query: createFixtureQueryService(),
      registry,
      datasetVersion: "1",
      allowPrerelease: false
    });
    await expect(renderer.render({ level: "ADM3" })).rejects.toThrow("requires visible MVT tiles");
    expect(preferences).toEqual([["mvt"]]);
    expect(harness.sources.size).toBe(0);
  });

  it("falls back to ADM2 when ADM3 MVT is unavailable", async () => {
    const harness = createMapHarness();
    const registry = {
      async resolveDeepestAvailableTerritoryArtifact(options: { requestedLevel: string }) {
        if (options.requestedLevel === "ADM3")
          throw new TerritoryError("ARTIFACT_NOT_FOUND", "No MVT");
        return {
          dataset: { version: "1" },
          artifact: { format: "geojson" },
          registryHash: "test",
          requestedLevel: "ADM2",
          resolvedLevel: "ADM2",
          exactMatch: true,
          coverageStatus: "verified",
          reason: "exact-match",
          url: "https://example.test/ADM2.geojson"
        };
      }
    } as unknown as TerritoryRegistryClient;
    const renderer = createTurkeyMapRenderService({
      map: harness.map,
      mode: "registry",
      query: createFixtureQueryService(),
      registry,
      datasetVersion: "1",
      allowPrerelease: false
    });
    expect(await renderer.render({ level: "ADM3" })).toMatchObject({
      requestedLevel: "ADM3",
      renderedLevel: "ADM2",
      exactMatch: false,
      fallbackReason: "requested-level-unavailable"
    });
  });

  it("uses the verified MVT manifest and caps requests at its highest tile zoom", async () => {
    const harness = createMapHarness();
    const manifest = JSON.stringify({
      format: "mvt",
      tileTemplate: "tiles/{z}/{x}/{y}.mvt",
      layers: [{ adminLevels: ["ADM3"], featureCount: 12, maxZoom: 12 }]
    });
    const bytes = Buffer.from(manifest);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes));
    try {
      const registry = {
        async resolveDeepestAvailableTerritoryArtifact() {
          return {
            dataset: { version: "1" },
            artifact: {
              format: "mvt",
              layer: "territory_adm3",
              sha256: createHash("sha256").update(bytes).digest("hex"),
              sizeBytes: bytes.byteLength
            },
            registryHash: "test",
            requestedLevel: "ADM3",
            resolvedLevel: "ADM3",
            exactMatch: true,
            coverageStatus: "verified",
            reason: "exact-match",
            url: "https://example.test/render/manifest.json"
          };
        }
      } as unknown as TerritoryRegistryClient;
      const renderer = createTurkeyMapRenderService({
        map: harness.map,
        mode: "registry",
        query: createFixtureQueryService(),
        registry,
        datasetVersion: "1",
        allowPrerelease: false
      });
      expect(await renderer.render({ level: "ADM3" })).toMatchObject({
        renderArtifactFormat: "mvt",
        renderedLevel: "ADM3"
      });
      expect(harness.sources.get("turkey-live-render")).toMatchObject({
        type: "vector",
        maxzoom: 12,
        tiles: ["https://example.test/render/tiles/{z}/{x}/{y}.mvt"]
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });
});

function createMapHarness() {
  const sources = new Map<string, unknown>();
  const layers = new Map<string, unknown>();
  let removedSources = 0;
  let removedLayers = 0;
  const map = {
    addSource(id: string, source: unknown) {
      sources.set(id, source);
    },
    getSource(id: string) {
      return sources.get(id);
    },
    removeSource(id: string) {
      sources.delete(id);
      removedSources++;
    },
    addLayer(layer: { id: string }) {
      layers.set(layer.id, layer);
    },
    getLayer(id: string) {
      return layers.get(id);
    },
    removeLayer(id: string) {
      layers.delete(id);
      removedLayers++;
    },
    on() {},
    off() {},
    queryRenderedFeatures() {
      return [];
    }
  } as unknown as MapLibreMap;
  return {
    map,
    sources,
    layers,
    get removedSources() {
      return removedSources;
    },
    get removedLayers() {
      return removedLayers;
    }
  };
}
