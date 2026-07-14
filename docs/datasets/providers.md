# Dataset Providers

TerritoryKit uses provider adapters instead of committing large raw GeoJSON archives. Providers are
responsible for source metadata, download/cache behavior, transformation into TerritoryKit schema,
and license/attribution records.

Implemented provider adapters:

| Provider        | Levels    | License Metadata           | Notes                                          |
| --------------- | --------- | -------------------------- | ---------------------------------------------- |
| `natural-earth` | ADM0      | Public Domain              | Used for the world-countries ADM0 pipeline.    |
| `geoboundaries` | ADM0-ADM4 | CC BY 4.0 release metadata | Used by pilot country source locks and builds. |
| `geojson`       | ADM0-ADM4 | User supplied              | Generic local/manual import path.              |

Provider registry metadata is generated into `datasets/registry/providers.json`.

## Publish Rules

- Do not package a source unless its redistribution terms are known.
- If license metadata is missing, builds may run locally, but publish/release should be disabled.
- OSM-derived boundaries need a dedicated ODbL-aware pipeline and are not mixed into default global
  artifacts.
- Official government sources must record source URL, source date, license, attribution, checksum,
  and any commercial or redistribution restrictions.
