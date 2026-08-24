# @territory-kit/migration

Generic spatial migration helpers for mapping legacy zones, including H3 cells represented as
polygons, onto versioned TerritoryKit territory datasets.

The package intentionally emits spatial evidence and diagnostics only. Game-specific ownership,
claim, leaderboard, and scoring rules stay in the consuming application.

```ts
import { createSpatialMigrationPlan } from "@territory-kit/migration";

const plan = createSpatialMigrationPlan(sourceZones, {
  sourceSystem: "rushandclaim-h3",
  sourceVersion: "h3-resolution-8",
  targetDataset: dataset,
  targetLevel: 3,
  strategy: "max-overlap",
  generatedAt: "2026-08-24T00:00:00.000Z"
});
```
