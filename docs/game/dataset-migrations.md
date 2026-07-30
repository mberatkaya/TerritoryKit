# Game Dataset Migrations

Game snapshots record the TerritoryKit dataset used for validation:

```json
{
  "context": {
    "dataset": {
      "id": "territory-kit-tr",
      "version": "1.1.0",
      "geometryHash": "old-hash"
    }
  }
}
```

When the active core engine uses a different dataset ID, version, or geometry hash, command
execution returns `dataset-version-mismatch`. Migrate the snapshot first or run the old dataset.

## Using Migration Plans

Prompt 6 introduced `TerritoryDatasetMigrationPlan` in `@territory-kit/dataset`. The game package
consumes that mapping:

```ts
import { migrateGameSnapshotTerritories } from "@territory-kit/game";

const migrated = migrateGameSnapshotTerritories(snapshot, migrationPlan);
```

By default, only mappings with `requiresReview: false` are applied. Unmapped territory IDs fail the
migration so applications cannot silently strand ownership or score state.

Options:

- `onUnmappedTerritory: "fail" | "drop" | "keep"`
- `includeReviewMappings: true` when a reviewed workflow has approved those mappings
- `now` to make migration metadata deterministic in tests

## What Is Migrated

The helper rewrites current territory ownership, scores, cooldown territory IDs, claim/capture
history, contests, and event territory references. Audit entries remain historical command records;
store the migration plan artifact next to the migrated snapshot for traceability.

After migration, initialize the game engine with a core engine built from the new dataset. Normal
territory validity and adjacency checks then use the new core dataset.
