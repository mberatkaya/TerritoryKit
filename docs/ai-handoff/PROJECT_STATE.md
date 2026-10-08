# Project state snapshot

**Observation time (UTC):** 2026-10-08 (TR ADM0–ADM2 parent provenance sprint)  
**Verified `origin/main` base:** `553b4e4` — _chore(cursor): establish persistent engineering rules and handoff (#102)_  
**Sprint branch:** `fix/tr-parent-provenance-lineage` (in progress; not merged)

> Re-run `git fetch origin main && git log -1 origin/main` before production decisions.

## Recent merged work (GitHub-verified)

| PR   | Title                                                                  | Merged (UTC) |
| ---- | ---------------------------------------------------------------------- | ------------ |
| #102 | chore(cursor): establish persistent engineering rules and handoff      | 2026-10-08   |
| #100 | Audit Türkiye ADM3 coverage, source fidelity and Istanbul geometry     | 2026-10-08   |
| #94  | Make delivery and render manifests match verified geographic artifacts | 2026-10-08   |

## Türkiye ADM0–ADM2 parent lineage (byte-verified on sprint branch)

| Evidence                                                                    | Finding                                                                                                              |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `datasets/generated/countries/TR/dataset.json` (v0.1.0)                     | ADM0–ADM2 zones declare `geoboundaries` on `properties.territory.source.provider`                                    |
| `datasets/sources/TR/national.json` + rc.7 `source-lock.json`               | Catalog/lock provider `hdx-cod-ab` with pinned ZIP member SHA-256                                                    |
| Local HDX member cache (`.territory/cache/sources/hdx-cod-ab/…`)            | Members `tur_admin{0,1,2}.geojson` **LOCKED_BYTES_VERIFIED** against `national.json`                                 |
| Geometry comparison (`reports/tr-adm3/provenance/geometry-comparison.json`) | **0** exact hash matches on name-paired features; ADM1 67/67 mismatches among 67 pairs; ADM2 731/731 among 731 pairs |
| National v2 CLI default path                                                | Loads geoBoundaries parent dataset, writes HDX catalog into `source-lock` without polygon-byte verification          |

**Classification:** `CONFIRMED_ROOT_CAUSE` — metadata/source-lock describes HDX; canonical parent polygons are geoBoundaries-derived bytes, not locked HDX members.

**Not changed in sprint:** canonical geometry bytes, stable territory IDs, ADM3 polygons, or `national.json` checksums.

## Engineering maturity

- Parent provenance inspection module: `packages/generators/src/turkey-parent-provenance.ts`
- National `tr v2 national plan|build` fails closed on provider mismatch (escape hatch: `--allow-parent-provenance-mismatch`)
- Audit evidence: `reports/tr-adm3/provenance/`
- Regression: `pnpm data:tr:adm3:audit:test` includes `scripts/tr-parent-provenance-audit.test.mjs`

## Quality limitations (unchanged)

ADM3 nationwide official coverage, Istanbul geometry defects, and consumer artifact verification remain as documented in `reports/tr-adm3/audit/current-state.md`.
