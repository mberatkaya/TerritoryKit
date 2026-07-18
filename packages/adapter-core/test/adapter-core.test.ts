import { describe, expect, expectTypeOf, it } from "vitest";
import { TerritoryError, isTerritoryError } from "@territory-kit/dataset";
import {
  assertTerritoryAdapterAttached,
  assertTerritoryAdapterCapability,
  createTerritoryAdapterLifecycle,
  defineTerritoryAdapterCapabilities,
  hasTerritoryAdapterCapability
} from "../src/index.js";
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
