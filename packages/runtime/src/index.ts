import { TerritoryError, isTerritoryError } from "@territory-kit/dataset";
import type { TerritoryRendererAdapter } from "@territory-kit/adapter-core";
import type { TerritoryEngine, TerritoryEngineOptions } from "@territory-kit/core";
import type { TerritoryDataset } from "@territory-kit/dataset";
import type {
  TerritoryInstalledDatasetHandle,
  TerritoryRegistryClient,
  TerritoryRegistryResolveArtifactOptions,
  TerritoryRegistryResolvedArtifact
} from "@territory-kit/registry";

export type TerritoryRuntimeStatus = "idle" | "disposed";

export interface TerritoryRuntimeState {
  readonly status: TerritoryRuntimeStatus;
  readonly disposed: boolean;
  readonly eventSequence: number;
}

export type TerritoryRuntimeEventType = "state-change" | "disposed" | "listener-error";

export interface TerritoryRuntimeEvent {
  readonly type: TerritoryRuntimeEventType;
  readonly state: TerritoryRuntimeState;
  readonly sequence: number;
  readonly occurredAt: Date;
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

export interface TerritoryRuntimeLogger {
  debug?(event: TerritoryRuntimeEvent): void;
  info?(event: TerritoryRuntimeEvent): void;
  warn?(event: TerritoryRuntimeEvent): void;
  error?(event: TerritoryRuntimeEvent): void;
}

export interface TerritoryRuntimeRequestContext {
  readonly requestId: string;
  readonly signal?: AbortSignal;
  readonly startedAt: Date;
}

export interface TerritoryRuntimeDatasetResolver {
  resolveArtifact(
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
}

export interface TerritoryRuntimeDisposeResult {
  readonly status: "disposed";
  readonly alreadyDisposed: boolean;
  readonly listenerCount: number;
}

export interface TerritoryRuntimeOptions<TTarget = unknown> {
  readonly adapter?: TerritoryRendererAdapter<TTarget>;
  readonly registry?: TerritoryRegistryClient;
  readonly dataset?: TerritoryDataset;
  readonly engine?: TerritoryEngine;
  readonly engineOptions?: Omit<TerritoryEngineOptions, "dataset">;
  readonly datasetResolver?: TerritoryRuntimeDatasetResolver;
  readonly cache?: TerritoryRuntimeCache;
  readonly clock?: TerritoryRuntimeClock;
  readonly logger?: TerritoryRuntimeLogger;
}

export interface TerritoryRuntime<TTarget = unknown> {
  readonly state: TerritoryRuntimeState;
  readonly adapter: TerritoryRendererAdapter<TTarget> | undefined;
  getState(): TerritoryRuntimeState;
  subscribe(listener: TerritoryRuntimeEventListener): TerritoryRuntimeSubscription;
  unsubscribe(listener: TerritoryRuntimeEventListener): boolean;
  dispose(): TerritoryRuntimeDisposeResult;
}

interface ListenerEntry {
  readonly listener: TerritoryRuntimeEventListener;
}

const SYSTEM_CLOCK: TerritoryRuntimeClock = {
  now() {
    return new Date();
  }
};

export function createTerritoryRuntime<TTarget = unknown>(
  options: TerritoryRuntimeOptions<TTarget> = {}
): TerritoryRuntime<TTarget> {
  const listeners = new Map<TerritoryRuntimeEventListener, ListenerEntry>();
  const clock = options.clock ?? SYSTEM_CLOCK;
  const logger = options.logger;
  let status: TerritoryRuntimeStatus = "idle";
  let eventSequence = 0;
  let disposed = false;

  const readState = (): TerritoryRuntimeState => ({
    status,
    disposed,
    eventSequence
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
    error?: TerritoryError
  ): TerritoryRuntimeEvent {
    eventSequence += 1;
    const state = readState();

    return {
      type,
      state,
      sequence: eventSequence,
      occurredAt: clock.now(),
      ...(error ? { error } : {})
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
        emit(createEvent("listener-error", error), false);
      }
    } else {
      for (const error of errors) {
        logEvent(createEvent("listener-error", error), logger);
      }
    }
  }

  const runtime: TerritoryRuntime<TTarget> = {
    get state() {
      return readState();
    },
    get adapter() {
      return options.adapter;
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
      disposed = true;
      status = "disposed";
      emit(createEvent("state-change"), true);
      emit(createEvent("disposed"), true);
      listeners.clear();

      return {
        status: "disposed",
        alreadyDisposed: false,
        listenerCount
      };
    }
  };

  return runtime;
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

  if (event.type === "listener-error") {
    logger.error?.(event);
    return;
  }

  logger.debug?.(event);
}
