# Dataset Migration Plans

Use migration plans when an application needs to move persisted references from one dataset version to another.

```bash
territory dataset migration-plan old-dataset.json new-dataset.json --json
territory dataset migration-plan old-dataset.json new-dataset.json --format markdown
```

The plan schema is versioned with `schemaVersion: "territory-migration-plan@1"`.

## Public API

```ts
import { createMigrationPlan, validateMigrationPlan } from "@territory-kit/dataset";

const plan = createMigrationPlan(oldDataset, newDataset);
const validation = validateMigrationPlan(plan);
```

`validateMigrationPlan` checks the schema version, dataset refs, mapping fields, duplicate automatic mappings, and low-confidence mappings that were incorrectly marked as automatic.

## Mapping Shape

```json
{
  "schemaVersion": "territory-migration-plan@1",
  "fromDataset": {
    "datasetId": "territorykit-tr",
    "datasetVersion": "2026.01.0",
    "geometryHash": "old-hash",
    "sourceDate": "2026-01-01"
  },
  "toDataset": {
    "datasetId": "territorykit-tr",
    "datasetVersion": "2026.07.0",
    "geometryHash": "new-hash",
    "sourceDate": "2026-07-01"
  },
  "mappings": [
    {
      "oldId": "tr:adm2:kadikoy",
      "newId": "tr:adm2:kadikoy",
      "type": "renamed",
      "confidence": 1,
      "requiresReview": false,
      "categories": ["renamed"],
      "strategy": "stable-id"
    }
  ],
  "reviewItems": [],
  "breakingChanges": [],
  "summary": {
    "automaticMappingCount": 1,
    "breakingChangeCount": 0,
    "requiresReviewCount": 0,
    "totalMappingCount": 1
  }
}
```

## Automatic Versus Manual

Automatic mappings are one-to-one matches with confidence at or above the automatic threshold and no review-only category.

Manual review is required for:

- `split-candidate`
- `merge-candidate`
- `ambiguous-match`
- `stable-id-conflict`
- `hierarchy-invalid`
- low-confidence geometry matches
- license or source changes
- major geometry changes

Split and merge candidates stay out of `mappings` because they can change aggregate semantics. They appear in `reviewItems` for a human approval workflow.

## CLI Artifacts

```bash
territory dataset migration-plan old.json new.json \
  --output reports/migration-plan.json \
  --mapping-output reports/migration-plan.raw.json \
  --fail-on-breaking \
  --fail-on-review
```

`--output` writes the selected `--format`. `--mapping-output` always writes the JSON plan. `--fail-on-breaking` and `--fail-on-review` make the command suitable for CI gates.

## Applying Plans

TerritoryKit intentionally does not mutate application data. Consumers should:

1. Run `validateMigrationPlan`.
2. Apply mappings where `requiresReview` is `false`.
3. Route `reviewItems` to a domain owner.
4. Rebuild derived caches and reports after review decisions are recorded.

Applications should store the plan artifact with the dataset upgrade so user-facing reports can explain why a region ID changed.

## Turkey V2

Turkey V2 migrations must preserve the difference between real and generated records. A generated
zone replaced by an official or OSM polygon is a source-class change and should be represented in
the migration plan instead of reusing the generated record as if it were an official mahalle.

The Gaziantep ADM3 pilot and older schema-v1 datasets remain readable in legacy mode. Strict Turkey
V2 validation is explicit through `--profile tr-v2`.
