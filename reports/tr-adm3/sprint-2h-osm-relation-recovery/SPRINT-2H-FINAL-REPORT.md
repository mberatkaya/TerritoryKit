# Sprint 2H — OSM relation recovery

**Generated:** 2026-10-17T18:20:13.545Z  
**HEAD:** b62251be16a1a8cb96e7f8095e644907b4986e94  
**Parser:** territorykit-tr-adm3-osm-parser@2026-10-17-sprint-2h-multipolygon-stitch

## Outcome

- Recovered OSM administrative research polygons (eight-district rollup): **228** (unique native OSM IDs: 228)
- Sprint 2G baseline constructed polygons: **4**
- Prior incorrect rollup (swapped clip suffixes): **145** — superseded by corrected district clips
- Fatih polygon-complete_ways built (2H parser): **48**
- Adalar polygon-complete_ways built (2H parser): **5**

## Root cause (summary)

Open-way multipolygon stitching (Sprint 2H parser) recovers most admin relations whose member ways are present in the derived clip; remaining Fatih gaps are explained at relation-ID granularity by polygon-clip missing outer ways versus country-PBF osmium getid recovery.

## Acceptance

- Technical merge: **GO_WITH_REVIEW**
- Geographical product: **NO_GO** (partial OSM research inventory; no official mahalle polygons; ODbL redistribution pending)
