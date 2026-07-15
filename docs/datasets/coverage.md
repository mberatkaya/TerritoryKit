# Dataset Coverage

Generated: 2026-07-15T11:50:12.286Z

This registry reports real source/artifact lifecycle state for the global ADM1 and ADM2 build. It does not substitute municipality, city, or neighbourhood data for ADM1/ADM2, and those out-of-scope levels are not mixed into ADM1/ADM2 source-missing counts.

Source providers:

- Natural Earth is used for the global ADM0 overview fallback.
- geoBoundaries is used for country ADM1/ADM2 source resolution and source-level metadata.

## Global ADM1/ADM2 Metrics

| Metric                      |  ADM1 |   ADM2 |
| --------------------------- | ----: | -----: |
| total ISO entries           |   249 |    249 |
| source resolution attempted |   249 |    249 |
| source available            |   195 |    179 |
| source unavailable          |    54 |     70 |
| built                       |     0 |      0 |
| built with warnings         |   174 |    154 |
| partial                     |     0 |      0 |
| validation failed           |     0 |      0 |
| hierarchy failed            |     3 |      7 |
| adjacency failed            |     0 |      0 |
| performance deferred        |     4 |      4 |
| mapping review required     |   186 |    170 |
| not applicable              |     0 |      0 |
| licence restricted          |     0 |      0 |
| stable ID failed            |    14 |     14 |
| total built feature count   | 2,662 | 33,265 |

## Country Rollups

| Metric                                                                       | Count |
| ---------------------------------------------------------------------------- | ----: |
| countries attempted for ADM1/ADM2                                            |   249 |
| countries with both ADM1 and ADM2 built                                      |   154 |
| countries with ADM1 only built                                               |    20 |
| countries with no ADM1 or ADM2 source                                        |    49 |
| countries with partial adjacency or performance-deferred adjacency lifecycle |     4 |
| countries with mapping review required                                       |   191 |
| countries whose artifact loader passed for at least one ADM1/ADM2 level      |   196 |
| countries whose artifact loader failed                                       |     0 |

## Build-All Outcomes

| Outcome              | Countries |
| -------------------- | --------: |
| built                |         0 |
| built with warnings  |       154 |
| partial              |        20 |
| source unavailable   |        49 |
| performance deferred |         4 |
| hierarchy failed     |         7 |
| stable ID failed     |        15 |
| validation failed    |         0 |
| adjacency failed     |         0 |
| licence restricted   |         0 |
| provider error       |         0 |

## Repair And Rejection Counts

| Metric                               | Count |
| ------------------------------------ | ----: |
| geometry repaired features           |     8 |
| geometry rejected features           |     0 |
| discarded non-area repair components |     0 |
| geometry warnings                    |    20 |
| geometry errors                      |    10 |

## Controlled Batch Country Sets In Final Report

| Batch       | Countries attempted | Built with warnings | Partial | Source unavailable | Performance deferred | Hierarchy failed | Stable ID failed | Validation failed |
| ----------- | ------------------: | ------------------: | ------: | -----------------: | -------------------: | ---------------: | ---------------: | ----------------: |
| regression  |                   5 |                   5 |       0 |                  0 |                    0 |                0 |                0 |                 0 |
| batch 1     |                  15 |                  13 |       0 |                  0 |                    0 |                0 |                2 |                 0 |
| batch 2     |                   9 |                   4 |       0 |                  0 |                    4 |                0 |                1 |                 0 |
| batch 3     |                  37 |                  29 |       3 |                  0 |                    0 |                1 |                4 |                 0 |
| full global |                 249 |                 154 |      20 |                 49 |                    4 |                7 |               15 |                 0 |

## Remaining Deferred Or Review Countries

Performance-deferred countries: BR, CA, MX, RU.

Hierarchy-failed countries: BY, ET, GU, IQ, ML, MP, PR.

Stable-ID-failed countries: AZ, BZ, CF, CL, CN, EC, ES, GM, IR, KG, LV, MT, OM, PT, VN.

Countries with ADM1 built and ADM2 source-unavailable: AD, AE, AG, BB, BH, DM, GD, GL, KN, LI, LY, MD, ME, MH, MU, NR, NU, SM, TT, VC.

Countries with no ADM1 or ADM2 source: AI, AQ, AS, AW, AX, BL, BM, BQ, BV, CC, CK, CW, CX, EH, FK, FO, GF, GG, GI, GP, GS, HK, HM, IM, IO, JE, KY, MF, MO, MQ, MS, NC, NF, PF, PM, PN, RE, SH, SJ, SX, TC, TF, TK, UM, VA, VG, VI, WF, YT.

Pilot countries with reviewed ADM1/ADM2 mappings: DE, ID, JP, TR, US.

Machine-readable artifacts:

- `datasets/registry/coverage.json`
- `reports/global-adm1-adm2.json`
