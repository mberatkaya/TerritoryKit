# Sprint 2B — Fatih smart-derived-v2.0-pilot

## Decision

- **Status:** INCONCLUSIVE
- **Reason:** Pareto trade-off: seed-named coverage improved vs rc.8/v1.7 replay but barrier alignment has not reached v1.7 replay levels.

## Locks

- Parent ADM2: `tr:adm2:54988432b39641834885080`
- Baseline (read-only): `.territory/national-geometry-remediation/candidate-rc8-impl-rev1/districts/tr_adm2_54988432b39641834885080/dataset.json`
- Barriers: `.territory/sprint-6/calibration/barriers`
- OSM source lock: `.territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json`
- Algorithm: `smart-derived-v2.0-pilot` (`impl-rev2`)

## Metrics snapshot

| Metric | rc.8 baseline | v1.7 replay | v2 pilot |
| --- | ---: | ---: | ---: |
| ADM3 zones | 30 | 30 | 47 |
| Seed-named share | 0.3333 | 0.3333 | 0.7872 |
| Mean zone barrier alignment | NOT_ASSESSED | 0.8954 | 0.6671 |
| Weighted internal barrier alignment | NOT_ASSESSED | 0.8907 | 0.6562 |
| Longest unsupported chain (m) | NOT_ASSESSED | 0 | 0 |
| Deterministic hash | — | 9845cbb6d3efc94e… | c19d894caa7272ff… |

## Next gate (Eyüpsultan)

- Reuse the same OSM snapshot + implementation revision.
- Require barrier-graph partition stability and improved seed/barrier metrics without rc.8 regression.

## Tests

- Run `pnpm --filter @territory-kit/generators test turkey-smart-derived-v2-pilot` and full `pnpm verify` before merge.

