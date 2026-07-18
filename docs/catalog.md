# Multi-Dataset Catalog

The runtime catalog resolves viewport and territory requests across multiple query datasets.
It is designed for country-split coverage, partial lower-admin coverage, priority overrides, and
fallback levels.

## API

```ts
import { createTerritoryCatalog } from "@territory-kit/runtime";

const catalog = createTerritoryCatalog();

catalog.registerDataset({
  dataset,
  country: "TR",
  levels: ["ADM2", "ADM3"],
  priority: 10,
  fallbackLevel: "ADM2",
  artifactPurpose: "query",
  spatialIndex: binaryIndexBuffer,
  indexHash: "..."
});

const plan = catalog.createResolutionPlan({
  bounds: { west: 25, south: 36, east: 45, north: 42 },
  zoom: 12,
  level: 3
});
```

Catalog entries contain:

- `datasetId` and `datasetVersion`
- `country`
- numeric levels derived from `ADM*` labels
- coverage bounds
- optional parent scope
- priority
- fallback level
- artifact purpose
- geometry hash
- optional binary index hash and buffer

## Resolution Plans

`resolveViewport` and `createResolutionPlan` return the same immutable plan shape:

- `exactMatches`: entries that cover the viewport and support the requested level
- `fallbackMatches`: entries that cover the viewport and resolve to a lower fallback level
- `unavailableCoverage`: no-coverage or level-unavailable records
- `selectedArtifacts`: deterministic winners after priority and tie-breaking
- `selectedLevels`: levels used by the selected artifacts
- `priorityDecisions`: lower-priority or lexical tie-break exclusions

A viewport can select more than one country. Entries are grouped by country, parent scope, selected
level, and artifact purpose, so adjacent countries can both be selected while overlapping entries
inside the same country resolve by priority.

## Runtime Behavior

When `createTerritoryRuntime({ catalog })` is used, runtime requests:

1. capture the catalog revision
2. build a resolution plan
3. load/reuse one engine per selected artifact through the engine pool
4. query all selected datasets
5. merge results deterministically
6. reject stale plans if the catalog changes before commit

Duplicate zone ids across datasets are namespaced in runtime render output as
`<datasetId>:<zoneId>` with the original id preserved in `properties.sourceZoneId`.
