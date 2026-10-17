# Sprint 2G — İstanbul mahalle geometry validation

**Generated:** 2026-10-17T18:00:00.000Z  
**Main baseline:** `ba03eedeea27c28dd0562d5744f070e94f6d3247`  
**Branch HEAD:** `2f51de2c00a290afb99584b336154254393605b8`

## A. Repository

| Field                           | Value                                          |
| ------------------------------- | ---------------------------------------------- |
| Branch                          | `feat/tr-istanbul-mahalle-geometry-validation` |
| Geographical product acceptance | **NO_GO**                                      |

## B. Source discovery

- Verified official mahalle polygons: **0**
- OSM administrative polygon features (pilot parents): **4**
- Kadıköy official acquisition: **BLOCKED_BY_SOURCE**

## C. Fatih geometry QA

- Gameplay remains **rc.8 pinned smart-derived v1.7** (immutable).
- Smart-derived v2 / hybrid: **NO_GO** (historical Sprint 2B.4).
- OSM administrative layer: research candidate only (`GO_WITH_REVIEW` technical QA when polygons present).

## D. Istanbul pilots (8 districts)

| District   | Classification         | OSM admin polys | Gameplay zones |
| ---------- | ---------------------- | --------------: | -------------: |
| Kadıköy    | BLOCKED_BY_SOURCE      |               0 |             28 |
| Fatih      | VERIFIED_OSM_CANDIDATE |               1 |             30 |
| Üsküdar    | BASELINE_PRESERVED     |               0 |             40 |
| Adalar     | VERIFIED_OSM_CANDIDATE |               3 |             14 |
| Eyüpsultan | BASELINE_PRESERVED     |               0 |             19 |
| Çatalca    | BASELINE_PRESERVED     |               0 |             19 |
| Başakşehir | BASELINE_PRESERVED     |               0 |             20 |
| Esenyurt   | BASELINE_PRESERVED     |               0 |             36 |

## E. Acceptance gates

| Gate                           | Result            |
| ------------------------------ | ----------------- |
| A Source discovery             | GO_WITH_REVIEW    |
| B Technical polygon QA         | NO_GO             |
| C Geographical quality         | NO_GO             |
| D Legal eligibility            | BLOCKED_BY_SOURCE |
| E Gameplay migration readiness | GO_WITH_REVIEW    |
| F Production readiness         | NO_GO             |

## F. Next action

Human license review for ODbL redistribution + independent OSM-vs-official accuracy sampling before any gameplay replacement-map promotion.

## Evidence

- OSM extract cache: `.territory/sprint-2g/osm-administrative-extract-istanbul-pilots.json`
- Map previews: `reports/tr-adm3/sprint-2g-geometry-validation/map-preview/`
