# Current milestone

## Türkiye ADM0–ADM2 geoBoundaries Path B lineage verification

**Status:** Path B investigation tooling and evidence landed on research branch. **Catalog migration not authorized.**

**Observation time:** 2026-10-08

### Verified conclusions

1. Canonical parent `datasets/generated/countries/TR/dataset.json` is **not Git-tracked**; reproducible only with local `datasets/generated/countries/TR/sources.lock.json` + geoBoundaries cache/build.
2. Historical country build lock pins **gbOpen** simplified members at git commit `9469f09592ced973a3448cf66b6100b741b64c0d` (see `sources.lock.json` and `reports/tr-adm3/provenance/geoboundaries/source-byte-verification.json`).
3. shapeID ↔ `territory.source.sourceId` coverage is **complete** for ADM0–ADM2 (1 / 81 / 973).
4. Geometry-repair + serialized hash replay matches **partially** (ADM0 100%, ADM1 57/81, ADM2 953/973) — geographic equivalence **not** assessed.
5. ADR-006 (HDX default catalog) remains **Accepted**; Path B metadata realignment requires separate approval (see `DECISIONS.md` DEC-008).

### Sprint branch deliverables

| Item                             | Location                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Path B inspection API            | `packages/generators/src/turkey-geoboundaries-parent-lineage.ts`                                                         |
| Reproducible geoBoundaries audit | `scripts/tr-geoboundaries-parent-audit.mjs`                                                                              |
| Evidence pack                    | `reports/tr-adm3/provenance/geoboundaries/`                                                                              |
| Regression tests                 | `packages/generators/test/turkey-geoboundaries-parent-lineage.test.ts`, `scripts/tr-geoboundaries-parent-audit.test.mjs` |

### Acceptance criteria

| #   | Criterion                                               | Status                                 |
| --- | ------------------------------------------------------- | -------------------------------------- |
| 1   | Identify historical geoBoundaries release + byte hashes | **Done** (local lock + cache)          |
| 2   | Canonical artifact storage status documented            | **Done** (gitignored local generation) |
| 3   | Deterministic comparison tooling                        | **Done**                               |
| 4   | Path B feasibility classification with limitations      | **Done** — `PATH_B_PARTIALLY_VERIFIED` |
| 5   | No production migration in this PR                      | **Done**                               |
| 6   | `pnpm data:tr:adm3:audit:test` passes                   | Pending CI on PR                       |

### Next authorized work (separate PR)

- **Path B migration (metadata only):** realign `national.json`, registry, national v2 default locks to pinned geoBoundaries gbOpen members; legal review on mixed OSM/ODbL attribution strings in geoBoundaries metadata; ADR-006 amendment.
- **Path A (geometry):** re-import from HDX locked members if policy chooses official COD-AB polygons over current bytes.
- **Geometry replay hardening:** reproduce remaining ADM1/ADM2 mismatches via full `buildTerritoryCountryDataset` pipeline diff (out of scope for this research PR).

### Verification commands

```sh
pnpm --filter @territory-kit/generators build
pnpm data:tr:geoboundaries:parent:audit -- --diagnostic
pnpm data:tr:adm3:audit:test
```
