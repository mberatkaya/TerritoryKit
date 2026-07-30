import { TerritoryError } from "@territory-kit/dataset";

export interface MobileMemoryCacheSummary {
  readonly entries: number;
  readonly bytes: number;
  readonly evictions: number;
}

export interface MobileMemoryCacheOptions<TValue> {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly estimateBytes?: (value: TValue) => number;
}

interface CacheEntry<TValue> {
  readonly value: TValue;
  readonly bytes: number;
}

export interface MobileMemoryCache<TValue> {
  get(key: string): TValue | undefined;
  set(key: string, value: TValue): void;
  delete(key: string): boolean;
  clear(): void;
  evictToBytes(maxBytes: number): number;
  getSummary(): MobileMemoryCacheSummary;
}

export function createMobileMemoryCache<TValue>(
  options: MobileMemoryCacheOptions<TValue> = {}
): MobileMemoryCache<TValue> {
  const maxEntries = validateCapacity(options.maxEntries, "maxEntries");
  const maxBytes = validateCapacity(options.maxBytes, "maxBytes");
  const estimateBytes = options.estimateBytes ?? (() => 1);
  const entries = new Map<string, CacheEntry<TValue>>();
  let bytes = 0;
  let evictions = 0;

  function deleteEntry(key: string): boolean {
    const existing = entries.get(key);

    if (!existing) {
      return false;
    }

    entries.delete(key);
    bytes -= existing.bytes;
    return true;
  }

  function evictIfNeeded(): void {
    while (
      (maxEntries !== undefined && entries.size > maxEntries) ||
      (maxBytes !== undefined && bytes > maxBytes)
    ) {
      const oldestKey = entries.keys().next().value as string | undefined;

      if (!oldestKey) {
        break;
      }

      deleteEntry(oldestKey);
      evictions += 1;
    }
  }

  return {
    get(key) {
      const entry = entries.get(key);

      if (!entry) {
        return undefined;
      }

      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      deleteEntry(key);
      const entry = {
        value,
        bytes: Math.max(0, Math.ceil(estimateBytes(value)))
      };
      entries.set(key, entry);
      bytes += entry.bytes;
      evictIfNeeded();
    },
    delete(key) {
      return deleteEntry(key);
    },
    clear() {
      entries.clear();
      bytes = 0;
    },
    evictToBytes(targetBytes) {
      const normalizedTarget = validateCapacity(targetBytes, "targetBytes") ?? 0;
      let removed = 0;

      while (bytes > normalizedTarget) {
        const oldestKey = entries.keys().next().value as string | undefined;

        if (!oldestKey) {
          break;
        }

        if (deleteEntry(oldestKey)) {
          evictions += 1;
          removed += 1;
        }
      }

      return removed;
    },
    getSummary() {
      return {
        entries: entries.size,
        bytes,
        evictions
      };
    }
  };
}

function validateCapacity(value: number | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      `Mobile memory cache option '${name}' must be a finite non-negative integer.`,
      { details: { option: name, value } }
    );
  }

  return value;
}
