# Current milestone

## Sprint 3.5 — Ulusal ADM2–ADM3 kalite kapanışı (Sprint 4 öncesi kapı)

**Status:** `feat/tr-national-adm2-adm3-quality-closeout` (PR pending).  
**Observation time:** 2026-10-14  
**Prerequisite:** Sprint 3 merged (#109).

## Sprint 3 — Ulusal RC.7 teslimat bütünlüğü ve tüketici sözleşmesi

**Status:** **done** (#109 merged on `main`).  
**Observation time:** 2026-10-13  
**Prerequisite:** Sprint 2 merged (#108).

### Sprint 3 acceptance criteria

| #   | Criterion                                                  | Status                                                                         |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | rc.7 artifact envanteri (gerçek baytlar veya BLOCKED)      | **Done** (`artifact-inventory.json`)                                           |
| 2   | ADM0–ADM3 ulusal kapsam doğrulaması                        | **Done** (`national-coverage-validation.json` + audit district index)          |
| 3   | 81 il kayıt vs candidate tüketimi ayrımı                   | **Done** (`province-source-consistency.json`)                                  |
| 4   | MVT + shard + delivery manifest                            | **Done** (örnekleme + checksum; `mvt-validation.json`, `shard-integrity.json`) |
| 5   | Consumer contract replay (yerel) + failure cases           | **Done** (`consumer-contract-results.json`, runtime tests)                     |
| 6   | Hosted vs local sınıflandırması                            | **Done** (`hosted-delivery-readiness.md` — LOCAL only)                         |
| 7   | İnsan onayı / üretim engelleri korundu                     | **Done** (`authorization-gates.json`)                                          |
| 8   | Sprint 4 Rush&Claim handoff                                | **Done** (`rushclaim-sprint-4-handoff.md`)                                     |
| 9   | `pnpm data:tr:adm3:audit:test`, format, docs:links, verify | **Done** (#109)                                                                |
| 10  | Tek PR `main`                                              | **Done** (#109)                                                                |

### Sprint 3.5 acceptance (national quality closeout)

| #   | Criterion                               | Status                                                  |
| --- | --------------------------------------- | ------------------------------------------------------- |
| 1   | 973 ilçe `district-quality-matrix.json` | **Done** (local rc.7)                                   |
| 2   | ADM2 doğrulama + ilçe geometri QA rerun | **Done** (3 ilçe `BLOCKED_BY_GEOMETRY`)                 |
| 3   | Kaynak / kimlik / baseline raporları    | **Done** (`reports/tr-adm3/national-quality-closeout/`) |
| 4   | Replacement-map (rc.7 değişmedi)        | **Done**                                                |
| 5   | Harita indeksi                          | **Done** (`map-index.html`)                             |
| 6   | Yeni rc.8 build (#108 geometri kodu)    | **Out of scope** — ayrı onaylı rebuild                  |

### Explicitly not in Sprint 3

- Path A / Path B migration
- npm/dataset/hosted tile publication
- Rush&Claim repo changes
- PR #103 merge

### Verification commands

```sh
pnpm data:tr:sprint3:national-rc
pnpm turkey:v2:national:validate
pnpm data:tr:adm3:audit:test
CI=true pnpm format:check
pnpm docs:links
pnpm verify
```

### Verification (Sprint 3.5)

```sh
pnpm data:tr:national-quality-closeout
```

### Next milestone

**Sprint 4 — Rush&Claim integration** — after Sprint 3.5 PR merge; see `reports/tr-adm3/sprint-3-national-rc/rushclaim-sprint-4-handoff.md`
