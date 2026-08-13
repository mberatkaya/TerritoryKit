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

## Turkey V2 Standard

Turkey V2 adds `territorykit-tr-v2-adm3-stable-id@1` for mixed official, OSM, and generated ADM3
records. The helper `createTurkeyV2Adm3TerritoryId()` includes province code, district code, source
class, and source-native or generated local identity.

Examples:

- `tr:adm3:tr-il-34-ilce-003-official-123456`
- `tr:adm3:tr-il-34-ilce-003-osm-relation-987654`
- `tr:adm3:tr-il-34-ilce-003-generated-tr-adm3-generated-zone-v1-000042`

When `sourceNativeId` is present, name changes do not change the ID. Generated algorithm-version
changes intentionally produce different IDs. See `adr/ADR-007-turkey-v2-stable-identity.md` in the
repository root.
