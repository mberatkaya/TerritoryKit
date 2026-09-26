# Sprint 5.1 README Audit

Audit date: 2026-08-29

Scope: first-party README files found with:

```bash
find . -path ./node_modules -prune -o -path ./.git -prune -o -iname README.md -print
```

| README path                                | Reviewed | Changed | Reason                                                                     |
| ------------------------------------------ | -------- | ------- | -------------------------------------------------------------------------- |
| `README.md`                                | yes      | yes     | Added Fatih calibration metrics and single-district hybrid example.        |
| `examples/react-native-maplibre/README.md` | yes      | no      | Example setup does not describe Turkey ADM3 build/source behavior.         |
| `packages/adapter-core/README.md`          | yes      | no      | Renderer-independent contracts unaffected by smart fallback calibration.   |
| `packages/cli/README.md`                   | yes      | yes     | Added `--osm-barrier-artifact` hybrid example and `smartAttempt` fields.   |
| `packages/core/README.md`                  | yes      | no      | Core query engine behavior unchanged.                                      |
| `packages/data-de/README.md`               | yes      | no      | Germany loader unrelated to Turkey ADM3 pipeline.                          |
| `packages/data-id/README.md`               | yes      | no      | Indonesia loader unrelated to Turkey ADM3 pipeline.                        |
| `packages/data-jp/README.md`               | yes      | no      | Japan loader unrelated to Turkey ADM3 pipeline.                            |
| `packages/data-tr/README.md`               | yes      | yes     | Clarified external artifact diagnostics while preserving thin loader role. |
| `packages/data-us/README.md`               | yes      | no      | United States loader unrelated to Turkey ADM3 pipeline.                    |
| `packages/dataset/README.md`               | yes      | no      | Schema semantics already cover generated/non-administrative metadata.      |
| `packages/game/README.md`                  | yes      | no      | Game ownership layer unaffected by data calibration.                       |
| `packages/generators/README.md`            | yes      | yes     | Added smart fallback diagnostic API and hybrid `smartAttempt` note.        |
| `packages/leaflet/README.md`               | yes      | no      | Renderer adapter docs do not describe Turkey ADM3 source priority.         |
| `packages/maplibre/README.md`              | yes      | no      | Existing Turkey V2/OSM barrier note remains accurate.                      |
| `packages/migration/README.md`             | yes      | no      | Spatial migration API unaffected by OSM source acquisition.                |
| `packages/nestjs/README.md`                | yes      | no      | NestJS integration docs do not describe Turkey ADM3 source priority.       |
| `packages/openlayers/README.md`            | yes      | no      | Renderer adapter docs do not describe Turkey ADM3 source priority.         |
| `packages/react-native/README.md`          | yes      | no      | Mobile runtime docs unaffected by build-time OSM snapshot pipeline.        |
| `packages/registry/README.md`              | yes      | no      | Registry cache/publish contract unchanged.                                 |
| `packages/runtime/README.md`               | yes      | no      | Runtime catalog behavior unchanged.                                        |

Summary:

- reviewed: 21
- changed: 4
- unchanged: 17

Sprint 5.1 also updated dataset documentation outside README scope:

- `docs/datasets/turkey-smart-fallback.md`
- `docs/datasets/turkey-osm-barrier-snapshots.md`
- `docs/datasets/turkey-v2-hybrid-coverage.md`
