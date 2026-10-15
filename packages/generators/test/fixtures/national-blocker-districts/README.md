# National blocker district hybrid regression fixtures

Committed OSM barrier artifacts (~29 MiB, ODbL 1.0) and a sliced ADM2 parent dataset (~14 KiB) for the three rc.7 districts that failed national `SIBLING_GEOMETRY_OVERLAP` QA (Ağrı merkez, İskenderun, Erbaa).

Used by `turkey-national-blocker-districts-hybrid.test.ts` when local `.territory/sprint-6/calibration/barriers` and `datasets/generated/countries/TR/dataset.json` are absent (typical CI). Override with `TERRITORY_TR_BLOCKER_BARRIER_ROOT` / `TERRITORY_TR_BLOCKER_DATASET_PATH` for full local calibration inputs.

Passing this test exercises hybrid build behavior on these fixtures only; it is not a claim that the full national rc.8 candidate build passed QA.

Regenerate from a machine with full calibration inputs:

```sh
# barriers: copy ADM2/tr_adm2_<hash> for the three districts from calibration barriers
# adm2-dataset.json: slice zones from datasets/generated/countries/TR/dataset.json
```
