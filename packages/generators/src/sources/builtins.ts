import { geoBoundariesSourceAdapter } from "./geoboundaries.js";
import { genericGeoJsonSourceAdapter } from "./generic-geojson.js";
import { naturalEarthSourceAdapter } from "./natural-earth.js";
import { createTerritorySourceRegistry } from "./registry.js";
import type { TerritorySourceAdapter } from "./types.js";

export const BUILTIN_TERRITORY_SOURCE_ADAPTERS: readonly TerritorySourceAdapter[] = [
  naturalEarthSourceAdapter,
  geoBoundariesSourceAdapter,
  genericGeoJsonSourceAdapter
];

export function createDefaultTerritorySourceRegistry() {
  return createTerritorySourceRegistry(BUILTIN_TERRITORY_SOURCE_ADAPTERS);
}

export function listTerritorySourceAdapters(): TerritorySourceAdapter[] {
  return createDefaultTerritorySourceRegistry().list();
}

export function getTerritorySourceAdapter(id: string): TerritorySourceAdapter {
  return createDefaultTerritorySourceRegistry().get(id);
}

export function hasTerritorySourceAdapter(id: string): boolean {
  return createDefaultTerritorySourceRegistry().has(id);
}
