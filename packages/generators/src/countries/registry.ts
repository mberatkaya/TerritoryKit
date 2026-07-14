import type { TerritoryCountryDatasetConfig } from "./types.js";
import { germanyCountryConfig } from "./configs/de.js";
import { indonesiaCountryConfig } from "./configs/id.js";
import { japanCountryConfig } from "./configs/jp.js";
import { turkeyCountryConfig } from "./configs/tr.js";
import { unitedStatesCountryConfig } from "./configs/us.js";

export class TerritoryCountryConfigRegistry {
  readonly #configsByAlpha2 = new Map<string, TerritoryCountryDatasetConfig>();
  readonly #alpha3Aliases = new Map<string, string>();

  constructor(configs: readonly TerritoryCountryDatasetConfig[]) {
    for (const config of configs) {
      this.register(config);
    }
  }

  register(config: TerritoryCountryDatasetConfig): void {
    const alpha2 = normalizeCountryLookup(config.countryCodeAlpha2);
    const alpha3 = config.countryCodeAlpha3.trim().toUpperCase();

    if (this.#configsByAlpha2.has(alpha2)) {
      throw new Error(`Country config '${alpha2}' is already registered.`);
    }

    if (this.#alpha3Aliases.has(alpha3)) {
      throw new Error(`Country alpha-3 alias '${alpha3}' is already registered.`);
    }

    this.#configsByAlpha2.set(alpha2, {
      ...config,
      countryCodeAlpha2: alpha2,
      countryCodeAlpha3: alpha3
    });
    this.#alpha3Aliases.set(alpha3, alpha2);
  }

  has(countryCode: string): boolean {
    return this.resolveCode(countryCode) !== undefined;
  }

  get(countryCode: string): TerritoryCountryDatasetConfig {
    const resolved = this.resolveCode(countryCode);

    if (!resolved) {
      throw new Error(`Country config '${countryCode}' is not registered.`);
    }

    return resolved;
  }

  list(): TerritoryCountryDatasetConfig[] {
    return [...this.#configsByAlpha2.values()].sort((left, right) =>
      left.countryCodeAlpha2.localeCompare(right.countryCodeAlpha2)
    );
  }

  private resolveCode(countryCode: string): TerritoryCountryDatasetConfig | undefined {
    const normalized = countryCode.trim();
    const alpha2 =
      normalized.length === 3
        ? this.#alpha3Aliases.get(normalized.toUpperCase())
        : normalized.toUpperCase();

    return alpha2 ? this.#configsByAlpha2.get(alpha2) : undefined;
  }
}

export function createTerritoryCountryConfigRegistry(
  configs: readonly TerritoryCountryDatasetConfig[]
): TerritoryCountryConfigRegistry {
  return new TerritoryCountryConfigRegistry(configs);
}

export function createDefaultTerritoryCountryConfigRegistry(): TerritoryCountryConfigRegistry {
  return createTerritoryCountryConfigRegistry([
    germanyCountryConfig,
    indonesiaCountryConfig,
    japanCountryConfig,
    turkeyCountryConfig,
    unitedStatesCountryConfig
  ]);
}

export function listTerritoryCountryConfigs(): TerritoryCountryDatasetConfig[] {
  return createDefaultTerritoryCountryConfigRegistry().list();
}

export function getTerritoryCountryConfig(countryCode: string): TerritoryCountryDatasetConfig {
  return createDefaultTerritoryCountryConfigRegistry().get(countryCode);
}

export function hasTerritoryCountryConfig(countryCode: string): boolean {
  return createDefaultTerritoryCountryConfigRegistry().has(countryCode);
}

function normalizeCountryLookup(countryCode: string): string {
  const normalized = countryCode.trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new Error("Country config code must be ISO alpha-2.");
  }

  return normalized;
}
