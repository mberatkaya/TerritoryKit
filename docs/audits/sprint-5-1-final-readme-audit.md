# Sprint 5.1 Final README Audit

Audit date: 2026-09-27

Scope: all 21 first-party README files returned by `rg --files -g README.md`, excluding dependencies and generated artifacts. Each file was read and checked for snapshot, relation, coverage, source-semantics, and CLI claims.

| Path                                       | Reviewed | Changed | Reason                                                                                                                             |
| ------------------------------------------ | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                | yes      | yes     | Updated Fatih metrics after native ESM polygon clipping and final real-snapshot regression.                                        |
| `examples/react-native-maplibre/README.md` | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/adapter-core/README.md`          | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/cli/README.md`                   | yes      | no      | Existing Turkey snapshot/hybrid examples and estimated source semantics remain accurate; detailed changes are linked dataset docs. |
| `packages/core/README.md`                  | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/data-de/README.md`               | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/data-id/README.md`               | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/data-jp/README.md`               | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/data-tr/README.md`               | yes      | no      | Existing Turkey snapshot/hybrid examples and estimated source semantics remain accurate; detailed changes are linked dataset docs. |
| `packages/data-us/README.md`               | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/dataset/README.md`               | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/game/README.md`                  | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/generators/README.md`            | yes      | yes     | Document complete relation assembly, limitations, normalized coverage and raw evidence.                                            |
| `packages/leaflet/README.md`               | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/maplibre/README.md`              | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/migration/README.md`             | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/nestjs/README.md`                | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/openlayers/README.md`            | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/react-native/README.md`          | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/registry/README.md`              | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |
| `packages/runtime/README.md`               | yes      | no      | Package or example contract is unchanged; no stale multipolygon or coverage claim.                                                 |

Reviewed: 21. Changed: 2. Unchanged: 19.

Dataset documentation updated: `docs/datasets/turkey-osm-barrier-snapshots.md` and `docs/datasets/turkey-smart-fallback.md`. Historical Sprint 5.1 audit remains unchanged.
