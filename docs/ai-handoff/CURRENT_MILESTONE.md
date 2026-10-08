# Current milestone

## Türkiye ADM0–ADM2 source provenance and parent geometry lineage

**Status:** Root cause confirmed; safe guardrails landed on sprint branch. **Canonical parent geometry migration not authorized.**

**Observation time:** 2026-10-08

### Verified conclusions

1. Locked HDX COD-AB GeoJSON members in `datasets/sources/TR/national.json` match locally cached `tur_admin{0,1,2}.geojson` byte hashes (archive ZIP not present locally).
2. Git-tracked parent dataset `datasets/generated/countries/TR/dataset.json` and rc.7 candidate parents carry **geoBoundaries** provenance on zones, not HDX.
3. National v2 assembly (`packages/cli/src/turkey-v2-national.ts`) defaults to the geoBoundaries parent file while `createSourceLockForCli` copies HDX catalog metadata — source-lock did not represent ingested parent bytes.
4. Name-normalized geometry hash comparison shows **no** ADM1/ADM2 exact matches between HDX members and canonical parents (see `reports/tr-adm3/provenance/`).

### Sprint branch deliverables

| Item                                     | Location                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Inspection + verification API            | `packages/generators/src/turkey-parent-provenance.ts`                                                      |
| Build/plan fail-closed gate              | `packages/cli/src/turkey-v2-national.ts`                                                                   |
| `parentInputDataset` on new source locks | `packages/generators/src/turkey-v2-national.ts`                                                            |
| Reproducible audit reports               | `reports/tr-adm3/provenance/`                                                                              |
| Regression tests                         | `packages/generators/test/turkey-parent-provenance.test.ts`, `scripts/tr-parent-provenance-audit.test.mjs` |

### Acceptance criteria (milestone — remaining)

| #   | Criterion                                                              | Status                                                                    |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | Byte-verified answer which upstream files produced canonical ADM0–ADM2 | **Done** — geoBoundaries tracked dataset; HDX members verified separately |
| 2   | Registry, dataset provenance, source-lock mutually consistent          | **Not done** — intentional mismatch documented; migration PR required     |
| 3   | No silent HDX ↔ geoBoundaries swap                                     | **Done** — no geometry relabel                                            |
| 4   | Regression tests fail on provenance drift                              | **Done** on branch                                                        |
| 5   | `pnpm data:tr:adm3:audit:test` passes in CI                            | **Pending** merge/CI                                                      |

### Next authorized work (separate PR)

Choose one path with explicit approval:

- **Path A:** Re-import ADM0–ADM2 from locked HDX members into `datasets/generated/countries/TR/`, replay ADM3 clipping / stable ID impact.
- **Path B:** Realign `national.json`, source-lock schema defaults, and registry TR rows to geoBoundaries with correct CC BY 4.0 attribution (no polygon change).

### Verification commands

```sh
pnpm --filter @territory-kit/generators build
pnpm --filter @territory-kit/cli build
pnpm data:tr:adm3:audit:test
pnpm data:tr:parent-provenance:audit   # optional; refreshes reports/tr-adm3/provenance/
```
