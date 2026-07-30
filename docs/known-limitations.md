# Known Limitations

These limitations are accepted for `release/production-hardening` and do not block the draft
release-preparation PR.

## High Priority

| Limitation                                         | Impact                                                                                                          | Mitigation                                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full Turkey build workflow is maintainer-triggered | Normal PR CI does not rebuild nationwide Turkey artifacts.                                                      | Use `.github/workflows/turkey-dataset-build.yml` from `main` and review uploaded benchmark, adjacency, geometry, and checksum artifacts before publish. |
| ADM3 Turkey coverage is partial                    | Only Gaziantep province neighbourhoods are represented; nationwide ADM3 is not claimed.                         | Coverage metadata marks `partial`, `complete-selected-parents`, and source attribution.                                                                 |
| ADM3 strict geometry quality has findings          | Gaziantep ADM3 has TypeScript strict findings for self-intersections, parent containment, and sibling overlaps. | Treat ADM3 as partial pilot data; release gate is ADM0-ADM2 strict national coverage.                                                                   |

## Medium Priority

| Limitation                                         | Impact                                                                                               | Mitigation                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Dev audit has high/moderate advisories             | VitePress/Vite/PostCSS/brace-expansion/esbuild dev paths need maintenance upgrades.                  | Critical audit gate passes; schedule dependency update sprint.                                          |
| Dev/optional license inventory has unknown entries | Optional native/dev tooling metadata can be incomplete outside production inventory.                 | Production inventory has no unknown licenses; review dev-only metadata before distributing dev bundles. |
| React Native has no native CI app build            | Android/iOS compatibility is verified only by peer ranges and import-boundary tests.                 | Consumers must validate native app setup with their React Native and MapLibre React Native versions.    |
| PostGIS has no live DB CI matrix                   | SQL is documented and type-tested, but not run against a containerized PostGIS version in normal CI. | Maintain a manual DB smoke before claiming a specific PostGIS version.                                  |

## Low Priority

| Limitation                                      | Impact                                                                                              | Mitigation                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| MapLibre examples emit Vite chunk-size warnings | Build passes, but example bundles include large renderer chunks.                                    | Keep `pnpm bundle:size` gate and tune example chunking in a follow-up.                 |
| Package tarball SHA is generated per dry-run    | Tarball checksums are evidence for the inspected artifact, not a reproducible-build guarantee.      | Re-run `pnpm package:dry-run` immediately before publish and compare package contents. |
| ADM3 MVT output is limited to zoom 12           | The Gaziantep pilot is useful for smoke rendering but not a complete multi-zoom production tileset. | Future ADM3 expansion must add audited zoom policies and tile budgets.                 |
