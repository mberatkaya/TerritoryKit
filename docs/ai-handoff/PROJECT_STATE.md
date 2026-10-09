# Project state snapshot

**Observation time (UTC):** 2026-10-09 (Sprint 1 — TR source governance closeout)  
**Verified `origin/main` base:** `dd3ab8eea31e0f1bce1cbb664105f53d150d7ca9` — _research(tr): reproduce geoBoundaries parent geometry through full country builder (#106)_  
**Active sprint branch:** `fix/tr-source-governance-closeout`

> Re-run `git fetch origin main && git log -1 origin/main` before production decisions.

## Recent merged work (GitHub-verified)

| PR   | Title                                                                              | Merged (UTC) |
| ---- | ---------------------------------------------------------------------------------- | ------------ |
| #106 | research(tr): reproduce geoBoundaries parent geometry through full country builder | 2026-10-09   |
| #105 | research(tr): verify geoBoundaries parent source lineage for Path B                | 2026-10-08   |
| #104 | fix(tr): verify and reconcile national parent source provenance                    | 2026-10-08   |
| #102 | chore(cursor): establish persistent engineering rules and handoff                  | 2026-10-08   |

**Open (not modified by Sprint 1):** [#103 Version Packages](https://github.com/mberatkaya/TerritoryKit/pull/103)

## Four-sprint implementation roadmap

| Sprint | Focus                               | Status                    |
| ------ | ----------------------------------- | ------------------------- |
| 1      | Source and governance closeout      | In progress (this branch) |
| 2      | Istanbul ADM3 geometry quality      | Next                      |
| 3      | National RC and delivery validation | Planned                   |
| 4      | Rush&Claim integration              | Planned                   |

Sprint 1 evidence: `reports/tr-adm3/sprint-1-governance/`

## Türkiye ADM0–ADM2 parent provenance (consolidated)

| Evidence                                                                      | Finding                                                                                                          |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Canonical parent (`datasets/generated/countries/TR/dataset.json`, gitignored) | `geoboundaries` on ADM0–ADM2; SHA-256 `648981940b96ac18f8e729b31d551e2922f1d76a5f33cdd99b92982e90eaf992` (local) |
| `datasets/sources/TR/national.json`                                           | HDX/OCHA COD-AB catalog (`hdx-cod-ab`) — does not match canonical parent bytes                                   |
| gbOpen pin                                                                    | `9469f09592ced973a3448cf66b6100b741b64c0d`; bytes verified (#105)                                                |
| Identity match                                                                | ADM0=1, ADM1=81, ADM2=973 source-native                                                                          |
| Full builder replay (#106)                                                    | `GEOGRAPHICALLY_EQUIVALENT_WITH_DIFFERENCES`; 44 serialized hash mismatches; deterministic replay                |
| Path B                                                                        | Technical **`PARTIAL`**; `legalReviewStatus: PENDING_REVIEW`; **not production-approved**; no metadata migration |

**Not changed in Sprint 1:** canonical geometry bytes, stable territory IDs, ADM3 polygons, `national.json`, npm/dataset publication.

## National dataset candidate (context only)

`territory-kit-tr-v2-playable@2.1.0-rc.7` — scope `LOCAL_RELEASE_CANDIDATE_NOT_PRODUCTION`. Metrics in `reports/tr-adm3/audit/baseline-claims.json` and `current-state.md`. Renderable area coverage is not official administrative accuracy.

## Engineering entry points

- Provenance audits: `pnpm data:tr:geoboundaries:parent:audit`, `pnpm data:tr:geoboundaries:parent:replay`
- Sprint 1 reports: `pnpm data:tr:sprint1:governance`
- ADM3 registry: `datasets/sources/TR/adm3/source-registry.json` (81 provinces)
