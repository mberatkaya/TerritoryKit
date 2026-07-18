import {
  assertTerritoryAdapterCapability,
  hasTerritoryAdapterCapability
} from "@territory-kit/adapter-core";
import type { TerritoryRendererAdapter } from "@territory-kit/adapter-core";
import { createTerritoryEngine, defaultZoomLevelStrategy } from "@territory-kit/core";
import type { TerritoryEngine, TerritoryEngineOptions } from "@territory-kit/core";
import { TerritoryError, isTerritoryError, loadTerritoryDataset } from "@territory-kit/dataset";
import type { TerritoryAdminLevel, TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import type {
  TerritoryInstalledDatasetHandle,
  TerritoryRegistryClient,
  TerritoryRegistryResolveArtifactOptions,
  TerritoryRegistryResolvedArtifact
} from "@territory-kit/registry";

export type TerritoryRuntimeStatus =
  | "idle"
  | "scheduled"
  | "resolving"
  | "loading"
  | "querying"
  | "updating-adapter"
  | "ready"
  | "error"
  | "disposed";

export interface TerritoryRuntimeBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface TerritoryRuntimeViewport {
  readonly bounds: TerritoryRuntimeBounds;
  readonly zoom: number;
  readonly level?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TerritoryRuntimeResultSummary {
  readonly requestId: string;
  readonly revision: number;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly geometryHash: string;
  readonly cacheKey: string;
  readonly level: number;
  readonly zoneCount: number;
  readonly cached: boolean;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly durationMs: number;
}

export interface TerritoryRuntimeCacheSummary {
  readonly entries: number;
  readonly bytes: number;
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly hits: number;
  readonly misses: number;
  readonly sets: number;
  readonly deletes: number;
  readonly evictions: number;
}

export interface TerritoryRuntimeState {
  readonly status: TerritoryRuntimeStatus;
  readonly revision: number;
  readonly eventSequence: number;
  readonly disposed: boolean;
  readonly activeRequestId?: string;
  readonly activeViewport?: TerritoryRuntimeViewport;
  readonly activeLevel?: number;
  readonly activeDatasetId?: string;
  readonly lastCompletedRequestId?: string;
  readonly lastError?: TerritoryError;
  readonly lastResultSummary?: TerritoryRuntimeResultSummary;
  readonly cache: TerritoryRuntimeCacheSummary;
}

export type TerritoryRuntimeEventType =
  | "state-change"
  | "disposed"
  | "listener-error"
  | "viewport-scheduled"
  | "viewport-requested"
  | "request-started"
  | "request-deduplicated"
  | "request-aborted"
  | "cache-hit"
  | "cache-miss"
  | "dataset-resolved"
  | "engine-ready"
  | "query-completed"
  | "adapter-updated"
  | "viewport-ready"
  | "request-failed";

export interface TerritoryRuntimeEvent {
  readonly type: TerritoryRuntimeEventType;
  readonly state: TerritoryRuntimeState;
  readonly sequence: number;
  readonly occurredAt: Date;
  readonly requestId?: string;
  readonly durationMs?: number;
  readonly error?: TerritoryError;
}

export type TerritoryRuntimeEventListener = (event: TerritoryRuntimeEvent) => void;

export interface TerritoryRuntimeSubscription {
  readonly active: boolean;
  unsubscribe(): boolean;
}

export interface TerritoryRuntimeClock {
  now(): Date;
}

export interface TerritoryRuntimeScheduledTask {
  cancel(): void;
}

export interface TerritoryRuntimeScheduler {
  setTimeout(callback: () => void, delayMs: number): TerritoryRuntimeScheduledTask;
}

export interface TerritoryRuntimeLogger {
  debug?(event: TerritoryRuntimeEvent): void;
  info?(event: TerritoryRuntimeEvent): void;
  warn?(event: TerritoryRuntimeEvent): void;
  error?(event: TerritoryRuntimeEvent): void;
}

export interface TerritoryRuntimeRequestContext {
  readonly requestId: string;
  readonly revision: number;
  readonly signal?: AbortSignal;
  readonly startedAt: Date;
  readonly viewport: TerritoryRuntimeViewport;
  readonly selectedLevel?: number;
  readonly cacheKey?: string;
}

export interface TerritoryRuntimeDatasetResolution {
  readonly dataset: TerritoryDataset;
  readonly datasetId?: string;
  readonly artifact?: TerritoryRegistryResolvedArtifact;
  readonly handle?: TerritoryInstalledDatasetHandle;
}

export interface TerritoryRuntimeDatasetResolver {
  resolveDataset?(
    viewport: TerritoryRuntimeViewport,
    context: TerritoryRuntimeRequestContext
  ): Promise<TerritoryRuntimeDatasetResolution | TerritoryDataset>;
  resolveArtifact?(
    options: TerritoryRegistryResolveArtifactOptions,
    context: TerritoryRuntimeRequestContext
  ): Promise<TerritoryRegistryResolvedArtifact>;
  installDataset?(
    datasetId: string,
    context: TerritoryRuntimeRequestContext
  ): Promise<TerritoryInstalledDatasetHandle>;
}

export interface TerritoryRuntimeCache {
  get(key: string, context: TerritoryRuntimeRequestContext): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array, context: TerritoryRuntimeRequestContext): Promise<void>;
  delete?(key: string, context: TerritoryRuntimeRequestContext): Promise<void>;
  clear?(): Promise<void>;
  getSummary?(): TerritoryRuntimeCacheSummary;
  dispose?(): void | Promise<void>;
}

export interface TerritoryRuntimeCacheOptions {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly copyOnRead?: boolean;
  readonly copyOnWrite?: boolean;
}

export interface TerritoryRuntimeRequestOptions {
  readonly force?: boolean;
  readonly reason?: string;
  readonly debounceMs?: number;
  readonly requestTimeoutMs?: number;
}

export type TerritoryRuntimeRequestStatus = "ready" | "aborted" | "failed";

export interface TerritoryRuntimeRequestResult {
  readonly requestId: string;
  readonly revision: number;
  readonly status: TerritoryRuntimeRequestStatus;
  readonly summary?: TerritoryRuntimeResultSummary;
  readonly error?: TerritoryError;
}

export interface TerritoryRuntimeCancelResult {
  readonly cancelled: boolean;
  readonly status: TerritoryRuntimeStatus;
  readonly requestId?: string;
  readonly reason?: string;
}

export interface TerritoryRuntimeDisposeResult {
  readonly status: "disposed";
  readonly alreadyDisposed: boolean;
  readonly listenerCount: number;
}

export type TerritoryRuntimeEngineFactory = (
  options: TerritoryEngineOptions,
  context: TerritoryRuntimeRequestContext
) => TerritoryEngine | Promise<TerritoryEngine>;

export interface TerritoryRuntimeOptions<TTarget = unknown> {
  readonly adapter?: TerritoryRendererAdapter<TTarget>;
  readonly adapterSourceId?: string;
  readonly registry?: TerritoryRegistryClient;
  readonly datasetId?: string;
  readonly dataset?: TerritoryDataset;
  readonly engine?: TerritoryEngine;
  readonly engineOptions?: Omit<TerritoryEngineOptions, "dataset">;
  readonly createEngine?: TerritoryRuntimeEngineFactory;
  readonly datasetResolver?: TerritoryRuntimeDatasetResolver;
  readonly cache?: TerritoryRuntimeCache | false;
  readonly debounceMs?: number;
  readonly requestTimeoutMs?: number;
  readonly cancelPreviousRequest?: boolean;
  readonly deduplicateRequests?: boolean;
  readonly clock?: TerritoryRuntimeClock;
  readonly scheduler?: TerritoryRuntimeScheduler;
  readonly logger?: TerritoryRuntimeLogger;
}

export interface TerritoryRuntime<TTarget = unknown> {
  readonly state: TerritoryRuntimeState;
  readonly adapter: TerritoryRendererAdapter<TTarget> | undefined;
  setViewport(
    viewport: TerritoryRuntimeViewport,
    options?: TerritoryRuntimeRequestOptions
  ): Promise<TerritoryRuntimeRequestResult | undefined>;
  refresh(
    options?: TerritoryRuntimeRequestOptions
  ): Promise<TerritoryRuntimeRequestResult | undefined>;
  cancelActiveRequest(reason?: string): TerritoryRuntimeCancelResult;
  getState(): TerritoryRuntimeState;
  subscribe(listener: TerritoryRuntimeEventListener): TerritoryRuntimeSubscription;
  unsubscribe(listener: TerritoryRuntimeEventListener): boolean;
  dispose(): TerritoryRuntimeDisposeResult;
}

interface ListenerEntry {
  readonly listener: TerritoryRuntimeEventListener;
}

interface RuntimeRequestRecord {
  readonly requestId: string;
  readonly revision: number;
  readonly viewport: TerritoryRuntimeViewport;
  readonly signature: string;
  readonly requestKey: string;
  readonly controller: AbortController;
  readonly startedAt: Date;
  readonly requestTimeoutMs?: number;
  readonly promise: Promise<TerritoryRuntimeRequestResult>;
  resolve(result: TerritoryRuntimeRequestResult): void;
  scheduledTask?: TerritoryRuntimeScheduledTask;
  cacheKey?: string;
  selectedLevel?: number;
  datasetId?: string;
  finished: boolean;
  aborted: boolean;
  abortEmitted: boolean;
  timedOut: boolean;
}

interface CachedViewportPayload {
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly geometryHash: string;
  readonly level: number;
  readonly zones: readonly TerritoryZone[];
}

const SYSTEM_CLOCK: TerritoryRuntimeClock = {
  now() {
    return new Date();
  }
};

const SYSTEM_SCHEDULER: TerritoryRuntimeScheduler = {
  setTimeout(callback, delayMs) {
    const timer = globalThis.setTimeout(callback, delayMs);

    return {
      cancel() {
        globalThis.clearTimeout(timer);
      }
    };
  }
};

const EMPTY_CACHE_SUMMARY: TerritoryRuntimeCacheSummary = Object.freeze({
  entries: 0,
  bytes: 0,
  hits: 0,
  misses: 0,
  sets: 0,
  deletes: 0,
  evictions: 0
});

export function createMemoryTerritoryRuntimeCache(
  options: TerritoryRuntimeCacheOptions = {}
): TerritoryRuntimeCache {
  const entries = new Map<string, Uint8Array>();
  const sizes = new Map<string, number>();
  const copyOnRead = options.copyOnRead !== false;
  const copyOnWrite = options.copyOnWrite !== false;
  let bytes = 0;
  let hits = 0;
  let misses = 0;
  let sets = 0;
  let deletes = 0;
  let evictions = 0;
  let disposed = false;

  function assertCacheUsable(): void {
    if (disposed) {
      throw new TerritoryError("RUNTIME_DISPOSED", "Runtime cache has been disposed.");
    }
  }

  function cloneBytes(value: Uint8Array): Uint8Array {
    return value.slice();
  }

  function deleteEntry(key: string, countDelete: boolean): boolean {
    const value = entries.get(key);

    if (!value) {
      return false;
    }

    entries.delete(key);
    bytes -= sizes.get(key) ?? value.byteLength;
    sizes.delete(key);

    if (countDelete) {
      deletes += 1;
    }

    return true;
  }

  function evictIfNeeded(): void {
    const maxEntries = options.maxEntries;
    const maxBytes = options.maxBytes;

    while (
      (maxEntries !== undefined && entries.size > maxEntries) ||
      (maxBytes !== undefined && bytes > maxBytes)
    ) {
      const oldestKey = entries.keys().next().value as string | undefined;

      if (!oldestKey) {
        break;
      }

      deleteEntry(oldestKey, false);
      evictions += 1;
    }
  }

  return {
    async get(key) {
      assertCacheUsable();
      const value = entries.get(key);

      if (!value) {
        misses += 1;
        return undefined;
      }

      entries.delete(key);
      entries.set(key, value);
      hits += 1;
      return copyOnRead ? cloneBytes(value) : value;
    },

    async set(key, value) {
      assertCacheUsable();
      deleteEntry(key, false);
      const bytesValue = copyOnWrite ? cloneBytes(value) : value;
      entries.set(key, bytesValue);
      sizes.set(key, bytesValue.byteLength);
      bytes += bytesValue.byteLength;
      sets += 1;
      evictIfNeeded();
    },

    async delete(key) {
      assertCacheUsable();
      deleteEntry(key, true);
    },

    async clear() {
      assertCacheUsable();
      entries.clear();
      sizes.clear();
      bytes = 0;
      deletes += 1;
    },

    getSummary() {
      return freezeCacheSummary({
        entries: entries.size,
        bytes,
        ...(options.maxEntries !== undefined ? { maxEntries: options.maxEntries } : {}),
        ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
        hits,
        misses,
        sets,
        deletes,
        evictions
      });
    },

    dispose() {
      disposed = true;
      entries.clear();
      sizes.clear();
      bytes = 0;
    }
  };
}

export function createTerritoryRuntime<TTarget = unknown>(
  options: TerritoryRuntimeOptions<TTarget> = {}
): TerritoryRuntime<TTarget> {
  const listeners = new Map<TerritoryRuntimeEventListener, ListenerEntry>();
  const clock = options.clock ?? SYSTEM_CLOCK;
  const scheduler = options.scheduler ?? SYSTEM_SCHEDULER;
  const logger = options.logger;
  const cache =
    options.cache === false ? undefined : (options.cache ?? createMemoryTerritoryRuntimeCache());
  const createEngineFactory = options.createEngine ?? createTerritoryEngine;
  const cancelPreviousRequest = options.cancelPreviousRequest !== false;
  const deduplicateRequests = options.deduplicateRequests !== false;
  const enginesByDatasetKey = new Map<string, TerritoryEngine>();
  const inFlightByRequestKey = new Map<string, RuntimeRequestRecord>();
  let status: TerritoryRuntimeStatus = "idle";
  let revision = 0;
  let eventSequence = 0;
  let disposed = false;
  let activeRequestId: string | undefined;
  let activeViewport: TerritoryRuntimeViewport | undefined;
  let activeLevel: number | undefined;
  let activeDatasetId: string | undefined;
  let lastCompletedRequestId: string | undefined;
  let lastError: TerritoryError | undefined;
  let lastResultSummary: TerritoryRuntimeResultSummary | undefined;
  let lastCompletedSignature: string | undefined;
  let lastRequestResult: TerritoryRuntimeRequestResult | undefined;
  let scheduledRequest: RuntimeRequestRecord | undefined;
  let activeRequest: RuntimeRequestRecord | undefined;

  const readState = (): TerritoryRuntimeState =>
    freezeState({
      status,
      revision,
      eventSequence,
      disposed,
      ...(activeRequestId ? { activeRequestId } : {}),
      ...(activeViewport ? { activeViewport: cloneViewport(activeViewport) } : {}),
      ...(activeLevel !== undefined ? { activeLevel } : {}),
      ...(activeDatasetId ? { activeDatasetId } : {}),
      ...(lastCompletedRequestId ? { lastCompletedRequestId } : {}),
      ...(lastError ? { lastError } : {}),
      ...(lastResultSummary ? { lastResultSummary: cloneResultSummary(lastResultSummary) } : {}),
      cache: readCacheSummary(cache)
    });

  function assertUsable(action: string): void {
    if (disposed) {
      throw new TerritoryError("RUNTIME_DISPOSED", `Cannot ${action} after runtime disposal.`, {
        details: { action }
      });
    }
  }

  function createEvent(
    type: TerritoryRuntimeEventType,
    input: {
      readonly request?: RuntimeRequestRecord;
      readonly error?: TerritoryError;
      readonly occurredAt?: Date;
      readonly durationMs?: number;
    } = {}
  ): TerritoryRuntimeEvent {
    eventSequence += 1;
    const occurredAt = input.occurredAt ?? clock.now();
    const requestId = input.request?.requestId;
    const durationMs =
      input.durationMs ??
      (input.request
        ? Math.max(0, occurredAt.getTime() - input.request.startedAt.getTime())
        : undefined);

    return {
      type,
      state: readState(),
      sequence: eventSequence,
      occurredAt,
      ...(requestId ? { requestId } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(input.error ? { error: input.error } : {})
    };
  }

  function emit(event: TerritoryRuntimeEvent, notifyErrors = true): void {
    const errors: TerritoryError[] = [];

    for (const entry of [...listeners.values()]) {
      try {
        entry.listener(event);
      } catch (error) {
        errors.push(toRuntimeListenerError(error, event.type));
      }
    }

    logEvent(event, logger);

    if (notifyErrors) {
      for (const error of errors) {
        emit(createEvent("listener-error", { error }), false);
      }
    } else {
      for (const error of errors) {
        logEvent(createEvent("listener-error", { error }), logger);
      }
    }
  }

  function emitEvent(
    type: TerritoryRuntimeEventType,
    input: {
      readonly request?: RuntimeRequestRecord;
      readonly error?: TerritoryError;
      readonly occurredAt?: Date;
      readonly durationMs?: number;
    } = {}
  ): void {
    emit(createEvent(type, input), true);
  }

  function setActiveRequest(record: RuntimeRequestRecord): void {
    activeRequestId = record.requestId;
    activeViewport = cloneViewport(record.viewport);
    activeLevel = record.selectedLevel ?? record.viewport.level;
    activeDatasetId = record.datasetId ?? activeDatasetId;
  }

  function setTerminalStatus(nextStatus: TerritoryRuntimeStatus): void {
    status = nextStatus;
    activeRequestId = undefined;
  }

  function createRequest(
    viewport: TerritoryRuntimeViewport,
    requestOptions: TerritoryRuntimeRequestOptions
  ): RuntimeRequestRecord {
    const requestId = `runtime-request-${revision + 1}`;
    const requestRevision = revision + 1;
    const controller = new AbortController();
    const signature = viewportSignature(viewport);
    const requestKey = createTentativeRequestKey(viewport, options);
    const startedAt = clock.now();
    let resolveRequest: (result: TerritoryRuntimeRequestResult) => void = () => undefined;
    const promise = new Promise<TerritoryRuntimeRequestResult>((resolve) => {
      resolveRequest = resolve;
    });

    return {
      requestId,
      revision: requestRevision,
      viewport,
      signature,
      requestKey,
      controller,
      startedAt,
      ...(requestOptions.requestTimeoutMs !== undefined
        ? { requestTimeoutMs: requestOptions.requestTimeoutMs }
        : {}),
      promise,
      resolve: resolveRequest,
      finished: false,
      aborted: false,
      abortEmitted: false,
      timedOut: false
    };
  }

  function finishRequest(
    record: RuntimeRequestRecord,
    result: TerritoryRuntimeRequestResult
  ): TerritoryRuntimeRequestResult {
    if (!record.finished) {
      record.finished = true;
      inFlightByRequestKey.delete(record.requestKey);

      if (scheduledRequest === record) {
        scheduledRequest = undefined;
      }

      if (activeRequest === record) {
        activeRequest = undefined;
      }

      record.resolve(result);
    }

    return result;
  }

  function abortRequest(
    record: RuntimeRequestRecord,
    reason: string,
    options: { readonly updateState: boolean }
  ): TerritoryRuntimeRequestResult {
    record.scheduledTask?.cancel();
    record.aborted = true;

    if (!record.controller.signal.aborted) {
      record.controller.abort(reason);
    }

    if (options.updateState && isCurrentRequest(record)) {
      setTerminalStatus(lastResultSummary ? "ready" : "idle");
    }

    const abortError = new TerritoryError(
      "REQUEST_ABORTED",
      `Runtime request '${record.requestId}' was aborted.`,
      {
        details: { requestId: record.requestId, reason }
      }
    );
    const result: TerritoryRuntimeRequestResult = {
      requestId: record.requestId,
      revision: record.revision,
      status: "aborted",
      error: abortError
    };

    if (!record.abortEmitted) {
      record.abortEmitted = true;
      emitEvent("request-aborted", { request: record, error: abortError });
    }

    return finishRequest(record, result);
  }

  function isCurrentRequest(record: RuntimeRequestRecord): boolean {
    return !disposed && activeRequestId === record.requestId;
  }

  function scheduleRequest(record: RuntimeRequestRecord, debounceMs: number): void {
    status = "scheduled";
    revision = record.revision;
    lastError = undefined;
    setActiveRequest(record);
    scheduledRequest = record;
    inFlightByRequestKey.set(record.requestKey, record);
    emitEvent("viewport-scheduled", { request: record });

    record.scheduledTask = scheduler.setTimeout(() => {
      if (disposed || scheduledRequest !== record || record.finished) {
        return;
      }

      scheduledRequest = undefined;
      void executeRequest(record);
    }, debounceMs);
  }

  async function executeRequest(
    record: RuntimeRequestRecord
  ): Promise<TerritoryRuntimeRequestResult> {
    if (record.finished) {
      return record.promise;
    }

    activeRequest = record;
    status = "resolving";
    setActiveRequest(record);
    emitEvent("viewport-requested", { request: record });
    emitEvent("request-started", { request: record });

    try {
      const result = await withRequestTimeout(record, () => executeRequestSteps(record));
      return finishRequest(record, result);
    } catch (error) {
      const runtimeError = record.timedOut
        ? createTimeoutError(record, record.requestTimeoutMs ?? 0)
        : toRuntimeError(error, "Runtime viewport request failed.");

      if (!record.timedOut && runtimeError.code === "REQUEST_ABORTED") {
        return abortRequest(record, "aborted", { updateState: false });
      }

      if (isCurrentRequest(record)) {
        lastError = runtimeError;
        setTerminalStatus("error");
      }

      emitEvent("request-failed", { request: record, error: runtimeError });

      return finishRequest(record, {
        requestId: record.requestId,
        revision: record.revision,
        status: "failed",
        error: runtimeError
      });
    }
  }

  async function executeRequestSteps(
    record: RuntimeRequestRecord
  ): Promise<TerritoryRuntimeRequestResult> {
    assertRequestFresh(record);
    const resolution = await resolveDataset(record);
    assertRequestFresh(record);
    const dataset = resolution.dataset;
    const datasetId = resolution.datasetId ?? dataset.manifest.datasetId;
    record.datasetId = datasetId;

    if (isCurrentRequest(record)) {
      activeDatasetId = datasetId;
      status = "loading";
    }

    emitEvent("dataset-resolved", { request: record });
    const engine = await getEngine(dataset, record);
    assertRequestFresh(record);
    const selectedLevel = resolveViewportLevel(engine, record.viewport, options.engineOptions);
    record.selectedLevel = selectedLevel;
    const cacheKey = engine.getViewportCacheKey({
      bounds: record.viewport.bounds,
      zoom: record.viewport.zoom,
      level: selectedLevel
    });
    record.cacheKey = cacheKey;

    if (isCurrentRequest(record)) {
      activeLevel = selectedLevel;
      status = "querying";
    }

    emitEvent("engine-ready", { request: record });
    const query = await readOrQueryVisibleZones(engine, record, selectedLevel);
    assertRequestFresh(record);
    emitEvent("query-completed", { request: record });
    assertRequestFresh(record);

    if (options.adapter && options.adapter.lifecycleState === "attached") {
      status = "updating-adapter";
      await updateAdapter(options.adapter, query.zones, record);
      emitEvent("adapter-updated", { request: record });
    }

    assertRequestFresh(record);
    const completedAt = clock.now();
    const summary: TerritoryRuntimeResultSummary = freezeResultSummary({
      requestId: record.requestId,
      revision: record.revision,
      datasetId,
      datasetVersion: dataset.manifest.datasetVersion,
      geometryHash: dataset.manifest.geometryHash,
      cacheKey,
      level: selectedLevel,
      zoneCount: query.zones.length,
      cached: query.cached,
      startedAt: record.startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt.getTime() - record.startedAt.getTime())
    });

    if (isCurrentRequest(record)) {
      lastCompletedRequestId = record.requestId;
      lastCompletedSignature = record.signature;
      lastResultSummary = summary;
      lastRequestResult = {
        requestId: record.requestId,
        revision: record.revision,
        status: "ready",
        summary
      };
      lastError = undefined;
      setTerminalStatus("ready");
    }

    emitEvent("viewport-ready", { request: record });

    return {
      requestId: record.requestId,
      revision: record.revision,
      status: "ready",
      summary
    };
  }

  async function withRequestTimeout<T>(
    record: RuntimeRequestRecord,
    operation: () => Promise<T>
  ): Promise<T> {
    const timeoutMs = record.requestTimeoutMs ?? options.requestTimeoutMs;

    if (timeoutMs === undefined || timeoutMs <= 0) {
      return operation();
    }

    let timeoutTask: TerritoryRuntimeScheduledTask | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTask = scheduler.setTimeout(() => {
        record.timedOut = true;
        const error = createTimeoutError(record, timeoutMs);

        if (!record.controller.signal.aborted) {
          record.controller.abort(error);
        }

        reject(error);
      }, timeoutMs);
    });

    try {
      return await Promise.race([operation(), timeoutPromise]);
    } finally {
      timeoutTask?.cancel();
    }
  }

  function assertRequestFresh(record: RuntimeRequestRecord): void {
    if (disposed) {
      throw new TerritoryError(
        "RUNTIME_DISPOSED",
        "Runtime request stopped because the runtime was disposed."
      );
    }

    if (record.controller.signal.aborted || record.aborted) {
      throw new TerritoryError(
        "REQUEST_ABORTED",
        `Runtime request '${record.requestId}' was aborted.`,
        {
          details: { requestId: record.requestId }
        }
      );
    }

    if (!isCurrentRequest(record)) {
      throw new TerritoryError(
        "REQUEST_ABORTED",
        `Runtime request '${record.requestId}' is stale.`,
        {
          details: { requestId: record.requestId, activeRequestId }
        }
      );
    }
  }

  async function resolveDataset(
    record: RuntimeRequestRecord
  ): Promise<TerritoryRuntimeDatasetResolution> {
    if (options.engine) {
      return { dataset: options.engine.dataset };
    }

    if (options.dataset) {
      return { dataset: options.dataset };
    }

    const context = createRequestContext(record);

    if (options.datasetResolver?.resolveDataset) {
      const resolved = await options.datasetResolver.resolveDataset(record.viewport, context);

      if ("dataset" in resolved) {
        return resolved;
      }

      return { dataset: resolved };
    }

    if (options.datasetId && options.datasetResolver?.installDataset) {
      const handle = await options.datasetResolver.installDataset(options.datasetId, context);
      return datasetFromInstalledHandle(handle, record);
    }

    if (options.datasetId && options.registry) {
      const handle = await options.registry.installDataset({
        datasetId: options.datasetId,
        ...(record.viewport.level !== undefined
          ? { levels: [levelToAdminLevel(record.viewport.level)] }
          : {}),
        signal: record.controller.signal
      });
      return datasetFromInstalledHandle(handle, record);
    }

    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      "Runtime viewport requests require a direct dataset, engine, dataset resolver, or registry datasetId.",
      {
        details: {
          hasDataset: Boolean(options.dataset),
          hasEngine: Boolean(options.engine),
          hasDatasetResolver: Boolean(options.datasetResolver),
          hasRegistry: Boolean(options.registry),
          hasDatasetId: Boolean(options.datasetId)
        }
      }
    );
  }

  async function getEngine(
    dataset: TerritoryDataset,
    record: RuntimeRequestRecord
  ): Promise<TerritoryEngine> {
    if (options.engine) {
      return options.engine;
    }

    const key = datasetEngineKey(dataset);
    const cachedEngine = enginesByDatasetKey.get(key);

    if (cachedEngine) {
      return cachedEngine;
    }

    const engineOptions: TerritoryEngineOptions = {
      dataset,
      ...options.engineOptions
    };
    const engine = await createEngineFactory(engineOptions, createRequestContext(record));
    enginesByDatasetKey.set(key, engine);
    return engine;
  }

  async function readOrQueryVisibleZones(
    engine: TerritoryEngine,
    record: RuntimeRequestRecord,
    selectedLevel: number
  ): Promise<{ readonly zones: readonly TerritoryZone[]; readonly cached: boolean }> {
    const cacheKey = record.cacheKey;

    if (!cacheKey || !cache) {
      return {
        zones: queryViewportZones(engine, record.viewport, selectedLevel),
        cached: false
      };
    }

    const context = createRequestContext(record);
    const cachedBytes = await cache.get(cacheKey, context);
    assertRequestFresh(record);

    if (cachedBytes) {
      emitEvent("cache-hit", { request: record });
      const payload = readCachedViewportPayload(cachedBytes, cacheKey);
      return { zones: payload.zones, cached: true };
    }

    emitEvent("cache-miss", { request: record });
    const zones = queryViewportZones(engine, record.viewport, selectedLevel);
    await cache.set(
      cacheKey,
      writeCachedViewportPayload({
        datasetId: engine.dataset.manifest.datasetId,
        datasetVersion: engine.dataset.manifest.datasetVersion,
        geometryHash: engine.dataset.manifest.geometryHash,
        level: selectedLevel,
        zones
      }),
      context
    );

    return { zones, cached: false };
  }

  async function updateAdapter(
    adapter: TerritoryRendererAdapter<TTarget>,
    zones: readonly TerritoryZone[],
    record: RuntimeRequestRecord
  ): Promise<void> {
    assertTerritoryAdapterCapability(adapter.capabilities, "geoJson", "update viewport source");

    if (!hasTerritoryAdapterCapability(adapter.capabilities, "sourceReplacement")) {
      throw new TerritoryError(
        "CAPABILITY_UNSUPPORTED",
        "Adapter capability 'sourceReplacement' is required for runtime viewport updates.",
        { details: { capability: "sourceReplacement", action: "update viewport source" } }
      );
    }

    await adapter.setSource({
      id: options.adapterSourceId ?? "territory-runtime",
      type: "geojson",
      data: zonesToFeatureCollection(zones),
      metadata: {
        requestId: record.requestId,
        revision: record.revision,
        cacheKey: record.cacheKey ?? "",
        level: record.selectedLevel ?? record.viewport.level ?? 0
      }
    });
  }

  function createRequestContext(record: RuntimeRequestRecord): TerritoryRuntimeRequestContext {
    return {
      requestId: record.requestId,
      revision: record.revision,
      signal: record.controller.signal,
      startedAt: record.startedAt,
      viewport: cloneViewport(record.viewport),
      ...(record.selectedLevel !== undefined ? { selectedLevel: record.selectedLevel } : {}),
      ...(record.cacheKey ? { cacheKey: record.cacheKey } : {})
    };
  }

  const runtime: TerritoryRuntime<TTarget> = {
    get state() {
      return readState();
    },
    get adapter() {
      return options.adapter;
    },
    setViewport(viewport, requestOptions = {}) {
      assertUsable("set runtime viewport");
      const normalizedViewport = normalizeViewport(viewport);
      const signature = viewportSignature(normalizedViewport);
      const force = requestOptions.force === true;
      const requestKey = createTentativeRequestKey(normalizedViewport, options);

      if (!force) {
        if (scheduledRequest?.signature === signature) {
          emitEvent("request-deduplicated", { request: scheduledRequest });
          return scheduledRequest.promise;
        }

        if (activeRequest?.signature === signature && deduplicateRequests) {
          emitEvent("request-deduplicated", { request: activeRequest });
          return activeRequest.promise;
        }

        if (lastCompletedSignature === signature) {
          return Promise.resolve(lastRequestResult);
        }

        const inFlight = inFlightByRequestKey.get(requestKey);

        if (inFlight && deduplicateRequests) {
          emitEvent("request-deduplicated", { request: inFlight });
          return inFlight.promise;
        }
      }

      if (cancelPreviousRequest) {
        if (scheduledRequest) {
          abortRequest(scheduledRequest, requestOptions.reason ?? "superseded", {
            updateState: false
          });
        }

        if (activeRequest && activeRequest !== scheduledRequest) {
          abortRequest(activeRequest, requestOptions.reason ?? "superseded", {
            updateState: false
          });
        }
      }

      const record = createRequest(normalizedViewport, requestOptions);
      const debounceMs = requestOptions.debounceMs ?? options.debounceMs ?? 0;

      if (debounceMs > 0) {
        scheduleRequest(record, debounceMs);
      } else {
        revision = record.revision;
        lastError = undefined;
        setActiveRequest(record);
        inFlightByRequestKey.set(record.requestKey, record);
        void executeRequest(record);
      }

      return record.promise;
    },
    refresh(requestOptions = {}) {
      assertUsable("refresh runtime viewport");

      if (!activeViewport) {
        throw new TerritoryError("RUNTIME_NOT_READY", "Cannot refresh before a viewport is set.");
      }

      return runtime.setViewport(activeViewport, { ...requestOptions, force: true });
    },
    cancelActiveRequest(reason = "cancelled") {
      assertUsable("cancel active runtime request");
      const record = scheduledRequest ?? activeRequest;

      if (!record) {
        return {
          cancelled: false,
          status
        };
      }

      abortRequest(record, reason, { updateState: true });

      return {
        cancelled: true,
        status,
        requestId: record.requestId,
        reason
      };
    },
    getState() {
      return readState();
    },
    subscribe(listener) {
      assertUsable("subscribe to runtime events");
      listeners.set(listener, { listener });
      let active = true;

      return {
        get active() {
          return active && listeners.has(listener);
        },
        unsubscribe() {
          if (!active) {
            return false;
          }

          active = false;
          return listeners.delete(listener);
        }
      };
    },
    unsubscribe(listener) {
      assertUsable("unsubscribe from runtime events");
      return listeners.delete(listener);
    },
    dispose() {
      if (disposed) {
        return {
          status: "disposed",
          alreadyDisposed: true,
          listenerCount: 0
        };
      }

      const listenerCount = listeners.size;
      const record = scheduledRequest ?? activeRequest;

      if (record) {
        abortRequest(record, "disposed", { updateState: false });
      }

      disposed = true;
      status = "disposed";
      activeRequestId = undefined;
      emitEvent("state-change");
      emitEvent("disposed");
      listeners.clear();
      void cache?.dispose?.();

      return {
        status: "disposed",
        alreadyDisposed: false,
        listenerCount
      };
    }
  };

  return runtime;
}

