# Dataset Diff

TerritoryKit can compare two administrative boundary dataset versions before an application migrates stored region IDs, ownership records, reports, caches, or derived indexes.

```bash
territory dataset diff old-dataset.json new-dataset.json
territory dataset diff old-dataset.json new-dataset.json --json
territory identity diff old-dataset.json new-dataset.json --json
```

The default stdout format for `territory dataset diff` is Markdown. Machine-readable output is available with `--json`, `--csv`, or `--format json|csv|mapping|breaking|coverage`.

Use output flags to write multiple artifacts in one run:

```bash
territory dataset diff old.json new.json \
  --markdown-output reports/diff.md \
  --json-output reports/diff.json \
  --csv-output reports/diff.csv \
  --mapping-output reports/migration-plan.json \
  --breaking-output reports/breaking.json \
  --coverage-output reports/coverage.json \
  --performance-output reports/performance.json
```

## Public API

```ts
import { diffDatasets, diffIdentities } from "@territory-kit/dataset";

const report = diffDatasets(oldDataset, newDataset);
const identityReport = diffIdentities(oldDataset, newDataset);
```

Reports use `schemaVersion: "territory-dataset-diff@1"` and include deterministic `summary`, `changes`, `matches`, `breakingChanges`, `coverageChangeReport`, and `performance` sections.

## Categories

The diff engine emits these categories:

- `added`
- `removed`
- `unchanged`
- `renamed`
- `reparented`
- `geometry-changed`
- `metadata-changed`
- `split-candidate`
- `merge-candidate`
- `ambiguous-match`
- `stable-id-conflict`
- `hierarchy-invalid`
- `license-changed`
- `source-changed`

For identical datasets, `changes` is empty and `summary.countsByCategory.unchanged` contains the matched zone count.

## Matching Strategy

Matching is deterministic and uses this order:

1. Stable ID exact match.
2. Source-native ID match from `properties.territory.codes`, `properties.territory.source.sourceId`, and common source code fields.
3. Parent plus normalized name match, including Turkish character normalization.
4. Geometry similarity from bbox-filtered spatial candidates.
5. Centroid, area, overlap, and parent containment signals.
6. `ambiguous-match` when candidates cannot be selected safely.

Automatic matches receive a confidence score. Mappings below `--automatic-confidence-threshold` default `0.85` require review and are not automatic migrations.

## Geometry Signals

`geometry-changed` entries include:

- bounding box change
- centroid distance in meters
- area change percentage
- intersection over union
- polygon or multipolygon type change
- topology validity
- whether the zone center remains inside its parent bbox

The current implementation uses fast bbox candidate filtering and bbox intersection for overlap signals. This is exact for rectangular fixtures and conservative enough for CI review gates; very complex polygon migrations should still be reviewed visually.

## Split And Merge

One old zone overlapping multiple new zones is a `split-candidate`. Multiple old zones overlapping one new zone is a `merge-candidate`.

These are never emitted as automatic one-to-one ID migrations. They appear in `reviewItems` when a migration plan is created.

## CI Exit Codes

By default, a successful diff command exits `0` even when changes exist. Use:

- `--fail-on-breaking` to exit `1` when breaking changes are present.
- `--fail-on-review` to exit `1` when any change or mapping requires manual review.
- input or usage errors exit `2`.

## Performance

The diff report includes deterministic performance counters:

- `candidatePairCount`
- `spatialCandidateCount`
- `spatialQueryCount`
- `estimatedMemoryBytes`
- `streamingRecommended`

The engine does not brute-force all pairs. It first resolves stable and source/name identities, then uses bbox candidate filtering for geometry candidates. Current memory use is in-memory and roughly linear in zone count plus retained candidates. Treat `streamingRecommended: true` as a signal to run the comparison in country, level, or source chunks for datasets above roughly 100,000 total zones.
