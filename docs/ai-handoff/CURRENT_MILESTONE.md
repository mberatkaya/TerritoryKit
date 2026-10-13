# Current milestone

## Sprint 3 — Ulusal RC.7 teslimat bütünlüğü ve tüketici sözleşmesi

**Status:** Implementation on `feat/tr-national-rc-delivery-validation` (PR pending).  
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
| 9   | `pnpm data:tr:adm3:audit:test`, format, docs:links, verify | **Pending CI**                                                                 |
| 10  | Tek PR `main`                                              | **Pending**                                                                    |

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

### Next milestone

**Sprint 4 — Rush&Claim integration** — see `reports/tr-adm3/sprint-3-national-rc/rushclaim-sprint-4-handoff.md`
