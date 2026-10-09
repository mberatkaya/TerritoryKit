# Next actions (prioritized backlog)

| P   | Task                                                    | Depends  | Key paths                                          | Expected output                   | Acceptance                      | Status             |
| --- | ------------------------------------------------------- | -------- | -------------------------------------------------- | --------------------------------- | ------------------------------- | ------------------ |
| 1   | Path B geoBoundaries parent lineage evidence            | —        | `reports/tr-adm3/provenance/geoboundaries/`        | Feasibility class + tooling       | PR #105                         | **done**           |
| 2   | Full country-build geometry replay for ADM1/ADM2 gaps   | P1       | `reports/tr-adm3/provenance/geoboundaries/replay/` | 44 mismatch root-cause inventory  | Replay PR merged                | **done on branch** |
| 1a  | Authorized Path B catalog/registry realignment          | P1, P2   | `datasets/sources/TR/national.json`, ADR-006       | Metadata consistent with polygons | Legal + ADR + replay acceptance | blocked (auth)     |
| 1b  | Authorized ADM0–ADM2 parent geometry migration (Path A) | —        | HDX import pipeline                                | Polygon bytes = HDX members       | ADM3 clip replay                | blocked (auth)     |
| 3   | Official Kadıköy neighbourhood data                     | —        | `reports/tr-adm3/audit/kadikoy-acquisition.json`   | Complete official bundle          | Ingestion succeeds              | pending            |
| 4   | Eyüpsultan geometry regression                          | —        | `reports/tr-adm3/audit/istanbul-replay.json`       | Root-cause note + fixture         | Reproducible diagnostic         | pending            |
| 5   | Nationwide ADM3 licensed polygon expansion              | —        | `datasets/sources/TR/`                             | New official sources              | Increased official count/area   | pending            |
| 6   | Consumer artifact validation                            | external | hosted manifests                                   | Integration test report           | Deployed version match          | pending            |

## Path B metadata migration prerequisites (unchanged + replay)

1. Legal review: CC BY-SA 2.0 / ODbL 1.0 lock strings vs geoBoundaries adapter CC BY 4.0.
2. ADR-006 amendment or DEC-008 acceptance with explicit gbOpen pins.
3. Accept or mitigate **44** canonical vs replay serialized-hash gaps (geographically equivalent under documented IoU tolerance; likely repair-engine drift).
4. ADM3 national clip regression plan (metadata-only Path B should not change parent geometry bytes).
5. rc.7 consumer replay after any registry/catalog change.

## Completed (full builder replay branch)

- `pnpm data:tr:geoboundaries:parent:replay`
- Stage-level transformation graph + per-zone mismatch JSON
- Deterministic double-run evidence
- Read-only downstream impact note
