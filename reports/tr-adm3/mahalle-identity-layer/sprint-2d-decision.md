# Sprint 2D — Istanbul settlement identity pilots

## Program decisions

| Gate                      | Decision           |
| ------------------------- | ------------------ |
| Technical pilot           | **GO_WITH_REVIEW** |
| Official mahalle accuracy | **NO_GO**          |
| Production release        | **NO_GO**          |

Stress phase (Adalar, Eyüpsultan, Kadıköy): **true**

Fatih regression (Sprint 2C pins): **PASS**

## District matrix

| District   | Technical      | Zones | Settlements | Ambiguous | Unseeded |
| ---------- | -------------- | ----: | ----------: | --------: | -------: |
| Fatih      | GO_WITH_REVIEW |    30 |          71 |        15 |        5 |
| Adalar     | GO_WITH_REVIEW |    14 |          11 |         2 |        8 |
| Eyüpsultan | GO_WITH_REVIEW |    19 |          82 |         6 |       11 |
| Kadıköy    | GO_WITH_REVIEW |    28 |          35 |         8 |        9 |
| Üsküdar    | GO_WITH_REVIEW |    40 |          40 |        10 |       15 |
| Çatalca    | GO_WITH_REVIEW |    19 |         248 |        12 |        6 |
| Başakşehir | GO_WITH_REVIEW |    20 |          33 |         5 |       11 |
| Esenyurt   | GO_WITH_REVIEW |    36 |          47 |        15 |       19 |

## Cross-district QA

- Duplicate canonical settlement IDs: **0**
- Same normalized name across districts (informational): **15**

Artifacts: `istanbul-pilot-matrix.json`, per-district `*-consumer-pin.json`, `istanbul-cross-district-qa.json`.
