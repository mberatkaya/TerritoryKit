# Current milestone

## Türkiye ADM0–ADM2 source provenance and parent geometry lineage

**Status:** Planning / preparation (this foundation sprint documents scope only — **no provenance migration implementation** in the engineering-foundation PR).

**Observation time:** 2026-10-08

### Problem statement

National Turkey builds attribute parent ADM0–ADM2 geometry in multiple places. Audit evidence (#100) states:

> Canonical ADM0–ADM2 records carry `geoboundaries` provenance and the CLI loads the tracked dataset, while national source-lock attribution describes HDX COD-AB. This is a confirmed provenance/selection mismatch in metadata and code, not evidence that the parent geometries themselves are wrong.

Until input-byte lineage is resolved, replays cannot honestly claim a clean HDX-derived parent build.

### Existing evidence

| Artifact                      | Path                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| Audit summary                 | `reports/tr-adm3/audit/current-state.md`                                                               |
| Claim ledger                  | `reports/tr-adm3/audit/baseline-claims.json`                                                           |
| HDX national catalog          | `datasets/sources/TR/national.json`                                                                    |
| Global registry (TR defaults) | `datasets/registry/countries.json` (`iso2: TR`, `defaultProvider: geoboundaries`, ADM1+ provider rows) |
| Country generator config      | `packages/generators/src/countries/configs/tr.ts`                                                      |
| ADR                           | `adr/ADR-006-turkey-national-administrative-sources.md`                                                |
| Replay comparison             | `reports/tr-adm3/audit/replay-canonical-comparison.json`                                               |

### Code paths to inspect

1. Parent load path for `tr v2 national build` — `packages/generators/src/turkey-v2-national.ts` (parent dataset assembly, source locks).
2. Tracked Turkey dataset package — `packages/data-tr/` and `datasets/generated/countries/TR/`.
3. CLI default canonical input — `packages/cli` Turkey v2/national commands.
4. Source adapter selection — `packages/generators/src/sources/capabilities.ts`, HDX adapter vs `geoboundaries.ts`.
5. Import/country commands that write provenance fields on territories.

### Missing / uncertain snapshots

- Committed byte-level ADM0–ADM2 fixtures under Git vs only `.territory/cache/` locks (environment-dependent).
- `artifactProducerCommit: null` for rc.7 candidate in audit ledger — producer commit unknown for ignored build tree.

### Verification commands (next PR)

```sh
git fetch origin main
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @territory-kit/generators build
pnpm --filter @territory-kit/cli build
# Inspect provenance fields on parent levels in tracked dataset vs national.json checksums
pnpm data:tr:adm3:audit:test
# Optional heavy: pnpm data:tr:adm3:audit  (requires local .territory candidate)
```

Compare geometry hashes of registry-imported geoBoundaries parents vs HDX `tur_admin{0,1,2}.geojson` members from `national.json` SHA manifests.

### License dependencies

- geoBoundaries: CC BY 4.0 (`docs/dataset-licensing.md`)
- HDX COD-AB Turkey: CC BY-IGO (`datasets/sources/TR/national.json`)

Redistribution and attribution must match the **actual** bytes used after resolution.

### Risks

- Changing parent polygons may shift ADM3 clipping, stable IDs, and MVT bounds.
- Aligning metadata without changing geometry still requires migration documentation.
- Wrong source choice misstates legal/administrative accuracy.

### Proposed regression fixtures

- Immutable small fixtures: one ADM1 polygon from each candidate source with expected SHA-256 and CRS.
- Test asserting national build parent `sourceProvider` / lock metadata matches ingested file checksums.
- Extend `scripts/tr-adm3-quality-source-audit.test.mjs` or add focused unit test in generators.

### Acceptance criteria (milestone complete)

1. Documented, byte-verified answer: which upstream files produced canonical TR ADM0–ADM2 in the national candidate and tracked package.
2. Registry, dataset provenance fields, and source-lock JSON are mutually consistent or explicitly document intentional dual sourcing.
3. No silent swap of HDX ↔ geoBoundaries; audit evidence updated with new timestamps, not rewritten history.
4. Regression tests fail on provenance drift.
5. `pnpm data:tr:adm3:audit:test` and relevant generator tests pass in CI.

### Next PR boundaries

- **In scope:** provenance investigation, fixtures, metadata alignment, tests, audit report updates.
- **Out of scope:** expanding official ADM3 coverage, Istanbul geometry fixes, consumer app changes, npm release.