function normalizeViewport(viewport: TerritoryRuntimeViewport): TerritoryRuntimeViewport {
  const bounds = viewport.bounds;

  if (!bounds || typeof bounds !== "object") {
    throw new TerritoryError("INVALID_BOUNDS", "Viewport bounds are required.");
  }

  const normalizedBounds: TerritoryRuntimeBounds = {
    west: validateLongitude(bounds.west, "west"),
    south: validateLatitude(bounds.south, "south"),
    east: validateLongitude(bounds.east, "east"),
    north: validateLatitude(bounds.north, "north")
  };

  if (normalizedBounds.west > normalizedBounds.east) {
    throw new TerritoryError(
      "INVALID_BOUNDS",
      "Viewport bounds cannot cross the antimeridian in the current runtime.",
      { details: { bounds: normalizedBounds } }
    );
  }

  if (normalizedBounds.south > normalizedBounds.north) {
    throw new TerritoryError(
      "INVALID_BOUNDS",
      "Viewport south must be less than or equal to north.",
      {
        details: { bounds: normalizedBounds }
      }
    );
  }

  if (!Number.isFinite(viewport.zoom) || viewport.zoom < 0) {
    throw new TerritoryError(
      "INVALID_COORDINATE",
      "Viewport zoom must be a finite non-negative number.",
      {
        details: { zoom: viewport.zoom }
      }
    );
  }

  if (
    viewport.level !== undefined &&
    (!Number.isInteger(viewport.level) || viewport.level < 0 || viewport.level > 5)
  ) {
    throw new TerritoryError(
      "INVALID_LEVEL",
      "Viewport level must be an integer ADM depth from 0 to 5.",
      {
        details: { level: viewport.level }
      }
    );
  }

  return cloneViewport({
    bounds: normalizedBounds,
    zoom: viewport.zoom,
    ...(viewport.level !== undefined ? { level: viewport.level } : {}),
    ...(viewport.metadata ? { metadata: viewport.metadata } : {})
  });
}

