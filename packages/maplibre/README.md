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
- `createTerritoryMapLibreAdapter(options)` manages attach, detach, data updates, and theme updates.
- `TerritoryMapLibreState` describes optional visual state per zone.

## License

Apache-2.0
