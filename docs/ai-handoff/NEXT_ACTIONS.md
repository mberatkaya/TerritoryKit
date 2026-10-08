# Next actions (prioritized backlog)

| P   | Task                                                       | Depends  | Key paths                                                                             | Expected output                    | Acceptance                         | Status                                 |
| --- | ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------- | -------------------------------------- |
| 1   | Resolve geoBoundaries vs HDX/OCHA ADM0–ADM2 parent lineage | —        | `reports/tr-adm3/provenance/`, `turkey-parent-provenance.ts`, `turkey-v2-national.ts` | Root cause + guards (no migration) | Milestone criteria 1,3,4 on branch | **root-cause done; migration pending** |
| 1b  | Authorized ADM0–ADM2 parent geometry migration             | P1       | `datasets/generated/countries/TR/`, HDX import pipeline, ADM3 clip replay             | Consistent bytes + metadata        | Criteria 2 + ADM3 impact report    | blocked (auth)                         |
| 2   | Official Kadıköy neighbourhood data                        | P1b opt  | `reports/tr-adm3/audit/kadikoy-acquisition.json`                                      | Complete official bundle           | Ingestion succeeds                 | pending                                |
| 3   | Eyüpsultan geometry regression                             | —        | `reports/tr-adm3/audit/istanbul-replay.json`                                          | Root-cause note + fixture          | Reproducible diagnostic            | pending                                |
| 4   | Istanbul generated-boundary realism                        | P3       | `turkey-smart-fallback.ts`                                                            | District fixtures                  | Realism gates documented           | pending                                |
| 5   | Nationwide ADM3 licensed polygon expansion                 | P1b      | `datasets/sources/TR/`                                                                | New official sources               | Increased official count/area      | pending                                |
| 6   | Consumer artifact validation                               | external | hosted manifests                                                                      | Integration test report            | Deployed version match             | pending                                |

## Immediate next PR (recommended)

**Parent geometry migration or metadata realignment (Path A or B in `CURRENT_MILESTONE.md`)** — use `reports/tr-adm3/provenance/resolution.md` as the evidence baseline. Do not merge migration without ADM3 clipping / stable-ID impact notes.

## Completed (provenance sprint branch)

- Byte verification of HDX members vs `national.json`
- Geometry comparison canonical parents vs HDX members
- National CLI provenance fail-closed + `parentInputDataset` lock field
- `reports/tr-adm3/provenance/*` evidence pack
