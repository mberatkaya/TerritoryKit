# Türkiye ADM0–ADM2 parent provenance resolution

**Inspection commit:** `553b4e411cf80a8979af275c4f802333d8759f3e`  
**Classification:** `CONFIRMED_ROOT_CAUSE`  
**Lineage status:** `CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS`  
**HDX geometry status:** `GEOMETRY_DIVERGENT_FROM_PARENT_DATASET`

## Root cause

National v2 builds load parent polygons from `datasets/generated/countries/TR/dataset.json`, which records `geoboundaries` on ADM0–ADM2 zones, while `datasets/sources/TR/national.json` and the emitted national `source-lock.json` describe HDX COD-AB checksums. The CLI copies catalog metadata into the lock without verifying that the parent dataset bytes were imported from those HDX members.

Verified local HDX member caches match `national.json` SHA-256 values, but parent dataset geometry hashes do not match those members (ADM0: 0/0 exact name matches; ADM1: 0/67 exact name matches; ADM2: 0/731 exact name matches).

## Safe actions taken in this sprint

- Added explicit parent provenance inspection and national build/plan failure on provider mismatch.
- Recorded `parentInputDataset` evidence on new source locks when builds are allowed.
- Did **not** relabel geoBoundaries polygons as HDX or migrate canonical geometry.

## Follow-up migration (separate authorization)

Re-import ADM0–ADM2 from locked HDX members **or** realign catalog/source-lock to geoBoundaries with license attribution, then replay ADM3 clipping impact.
