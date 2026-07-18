import { defineTerritoryAdapterCapabilities } from "@territory-kit/adapter-core";
import type { TerritoryRendererAdapter } from "@territory-kit/adapter-core";
import { createTerritoryEngine } from "@territory-kit/core";
import { TerritoryError, isTerritoryError } from "@territory-kit/dataset";
import type { TerritoryDataset } from "@territory-kit/dataset";
import { createSyntheticGridDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it, vi } from "vitest";
import { createMemoryTerritoryRuntimeCache, createTerritoryRuntime } from "../src/index.js";
import type {
  TerritoryRuntimeEvent,
  TerritoryRuntimeRequestContext,
  TerritoryRuntimeScheduler,
  TerritoryRuntimeScheduledTask,
  TerritoryRuntimeViewport
} from "../src/index.js";

const VIEWPORT: TerritoryRuntimeViewport = {
  bounds: { west: 0, south: 0, east: 2, north: 2 },
  zoom: 4,
  level: 0
};

describe("territory runtime viewport lifecycle", () => {
  it("creates an idle runtime with immutable isolated state", () => {
    const first = createTerritoryRuntime();
    const second = createTerritoryRuntime();
    const state = first.getState();

    expect(state).toMatchObject({
      status: "idle",
      revision: 0,
      disposed: false,
      eventSequence: 0,
      cache: {
        entries: 0,
        bytes: 0,
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0,
        evictions: 0
      }
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.cache)).toBe(true);
    expect(second).not.toBe(first);
  });

  it("subscribes, deduplicates, unsubscribes, and reports deterministic dispose events", () => {
    const fixedDate = new Date("2026-07-18T12:00:00.000Z");
    const clock = { now: vi.fn(() => fixedDate) };
    const runtime = createTerritoryRuntime({ clock });
    const events: string[] = [];
    const occurredAt: Date[] = [];
    const listener = (event: TerritoryRuntimeEvent): void => {
      events.push(`${event.sequence}:${event.type}:${event.state.status}`);
      occurredAt.push(event.occurredAt);
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
    expect(occurredAt).toEqual([fixedDate, fixedDate]);
    expect(clock.now).toHaveBeenCalledTimes(2);
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

  it("runs the complete direct-dataset viewport request state machine", async () => {
    const dataset = createDataset();
    const events: TerritoryRuntimeEvent[] = [];
    const runtime = createTerritoryRuntime({ dataset });
    runtime.subscribe((event) => events.push(event));

    const result = await runtime.setViewport(VIEWPORT);

    expect(result?.status).toBe("ready");
    expect(result?.summary).toMatchObject({
      requestId: "runtime-request-1",
      revision: 1,
      datasetId: dataset.manifest.datasetId,
      level: 0,
      zoneCount: 4,
      cached: false
    });
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      revision: 1,
      activeViewport: VIEWPORT,
      activeLevel: 0,
      activeDatasetId: dataset.manifest.datasetId,
      lastCompletedRequestId: "runtime-request-1",
      lastResultSummary: expect.objectContaining({ zoneCount: 4 })
    });
    expect(events.map((event) => event.type)).toEqual([
      "viewport-requested",
      "request-started",
      "dataset-resolved",
      "engine-ready",
      "cache-miss",
      "query-completed",
      "viewport-ready"
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(events.map((event) => event.state.status)).toEqual([
      "resolving",
      "resolving",
      "loading",
      "querying",
      "querying",
      "querying",
      "ready"
    ]);
  });

  it("throws stable coded errors for invalid viewport input", async () => {
    const runtime = createTerritoryRuntime({ dataset: createDataset() });

    expect(() =>
      runtime.setViewport({ bounds: { west: 200, south: 0, east: 1, north: 1 }, zoom: 1 })
    ).toThrow(expect.objectContaining({ code: "INVALID_BOUNDS" }));
    expect(() =>
      runtime.setViewport({ bounds: { west: 0, south: 2, east: 1, north: 1 }, zoom: 1 })
    ).toThrow(expect.objectContaining({ code: "INVALID_BOUNDS" }));
    expect(() => runtime.setViewport({ ...VIEWPORT, level: 8 })).toThrow(
      expect.objectContaining({
        code: "INVALID_LEVEL"
      })
    );
    expect(() => runtime.setViewport({ ...VIEWPORT, zoom: Number.NaN })).toThrow(
      expect.objectContaining({
        code: "INVALID_COORDINATE"
      })
    );

    await expect(runtime.setViewport(VIEWPORT)).resolves.toMatchObject({
      status: "ready"
    });
    expect(runtime.getState().status).toBe("ready");
    expect(runtime.getState().lastError).toBeUndefined();
  });

  it("rejects invalid refresh before any viewport has completed", () => {
    const runtime = createTerritoryRuntime({ dataset: createDataset() });

    expect(() => runtime.refresh()).toThrow(
      expect.objectContaining({
        code: "RUNTIME_NOT_READY"
      })
    );
  });

  it("keeps invalid viewport errors out of the runtime state", () => {
    const runtime = createTerritoryRuntime({ dataset: createDataset() });

    expect(() => runtime.setViewport({ ...VIEWPORT, level: 8 })).toThrow(
      expect.objectContaining({
        code: "INVALID_LEVEL"
      })
    );
    expect(runtime.getState().status).toBe("idle");
    expect(runtime.getState().lastError).toBeUndefined();
  });

  it("debounces rapid viewport updates so only the last request is processed", async () => {
    const scheduler = new FakeScheduler();
    const events: TerritoryRuntimeEvent[] = [];
    const runtime = createTerritoryRuntime({
      dataset: createDataset(),
      debounceMs: 20,
      scheduler
    });
    runtime.subscribe((event) => events.push(event));

    const requests = Array.from({ length: 10 }, (_, index) =>
      runtime.setViewport(viewportAt(index), { reason: "typing" })
    );

    expect(events.filter((event) => event.type === "viewport-scheduled")).toHaveLength(10);
    scheduler.advance(19);
    await flushPromises();
    expect(events.filter((event) => event.type === "request-started")).toHaveLength(0);

    scheduler.advance(1);
    const results = await Promise.all(requests);

    expect(results.filter((result) => result?.status === "ready")).toHaveLength(1);
    expect(results.filter((result) => result?.status === "aborted")).toHaveLength(9);
    expect(events.filter((event) => event.type === "request-started")).toHaveLength(1);
    expect(runtime.getState().activeViewport?.metadata).toEqual({ index: 9 });
  });

  it("skips duplicate completed viewports unless force is set", async () => {
    const events: TerritoryRuntimeEvent[] = [];
    const runtime = createTerritoryRuntime({ dataset: createDataset() });
    runtime.subscribe((event) => events.push(event));

    const first = await runtime.setViewport(VIEWPORT);
    const duplicate = await runtime.setViewport(VIEWPORT);
    const forced = await runtime.setViewport(VIEWPORT, { force: true });

    expect(duplicate).toEqual(first);
    expect(forced?.requestId).toBe("runtime-request-2");
    expect(events.filter((event) => event.type === "request-started")).toHaveLength(2);
    expect(events.filter((event) => event.type === "cache-hit")).toHaveLength(1);
  });

  it("deduplicates concurrent requests with the same key", async () => {
    const deferred = createDeferred<TerritoryDataset>();
    const events: TerritoryRuntimeEvent[] = [];
    const runtime = createTerritoryRuntime({
      cache: false,
      datasetResolver: {
        resolveDataset: vi.fn(() => deferred.promise)
      }
    });
    runtime.subscribe((event) => events.push(event));

    const first = runtime.setViewport(VIEWPORT);
    const second = runtime.setViewport(VIEWPORT);

    expect(second).toBe(first);
    expect(events.filter((event) => event.type === "request-deduplicated")).toHaveLength(1);
    deferred.resolve(createDataset());
    await expect(first).resolves.toMatchObject({ status: "ready" });
    expect(events.filter((event) => event.type === "request-started")).toHaveLength(1);
  });

  it("cancels active requests as a normal lifecycle result", async () => {
    const runtime = createTerritoryRuntime({
      cache: false,
      datasetResolver: {
        resolveDataset(_viewport, context) {
          return waitForAbort(context);
        }
      }
    });
    const request = runtime.setViewport(VIEWPORT);
    const cancel = runtime.cancelActiveRequest("user-pan");

    expect(cancel).toMatchObject({
      cancelled: true,
      requestId: "runtime-request-1",
      reason: "user-pan"
    });
    await expect(request).resolves.toMatchObject({
      status: "aborted",
      error: expect.objectContaining({ code: "REQUEST_ABORTED" })
    });
    expect(runtime.getState().status).toBe("idle");
  });

  it("rejects stale and late responses without updating state or adapter", async () => {
    const dataset = createDataset();
    const first = createDeferred<TerritoryDataset>();
    const second = createDeferred<TerritoryDataset>();
    const resolver = vi.fn((_viewport: TerritoryRuntimeViewport) =>
      resolver.mock.calls.length === 1 ? first.promise : second.promise
    );
    const runtime = createTerritoryRuntime({
      cache: false,
      cancelPreviousRequest: false,
      datasetResolver: { resolveDataset: resolver }
    });

    const slow = runtime.setViewport(viewportAt(0));
    const fast = runtime.setViewport(viewportAt(1));
    second.resolve(dataset);
    await expect(fast).resolves.toMatchObject({ status: "ready", requestId: "runtime-request-2" });

    first.resolve(dataset);
    await expect(slow).resolves.toMatchObject({
      status: "aborted",
      requestId: "runtime-request-1"
    });
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      lastCompletedRequestId: "runtime-request-2",
      activeViewport: viewportAt(1)
    });
  });

  it("produces a stable coded timeout error", async () => {
    const scheduler = new FakeScheduler();
    const events: TerritoryRuntimeEvent[] = [];
    const runtime = createTerritoryRuntime({
      cache: false,
      scheduler,
      datasetResolver: {
        resolveDataset: () => new Promise<TerritoryDataset>(() => undefined)
      }
    });
    runtime.subscribe((event) => events.push(event));

    const request = runtime.setViewport(VIEWPORT, { requestTimeoutMs: 50 });
    scheduler.advance(50);

    await expect(request).resolves.toMatchObject({
      status: "failed",
      error: expect.objectContaining({ code: "DOWNLOAD_TIMEOUT" })
    });
    expect(runtime.getState()).toMatchObject({
      status: "error",
      lastError: expect.objectContaining({ code: "DOWNLOAD_TIMEOUT" })
    });
    expect(events.at(-1)).toMatchObject({
      type: "request-failed",
      error: expect.objectContaining({ code: "DOWNLOAD_TIMEOUT" })
    });
  });

  it("aborts active work during dispose and rejects invalid post-dispose operations", async () => {
    const runtime = createTerritoryRuntime({
      cache: false,
      datasetResolver: {
        resolveDataset(_viewport, context) {
          return waitForAbort(context);
        }
      }
    });
    const request = runtime.setViewport(VIEWPORT);

    expect(runtime.dispose()).toEqual({
      status: "disposed",
      alreadyDisposed: false,
      listenerCount: 0
    });
    await expect(request).resolves.toMatchObject({ status: "aborted" });
    expect(runtime.dispose()).toEqual({
      status: "disposed",
      alreadyDisposed: true,
      listenerCount: 0
    });
    expect(() => runtime.subscribe(() => undefined)).toThrow(TerritoryError);

    try {
      runtime.unsubscribe(() => undefined);
    } catch (error) {
      expect(isTerritoryError(error)).toBe(true);
      expect(error).toMatchObject({ code: "RUNTIME_DISPOSED" });
    }
  });

  it("records cache misses, hits, and cached result summaries", async () => {
    const cache = createMemoryTerritoryRuntimeCache();
    const events: TerritoryRuntimeEvent[] = [];
    const runtime = createTerritoryRuntime({ dataset: createDataset(), cache });
    runtime.subscribe((event) => events.push(event));

    const first = await runtime.setViewport(VIEWPORT);
    const second = await runtime.setViewport(VIEWPORT, { force: true });

    expect(first?.summary?.cached).toBe(false);
    expect(second?.summary?.cached).toBe(true);
    expect(events.filter((event) => event.type === "cache-miss")).toHaveLength(1);
    expect(events.filter((event) => event.type === "cache-hit")).toHaveLength(1);
    expect(runtime.getState().cache).toMatchObject({
      entries: 1,
      hits: 1,
      misses: 1,
      sets: 1
    });
  });

  it("implements deterministic LRU eviction and maxEntries", async () => {
    const cache = createMemoryTerritoryRuntimeCache({ maxEntries: 2 });
    const context = fakeContext();

    await cache.set("a", new Uint8Array([1]), context);
    await cache.set("b", new Uint8Array([2]), context);
    await expect(cache.get("a", context)).resolves.toEqual(new Uint8Array([1]));
    await cache.set("c", new Uint8Array([3]), context);

    await expect(cache.get("b", context)).resolves.toBeUndefined();
    await expect(cache.get("a", context)).resolves.toEqual(new Uint8Array([1]));
    expect(cache.getSummary?.()).toMatchObject({
      entries: 2,
      evictions: 1
    });
  });

  it("tracks maxBytes and protects cached Uint8Array values from mutation by default", async () => {
    const cache = createMemoryTerritoryRuntimeCache({ maxBytes: 3 });
    const context = fakeContext();
    const source = new Uint8Array([1, 2]);

    await cache.set("a", source, context);
    source[0] = 9;
    await expect(cache.get("a", context)).resolves.toEqual(new Uint8Array([1, 2]));

    const read = await cache.get("a", context);
    expect(read).toBeDefined();
    read![1] = 9;
    await expect(cache.get("a", context)).resolves.toEqual(new Uint8Array([1, 2]));

    await cache.set("b", new Uint8Array([3, 4]), context);
    await expect(cache.get("a", context)).resolves.toBeUndefined();
    expect(cache.getSummary?.()).toMatchObject({
      entries: 1,
      bytes: 2,
      maxBytes: 3,
      evictions: 1
    });

    await cache.set("oversized", new Uint8Array([1, 2, 3, 4]), context);
    await expect(cache.get("oversized", context)).resolves.toBeUndefined();
    expect(cache.getSummary?.().bytes).toBeLessThanOrEqual(3);
  });

  it("reuses lazy engines for a direct dataset", async () => {
    const createEngine = vi.fn((options) => {
      return createTerritoryEngine(options);
    });
    const runtime = createTerritoryRuntime({
      dataset: createDataset(),
      cache: false,
      createEngine
    });

    await runtime.setViewport(viewportAt(0));
    await runtime.setViewport(viewportAt(1));

    expect(createEngine).toHaveBeenCalledTimes(1);
  });

  it("updates only the latest successful request through an attached adapter", async () => {
    const dataset = createDataset();
    const first = createDeferred<TerritoryDataset>();
    const second = createDeferred<TerritoryDataset>();
    const adapter = createAdapter();
    const resolver = vi.fn(() =>
      resolver.mock.calls.length === 1 ? first.promise : second.promise
    );
    const runtime = createTerritoryRuntime({
      cache: false,
      cancelPreviousRequest: false,
      adapter,
      datasetResolver: { resolveDataset: resolver }
    });

    const slow = runtime.setViewport(viewportAt(0));
    const fast = runtime.setViewport(viewportAt(1));
    second.resolve(dataset);
    await expect(fast).resolves.toMatchObject({ status: "ready" });

    first.resolve(dataset);
    await expect(slow).resolves.toMatchObject({ status: "aborted" });
    expect(adapter.setSource).toHaveBeenCalledTimes(1);
    expect(adapter.setSource).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ requestId: "runtime-request-2" })
      })
    );
  });

  it("skips detached adapters without crashing and reports attached adapter failures", async () => {
    const detached = createAdapter("detached");
    const detachedRuntime = createTerritoryRuntime({
      dataset: createDataset(),
      cache: false,
      adapter: detached
    });

    await expect(detachedRuntime.setViewport(VIEWPORT)).resolves.toMatchObject({ status: "ready" });
    expect(detached.setSource).not.toHaveBeenCalled();

    const failing = {
      ...createAdapter("attached"),
      setSource: vi.fn().mockRejectedValueOnce(new Error("renderer rejected source"))
    };
    const failingRuntime = createTerritoryRuntime({
      dataset: createDataset(),
      cache: false,
      adapter: failing
    });

    await expect(failingRuntime.setViewport(VIEWPORT)).resolves.toMatchObject({
      status: "failed",
      error: expect.objectContaining({ code: "UNKNOWN" })
    });
    expect(failingRuntime.getState()).toMatchObject({
      status: "error",
      lastError: expect.objectContaining({ code: "UNKNOWN" })
    });
  });

  it("reports adapter capability failures with coded runtime events", async () => {
    const adapter = createAdapter("attached", { sourceReplacement: false });
    const events: TerritoryRuntimeEvent[] = [];
    const runtime = createTerritoryRuntime({
      dataset: createDataset(),
      cache: false,
      adapter
    });
    runtime.subscribe((event) => events.push(event));

    await expect(runtime.setViewport(VIEWPORT)).resolves.toMatchObject({
      status: "failed",
      error: expect.objectContaining({ code: "CAPABILITY_UNSUPPORTED" })
    });
    expect(events.at(-1)).toMatchObject({
      type: "request-failed",
      error: expect.objectContaining({ code: "CAPABILITY_UNSUPPORTED" })
    });
  });

  it("uses the injected clock for deterministic event timestamps", async () => {
    let current = Date.parse("2026-07-18T00:00:00.000Z");
    const clock = {
      now: vi.fn(() => {
        current += 10;
        return new Date(current);
      })
    };
    const events: TerritoryRuntimeEvent[] = [];
    const runtime = createTerritoryRuntime({ dataset: createDataset(), clock, cache: false });
    runtime.subscribe((event) => events.push(event));

    await runtime.setViewport(VIEWPORT);

    expect(events.map((event) => event.occurredAt.toISOString())).toEqual([
      "2026-07-18T00:00:00.020Z",
      "2026-07-18T00:00:00.030Z",
      "2026-07-18T00:00:00.040Z",
      "2026-07-18T00:00:00.050Z",
      "2026-07-18T00:00:00.060Z",
      "2026-07-18T00:00:00.080Z"
    ]);
  });

  it("is safe to import in Node and browser-like runtimes", async () => {
    await expect(import("../src/index.js")).resolves.toHaveProperty("createTerritoryRuntime");
    await expect(import("../src/index.js")).resolves.toHaveProperty(
      "createMemoryTerritoryRuntimeCache"
    );
  });
});

