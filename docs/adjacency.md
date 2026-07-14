# Adjacency Artifacts

TerritoryKit adjacency artifacts describe relationships between existing dataset zones. They are
separate from `dataset.json` so boundary geometry can remain canonical while computed and manually
audited neighbor edges evolve independently.

## Relation Types

- `shared-border`: two polygons share a positive-length boundary segment.
- `point-touch`: two polygons touch only at one or more boundary points.
- `maritime`: manual relationship for water-separated neighbors.
- `logical`: manual relationship for bridges, tunnels, portals, or app-specific links.

Bounding boxes are only a candidate prefilter. Final `shared-border`, `point-touch`, overlap, and
containment decisions are made from polygon boundary geometry.

## Build API

```ts
import { buildTerritoryAdjacency } from "@territory-kit/generators";

const result = await buildTerritoryAdjacency(dataset, {
  sameParentOnly: true,
  sameAdminLevelOnly: true,
  includePointTouches: false,
  minimumSharedBoundaryMeters: 10,
  buildDate: "2026-01-01T00:00:00.000Z"
});

console.log(result.artifact.edges);
```

Computed edges are deterministic for the same dataset, options, and normalized timestamp. Pass
`buildDate` or set `SOURCE_DATE_EPOCH` for reproducible filesystem output.

## Manual Overrides

Manual overrides run after computed edges. `remove` deletes any edge for the pair, and `add`
creates a manual edge. `maritime` and `logical` edges are manual-only.

```json
{
  "remove": [{ "a": "tr:adm1:34", "b": "tr:adm1:41", "reason": "source split changed" }],
  "add": [
    {
      "a": "tr:adm1:34",
      "b": "tr:adm1:41",
      "type": "maritime",
      "reason": "regular ferry connection",
      "sourceReference": "authority://example"
    }
  ]
}
```

## CLI

```sh
territory adjacency build ./dist/regions --output ./dist/regions-adjacency --build-date 2026-01-01T00:00:00.000Z
territory adjacency validate ./dist/regions ./dist/regions-adjacency
territory adjacency inspect ./dist/regions-adjacency tr:adm2:fatih --type shared-border --json
```

`territory adjacency build` writes `adjacency.json`, `build-report.json`, and `checksums.json` when
the output is a directory. Use `--include-point-touches`, `--minimum-shared-boundary-meters`,
`--overrides`, `--strict`, `--report`, and `--force` to tune builds.

Source imports can build adjacency immediately after serialization:

```sh
territory import geojson \
  --input ./regions.geojson \
  --output ./dist/regions \
  --country TR \
  --admin-level ADM2 \
  --name-property name \
  --build-adjacency
```

## Core Queries

```ts
import { createTerritoryEngine } from "@territory-kit/core";

const engine = createTerritoryEngine({ dataset, adjacency: artifact });

engine.zoneNeighbors("tr:adm2:fatih", { types: ["shared-border"] });
engine.getAdjacencyRelations("tr:adm2:fatih", { types: ["logical"] });
```

When no `types` filter is passed, `zoneNeighbors` keeps legacy `neighborIds` and old
`adjacencyConnections` behavior while also including artifact neighbors. When `types` is passed,
the query uses adjacency artifact relation types.

## Legacy BBox Helper

`inferBBoxAdjacency` and `territory adjacency <dataset.json>` remain available for development and
fixture generation. They are bbox helpers and must not be treated as legal polygon adjacency.
