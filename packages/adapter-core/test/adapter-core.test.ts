import { describe, expect, expectTypeOf, it } from "vitest";
import { TerritoryError, isTerritoryError } from "@territory-kit/dataset";
import {
  assertTerritoryAdapterAttached,
  assertTerritoryAdapterCapability,
  createTerritoryAdapterLifecycle,
  defineTerritoryAdapterCapabilities,
  hasTerritoryAdapterCapability,
  isTerritoryFeatureCollection,
  readFirstTerritoryRenderFeature,
  readTerritoryFeatureId,
  territoryZonesToFeatureCollection
} from "../src/index.js";
import type { TerritoryZone } from "@territory-kit/dataset";
import type {
  TerritoryRendererAdapter,
  TerritoryRenderSource,
  TerritoryRenderState,
  TerritoryRenderTheme
} from "../src/index.js";

describe("adapter-core contracts", () => {
  it("normalizes immutable capability objects", () => {
    const capabilities = defineTerritoryAdapterCapabilities({
      geoJson: true,
      vectorTiles: undefined,
      click: true,
      customRuntimeFlag: true
    });

    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(capabilities.geoJson).toBe(true);
    expect(capabilities.vectorTiles).toBe(false);
    expect(hasTerritoryAdapterCapability(capabilities, "customRuntimeFlag")).toBe(true);
  });

  it("throws stable errors for unsupported capabilities", () => {
    const capabilities = defineTerritoryAdapterCapabilities({ geoJson: true });

    expect(() => assertTerritoryAdapterCapability(capabilities, "geoJson")).not.toThrow();
    expect(() => assertTerritoryAdapterCapability(capabilities, "vectorTiles")).toThrow(
      TerritoryError
    );

    try {
      assertTerritoryAdapterCapability(capabilities, "vectorTiles");
    } catch (error) {
      expect(isTerritoryError(error)).toBe(true);
      expect(error).toMatchObject({ code: "CAPABILITY_UNSUPPORTED" });
    }
  });

  it("tracks attach, double attach, replacement, detach, and dispose", () => {
    const lifecycle = createTerritoryAdapterLifecycle<object>();
    const attachedLifecycle = createTerritoryAdapterLifecycle({});
    const first = {};
    const second = {};

    expect(attachedLifecycle.lifecycleState).toBe("attached");
    expect(() => attachedLifecycle.assertAttached("update theme")).not.toThrow();
    expect(lifecycle.lifecycleState).toBe("detached");
    expect(lifecycle.attach(first)).toBe("attached");
    expect(lifecycle.lifecycleState).toBe("attached");
    expect(lifecycle.attach(first)).toBe("refreshed");
    expect(lifecycle.attach(second)).toBe("replaced");
    expect(lifecycle.target).toBe(second);
    expect(lifecycle.detach()).toBe("detached");
    expect(lifecycle.detach()).toBe("noop");
    expect(lifecycle.dispose()).toBe("disposed");
    expect(lifecycle.dispose()).toBe("noop");
    expect(() => lifecycle.attach(first)).toThrow(TerritoryError);
  });

  it("marks non-disposed lifecycle failures as error", () => {
    const lifecycle = createTerritoryAdapterLifecycle<object>({});

    expect(lifecycle.fail("renderer failed")).toMatchObject({
      code: "UNKNOWN",
      message: "Adapter operation failed."
    });
    expect(lifecycle.lifecycleState).toBe("error");
    expect(
      lifecycle.fail(new TerritoryError("ADAPTER_TARGET_INVALID", "Bad target."))
    ).toMatchObject({
      code: "ADAPTER_TARGET_INVALID"
    });
  });

  it("keeps disposed terminal after fail and rejects later attach", () => {
    const lifecycle = createTerritoryAdapterLifecycle<object>();
    const target = {};

    lifecycle.attach(target);
    lifecycle.dispose();
    const error = lifecycle.fail("renderer failed after disposal");

    expect(isTerritoryError(error)).toBe(true);
    expect(lifecycle.lifecycleState).toBe("disposed");

    try {
      lifecycle.attach(target);
    } catch (attachError) {
      expect(isTerritoryError(attachError)).toBe(true);
      expect(attachError).toMatchObject({ code: "ADAPTER_DISPOSED" });
    }
  });

  it("guards updates before attach", () => {
    expect(() => assertTerritoryAdapterAttached("detached", "update state")).toThrow(
      TerritoryError
    );
    expect(() => assertTerritoryAdapterAttached("disposed", "update state")).toThrow(
      TerritoryError
    );
  });

  it("converts zones into stable GeoJSON feature collections", () => {
    const stateByZoneId = new Map([["tr:adm1:istanbul", { selected: true, score: 9 }]]);
    const collection = territoryZonesToFeatureCollection([zoneFixture()], { stateByZoneId });

    expect(isTerritoryFeatureCollection(collection)).toBe(true);
    expect(isTerritoryFeatureCollection({ type: "FeatureCollection", features: [] })).toBe(true);
    expect(isTerritoryFeatureCollection({ type: "FeatureCollection" })).toBe(false);
    expect(isTerritoryFeatureCollection(null)).toBe(false);
    expect(collection.features[0]).toMatchObject({
      id: "tr:adm1:istanbul",
      properties: {
        id: "tr:adm1:istanbul",
        territoryId: "tr:adm1:istanbul",
        datasetId: "turkey-admin",
        level: 1,
        adminLevel: "ADM1",
        countryCode: "TR",
        name: "Istanbul",
        parentId: "tr",
        source: "fixture",
        selected: true,
        score: 9
      }
    });
  });

  it("omits absent optional GeoJSON properties", () => {
    const zone = zoneFixture({ properties: {} });
    delete zone.countryCode;
    delete zone.name;
    delete zone.parentId;

    const collection = territoryZonesToFeatureCollection([zone]);

    expect(collection.features[0]?.properties).toEqual({
      id: "tr:adm1:istanbul",
      territoryId: "tr:adm1:istanbul",
      datasetId: "turkey-admin",
      level: 1,
      adminLevel: "ADM1"
    });
  });

  it("reads territory feature ids by renderer priority", () => {
    expect(readTerritoryFeatureId(null)).toBeUndefined();
    expect(readTerritoryFeatureId({ properties: { territoryId: 34 }, id: "feature-id" })).toBe(
      "34"
    );
    expect(readTerritoryFeatureId({ properties: {}, id: 27 })).toBe("27");
    expect(readTerritoryFeatureId({ properties: { id: "property-id" } })).toBe("property-id");
    expect(readTerritoryFeatureId({ properties: { id: 10 }, id: undefined })).toBe("10");
    expect(
      readTerritoryFeatureId({ properties: { territoryId: false }, id: null })
    ).toBeUndefined();
    expect(readTerritoryFeatureId({ properties: [], id: "array-properties" })).toBe(
      "array-properties"
    );
  });

  it("reads the first renderer feature across event shapes", () => {
    const listFeature = { id: "from-list" };
    const directFeature = { id: "from-direct" };
    const layerFeature = { id: "from-layer" };
    const targetFeature = { id: "from-target" };

    expect(readFirstTerritoryRenderFeature(null)).toBeUndefined();
    expect(readFirstTerritoryRenderFeature({ features: [listFeature] })).toBe(listFeature);
    expect(readFirstTerritoryRenderFeature({ features: [] })).toBeUndefined();
    expect(readFirstTerritoryRenderFeature({ feature: directFeature })).toBe(directFeature);
    expect(readFirstTerritoryRenderFeature({ layer: { feature: layerFeature } })).toBe(
      layerFeature
    );
    expect(readFirstTerritoryRenderFeature({ target: { feature: targetFeature } })).toBe(
      targetFeature
    );
    expect(readFirstTerritoryRenderFeature({ layer: [], target: [] })).toBeUndefined();
  });

  it("keeps the renderer adapter type minimal and implementation-friendly", () => {
    const adapter: TerritoryRendererAdapter<object> = {
      capabilities: defineTerritoryAdapterCapabilities({ geoJson: true }),
      lifecycleState: "attached",
      attach() {},
      detach() {},
      setSource(_source: TerritoryRenderSource) {},
      updateState(_state: TerritoryRenderState) {},
      updateTheme(_theme: TerritoryRenderTheme) {}
    };

    expectTypeOf(adapter).toMatchTypeOf<TerritoryRendererAdapter<object>>();
    expect(adapter.capabilities.geoJson).toBe(true);
  });

  it("is safe to import in browser-like runtimes", async () => {
    await expect(import("../src/index.js")).resolves.toHaveProperty(
      "defineTerritoryAdapterCapabilities"
    );
  });
});

function zoneFixture(overrides: Partial<TerritoryZone> = {}): TerritoryZone {
  return {
    id: "tr:adm1:istanbul",
    datasetId: "turkey-admin",
    countryCode: "TR",
    level: 1,
    sourceAdminLevel: "ADM1",
    semanticType: "province",
    name: "Istanbul",
    parentId: "tr",
    childIds: [],
    neighborIds: [],
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [28, 40],
          [29, 40],
          [29, 41],
          [28, 41],
          [28, 40]
        ]
      ]
    },
    center: [28.5, 40.5],
    bbox: [28, 40, 29, 41],
    properties: { source: "fixture" },
    ...overrides
  };
}