function validateLongitude(value: number, field: string): number {
  if (!Number.isFinite(value) || value < -180 || value > 180) {
    throw new TerritoryError(
      "INVALID_BOUNDS",
      `Viewport bounds.${field} must be between -180 and 180.`,
      {
        details: { field, value }
      }
    );
  }

  return value;
}

function validateLatitude(value: number, field: string): number {
  if (!Number.isFinite(value) || value < -90 || value > 90) {
    throw new TerritoryError(
      "INVALID_BOUNDS",
      `Viewport bounds.${field} must be between -90 and 90.`,
      {
        details: { field, value }
      }
    );
  }

  return value;
}

function resolveViewportLevel(
  engine: TerritoryEngine,
  viewport: TerritoryRuntimeViewport,
  engineOptions: Omit<TerritoryEngineOptions, "dataset"> | undefined
): number {
  if (viewport.level !== undefined) {
    return viewport.level;
  }

  const strategy = engineOptions?.levelStrategy ?? defaultZoomLevelStrategy;

  return strategy.resolveLevel({
    zoom: viewport.zoom,
    dataset: engine.dataset,
    availableLevels: engine.availableLevels
  });
}

function queryViewportZones(
  engine: TerritoryEngine,
  viewport: TerritoryRuntimeViewport,
  selectedLevel: number
): TerritoryZone[] {
  return engine.getZonesInBounds({
    ...viewport.bounds,
    level: selectedLevel
  });
}

