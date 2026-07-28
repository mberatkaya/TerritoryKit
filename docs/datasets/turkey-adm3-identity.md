# Turkey ADM3 Identity

ADM3 stable IDs are deterministic and include parent context. The stable key is built from:

- country `TR`
- province plate code
- parent ADM2 key or mapped TerritoryKit ADM2 ID
- stable source ID when present, otherwise normalized name

This prevents same-name neighbourhoods in different districts from colliding. It also keeps IDs
stable when source feature order changes or polygon ring coordinate order changes.

## Normalization

`normalizeTurkeyAdm3Name()` uses the same ASCII-safe ID slug rules as TerritoryKit global IDs. It
normalizes Turkish dotted/dotless `i`, strips combining marks, lowercases, and collapses separators.

Examples:

- `İstiklal` -> `istiklal`
- `TR-27` -> province `27`
- parent `tr:adm2:54988432b26387222249237` becomes part of the stable ADM3 key

## Diff Policy

`identity-diff-report.json` is emitted for each build. Name changes appear as name diffs when the
stable source and parent context still match. Splits, merges, and parent changes are not silently
auto-matched; they appear as added/removed or parent-changed entries and require review.
