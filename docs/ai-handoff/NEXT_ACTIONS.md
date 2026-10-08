# Next actions (prioritized backlog)

| P   | Task                                                    | Depends  | Key paths                                                                             | Expected output                   | Acceptance                        | Status             |
| --- | ------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------- | ------------------ |
| 1   | Path B geoBoundaries parent lineage evidence            | —        | `reports/tr-adm3/provenance/geoboundaries/`, `turkey-geoboundaries-parent-lineage.ts` | Feasibility class + tooling       | Milestone criteria on research PR | **done on branch** |
| 1a  | Authorized Path B catalog/registry realignment          | P1       | `datasets/sources/TR/national.json`, `datasets/registry/`, ADR-006                    | Metadata consistent with polygons | Legal + ADR approval              | blocked (auth)     |
| 1b  | Authorized ADM0–ADM2 parent geometry migration (Path A) | —        | HDX import pipeline, `datasets/generated/countries/TR/`                               | Polygon bytes = HDX members       | ADM3 clip replay                  | blocked (auth)     |
| 2   | Full country-build geometry replay for ADM1/ADM2 gaps   | P1       | `packages/generators/src/countries/builder.ts`                                        | Explain 24+20 hash mismatches     | Repro doc                         | pending            |
| 3   | Official Kadıköy neighbourhood data                     | P1b opt  | `reports/tr-adm3/audit/kadikoy-acquisition.json`                                      | Complete official bundle          | Ingestion succeeds                | pending            |
| 4   | Eyüpsultan geometry regression                          | —        | `reports/tr-adm3/audit/istanbul-replay.json`                                          | Root-cause note + fixture         | Reproducible diagnostic           | pending            |
| 5   | Nationwide ADM3 licensed polygon expansion              | P1b      | `datasets/sources/TR/`                                                                | New official sources              | Increased official count/area     | pending            |
| 6   | Consumer artifact validation                            | external | hosted manifests                                                                      | Integration test report           | Deployed version match            | pending            |

## Immediate next PR (recommended)

**Path B metadata migration (authorized)** — prerequisites:

1. Accept DEC-008 or amend ADR-006 with explicit gbOpen geoBoundaries pins from `sources.lock.json`.
2. Legal review of geoBoundaries license strings (OSM/ODbL vs CC BY 4.0 adapter default).
3. Resolve or accept ADM1/ADM2 geometry replay gaps (57/81 and 953/973) — either document as non-material serialization/repair drift or complete full builder replay proof.
4. ADM3 national clip regression plan executed (no geometry change expected for metadata-only Path B).

## Completed (geoBoundaries research branch)

- `pnpm data:tr:geoboundaries:parent:audit` tooling + reports
- Byte verification against historical `sources.lock.json`
- shapeID identity comparison at national inventory scale (local artifacts)
- Path B classification `PATH_B_PARTIALLY_VERIFIED`
