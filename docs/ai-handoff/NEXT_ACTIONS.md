# Next actions (prioritized backlog)

Update status when starting/completing work. Do not modify Rush&Claim repos from TerritoryKit tasks.

| P   | Task                                                        | Depends       | Key paths                                                                                                                | Expected output                      | Acceptance                                  | Status      |
| --- | ----------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------- | ----------- |
| 1   | Resolve geoBoundaries vs HDX/OCHA ADM0–ADM2 parent lineage  | —             | `CURRENT_MILESTONE.md`, `turkey-v2-national.ts`, `datasets/sources/TR/national.json`, `datasets/registry/countries.json` | Byte-verified lineage doc + tests    | Milestone acceptance criteria               | **pending** |
| 2   | Official Kadıköy neighbourhood data                         | P1 optional   | `reports/tr-adm3/audit/kadikoy-acquisition.json`, `turkey-adm3-ingestion.ts`                                             | Complete official bundle + CRS proof | Ingestion succeeds; not SHP-only gap        | pending     |
| 3   | Eyüpsultan geometry regression (~3.611 km seam, `NO_ROUTE`) | —             | `reports/tr-adm3/audit/istanbul-replay.json`, `istanbul-geometry-defects.md`, `turkey-organic-routing.ts`                | Root-cause note + fixture            | Stable IDs; reproducible diagnostic         | pending     |
| 4   | Istanbul generated-boundary realism                         | P3            | `turkey-smart-fallback.ts`, `district-quality-diagnostics.json`                                                          | Immutable district fixtures          | Realism gates documented per district       | pending     |
| 5   | Nationwide ADM3 licensed polygon expansion                  | P1            | `datasets/sources/TR/`, `datasets/registry/tr-adm3-*`                                                                    | New official sources ingested        | Increased official count/area with licenses | pending     |
| 6   | Consumer artifact validation                                | external auth | registry publish workflows, hosted manifests                                                                             | Integration test report              | Deployed version + cache match              | pending     |

## First executable task (after this foundation PR merges)

**P1 step 1:** On a dedicated branch, load HDX `tur_admin0/1/2.geojson` members per `datasets/sources/TR/national.json` checksums and compare stable geometry hashes to territories in the tracked TR parent dataset / national candidate ADM0–ADM2 layers. Record results in a new `reports/tr-adm3/provenance/` evidence file and wire a failing-then-passing regression test.

## Blocked prerequisites

- P6: credentials/URLs for hosted registry and mobile app not in this repo.
- P1 heavy replay: local `.territory/sprint-6/final/candidate` may be absent on clean CI clones.

## Completed (foundation sprint)

- Cursor rules under `.cursor/rules/`
- AI handoff directory `docs/ai-handoff/`
- Engineering foundation PR (see GitHub)
