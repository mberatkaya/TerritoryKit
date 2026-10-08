# Architectural decision register

Lightweight ADR companion. Full ADRs remain in `adr/` and `docs/adr/`. Status meanings:

- **Accepted** — supported by merged code/docs
- **Historical** — superseded or context-only
- **Proposed** — not yet implemented
- **Open** — conflict or missing evidence

## Decision template (copy for new entries)

```markdown
### DEC-XXX: Title

- **Status:** Accepted | Historical | Proposed | Open
- **Date:** YYYY-MM-DD
- **Context:** …
- **Decision:** …
- **Evidence:** paths, PRs, commits
- **Consequences:** …
```

---

### DEC-001: Source precedence for Turkey gameplay geometry

- **Status:** Accepted
- **Context:** Hybrid national builds combine municipal, OSM, and generated zones.
- **Decision:** Official licensed polygons → verified OSM administrative → generated gameplay zones (`turkey-v2-hybrid.ts`, ADR-009).
- **Evidence:** `adr/ADR-009-turkey-v2-hybrid-source-priority.md`, `packages/generators/src/turkey-v2-hybrid.ts`
- **Consequences:** Generated areas must carry appropriate metadata and confidence; never labeled as legal mahalle boundaries.

### DEC-002: Turkey national ADM0–ADM2 HDX COD-AB catalog

- **Status:** Accepted (catalog + generator config)
- **Decision:** National ADM0–ADM2 sourced from HDX/OCHA COD-AB with checksums in `datasets/sources/TR/national.json`; generator default documented in `packages/generators/src/countries/configs/tr.ts`.
- **Evidence:** `adr/ADR-006-turkey-national-administrative-sources.md`, `datasets/sources/TR/national.json`
- **Consequences:** Downloads use explicit locks; not implied by registry rows alone.

### DEC-003: Parent geometry provenance on canonical dataset vs source-lock

- **Status:** Open (root cause confirmed 2026-10-08; migration decision pending)
- **Context:** Audit #100 recorded ADM0–ADM2 canonical records with `geoboundaries` provenance while source-lock/national catalog describe HDX COD-AB.
- **Decision:** Canonical parent polygons in `datasets/generated/countries/TR/dataset.json` are geoBoundaries-sourced bytes. HDX COD-AB members in `national.json` are verified locally but **do not** match those parent geometries. National v2 builds copied HDX catalog into `source-lock` without ingesting those members for ADM0–ADM2.
- **Evidence:** `reports/tr-adm3/provenance/parent-lineage.json`, `geometry-comparison.json`, `source-verification.json`; `packages/cli/src/turkey-v2-national.ts` (`DEFAULT_ADM0_ADM2_DATASET` vs `DEFAULT_NATIONAL_SOURCE`)
- **Consequences:** Replay builds cannot claim HDX lineage until Path A/B migration in `CURRENT_MILESTONE.md`. CLI now fails closed on provider mismatch unless `--allow-parent-provenance-mismatch`.

### DEC-004: No H3 / hex grid as admin substitute

- **Status:** Accepted
- **Evidence:** `CONTRIBUTING.md` package boundaries section
- **Consequences:** Generators use polygon pipelines, not arbitrary grids.

### DEC-005: Original vs effective geometry

- **Status:** Accepted
- **Decision:** Preserve provenance and hashes for imported vs clipped/effective geometry in v2/Turkey pipelines.
- **Evidence:** `reports/tr-adm3/audit/official-source-fidelity.md`, dataset quality modules

### DEC-006: CI split Node 22 vs 24

- **Status:** Accepted
- **Decision:** Node 22 runs `release:check`; Node 24 runs full `verify` + visual tests; PostGIS in separate job.
- **Evidence:** `.github/workflows/ci.yml`

### DEC-007: Delivery/render manifest pinning

- **Status:** Accepted (merged #94)
- **Evidence:** PR #94, render/delivery modules in generators and maplibre packages

### Historical: Sprint 6 rc.7 national candidate metrics

- **Status:** Historical
- **Note:** Baseline counts in `reports/baselines/sprint-6-national-rc7.json` describe a local candidate artifact, not demonstrated production deployment.

## Open technical questions

1. Which byte source actually produced tracked/canonical TR ADM0–ADM2 parent geometries in the national candidate?
2. What is the authoritative path to full official Kadıköy neighbourhood polygons (CRS + complete bundle)?
3. Hosted registry version vs mobile offline cache — requires external consumer tests (Priority 6 in `NEXT_ACTIONS.md`).
