# Current milestone

## Türkiye ADM0–ADM2 geoBoundaries full country-builder replay

**Status:** Research PR in progress on `research/tr-geoboundaries-full-builder-replay`. **Path B catalog migration not authorized.**

**Observation time:** 2026-10-09

### Verified conclusions

1. Pinned gbOpen simplified bytes verify against `sources.lock.json` (local cache).
2. Full `buildTerritoryCountryDataset` replay (historical pilot geoBoundaries field map) reproduces **deterministic** output; replay `dataset.json` hash ≠ canonical artifact hash (expected — canonical is reference evidence, not overwritten).
3. Serialized geometry vs canonical: ADM0 **1/1**, ADM1 **57/81**, ADM2 **953/973** (same counts as repair-only audit #105).
4. All **44** mismatches: replay pipeline self-consistent; coğrafi IoU ≥ 0.9999 toleransı; kök neden sınıfı **`dependency-version`** (GEOS/Shapely repair engine vs July 2026 canonical bytes).
5. `legalReviewStatus` remains **PENDING_REVIEW**; replay does not authorize Path B metadata migration.

### Sprint deliverables

| Item         | Location                                                              |
| ------------ | --------------------------------------------------------------------- |
| Replay API   | `packages/generators/src/turkey-geoboundaries-full-builder-replay.ts` |
| CLI          | `pnpm data:tr:geoboundaries:parent:replay`                            |
| Evidence     | `reports/tr-adm3/provenance/geoboundaries/replay/`                    |
| Builder hook | optional `countryConfig` on `buildTerritoryCountryDataset`            |

### Acceptance criteria

| #   | Criterion                                       | Status                                 |
| --- | ----------------------------------------------- | -------------------------------------- |
| 1   | Trace real builder pipeline                     | **Done**                               |
| 2   | Preserve canonical baseline (read-only)         | **Done**                               |
| 3   | Account for all 44 mismatches individually      | **Done** (`geometry-differences.json`) |
| 4   | Geographic equivalence assessment               | **Done** (IoU / sym diff)              |
| 5   | Determinism validation                          | **Done**                               |
| 6   | No Path B migration / no canonical byte changes | **Done**                               |
| 7   | CI tests for replay harness                     | Pending PR CI                          |

### Verification commands

```sh
pnpm --filter @territory-kit/generators build
pnpm data:tr:geoboundaries:parent:replay -- --allow-incomplete-evidence
pnpm data:tr:adm3:audit:test
```
