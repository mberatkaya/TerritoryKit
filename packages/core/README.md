# @territory-kit/core

Core TerritoryKit engine APIs for hierarchical zones, spatial lookup, adjacency, bounds queries, and zoom-level transitions.

## Installation

```sh
pnpm add @territory-kit/core @territory-kit/dataset
```

## Basic Usage

```ts
import { readFile } from "node:fs/promises";
import { createTerritoryEngine } from "@territory-kit/core";
import { loadTerritoryDataset } from "@territory-kit/dataset";

const dataset = loadTerritoryDataset(input);
const adjacency = JSON.parse(await readFile("adjacency.json", "utf8"));
const engine = createTerritoryEngine({ dataset, adjacency });

const zoneId = engine.latLngToZone({ lat: 41.0, lng: 29.0 });
const sharedBorderNeighbors = engine.zoneNeighbors("tr:adm2:fatih", {
  types: ["shared-border"]
});
```

## API Summary

- `createTerritoryEngine({ dataset, adjacency, levelStrategy })` builds the query engine.
- `latLngToZone(coordinate, options)` locates the containing zone.
- `zoneNeighbors(zoneId, options)` returns legacy neighbors and optional adjacency artifact
  neighbors.
- `getAdjacencyRelations(zoneId, options)` returns typed artifact edges such as `shared-border`,
  `point-touch`, `maritime`, and `logical`.
- `getVisibleZones(query)` and `getViewportCacheKey(query)` support viewport flows.
- `zoomToDefaultLevel` and `defaultZoomLevelStrategy` provide default zoom mapping.

## License

Apache-2.0
