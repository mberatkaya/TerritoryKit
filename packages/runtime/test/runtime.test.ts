import { describe, expect, it, vi } from "vitest";
import { TerritoryError, isTerritoryError } from "@territory-kit/dataset";
import { createTerritoryRuntime } from "../src/index.js";
import type { TerritoryRuntimeEvent } from "../src/index.js";

describe("territory runtime lifecycle", () => {
  it("creates an idle runtime with isolated state", () => {
    const first = createTerritoryRuntime();
    const second = createTerritoryRuntime();

    expect(first.getState()).toEqual({
      status: "idle",
      disposed: false,
      eventSequence: 0
    });
    expect(second).not.toBe(first);
  });

  it("subscribes, deduplicates, unsubscribes, and reports deterministic dispose events", () => {
    const runtime = createTerritoryRuntime();
    const events: string[] = [];
    const listener = (event: TerritoryRuntimeEvent): void => {
      events.push(`${event.sequence}:${event.type}:${event.state.status}`);
    };
    const firstSubscription = runtime.subscribe(listener);
    const secondSubscription = runtime.subscribe(listener);

    expect(firstSubscription.active).toBe(true);
    expect(secondSubscription.active).toBe(true);
    expect(runtime.dispose()).toEqual({
      status: "disposed",
      alreadyDisposed: false,
      listenerCount: 1
    });
    expect(events).toEqual(["1:state-change:disposed", "2:disposed:disposed"]);
    expect(firstSubscription.active).toBe(false);
    expect(secondSubscription.unsubscribe()).toBe(false);
  });

  it("isolates listener failures and notifies remaining listeners", () => {
    const runtime = createTerritoryRuntime();
    const errors: string[] = [];
    const logger = {
      error: vi.fn()
    };
    const withLogger = createTerritoryRuntime({ logger });

    runtime.subscribe(() => {
      throw new Error("listener exploded");
    });
    runtime.subscribe((event) => {
      errors.push(event.type);
    });
    runtime.dispose();

    expect(errors).toEqual(["state-change", "listener-error", "disposed", "listener-error"]);

    withLogger.subscribe(() => {
      throw new Error("logged listener failure");
    });
    withLogger.dispose();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "listener-error",
        error: expect.objectContaining({ code: "UNKNOWN" })
      })
    );

    const codedRuntime = createTerritoryRuntime();
    const codedErrors: string[] = [];
    codedRuntime.subscribe(() => {
      throw new TerritoryError("RUNTIME_NOT_READY", "Not ready.");
    });
    codedRuntime.subscribe((event) => {
      if (event.error) {
        codedErrors.push(event.error.code);
      }
    });
    codedRuntime.dispose();
    expect(codedErrors).toEqual(["RUNTIME_NOT_READY", "RUNTIME_NOT_READY"]);
  });

  it("allows double dispose but rejects invalid post-dispose operations", () => {
    const runtime = createTerritoryRuntime();

    runtime.dispose();
    expect(runtime.dispose()).toEqual({
      status: "disposed",
      alreadyDisposed: true,
      listenerCount: 0
    });

    expect(() => runtime.subscribe(() => {})).toThrow(TerritoryError);

    try {
      runtime.unsubscribe(() => {});
    } catch (error) {
      expect(isTerritoryError(error)).toBe(true);
      expect(error).toMatchObject({ code: "RUNTIME_DISPOSED" });
    }
  });

  it("is safe to import in Node and browser-like runtimes", async () => {
    await expect(import("../src/index.js")).resolves.toHaveProperty("createTerritoryRuntime");
  });
});