class FakeScheduler implements TerritoryRuntimeScheduler {
  private currentTime = 0;
  private nextId = 0;
  private readonly tasks = new Map<
    number,
    { readonly dueAt: number; readonly callback: () => void }
  >();

  setTimeout(callback: () => void, delayMs: number): TerritoryRuntimeScheduledTask {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, { dueAt: this.currentTime + delayMs, callback });

    return {
      cancel: () => {
        this.tasks.delete(id);
      }
    };
  }

  advance(ms: number): void {
    this.currentTime += ms;

    while (true) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAt <= this.currentTime)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];

      if (!due) {
        return;
      }

      this.tasks.delete(due[0]);
      due[1].callback();
    }
  }
}

function createDataset(): TerritoryDataset {
  return createSyntheticGridDataset({
    datasetId: "runtime-grid",
    rows: 2,
    columns: 2,
    level: 0,
    cellSize: 1
  });
}

function viewportAt(index: number): TerritoryRuntimeViewport {
  return {
    bounds: { west: 0, south: 0, east: 1 + (index % 2), north: 1 + (index % 2) },
    zoom: 4,
    level: 0,
    metadata: { index }
  };
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  };
}

function waitForAbort(context: TerritoryRuntimeRequestContext): Promise<TerritoryDataset> {
  return new Promise<TerritoryDataset>((_resolve, reject) => {
    context.signal?.addEventListener(
      "abort",
      () => {
        reject(new TerritoryError("REQUEST_ABORTED", "Aborted by test."));
      },
      { once: true }
    );
  });
}

function fakeContext(): TerritoryRuntimeRequestContext {
  return {
    requestId: "test-request",
    revision: 1,
    startedAt: new Date("2026-07-18T00:00:00.000Z"),
    viewport: VIEWPORT
  };
}

function createAdapter(
  lifecycleState: "attached" | "detached" = "attached",
  capabilities: { readonly sourceReplacement?: boolean } = {}
): TerritoryRendererAdapter {
  return {
    capabilities: defineTerritoryAdapterCapabilities({
      geoJson: true,
      sourceReplacement: capabilities.sourceReplacement ?? true
    }),
    lifecycleState,
    attach: vi.fn(),
    detach: vi.fn(),
    setSource: vi.fn(),
    updateState: vi.fn(),
    updateTheme: vi.fn()
  };
}

function flushPromises(): Promise<void> {
  return Promise.resolve();
}
