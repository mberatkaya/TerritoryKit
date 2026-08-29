# Turkey V2 Data Contract

Turkey V2 is the data contract for mixing real Turkey ADM3 polygons and TerritoryKit-generated game
zones. Sprint 4 adds a national playable dataset build that applies this contract across the
canonical 81-province / 973-district ADM0-ADM2 hierarchy.

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

`sourceClass` remains the legacy final-source family:

- `official`
- `osm`
- `generated`

Resolver priority is official ADM3, then OSM administrative ADM3, then eligible OSM barrier
snapshot input for smart-derived generated fallback, then legacy generated fallback.
`sourceClass` describes final zone semantics and remains `official`, `osm`, or `generated`;
`providerClass` can separately describe access policy such as `runtime` or `experimental`. The
hybrid coverage pipeline implements deterministic representative merge and clipping, while final
national playable artifacts are produced by the Turkey V2 national build.
See [Turkey V2 source class and provenance](./turkey-v2-source-provenance.md) for the dedicated
source reference.

Turkey ADM3 boundaries also carry canonical boundary governance fields. These fields prevent
official neighbourhood polygons, OSM administrative boundaries, smart-derived playable coverage, and
synthetic tests from being represented as the same thing.

| Field                 | Values                                                                                         | Meaning                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `boundaryKind`        | `administrative`, `estimated`                                                                  | Whether the polygon claims to be an administrative boundary or estimate. |
| `boundarySourceClass` | `official-national`, `official-local`, `osm-administrative`, `smart-derived`, `synthetic-test` | Auditable provenance class for the boundary geometry.                    |
| `confidence`          | `authoritative`, `high`, `medium`, `low`                                                       | Confidence in the boundary representation.                               |
| `licenseState`        | `approved`, `pending`, `restricted`, `unknown`                                                 | Publication gate state for the source license and redistribution terms.  |

Required invariants:

- `smart-derived` boundaries are always `boundaryKind: "estimated"` and `administrative: false`.
- `synthetic-test` boundaries are always `boundaryKind: "estimated"` and are rejected by the
  production Turkey V2 publish validation path.
- `authoritative` confidence requires `boundarySourceClass: "official-national"` or
  `"official-local"` and `licenseState: "approved"`.
- `osm-administrative` boundaries may be `boundaryKind: "administrative"`, but
  `administrative: false` until an approved official source replaces them.
- Missing official ADM3 coverage is represented in coverage reports, not by fake ADM3 zones.

## Metadata Fields

Schema-v1 stores additive metadata under `zone.properties.territory`. The strict profile accepts the
existing nested `source` object and the V2 top-level aliases below.

| Field                                 | Type    | Required in TR V2           | Source classes | Notes                                              |
| ------------------------------------- | ------- | --------------------------- | -------------- | -------------------------------------------------- |
| `sourceClass`                         | string  | yes                         | all            | `official`, `osm`, or `generated`                  |
| `boundaryKind`                        | string  | yes                         | ADM3           | `administrative` or `estimated`                    |
| `boundarySourceClass`                 | string  | yes                         | ADM3           | Canonical provenance class                         |
| `confidence`                          | string  | yes                         | ADM3           | `authoritative`, `high`, `medium`, or `low`        |
| `administrative`                      | boolean | yes                         | ADM3           | True only for approved official admin boundaries   |
| `providerId`                          | string  | yes                         | ADM3           | Stable provider identifier                         |
| `sourceProvider` or `source.provider` | string  | real sources                | official, osm  | Must identify publisher/provider                   |
| `sourceId`                            | string  | yes                         | ADM3           | Stable source or source-object identifier          |
| `sourceDatasetId`                     | string  | conditional                 | all            | Verifiable source reference when URL is not enough |
| `sourceNativeId`                      | string  | real sources when available | official, osm  | Preferred stable identity input                    |
| `sourceDate`                          | string  | real sources                | official, osm  | Source snapshot date                               |
| `sourceUrl`                           | string  | conditional                 | official, osm  | Or equivalent repository provenance reference      |
| `sourceVersion`                       | string  | when known                  | all            | Source release/version label                       |
| `sourceSnapshotChecksum`              | string  | yes                         | ADM3           | Checksum of source snapshot or deterministic input |
| `licenseState`                        | string  | yes                         | ADM3           | License gate result                                |
| `license`                             | string  | real sources                | official, osm  | Preserve source license                            |
| `attribution`                         | string  | real sources                | official, osm  | Preserve attribution                               |
| `geometryHash`                        | string  | yes                         | ADM3           | Hash of effective published geometry               |
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
- `INVALID_BOUNDARY_METADATA`
- `SOURCE_FLAG_CONFLICT`
- `MISSING_GENERATOR_VERSION`
- `INVALID_GENERATED_SEMANTIC_TYPE`
- `MISSING_SOURCE_PROVENANCE`
- `MISSING_BOUNDARY_PROVENANCE`
- `LICENSE_GATE_FAILED`
- `SYNTHETIC_SOURCE_NOT_PUBLISHABLE`
- `INVALID_PARENT_LEVEL`
- `ADM3_ORPHAN`
- `HIERARCHY_CODE_MISMATCH`
- `DUPLICATE_STABLE_ID`
- `INVALID_COVERAGE_STATUS`
- `INVALID_SEMANTIC_REVIEW_STATUS`

Legacy schema-v1 datasets remain readable by default. They are not silently converted to Turkey V2
metadata, and generated zones are never relabeled as official administrative areas.

## National Playable Dataset

The Sprint 4 national build uses HDX/OCHA COD-AB for ADM0-ADM2, then applies the hybrid ADM3
priority per district:

```text
official ADM3
  -> OSM administrative ADM3
  -> OSM barrier snapshot smart-derived fallback
  -> legacy generated fallback
```

The generated fallback is a playable territorial layer, not an official neighbourhood/village
claim. Large geometry artifacts are resolver/registry assets; `@territory-kit/data-tr` exposes the
descriptor and loader but does not embed the national geometry in the npm package.

Build locally:

```bash
pnpm turkey:v2:national:build
pnpm turkey:v2:national:validate
```

See [Turkey V2 national playable dataset](./turkey-v2-national-playable.md) for artifact layout,
reports, and loader usage.
