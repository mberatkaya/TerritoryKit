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
- `encodeTerritoryBinarySpatialIndex`, `decodeTerritoryBinarySpatialIndex`,
  `inspectTerritoryBinarySpatialIndex`, and `validateTerritoryBinarySpatialIndex` provide the
  versioned `.tksi` binary bbox index contract.
- `createTerritoryEngine({ dataset, spatialIndex })` accepts a prebuilt binary index and falls back
  to runtime Flatbush construction when no index is provided.
- `getSpatialIndexSummary()` reports whether an engine is using `flatbush` or `binary` lookup.
- `zoomToDefaultLevel` and `defaultZoomLevelStrategy` provide default zoom mapping.
- `createTerritoryCountryDatasetDescriptor` and `loadTerritoryCountryDataset` support thin
  resolver-driven country loader packages.

Registry client exports from the core root are deprecated compatibility exports. New code should
import registry APIs from `@territory-kit/registry`; migration-only code can use
`@territory-kit/core/legacy-registry`.

## License

Apache-2.0
