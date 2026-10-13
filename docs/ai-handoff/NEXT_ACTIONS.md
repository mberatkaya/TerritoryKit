# Next actions (prioritized backlog)

## Active program (four sprints)

| Sprint | Task                                                                                            | Status                                                                         |
| ------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1      | Source governance closeout — consolidated reports, licensing matrix, Path A/B, Sprint 2 handoff | **done** (#107)                                                                |
| 2      | Istanbul geometry quality — Fatih, Kadıköy, Üsküdar, Adalar, Eyüpsultan/Çatalca pilots          | **done** (#108)                                                                |
| 3      | National RC and delivery validation                                                             | **review** (PR pending — `feat/tr-national-rc-delivery-validation`)            |
| 4      | Rush&Claim integration                                                                          | planned (`reports/tr-adm3/sprint-3-national-rc/rushclaim-sprint-4-handoff.md`) |

## Blocked until human authorization

| P   | Task                                            | Key paths                             | Status                        |
| --- | ----------------------------------------------- | ------------------------------------- | ----------------------------- |
| 1a  | Authorized Path B catalog/registry realignment  | `national.json`, DEC-008, ADR-006     | blocked — legal + DEC-008     |
| 1b  | Authorized Path A HDX parent geometry migration | HDX import, ADM3 clip replay          | blocked — ADR + legal         |
| —   | Promote rc.7 to production/hosted delivery      | `.territory/sprint-6/final/candidate` | blocked                       |
| —   | Merge PR #103 Version Packages                  | GitHub #103                           | observe only — not authorized |

## Sprint 4 prerequisites (from Sprint 3 handoff)

| P   | Task                                      | Key paths                        | Expected output           |
| --- | ----------------------------------------- | -------------------------------- | ------------------------- |
| 1   | Manifest + MVT + shard integration in R&C | `rushclaim-sprint-4-handoff.md`  | Consumer wiring PR in R&C |
| 2   | Kadıköy official source acquisition       | `kadikoy-acquisition.json`       | Ingestion path or blocker |
| 3   | Hosted delivery read-only verification    | production CDN (when authorized) | HOSTED_DELIVERY_VERIFIED  |
| 4   | Legal ADM0–ADM2 + municipal licenses      | `human-approvals-required.json`  | PENDING_REVIEW → accepted |

## Completed (merged on `main`)

- Sprint 2 Istanbul pilots and diagnostic fixes (#108)
- Sprint 1 governance closeout (#107)
- Path B geoBoundaries parent lineage (#105)
- Full country-build geometry replay (#106)
- Parent provenance fail-closed (#104)

Evidence index: `reports/tr-adm3/sprint-1-governance/`, `reports/tr-adm3/sprint-2-istanbul/`, `reports/tr-adm3/sprint-3-national-rc/`
