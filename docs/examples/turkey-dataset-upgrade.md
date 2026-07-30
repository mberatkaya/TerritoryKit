# Turkey Dataset Upgrade Example

This example shows how a Turkey administrative dataset upgrade can be reviewed before application data moves to the new version.

## Scenario

Old dataset:

- `territorykit-tr@2026.01.0`
- `tr:adm2:kadikoy` uses ASCII display name `Kadikoy`
- `tr:adm3:demo-quarter` exists as one neighbourhood-like unit
- source provider is `synthetic-demo`

New dataset:

- `territorykit-tr@2026.07.0`
- `tr:adm2:kadikoy` display name is corrected to `Kadıköy`
- `tr:adm3:demo-quarter` is replaced by `tr:adm3:demo-quarter-a` and `tr:adm3:demo-quarter-b`
- source provider remains `synthetic-demo`

## Command

```bash
territory dataset diff examples/tr-old.json examples/tr-new.json \
  --markdown-output reports/tr-diff.md \
  --json-output reports/tr-diff.json \
  --csv-output reports/tr-diff.csv \
  --mapping-output reports/tr-migration-plan.json \
  --breaking-output reports/tr-breaking.json \
  --coverage-output reports/tr-coverage.json
```

For CI:

```bash
territory dataset diff examples/tr-old.json examples/tr-new.json --json --fail-on-breaking
```

## Example Markdown Report Excerpt

```md
# Territory Dataset Diff

From: territorykit-tr@2026.01.0
To: territorykit-tr@2026.07.0

## Summary

- Old zones: 4
- New zones: 5
- Changes: 2
- Unchanged matches: 2
- Requires review: 1
- Breaking changes: 1

## Categories

| Category        | Count |
| --------------- | ----: |
| added           |     0 |
| removed         |     0 |
| unchanged       |     2 |
| renamed         |     1 |
| split-candidate |     1 |

## Changes

| Category        | Old ID               | New ID                                         | Confidence | Review | Reason                                                                   |
| --------------- | -------------------- | ---------------------------------------------- | ---------: | ------ | ------------------------------------------------------------------------ |
| renamed         | tr:adm2:kadikoy      | tr:adm2:kadikoy                                |      1.000 | no     | Zone 'tr:adm2:kadikoy' name changed from 'Kadikoy' to 'Kadıköy'.         |
| split-candidate | tr:adm3:demo-quarter | tr:adm3:demo-quarter-a, tr:adm3:demo-quarter-b |      0.558 | yes    | Old zone 'tr:adm3:demo-quarter' overlaps 2 new zones with 100% coverage. |
```

## Migration Plan Interpretation

Automatic:

- `tr:adm2:kadikoy -> tr:adm2:kadikoy`, type `renamed`, confidence `1`, no review.

Manual:

- `tr:adm3:demo-quarter` split candidate. Do not move user data into either child automatically. Product or data owners should decide whether records are duplicated, proportionally assigned, archived, or manually reclassified.

## Coverage Interpretation

The coverage report shows one additional ADM3 zone and unchanged ADM0/ADM1/ADM2 coverage. This means apps with aggregate province or district reports can usually rebuild caches, while neighbourhood-level records need review for the split.
