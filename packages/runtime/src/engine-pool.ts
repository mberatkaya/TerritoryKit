import { createTerritoryEngine } from "@territory-kit/core";
import type {
  TerritoryBinarySpatialIndex,
  TerritoryBinarySpatialIndexBuffer,
  TerritoryEngine,
  TerritoryEngineOptions
} from "@territory-kit/core";
import { TerritoryError } from "@territory-kit/dataset";
import type { TerritoryDataset } from "@territory-kit/dataset";

export interface TerritoryEnginePoolEntry {
  readonly key: string;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly geometryHash: string;
  readonly engine: TerritoryEngine;
  readonly pinned: boolean;
  readonly estimatedBytes: number;
  readonly lastUsed: number;
  readonly uses: number;
}

export interface TerritoryEnginePoolSummary {
  readonly activeEngines: number;
  readonly pinnedEngines: number;
  readonly maxActiveEngines?: number;
  readonly estimatedBytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly entries: readonly Omit<TerritoryEnginePoolEntry, "engine">[];
}

export interface TerritoryEnginePoolGetOptions {
  readonly key?: string;
  readonly engineOptions?: Omit<TerritoryEngineOptions, "dataset" | "spatialIndex">;
  readonly spatialIndex?: TerritoryBinarySpatialIndex | TerritoryBinarySpatialIndexBuffer;
  readonly indexHash?: string;
  readonly pinned?: boolean;
  readonly context?: unknown;
}

export type TerritoryEnginePoolFactory = (
  options: TerritoryEngineOptions,
  context?: unknown
) => TerritoryEngine | Promise<TerritoryEngine>;

export type TerritoryEnginePoolMemoryEstimator = (
  dataset: TerritoryDataset,
  engine: TerritoryEngine
) => number;

export interface TerritoryEnginePoolOptions {
  readonly maxActiveEngines?: number;
  readonly createEngine?: TerritoryEnginePoolFactory;
  readonly engineOptions?: Omit<TerritoryEngineOptions, "dataset" | "spatialIndex">;
  readonly estimateMemory?: TerritoryEnginePoolMemoryEstimator;
  readonly clock?: () => number;
}

export interface TerritoryEnginePool {
  readonly summary: TerritoryEnginePoolSummary;
  getEngine(
    dataset: TerritoryDataset,
    options?: TerritoryEnginePoolGetOptions
  ): Promise<TerritoryEngine>;
  pin(key: string): boolean;
  unpin(key: string): boolean;
  delete(key: string): boolean;
  dispose(): void;
  getSummary(): TerritoryEnginePoolSummary;
}

interface MutablePoolEntry {
  key: string;
  datasetId: string;
  datasetVersion: string;
  geometryHash: string;
  engine: TerritoryEngine;
  pinned: boolean;
  estimatedBytes: number;
  lastUsed: number;
  uses: number;
}

interface PoolKeySignature {
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly geometryHash: string;
  readonly indexHash?: string;
}

