# Current milestone

## Sprint 1 — Türkiye kaynak yönetişimi ve kapanış

**Status:** Implementation on `fix/tr-source-governance-closeout` (PR pending).  
**Observation time:** 2026-10-09

### Completed research (on `main`, do not recreate)

- PR #104 — parent provenance guardrails
- PR #105 — geoBoundaries lineage and byte verification
- PR #106 — full country builder replay and geographic equivalence evidence

### Sprint 1 acceptance criteria

| #   | Criterion                                                      | Status                                  |
| --- | -------------------------------------------------------------- | --------------------------------------- |
| 1   | Handoff reflects merged PRs #104–#106                          | **Done** (this branch)                  |
| 2   | rc.7 candidate documented with scope labels                    | **Done**                                |
| 3   | 81-province ADM3 registry consistent with evidence             | **Done** (`adm3-readiness-report.json`) |
| 4   | License evidence separated (source vs distribution vs catalog) | **Done**                                |
| 5   | Unknown legal permissions remain `PENDING_REVIEW`              | **Done**                                |
| 6   | Path A/B matrix and human approvals documented                 | **Done**                                |
| 7   | No unauthorized migration or publication                       | **Done** (docs/reports only)            |
| 8   | Sprint 2 Istanbul handoff with pilots and tests                | **Done**                                |
| 9   | `pnpm data:tr:adm3:audit:test`, format, docs:links, verify     | **Pending CI / local run**              |
| 10  | One reviewable PR against `main`                               | **Pending**                             |

### Explicitly not in Sprint 1

- Path A HDX geometry migration
- Path B metadata/catalog realignment (DEC-008 not accepted)
- Istanbul geometry fixes (Sprint 2)
- Merge of PR #103

### Verification commands

```sh
pnpm data:tr:sprint1:governance
pnpm data:tr:adm3:audit:test
CI=true pnpm format:check
pnpm docs:links
pnpm verify
```

### Next milestone

**Sprint 2 — Istanbul ADM3 geometry quality** — see `reports/tr-adm3/sprint-1-governance/sprint-2-istanbul-handoff.md`
