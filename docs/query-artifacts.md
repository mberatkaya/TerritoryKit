# Query Artifacts

Query artifacts are the authoritative data used by core lookup, hierarchy, metadata, and adjacency
workflows. They keep stable `territoryId` values and may include detailed geometry needed by point
lookup or parent/child resolution.

```ts
import { loadTerritoryQueryDataset } from "@territory-kit/core";

const query = await loadTerritoryQueryDataset({
  registry,
  datasetId: "territory-kit-tr",
  levels: ["ADM1", "ADM2"]
});

const zone = query.getZoneById("tr:34");
```

`loadTerritoryQueryDataset` remains available from `@territory-kit/core` for compatibility. New
runtime orchestration should move registry installation coordination toward `@territory-kit/runtime`
as that package grows beyond its Sprint 11 lifecycle foundation.

Render artifacts must not replace query artifacts for business logic. Map click handlers should use
the render feature `territoryId` to lazy-load query metadata when needed.