function levelToAdminLevel(level: number): TerritoryAdminLevel {
  if (level < 0 || level > 5 || !Number.isInteger(level)) {
    throw new TerritoryError("INVALID_LEVEL", "Viewport level must map to ADM0 through ADM5.", {
      details: { level }
    });
  }

  return `ADM${level}` as TerritoryAdminLevel;
}

async function datasetFromInstalledHandle(
  handle: TerritoryInstalledDatasetHandle,
  record: RuntimeRequestRecord
): Promise<TerritoryRuntimeDatasetResolution> {
  const levelPath =
    record.viewport.level === undefined
      ? undefined
      : `levels/ADM${record.viewport.level}/dataset.json`;
  const paths = handle.installedArtifacts
    .map((entry) => entry.artifact.path)
    .filter((path): path is string => Boolean(path))
    .filter(
      (path) =>
        path === "dataset.json" || (path.startsWith("levels/") && path.endsWith("/dataset.json"))
    )
    .sort();
  const selectedPath = (levelPath && paths.includes(levelPath) ? levelPath : undefined) ?? paths[0];

  if (!selectedPath) {
    throw new TerritoryError(
      "ARTIFACT_NOT_FOUND",
      "Installed dataset does not contain a query dataset artifact.",
      {
        details: { datasetId: handle.dataset.id, version: handle.dataset.version }
      }
    );
  }

  const text = await handle.readText(selectedPath);
  const dataset = loadTerritoryDataset(JSON.parse(text) as unknown);

  return {
    dataset,
    datasetId: handle.dataset.id,
    handle
  };
}

