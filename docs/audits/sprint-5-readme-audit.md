# Sprint 5 README Audit

Audit date: 2026-08-28

Scope: first-party README files found with:

```bash
find . -type f \( -iname "README.md" -o -iname "README.*" \) \
  -not -path "./node_modules/*" \
  -not -path "./dist/*" \
  -not -path "./.territory/*" \
  -not -path "./.git/*"
```

| README path                                | Reviewed | Changed | Reason                                                                  |
| ------------------------------------------ | -------- | ------- | ----------------------------------------------------------------------- |
| `README.md`                                | yes      | yes     | Added Turkey OSM barrier snapshot priority, CLI examples, and doc link. |
| `examples/react-native-maplibre/README.md` | yes      | no      | Example setup does not describe Turkey ADM3 build/source behavior.      |
| `packages/adapter-core/README.md`          | yes      | no      | Renderer-independent contracts unaffected by OSM snapshot pipeline.     |
| `packages/cli/README.md`                   | yes      | yes     | Added `territory tr osm` acquire/verify/barrier/coverage commands.      |
| `packages/core/README.md`                  | yes      | no      | Core query engine behavior unchanged.                                   |
| `packages/data-de/README.md`               | yes      | no      | Germany loader unrelated to Turkey ADM3 pipeline.                       |
| `packages/data-id/README.md`               | yes      | no      | Indonesia loader unrelated to Turkey ADM3 pipeline.                     |
| `packages/data-jp/README.md`               | yes      | no      | Japan loader unrelated to Turkey ADM3 pipeline.                         |
| `packages/data-tr/README.md`               | yes      | yes     | Clarified thin loader role and external OSM snapshot/barrier artifacts. |
| `packages/data-us/README.md`               | yes      | no      | United States loader unrelated to Turkey ADM3 pipeline.                 |
| `packages/dataset/README.md`               | yes      | no      | Schema semantics already cover generated/non-administrative metadata.   |
| `packages/game/README.md`                  | yes      | no      | Game ownership layer unaffected by data acquisition.                    |
| `packages/generators/README.md`            | yes      | yes     | Added OSM snapshot/barrier generator API and smart adapter example.     |
| `packages/leaflet/README.md`               | yes      | no      | Renderer adapter docs do not describe Turkey ADM3 source priority.      |
| `packages/maplibre/README.md`              | yes      | yes     | Clarified legacy Gaziantep ADM3 vs Turkey V2 nationwide artifacts.      |
| `packages/migration/README.md`             | yes      | no      | Spatial migration API unaffected by OSM source acquisition.             |
| `packages/nestjs/README.md`                | yes      | no      | NestJS integration docs do not describe Turkey ADM3 source priority.    |
| `packages/openlayers/README.md`            | yes      | no      | Renderer adapter docs do not describe Turkey ADM3 source priority.      |
| `packages/react-native/README.md`          | yes      | no      | Mobile runtime docs unaffected by build-time OSM snapshot pipeline.     |
| `packages/registry/README.md`              | yes      | no      | Registry cache/publish contract unchanged.                              |
| `packages/runtime/README.md`               | yes      | no      | Runtime catalog behavior unchanged.                                     |

Summary:

- reviewed: 21
- changed: 5
- unchanged: 16