export function createTerritoryEnginePool(
  options: TerritoryEnginePoolOptions = {}
): TerritoryEnginePool {
  const maxActiveEngines = validateMaxActiveEngines(options.maxActiveEngines);
  const createEngine = options.createEngine ?? createTerritoryEngine;
  const estimateMemory = options.estimateMemory ?? defaultEstimateMemory;
  const clock = options.clock ?? (() => Date.now());
  const entries = new Map<string, MutablePoolEntry>();
  const keySignatures = new Map<string, PoolKeySignature>();
  const inFlightByKey = new Map<string, Promise<TerritoryEngine>>();
  const inFlightTokensByKey = new Map<string, symbol>();
  let hits = 0;
  let misses = 0;
  let evictions = 0;
  let disposed = false;

  const pool: TerritoryEnginePool = {
    get summary() {
      return readSummary();
    },
    async getEngine(dataset, getOptions = {}) {
      assertUsable();
      const key = getOptions.key ?? datasetEnginePoolKey(dataset, getOptions.indexHash);
      const signature = createKeySignature(dataset, getOptions.indexHash);
      assertKeyCompatible(key, signature);
      const cached = entries.get(key);

      if (cached) {
        hits += 1;
        cached.uses += 1;
        cached.lastUsed = clock();

        if (getOptions.pinned === true) {
          cached.pinned = true;
        }

        return cached.engine;
      }

      const inFlight = inFlightByKey.get(key);

      if (inFlight) {
        hits += 1;
        return inFlight;
      }

      misses += 1;

      const token = Symbol(key);
      inFlightTokensByKey.set(key, token);

      const creation = Promise.resolve()
        .then(() =>
          createEngine(
            {
              dataset,
              ...(options.engineOptions ?? {}),
              ...(getOptions.engineOptions ?? {}),
              ...(getOptions.spatialIndex ? { spatialIndex: getOptions.spatialIndex } : {})
            },
            getOptions.context
          )
        )
        .then((engine) => {
          const stillCurrent = inFlightTokensByKey.get(key) === token;
          inFlightByKey.delete(key);

          if (stillCurrent) {
            inFlightTokensByKey.delete(key);
          }

          if (!stillCurrent) {
            disposeEngine(engine);
            if (disposed) {
              throw new TerritoryError(
                "RUNTIME_DISPOSED",
                "Territory engine pool was disposed while creating an engine."
              );
            }

            return engine;
          }

          if (disposed) {
            disposeEngine(engine);
            throw new TerritoryError(
              "RUNTIME_DISPOSED",
              "Territory engine pool was disposed while creating an engine."
            );
          }

          if (maxActiveEngines === 0) {
            return engine;
          }

          const entry: MutablePoolEntry = {
            key,
            datasetId: dataset.manifest.datasetId,
            datasetVersion: dataset.manifest.datasetVersion,
            geometryHash: dataset.manifest.geometryHash,
            engine,
            pinned: getOptions.pinned === true,
            estimatedBytes: estimateMemory(dataset, engine),
            lastUsed: clock(),
            uses: 1
          };

          entries.set(key, entry);
          keySignatures.set(key, signature);
          evictIfNeeded();
          return engine;
        })
        .catch((error) => {
          if (inFlightTokensByKey.get(key) === token) {
            inFlightByKey.delete(key);
            inFlightTokensByKey.delete(key);
          }

          if (!entries.has(key)) {
            keySignatures.delete(key);
          }

          throw error;
        });

      inFlightByKey.set(key, creation);
      return creation;
    },
    pin(key) {
      const entry = entries.get(key);

      if (!entry) {
        return false;
      }

      entry.pinned = true;
      entry.lastUsed = clock();
      return true;
    },
    unpin(key) {
      const entry = entries.get(key);

      if (!entry) {
        return false;
      }

      entry.pinned = false;
      entry.lastUsed = clock();
      evictIfNeeded();
      return true;
    },
    delete(key) {
      const entry = entries.get(key);

      if (!entry) {
        const deletedInFlight = inFlightByKey.delete(key);

        if (deletedInFlight) {
          inFlightTokensByKey.delete(key);
          keySignatures.delete(key);
        }

        return deletedInFlight;
      }

      disposeEngine(entry.engine);
      keySignatures.delete(key);
      return entries.delete(key);
    },
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;

      for (const entry of entries.values()) {
        disposeEngine(entry.engine);
      }

      entries.clear();
      keySignatures.clear();
      inFlightByKey.clear();
      inFlightTokensByKey.clear();
    },
    getSummary() {
      return readSummary();
    }
  };

  function evictIfNeeded(): void {
    if (maxActiveEngines === undefined) {
      return;
    }

    while (entries.size > maxActiveEngines) {
      const candidate = [...entries.values()]
        .filter((entry) => !entry.pinned)
        .sort(
          (left, right) => left.lastUsed - right.lastUsed || left.key.localeCompare(right.key)
        )[0];

      if (!candidate) {
        break;
      }

      disposeEngine(candidate.engine);
      entries.delete(candidate.key);
      keySignatures.delete(candidate.key);
      evictions += 1;
    }
  }

  function readSummary(): TerritoryEnginePoolSummary {
    const summaryEntries = [...entries.values()]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((entry) =>
        Object.freeze({
          key: entry.key,
          datasetId: entry.datasetId,
          datasetVersion: entry.datasetVersion,
          geometryHash: entry.geometryHash,
          pinned: entry.pinned,
          estimatedBytes: entry.estimatedBytes,
          lastUsed: entry.lastUsed,
          uses: entry.uses
        })
      );

    return Object.freeze({
      activeEngines: entries.size,
      pinnedEngines: summaryEntries.filter((entry) => entry.pinned).length,
      ...(maxActiveEngines !== undefined ? { maxActiveEngines } : {}),
      estimatedBytes: summaryEntries.reduce((total, entry) => total + entry.estimatedBytes, 0),
      hits,
      misses,
      evictions,
      entries: Object.freeze(summaryEntries)
    });
  }

  function assertUsable(): void {
    if (disposed) {
      throw new TerritoryError("RUNTIME_DISPOSED", "Territory engine pool has been disposed.");
    }
  }

  function assertKeyCompatible(key: string, signature: PoolKeySignature): void {
    const existing = keySignatures.get(key);

    if (!existing) {
      keySignatures.set(key, signature);
      return;
    }

    if (poolKeySignaturesEqual(existing, signature)) {
      return;
    }

    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      "Engine pool key is already associated with a different dataset or spatial index.",
      {
        details: {
          key,
          expected: existing,
          actual: signature
        }
      }
    );
  }

  return pool;
}

function createKeySignature(
  dataset: TerritoryDataset,
  indexHash: string | undefined
): PoolKeySignature {
  return {
    datasetId: dataset.manifest.datasetId,
    datasetVersion: dataset.manifest.datasetVersion,
    geometryHash: dataset.manifest.geometryHash,
    ...(indexHash ? { indexHash } : {})
  };
}

function poolKeySignaturesEqual(left: PoolKeySignature, right: PoolKeySignature): boolean {
  return (
    left.datasetId === right.datasetId &&
    left.datasetVersion === right.datasetVersion &&
    left.geometryHash === right.geometryHash &&
    (left.indexHash ?? "") === (right.indexHash ?? "")
  );
}

export function datasetEnginePoolKey(
  dataset: TerritoryDataset,
  indexHash: string | undefined = undefined
): string {
  return [
    dataset.manifest.datasetId,
    dataset.manifest.datasetVersion,
    dataset.manifest.geometryHash,
    indexHash ?? "json"
  ].join(":");
}

function validateMaxActiveEngines(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value < 0 || !Number.isFinite(value)) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      "Engine pool maxActiveEngines must be a finite non-negative integer.",
      {
        details: { maxActiveEngines: value }
      }
    );
  }

  return value;
}

function defaultEstimateMemory(dataset: TerritoryDataset, engine: TerritoryEngine): number {
  return (
    dataset.zones.length * 256 +
    engine.getSpatialIndexSummary().estimatedBytes +
    JSON.stringify(dataset.manifest).length
  );
}

function disposeEngine(engine: TerritoryEngine): void {
  const candidate = engine as TerritoryEngine & { dispose?: () => void };
  candidate.dispose?.();
}
