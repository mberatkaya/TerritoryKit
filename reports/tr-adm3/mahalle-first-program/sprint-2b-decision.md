# Sprint 2B (superseded by 2B.3) — Fatih smart-derived-v2.0-pilot

## Decision

- **Status:** INCONCLUSIVE
- **Reason:** Pareto trade-off: seed-named coverage improved vs rc.8/v1.7 replay but barrier alignment has not reached v1.7 replay levels (weighted 0.7521 vs target 0.8907).
- **National expansion:** NO-GO
- **Selected variant:** hypothesis-a-weak-reassignment

## Hypothesis variants (deterministic)

- hypothesis-a-weak-reassignment: weighted=0.752064, seedCoverage=0.5352, zones=47
- hypothesis-b-max-area-1p12: weighted=0.656217, seedCoverage=0.5211, zones=47
- impl-rev3-combined: weighted=0.752064, seedCoverage=0.5352, zones=47

## Design note

- Hypothesis A (weak-barrier watershed relabeling) materially improved weighted barrier alignment vs impl-rev2 (+0.096) while preserving seed coverage.
- Hypothesis B (max-area ×1.12) did not change Fatih metrics vs rev2; default impl-rev3 keeps multiplier 1.0.
- Closing the remaining ~0.14 weighted gap to v1.7 replay likely requires a deeper v2 partition model (fewer zone boundaries / stronger-barrier-preserving merges), not further threshold tuning.

## Locks

- Parent ADM2: `tr:adm2:54988432b39641834885080`
- Baseline (read-only): `.territory/national-geometry-remediation/candidate-rc8-impl-rev1/districts/tr_adm2_54988432b39641834885080/dataset.json`
- Barriers: `.territory/sprint-6/calibration/barriers`
- OSM source lock: `.territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json`
- Algorithm: `smart-derived-v2.0-pilot` (`impl-rev3`)

## Metrics snapshot

| Metric                              | rc.8 baseline |       v1.7 replay |          v2 pilot |
| ----------------------------------- | ------------: | ----------------: | ----------------: |
| ADM3 zones                          |            30 |                30 |                47 |
| Seed-named share                    |        0.3333 |            0.3333 |            0.8085 |
| Mean zone barrier alignment         |  NOT_ASSESSED |            0.8954 |            0.7464 |
| Weighted internal barrier alignment |  NOT_ASSESSED |            0.8907 |            0.7521 |
| Longest unsupported chain (m)       |  NOT_ASSESSED |                 0 |                 0 |
| Deterministic hash                  |             — | 9845cbb6d3efc94e… | 0efdf8b446130caf… |

## Next gate (Eyüpsultan)

- Reuse the same OSM snapshot + implementation revision.
- Require barrier-graph partition stability and improved seed/barrier metrics without rc.8 regression.

## Tests

- Run `pnpm --filter @territory-kit/generators test turkey-smart-derived-v2-pilot` and full `pnpm verify` before merge.
