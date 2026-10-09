# Next actions (prioritized backlog)

## Active program (four sprints)

| Sprint | Task                                                                                            | Status                                                |
| ------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1      | Source governance closeout — consolidated reports, licensing matrix, Path A/B, Sprint 2 handoff | **done** (#107, `70aab395`) |
| 2      | Istanbul geometry quality — Fatih, Kadıköy, Üsküdar, Adalar, Eyüpsultan/Çatalca pilots          | **in progress** (`feat/tr-adm3-istanbul-quality`) |
| 3      | National RC and delivery validation                                                             | planned                                               |
| 4      | Rush&Claim integration                                                                          | planned                                               |

## Blocked until human authorization

| P   | Task                                            | Key paths                             | Status                        |
| --- | ----------------------------------------------- | ------------------------------------- | ----------------------------- |
| 1a  | Authorized Path B catalog/registry realignment  | `national.json`, DEC-008, ADR-006     | blocked — legal + DEC-008     |
| 1b  | Authorized Path A HDX parent geometry migration | HDX import, ADM3 clip replay          | blocked — ADR + legal         |
| —   | Promote rc.7 to production/hosted delivery      | `.territory/sprint-6/final/candidate` | blocked                       |
| —   | Merge PR #103 Version Packages                  | GitHub #103                           | observe only — not authorized |

## Sprint 2 executable backlog (from handoff)

| P   | Task                                                  | Key paths                           | Expected output                |
| --- | ----------------------------------------------------- | ----------------------------------- | ------------------------------ |
| 1   | Kadıköy complete official bundle                      | `kadikoy-acquisition.json`          | 21-record ingestion comparison |
| 2   | Eyüpsultan NO_ROUTE / seam regression                 | `istanbul-replay.json`              | Fixture + root-cause note      |
| 3   | Generated-only shape pathology (Fatih spikes/slivers) | geometry QA tools                   | Export thresholds              |
| 4   | Üsküdar / Adalar coast-water policy                   | audit roadmap §4                    | Policy fixture                 |
| 5   | Çatalca rural realism classification                  | `district-quality-diagnostics.json` | Classified improvement plan    |

## Completed (merged on `main`)

- Path B geoBoundaries parent lineage (#105)
- Full country-build geometry replay (#106)
- Parent provenance fail-closed (#104)

## Path B / Path A prerequisites (unchanged)

1. Legal review: CC BY-SA 2.0 / ODbL 1.0 vs geoBoundaries CC BY 4.0 vs HDX CC BY-IGO.
2. DEC-008 acceptance and/or ADR-006 amendment with explicit pins.
3. Accept or mitigate **44** canonical vs replay serialized-hash gaps (#106 geographic equivalence).
4. ADM3 national clip regression plan for Path A; byte-freeze verification for Path B.
5. rc.7 consumer replay after any registry/catalog change.

Evidence index: `reports/tr-adm3/sprint-1-governance/`
