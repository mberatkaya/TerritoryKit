# @territory-kit/maplibre

MapLibre GL JS adapter utilities for rendering TerritoryKit zones as GeoJSON sources and layers.

## Installation

```sh
pnpm add @territory-kit/maplibre @territory-kit/core @territory-kit/dataset maplibre-gl
```

## Basic Usage

```ts
import { createTerritoryMapLibreAdapter } from "@territory-kit/maplibre";

const adapter = createTerritoryMapLibreAdapter({
  zones: dataset.zones,
  onZoneClick: ({ zoneId }) => console.log(zoneId)
});

adapter.attach(map);
```

## API Summary

- `zonesToFeatureCollection(zones, stateByZoneId)` converts zones to GeoJSON features.
- `createTerritoryMapLibreLayers(zones, options)` returns source and layer specs.
- `createTerritoryMapLibreSource({ registry, country, level })` resolves registry-backed render
  artifacts with `requestedLevel`, `renderedLevel`, and fallback metadata.
- `createTerritoryMapLibreLevelLayers(options)` returns ADM0-ADM5 layer specs from the default zoom
  policy.
- `setTerritoryMapLibreHoverState` and `setTerritoryMapLibreSelectedState` wrap MapLibre feature
  state for vector-tile interactions.
- `createTerritoryMapLibreAdapter(options)` manages attach, detach, data updates, and theme updates.
- `TerritoryMapLibreState` describes optional visual state per zone.

ADM3 and deeper sources prefer MVT when available and may fall back to GeoJSON for small fixtures.
Do not load nationwide neighbourhood geometry as one browser GeoJSON by default.

## License

Apache-2.0
