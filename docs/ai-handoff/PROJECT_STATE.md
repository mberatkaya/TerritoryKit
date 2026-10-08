# Project state snapshot

**Observation time (UTC):** 2026-10-08 (session establishing this handoff)  
**Verified `origin/main` commit:** `9a04a91` — _Audit Türkiye ADM3 coverage, source fidelity and Istanbul geometry (#100)_  
**Package versions on main:** `3.1.0` (workspace packages, e.g. `@territory-kit/core`)

> This file does not auto-sync with GitHub. Re-run `git fetch origin main && git log -1 origin/main` before relying on it.

## Recent merged work (GitHub-verified)

| PR   | Title                                                                  | Merged (UTC) |
| ---- | ---------------------------------------------------------------------- | ------------ |
| #100 | Audit Türkiye ADM3 coverage, source fidelity and Istanbul geometry     | 2026-10-08   |
| #94  | Make delivery and render manifests match verified geographic artifacts | 2026-10-08   |

**Intentionally closed without merge (not active work):** #95–#99 (Dependabot), #101 (Version Packages / release).

**Open PRs:** none at observation time.

## Engineering maturity

- TypeScript monorepo with enforced package boundaries, Turbo tasks, Vitest, Changesets release path.
- Turkey ADM3: national pipeline, audit evidence, regression test `pnpm data:tr:adm3:audit:test`; full audit script `pnpm data:tr:adm3:audit` (heavy, local artifacts).
- Delivery/render manifest alignment landed in #94; audit documentation and checks in #100.

## Quality limitations (evidence-scoped)

From `reports/tr-adm3/audit/current-state.md` (local **release candidate** `2.1.0-rc.7`, scope `LOCAL_RELEASE_CANDIDATE_NOT_PRODUCTION`):

- ADM3 counts (candidate): 20,392 zones — official 3,343, OSM admin 0, generated 17,049.
- Official polygons concentrated in 61 districts (Bursa, Gaziantep, Kayseri, Ordu).
- Effective official area share ~4.997% of national ADM3 area (spherical sum; not union coverage).
- Parent metadata mismatch: canonical ADM0–ADM2 records use `geoboundaries` provenance while national source-lock/catalog describes HDX COD-AB — **unresolved lineage** (see `CURRENT_MILESTONE.md`).
- Mobile/hosted consumer artifact selection: **NOT_OBSERVED** in audit.

## External prerequisites

- Full national rebuilds may require `.territory/` caches, OSM PBF locks, and HDX ZIP source locks (not all committed to Git).
- PostGIS live validation needs Docker/PostGIS or `TERRITORYKIT_POSTGIS_URL` for local `pnpm postgis:validate`.

## Production blockers (documented, not closed)

- ADM0–ADM2 parent byte lineage vs metadata attribution.
- Incomplete official ADM3 nationwide coverage; Kadıköy official bundle gaps (SHP-only records insufficient per audit).
- Istanbul geometry realism (e.g. Eyüpsultan `NO_ROUTE` / unsupported seam evidence in audit JSON).
- Consumer/deployed artifact verification outside this repository.
