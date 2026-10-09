# Project state snapshot

**Observation time (UTC):** 2026-10-09 (TR geoBoundaries full builder replay sprint)  
**Verified `origin/main` base at sprint start:** `d5e2fe6` — _research(tr): verify geoBoundaries parent source lineage for Path B (#105)_  
**Sprint branch:** `research/tr-geoboundaries-full-builder-replay` (in progress; not merged)

> Re-run `git fetch origin main && git log -1 origin/main` before production decisions.

## Recent merged work (GitHub-verified)

| PR   | Title                                                               | Merged (UTC) |
| ---- | ------------------------------------------------------------------- | ------------ |
| #105 | research(tr): verify geoBoundaries parent source lineage for Path B | 2026-10-08   |
| #104 | fix(tr): verify and reconcile national parent source provenance     | 2026-10-08   |
| #102 | chore(cursor): establish persistent engineering rules and handoff   | 2026-10-08   |

## Türkiye ADM0–ADM2 geoBoundaries full builder replay

| Evidence                                       | Finding                                                                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `datasets/generated/countries/TR/dataset.json` | Gitignored; local SHA-256 `648981940b96ac18f8e729b31d551e2922f1d76a5f33cdd99b92982e90eaf992`                                |
| `sources.lock.json`                            | SHA-256 `38db7605d4fd4bd372a76be100c7a12be15ea88698117290b00373747ad36c35`; gbOpen pin `9469f095…`                          |
| `pnpm data:tr:geoboundaries:parent:replay`     | Tam `buildTerritoryCountryDataset` replay; tarihsel pilot `shapeID`/`shapeName` config                                      |
| Replay sınıflandırma                           | `GEOGRAPHICALLY_EQUIVALENT_WITH_DIFFERENCES` — 44 serileştirilmiş hash uyuşmazlığı; IoU toleransı içinde coğrafi eşdeğerlik |
| Determinizm                                    | İki identik replay koşusu `dataset.json` SHA-256 bayt-identical                                                             |
| Path B                                         | Teknik öneri `PARTIAL`; `legalReviewStatus: PENDING_REVIEW`; metadata migrasyonu **yetkisiz**                               |

**Not changed:** canonical geometry bytes, stable territory IDs, ADM3 polygons, `national.json`, Path B catalog migration.

## Engineering maturity

- Full builder replay: `packages/generators/src/turkey-geoboundaries-full-builder-replay.ts`
- Reports: `reports/tr-adm3/provenance/geoboundaries/replay/`
- Audits: `pnpm data:tr:geoboundaries:parent:audit`, `pnpm data:tr:geoboundaries:parent:replay`
