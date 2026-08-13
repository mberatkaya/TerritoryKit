# Turkey V2 Data Contract

Turkey V2 is the data contract for mixing real Turkey ADM3 polygons and TerritoryKit-generated game
zones. It does not build nationwide ADM3 polygons in this sprint.

Final product target: Turkey should become continuously playable for KapRota-style route matching.
Official and OSM polygons should be used where reviewed, and generated zones may fill gaps. Generated
zones are never official mahalle or köy records.

## Hierarchy

| Level | Turkey meaning                       | Allowed ADM3 semantics                       |
| ----- | ------------------------------------ | -------------------------------------------- |
| ADM0  | Türkiye                              | n/a                                          |
| ADM1  | İl                                   | n/a                                          |
| ADM2  | İlçe                                 | n/a                                          |
| ADM3  | Mahalle, köy, or generated game zone | `neighbourhood`, `village`, `generated-zone` |

Metropolitan municipality status does not change ADM levels. Municipality boundaries are not treated
as district or neighbourhood boundaries unless a reviewed source proves that relationship. ADM4 is
not part of the Turkey V2 production hierarchy in this contract.

## Source Classes

`sourceClass` is one of:

- `official`
- `osm`
- `generated`

Priority is `official > osm > generated`. This sprint defines the contract and strict validation;
real geometric merge, clipping, and national polygon generation remain future work.
See [Turkey V2 source class and provenance](./turkey-v2-source-provenance.md) for the dedicated
source reference.

## Metadata Fields

Schema-v1 stores additive metadata under `zone.properties.territory`. The strict profile accepts the
existing nested `source` object and the V2 top-level aliases below.

| Field                                 | Type    | Required in TR V2           | Source classes | Notes                                              |
| ------------------------------------- | ------- | --------------------------- | -------------- | -------------------------------------------------- |
| `sourceClass`                         | string  | yes                         | all            | `official`, `osm`, or `generated`                  |
| `sourceProvider` or `source.provider` | string  | real sources                | official, osm  | Must identify publisher/provider                   |
| `sourceDatasetId`                     | string  | conditional                 | all            | Verifiable source reference when URL is not enough |
| `sourceNativeId`                      | string  | real sources when available | official, osm  | Preferred stable identity input                    |
| `sourceDate`                          | string  | real sources                | official, osm  | Source snapshot date                               |
| `sourceUrl`                           | string  | conditional                 | official, osm  | Or equivalent repository provenance reference      |
| `license`                             | string  | real sources                | official, osm  | Preserve source license                            |
| `attribution`                         | string  | real sources                | official, osm  | Preserve attribution                               |
| `official`                            | boolean | yes                         | all            | Must match `sourceClass`                           |
| `generated`                           | boolean | yes                         | all            | Must match `sourceClass`                           |
| `algorithmVersion`                    | string  | generated                   | generated      | Generator contract version                         |
| `generationSeed`                      | string  | conditional                 | generated      | Or `generatedZone.seed`/deterministic local key    |
| `semanticType`                        | string  | yes                         | all            | Generated zones must use `generated-zone`          |
| `localTypeName`                       | string  | conditional                 | all            | Generated zones must not use `Mahalle` or `Köy`    |
| `countryCode`                         | string  | yes                         | all            | Must be `TR`                                       |
| `provinceCode`                        | string  | yes                         | ADM3           | Turkey plate code context                          |
| `districtCode`                        | string  | yes                         | ADM3           | District context                                   |
| `parentId`                            | string  | yes                         | ADM3           | Must point to an ADM2 zone                         |
| `coverageStatus`                      | string  | yes                         | all            | Existing TerritoryKit vocabulary                   |
| `semanticReviewStatus`                | string  | yes                         | all            | Existing TerritoryKit vocabulary                   |

Serialization is additive and backwards-compatible with `territory-schema@1`. Ordinary
`loadTerritoryDataset()` calls do not require these fields. The strict Turkey V2 profile enforces
them only when explicitly requested.

## Strict Validation

Use:

```bash
territory validate ./dataset.json --profile tr-v2
```

Programmatic validation is available from the opt-in subpath:

```ts
import { validateTurkeyV2Dataset } from "@territory-kit/dataset/turkey-v2";
```

The profile reports deterministic JSON and non-zero exit codes for invalid datasets. New typed issue
codes include:

- `INVALID_SOURCE_CLASS`
- `SOURCE_FLAG_CONFLICT`
- `MISSING_GENERATOR_VERSION`
- `INVALID_GENERATED_SEMANTIC_TYPE`
- `MISSING_SOURCE_PROVENANCE`
- `INVALID_PARENT_LEVEL`
- `ADM3_ORPHAN`
- `HIERARCHY_CODE_MISMATCH`
- `DUPLICATE_STABLE_ID`
- `INVALID_COVERAGE_STATUS`
- `INVALID_SEMANTIC_REVIEW_STATUS`

Legacy schema-v1 datasets remain readable by default. They are not silently converted to Turkey V2
metadata, and generated zones are never relabeled as official administrative areas.
