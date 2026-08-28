# @territory-kit/maplibre

MapLibre GL JS adapter utilities for rendering TerritoryKit zones as GeoJSON sources and layers.

## Installation

```sh
pnpm add @territory-kit/maplibre @territory-kit/adapter-core @territory-kit/dataset maplibre-gl
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
- `createTerritoryMapLibreAdapter(options)` implements the shared adapter contract and manages
  attach, detach, source, state, data, and theme updates.
- `sourceReplacement` means `setSource` updates the configured existing GeoJSON source with
  `setData`. The source id must match the adapter `sourceId`; missing or mismatched sources throw
  coded `TerritoryError`s instead of silently no-oping.
- `TerritoryMapLibreState` describes optional visual state per zone.

ADM3 and deeper sources prefer MVT when available and may fall back to GeoJSON for small fixtures.
Do not load nationwide neighbourhood geometry as one browser GeoJSON by default.

Partial lower-admin artifacts can be scoped with `parentId`. The legacy Turkey ADM3 partial
artifact is available for Gaziantep ADM2 parents only; an uncovered parent falls back to ADM2 with
`fallbackReason: "requested-level-unavailable-for-area"` when deepest-available fallback is
enabled. The Turkey V2 national playable dataset is a separate external artifact path for
nationwide ADM3 gameplay coverage. OSM barrier snapshots are build-time generator inputs and should
not be shipped to browser renderers.

## License

Apache-2.0
