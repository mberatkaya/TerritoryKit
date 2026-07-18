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
  selectionGroup: "tr-official-adm",
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
- optional `selectionGroup` for mutually exclusive variants
- fallback level
- artifact purpose
- geometry hash
- optional binary index hash and buffer

Registration is intentionally strict. Dataset id, dataset version, and geometry hash overrides must
match the dataset manifest; country must not conflict with manifest or zone country codes; levels
must exist in the dataset; fallback level must be one of the registered levels; priority must be
finite; bounds must be finite, sorted, and contain the dataset coverage; and binary spatial index
metadata plus registration `indexHash` must match the dataset. Registering the same entry id with
identical data is idempotent. Reusing that id with different dataset, bounds, priority, hash, or
index data fails with `RUNTIME_CONFIGURATION_INVALID`.

## Resolution Plans

`resolveViewport` and `createResolutionPlan` return the same immutable plan shape:

- `exactMatches`: entries that cover the viewport and support the requested level
- `fallbackMatches`: entries that cover the viewport and resolve to a lower fallback level
- `unavailableCoverage`: no-coverage or level-unavailable records
- `selectedArtifacts`: deterministic winners after priority and tie-breaking
- `selectedLevels`: levels used by the selected artifacts
- `priorityDecisions`: lower-priority or lexical tie-break exclusions

A viewport can select more than one country. Entries with different countries or parent scopes can
both be selected. Same-country, same-parent, same-level entries compete only when their coverage
bounds overlap, which lets disjoint country shards load together. Entries with the same explicit
`selectionGroup` always compete, even when their bounds are disjoint, so applications can model
mutually exclusive variants.

## Runtime Behavior

When `createTerritoryRuntime({ catalog })` is used, runtime requests:

1. capture the catalog revision
2. build a resolution plan
3. create a catalog viewport cache key from the plan, collision policy, zoom, level, and bounds
4. load/reuse one engine per selected artifact through the engine pool
5. query all selected datasets
6. merge results deterministically
7. reject stale plans if the catalog changes before commit

Duplicate zone ids across selected artifacts are rejected by default before adapter updates. Pass
`zoneIdCollisionPolicy: "namespace"` to `createTerritoryRuntime` to namespace every catalog output
zone from the start as `<entryId>::<sourceZoneId>`. Namespace mode rewrites local `parentId`,
`childIds`, `neighborIds`, and string references in zone properties, and preserves
`sourceZoneId`, `sourceDatasetId`, and `sourceEntryId`.

Collision policy is part of catalog cache identity. Catalog cache keys include
`collision=error` or `collision=namespace`, and cached catalog payloads record the policy that
created them. If a payload policy does not match the runtime policy, runtime treats the entry as a
miss and deletes it when the cache supports deletion. This keeps `error` and `namespace` runtimes
isolated even when they share the same external cache. Direct single-dataset viewport cache keys do
not include catalog collision policy.
