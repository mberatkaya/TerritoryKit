# Project state snapshot

**Observation time (UTC):** 2026-10-13 (Sprint 3 — TR national RC delivery validation)  
**Verified `origin/main` base:** `2c03e1b870272191cf8ddddf3313fe9d3cb147ba` — _feat(tr): improve Istanbul ADM3 geometry quality and pilot source validation (#108)_  
**Active sprint branch:** `feat/tr-national-rc-delivery-validation`

> Re-run `git fetch origin main && git log -1 origin/main` before production decisions.

## Recent merged work (GitHub-verified)

| PR   | Title                                                                              | Merged (UTC) |
| ---- | ---------------------------------------------------------------------------------- | ------------ |
| #108 | feat(tr): improve Istanbul ADM3 geometry quality and pilot source validation       | 2026-10-13   |
| #107 | fix(tr): close source governance gaps and prepare ADM3 delivery roadmap            | 2026-10-09   |
| #106 | research(tr): reproduce geoBoundaries parent geometry through full country builder | 2026-10-09   |
| #105 | research(tr): verify geoBoundaries parent source lineage for Path B                | 2026-10-08   |
| #104 | fix(tr): verify and reconcile national parent source provenance                    | 2026-10-08   |

**Open (observe only):** [#103 Version Packages](https://github.com/mberatkaya/TerritoryKit/pull/103)

**CI on `main` (2026-10-13):** CI and Release workflows **success** at merge of #108.

## Four-sprint implementation roadmap

| Sprint | Focus                               | Status                                                    |
| ------ | ----------------------------------- | --------------------------------------------------------- |
| 1      | Source and governance closeout      | **done** (#107)                                           |
| 2      | Istanbul ADM3 geometry quality      | **done** (#108)                                           |
| 3      | National RC and delivery validation | **in review** (`feat/tr-national-rc-delivery-validation`) |
| 4      | Rush&Claim integration              | planned                                                   |

Sprint 3 evidence: `reports/tr-adm3/sprint-3-national-rc/`

## National dataset candidate (context only)

`territory-kit-tr-v2-playable@2.1.0-rc.7` — scope `LOCAL_RELEASE_CANDIDATE_NOT_PRODUCTION`. Sprint 3 re-verified local bytes when `.territory/sprint-6/final/candidate` is present. Metrics in `reports/tr-adm3/sprint-3-national-rc/` and historical baseline `reports/baselines/sprint-6-national-rc7.json`. Renderable area coverage is not official administrative accuracy.

## Engineering entry points

- Sprint 3 reports: `pnpm data:tr:sprint3:national-rc`
- National validate: `pnpm turkey:v2:national:validate`, `pnpm turkey:v2:national:validate:publish-ready`
- Consumer resolver: `@territory-kit/runtime/turkey-v2-delivery`
- ADM3 registry: `datasets/sources/TR/adm3/source-registry.json` (81 provinces)
