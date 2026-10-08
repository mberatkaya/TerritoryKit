# Project state snapshot

**Observation time (UTC):** 2026-10-08 (TR geoBoundaries Path B lineage sprint)  
**Verified `origin/main` base:** `5dfcd99` — _fix(tr): verify and reconcile national parent source provenance (#104)_  
**Sprint branch:** `research/tr-geoboundaries-parent-lineage` (in progress; not merged)

> Re-run `git fetch origin main && git log -1 origin/main` before production decisions.

## Recent merged work (GitHub-verified)

| PR   | Title                                                              | Merged (UTC) |
| ---- | ------------------------------------------------------------------ | ------------ |
| #104 | fix(tr): verify and reconcile national parent source provenance    | 2026-10-08   |
| #102 | chore(cursor): establish persistent engineering rules and handoff  | 2026-10-08   |
| #100 | Audit Türkiye ADM3 coverage, source fidelity and Istanbul geometry | 2026-10-08   |

## Türkiye ADM0–ADM2 parent lineage (Path B geoBoundaries sprint)

| Evidence                                            | Finding                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `datasets/generated/countries/TR/dataset.json`      | **Gitignored** (`datasets/generated/`). Present locally as v0.1.0 build `2026-07-15T11:34:06.314Z`; not on GitHub `main` tree API.        |
| `datasets/generated/countries/TR/sources.lock.json` | Pinlenmiş **gbOpen** geoBoundaries release `9469f095…`, simplified ADM0–ADM2 GeoJSON SHA-256; yerel önbellekte **LOCKED_BYTES_VERIFIED**. |
| `reports/tr-adm3/provenance/geoboundaries/`         | shapeID kimlik eşleşmesi ADM0=1, ADM1=81, ADM2=973; onarım sonrası geometri hash ADM0=1/1, ADM1=57/81, ADM2=953/973.                      |
| Path B sınıflandırma                                | `PATH_B_PARTIALLY_VERIFIED` — bayt hattı ve kimlik tam; tam geometri yeniden üretimi kanıtlanmadı.                                        |
| HDX (`national.json`)                               | PR #104 ile doğrulanmış; canonical ebeveyn poligonlarıyla serileştirilmiş hash uyuşmazlığı devam ediyor.                                  |

**Classification:** `PATH_B_PARTIALLY_VERIFIED` — metadata realignment teknik olarak mümkün olabilir, ancak `PATH_B_VERIFIED_CANDIDATE` için tam geometri replay kanıtı eksik.

**Not changed in sprint:** canonical geometry bytes, stable territory IDs, ADM3 polygons, `national.json` HDX checksums.

## Engineering maturity

- HDX parent provenance: `packages/generators/src/turkey-parent-provenance.ts` (PR #104)
- geoBoundaries Path B inspection: `packages/generators/src/turkey-geoboundaries-parent-lineage.ts`
- Audits: `pnpm data:tr:parent-provenance:audit`, `pnpm data:tr:geoboundaries:parent:audit`
- Regression: `pnpm data:tr:adm3:audit:test` (+ geoboundaries audit subprocess tests)

## Quality limitations (unchanged)

ADM3 nationwide official coverage, Istanbul geometry defects, and consumer artifact verification remain as documented in `reports/tr-adm3/audit/current-state.md`.
