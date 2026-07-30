# Stable ID Migrations

Stable IDs are the application contract between TerritoryKit datasets and downstream records. They should remain stable across geometry corrections, name fixes, and source refreshes whenever the represented real-world administrative unit is the same.

## What Can Be Automatic

These changes can usually be migrated automatically when confidence is high:

- unchanged stable ID
- name-only rename with stable ID match
- source-native ID match with one old and one new zone
- parent plus normalized-name match with one old and one new zone
- small geometry correction

The migration plan still records the categories so applications can rebuild indexes, caches, and reports.

## What Requires Review

Manual approval is required when identity semantics may have changed:

- duplicate stable IDs
- low-confidence geometry matches
- ambiguous normalized-name matches
- one old zone splitting into multiple new zones
- multiple old zones merging into one new zone
- missing or invalid hierarchy
- license or source-provider change
- major geometry shift
- ADM level change

These changes are not safe one-to-one migrations without domain input.

## Confidence Model

The default automatic threshold is `0.85`.

| Strategy                 | Typical Confidence | Notes                                                                                 |
| ------------------------ | -----------------: | ------------------------------------------------------------------------------------- |
| `stable-id`              |             `1.00` | Exact unique stable ID match.                                                         |
| `source-native-id`       |             `0.96` | Exact source code match with unique old/new candidates.                               |
| `parent-normalized-name` |             `0.88` | Same parent, level, country, and normalized name.                                     |
| `geometry-similarity`    |           variable | Weighted IoU, centroid distance, area ratio, parent signal, and optional name signal. |
| `manual-review`          |           variable | Added, removed, split, merge, hierarchy, or ambiguous cases.                          |

You can tune the threshold:

```bash
territory dataset diff old.json new.json --automatic-confidence-threshold 0.9 --json
```

## Stable ID Conflicts

`stable-id-conflict` is emitted when:

- the old or new dataset contains duplicate zone IDs, or
- an exact stable ID match has disjoint source-native IDs, different normalized names, and very low geometry overlap.

Conflicts are breaking changes. They should be fixed upstream or approved with an explicit manual mapping outside automatic migration.

## Consumer Checklist

- Store dataset ID, version, and geometry hash with user data.
- Run `territory dataset diff` before accepting a new dataset.
- Block deploys with `--fail-on-breaking` when downstream systems cannot tolerate review items.
- Apply only mappings with `requiresReview: false`.
- Recompute caches keyed by zone ID, parent ID, or geometry hash.
- Keep the migration plan with release notes for auditability.