function readCachedViewportPayload(bytes: Uint8Array, cacheKey: string): CachedViewportPayload {
  try {
    const input = JSON.parse(new TextDecoder().decode(bytes)) as unknown;

    if (!isRecord(input) || !Array.isArray(input.zones)) {
      throw new Error("Cached payload shape is invalid.");
    }

    return input as unknown as CachedViewportPayload;
  } catch (error) {
    throw new TerritoryError("CACHE_CORRUPTED", `Runtime cache entry '${cacheKey}' is corrupted.`, {
      cause: error,
      details: { cacheKey }
    });
  }
}

function writeCachedViewportPayload(payload: CachedViewportPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function zonesToFeatureCollection(zones: readonly TerritoryZone[]): unknown {
  return {
    type: "FeatureCollection",
    features: zones.map((zone) => ({
      type: "Feature",
      id: zone.id,
      geometry: zone.geometry,
      properties: {
        ...zone.properties,
        id: zone.id,
        datasetId: zone.datasetId,
        level: zone.level,
        ...(zone.name ? { name: zone.name } : {}),
        ...(zone.parentId ? { parentId: zone.parentId } : {})
      }
    }))
  };
}

function createTentativeRequestKey(
  viewport: TerritoryRuntimeViewport,
  options: TerritoryRuntimeOptions
): string {
  const datasetKey =
    options.engine?.dataset.manifest.datasetId ??
    options.dataset?.manifest.datasetId ??
    options.datasetId ??
    "resolver";

  return stableJson({
    datasetKey,
    bounds: viewport.bounds,
    zoom: viewport.zoom,
    level: viewport.level
  });
}

function viewportSignature(viewport: TerritoryRuntimeViewport): string {
  return stableJson(viewport);
}

function datasetEngineKey(dataset: TerritoryDataset): string {
  return [
    dataset.manifest.datasetId,
    dataset.manifest.datasetVersion,
    dataset.manifest.geometryHash
  ].join(":");
}

function createTimeoutError(record: RuntimeRequestRecord, timeoutMs: number): TerritoryError {
  return new TerritoryError(
    "DOWNLOAD_TIMEOUT",
    `Runtime request '${record.requestId}' timed out after ${timeoutMs}ms.`,
    {
      details: {
        requestId: record.requestId,
        timeoutMs
      }
    }
  );
}

function toRuntimeError(error: unknown, message: string): TerritoryError {
  if (isTerritoryError(error)) {
    return error;
  }

  return new TerritoryError("UNKNOWN", message, { cause: error });
}

function toRuntimeListenerError(
  error: unknown,
  eventType: TerritoryRuntimeEventType
): TerritoryError {
  if (isTerritoryError(error)) {
    return error;
  }

  return new TerritoryError("UNKNOWN", "Runtime event listener failed.", {
    cause: error,
    details: { eventType }
  });
}

function logEvent(event: TerritoryRuntimeEvent, logger: TerritoryRuntimeLogger | undefined): void {
  if (!logger) {
    return;
  }

  if (event.type === "request-failed" || event.type === "listener-error") {
    logger.error?.(event);
    return;
  }

  if (event.type === "request-aborted") {
    logger.warn?.(event);
    return;
  }

  logger.debug?.(event);
}

function readCacheSummary(cache: TerritoryRuntimeCache | undefined): TerritoryRuntimeCacheSummary {
  return cache?.getSummary?.() ?? EMPTY_CACHE_SUMMARY;
}

function freezeState(state: TerritoryRuntimeState): TerritoryRuntimeState {
  return Object.freeze(state);
}

function freezeCacheSummary(summary: TerritoryRuntimeCacheSummary): TerritoryRuntimeCacheSummary {
  return Object.freeze(summary);
}

function freezeResultSummary(
  summary: TerritoryRuntimeResultSummary
): TerritoryRuntimeResultSummary {
  return Object.freeze(summary);
}

function cloneViewport(viewport: TerritoryRuntimeViewport): TerritoryRuntimeViewport {
  const metadata = viewport.metadata ? Object.freeze({ ...viewport.metadata }) : undefined;

  return Object.freeze({
    bounds: Object.freeze({ ...viewport.bounds }),
    zoom: viewport.zoom,
    ...(viewport.level !== undefined ? { level: viewport.level } : {}),
    ...(metadata ? { metadata } : {})
  });
}

function cloneResultSummary(summary: TerritoryRuntimeResultSummary): TerritoryRuntimeResultSummary {
  return freezeResultSummary({
    ...summary,
    startedAt: new Date(summary.startedAt.getTime()),
    completedAt: new Date(summary.completedAt.getTime())
  });
}

function stableJson(input: unknown): string {
  return JSON.stringify(sortStable(input));
}

function sortStable(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => sortStable(item));
  }

  if (isRecord(input)) {
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, sortStable(value)])
    );
  }

  if (input instanceof Date) {
    return input.toISOString();
  }

  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
