# Türkiye ADM0–ADM2 parent provenance resolution

**Inspection commit:** `2cdb37da353980151abe4f02502d427779c2cebf`  
**Classification:** `CONFIRMED_ROOT_CAUSE`  
**Provider metadata:** `CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS`  
**HDX member bytes:** `ALL_LOCKED_MEMBERS_VERIFIED`  
**Serialized geometry:** `COMPARED`

## Confirmed implementation mismatch

National v2 builds load parent polygons from `datasets/generated/countries/TR/dataset.json`, which records `geoboundaries` on ADM0–ADM2 zones, while `datasets/sources/TR/national.json` and emitted `source-lock.json` describe HDX COD-AB checksums. The CLI copies catalog metadata into the lock without verifying that parent polygons were imported from those HDX members.

geoBoundaries upstream archive bytes were **not** independently verified in this repository.

## HDX catalog member bytes (when cached)

Local HDX member caches were checked against `national.json` SHA-256 where available (`ALL_LOCKED_MEMBERS_VERIFIED`).

## Serialized geometry comparison (not geographic proof)

ADM0: 0/1 serialized-hash matches (identity method native-admin-id); ADM1: 0/81 serialized-hash matches (identity method native-admin-id); ADM2: 0/731 serialized-hash matches (identity method province-scoped-name)

Differing serialized hashes do **not** by themselves prove administrative boundary changes; geographic equivalence was **not** assessed.

## Safe actions in PR #104

- Parent provenance inspection and national `plan|build` fail-closed on confirmed provider mismatch.
- `parentInputDataset` records observed evidence; optional dev bypass is labeled and forbidden for publish-ready.
- No relabel of geoBoundaries polygons as HDX; no canonical geometry migration.

## Follow-up (separate authorization)

Path A: re-import ADM0–ADM2 from locked HDX members. Path B: realign catalog/registry to geoBoundaries with license attribution. Replay ADM3 clipping impact before promotion.
