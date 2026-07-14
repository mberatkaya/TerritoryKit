# @territory-kit/core

Core TerritoryKit engine APIs for hierarchical zones, spatial lookup, adjacency, bounds queries, and zoom-level transitions.

## Installation

```sh
pnpm add @territory-kit/core @territory-kit/dataset
```

## Basic Usage

```ts
import { createTerritoryEngine } from "@territory-kit/core";
import { loadTerritoryDataset } from "@territory-kit/dataset";

const dataset = loadTerritoryDataset(input);
const engine = createTerritoryEngine({ dataset });

const zoneId = engine.latLngToZone([29.0, 41.0]);
```

## API Summary

- `createTerritoryEngine({ dataset, levelStrategy })` builds the query engine.
- `latLngToZone(coordinate, options)` locates the containing zone.
- `getNeighbors(zoneId, options)` returns adjacent zones.
- `getVisibleZones(query)` and `getViewportCacheKey(query)` support viewport flows.
- `zoomToDefaultLevel` and `defaultZoomLevelStrategy` provide default zoom mapping.

## License

Apache-2.0
