# Dataset Coverage

Generated: 2026-07-15T12:49:17.900Z

This registry reports real source and artifact lifecycle state for the global ADM1 and ADM2 build. It does not substitute municipality, city, or neighbourhood data for ADM1/ADM2, and out-of-scope levels are not mixed into ADM1/ADM2 source-missing counts.

Source providers:

- Natural Earth is used for the global ADM0 overview fallback.
- geoBoundaries is used for country ADM1/ADM2 source resolution and source-level metadata.

## Global ADM1/ADM2 Metrics

| Metric                    |  ADM1 |   ADM2 |
| ------------------------- | ----: | -----: |
| total ISO entries         |   249 |    249 |
| source available          |   197 |    179 |
| source unavailable        |    52 |     70 |
| artifact built            |   197 |    179 |
| validation passed         |     0 |      0 |
| validation passed warning |   197 |    179 |
| hierarchy passed          |   197 |    179 |
| adjacency passed          |   193 |    175 |
| adjacency not run         |    56 |     74 |
| index passed              |   197 |    179 |
| loader passed             |   197 |    179 |
| semantic review required  |   244 |    244 |
| semantic reviewed         |     5 |      5 |
| total built feature count | 3,229 | 49,233 |

## Country Rollups

| Metric                                                                  | Count |
| ----------------------------------------------------------------------- | ----: |
| countries attempted for ADM1/ADM2                                       |   249 |
| countries with both ADM1 and ADM2 built                                 |   176 |
| countries with ADM1 only built                                          |    21 |
| countries with ADM2 only built                                          |     3 |
| countries with no ADM1 or ADM2 source                                   |    49 |
| countries with large-country adjacency intentionally not run            |     4 |
| countries with mapping review required                                  |   244 |
| countries whose artifact loader passed for at least one ADM1/ADM2 level |   200 |
| countries whose artifact loader failed                                  |     0 |

## Build-All Outcomes

| Outcome              | Countries |
| -------------------- | --------: |
| built                |         0 |
| built with warnings  |       176 |
| partial              |        24 |
| source unavailable   |        49 |
| performance deferred |         0 |
| hierarchy failed     |         0 |
| stable ID failed     |         0 |
| validation failed    |         0 |
| adjacency failed     |         0 |
| licence restricted   |         0 |
| provider error       |         0 |

## Repair And Rejection Counts

| Metric                               |  Count |
| ------------------------------------ | -----: |
| geometry repaired features           |      8 |
| geometry rejected features           |      0 |
| discarded non-area repair components |      0 |
| geometry quality warnings            | 38,655 |
| geometry quality errors              |      0 |

## Remediation Summary

| Batch                 | Countries attempted | Built with warnings | Partial | Source unavailable | Performance deferred | Hierarchy failed | Stable ID failed | Validation failed |
| --------------------- | ------------------: | ------------------: | ------: | -----------------: | -------------------: | ---------------: | ---------------: | ----------------: |
| stable ID remediation |                  15 |                  14 |       1 |                  0 |                    0 |                0 |                0 |                 0 |
| hierarchy remediation |                   7 |                   4 |       3 |                  0 |                    0 |                0 |                0 |                 0 |
| performance coverage  |                   4 |                   4 |       0 |                  0 |                    0 |                0 |                0 |                 0 |
| partial-source audit  |                  20 |                   0 |      20 |                  0 |                    0 |                0 |                0 |                 0 |
| full global report    |                 249 |                 176 |      24 |                 49 |                    0 |                0 |                0 |                 0 |

## Remaining Deferred Or Review Countries

Performance-deferred countries: none.

Hierarchy-failed countries: none.

Stable-ID-failed countries: none.

Countries with ADM1 built and ADM2 source-unavailable: AD, AE, AG, BB, BH, DM, GD, GL, KN, LI, LY, MD, ME, MH, MT, MU, NR, NU, SM, TT, VC.

Countries with ADM2 built and ADM1 source-unavailable: GU, MP, PR.

Countries with no ADM1 or ADM2 source: AI, AQ, AS, AW, AX, BL, BM, BQ, BV, CC, CK, CW, CX, EH, FK, FO, GF, GG, GI, GP, GS, HK, HM, IM, IO, JE, KY, MF, MO, MQ, MS, NC, NF, PF, PM, PN, RE, SH, SJ, SX, TC, TF, TK, UM, VA, VG, VI, WF, YT.

Pilot countries with reviewed ADM1/ADM2 mappings: DE, ID, JP, TR, US.

Machine-readable artifacts:

- `datasets/registry/coverage.json`
- `reports/global-adm1-adm2.json`
- `reports/remediation/stable-id/phase-a-build.json`
- `reports/remediation/hierarchy/phase-b-build.json`
- `reports/remediation/performance/phase-c-build.json`
- `reports/remediation/partial/phase-d-build.json`
