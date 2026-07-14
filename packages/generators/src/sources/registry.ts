import { TerritorySourceError } from "./errors.js";
import type { TerritorySourceAdapter } from "./types.js";
import { normalizeSourceAdapterId } from "./utils.js";

export class TerritorySourceRegistry {
  readonly #adapters = new Map<string, TerritorySourceAdapter>();

  register(adapter: TerritorySourceAdapter): void {
    const id = normalizeSourceAdapterId(adapter.id);

    if (this.#adapters.has(id)) {
      throw new TerritorySourceError({
        code: "SOURCE_ADAPTER_DUPLICATE",
        message: `Source adapter '${id}' is already registered.`,
        stage: "resolve",
        provider: id
      });
    }

    this.#adapters.set(id, adapter);
  }

  get(id: string): TerritorySourceAdapter {
    const normalizedId = normalizeSourceAdapterId(id);
    const adapter = this.#adapters.get(normalizedId);

    if (!adapter) {
      throw new TerritorySourceError({
        code: "SOURCE_ADAPTER_NOT_FOUND",
        message: `Source adapter '${normalizedId}' is not registered.`,
        stage: "resolve",
        provider: normalizedId
      });
    }

    return adapter;
  }

  has(id: string): boolean {
    try {
      return this.#adapters.has(normalizeSourceAdapterId(id));
    } catch {
      return false;
    }
  }

  list(): TerritorySourceAdapter[] {
    return [...this.#adapters.values()].sort((left, right) => left.id.localeCompare(right.id));
  }
}

export function createTerritorySourceRegistry(
  adapters: readonly TerritorySourceAdapter[] = []
): TerritorySourceRegistry {
  const registry = new TerritorySourceRegistry();

  for (const adapter of adapters) {
    registry.register(adapter);
  }

  return registry;
}
