# Turkey Administrative Model

TerritoryKit levels are technical hierarchy levels, not direct translations of Turkish local names.

| TerritoryKit level | Turkey model                                                              | semanticType                                    | localTypeName                     | Source status                       |
| ------------------ | ------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------- | ----------------------------------- |
| ADM0               | Türkiye                                                                   | `country`                                       | Ülke                              | HDX COD-AB verified                 |
| ADM1               | İl                                                                        | `province`                                      | İl                                | HDX COD-AB verified, 81 features    |
| ADM2               | İlçe                                                                      | `district`                                      | İlçe                              | HDX COD-AB verified, 973 features   |
| ADM3               | Mahalle/Köy when a boundary source exists, or generated game zone in V2   | `neighbourhood`, `village`, or `generated-zone` | Mahalle/Köy or generated-zone     | partial/blocker                     |
| ADM4               | Municipality/locality sub-unit only if a reviewed source distinguishes it | `municipality` or `locality`                    | Yerleşim veya belediye alt birimi | not applicable pending source model |

Metropolitan municipality status does not change ADM1 or ADM2: provinces remain ADM1 and districts
remain ADM2. Municipality boundaries are not automatically equivalent to civil administrative
boundaries. A municipality source can only be used when its scope, license, and parent relationship
are explicit.

Neighbourhoods and villages are modeled at ADM3 because both sit below district-level parentage in
the application hierarchy. They may use different `semanticType` and `localType` values in the same
ADM level when a reviewed source supplies that distinction. Turkey V2 also permits
`semanticType: "generated-zone"` at ADM3 for generated game coverage; those records are not official
mahalle or köy boundaries.

HDX COD-AB property mapping:

| Field              | ADM0         | ADM1         | ADM2         |
| ------------------ | ------------ | ------------ | ------------ |
| `sourceAdminLevel` | `adm0`       | `adm1`       | `adm2`       |
| stable/source id   | `adm0_pcode` | `adm1_pcode` | `adm2_pcode` |
| parent source id   | none         | `adm0_pcode` | `adm1_pcode` |
| local name         | `adm0_name1` | `adm1_name1` | `adm2_name1` |

Every generated record stores `sourceAdminLevel`, `semanticType`, `localType`, `localTypeName`,
`hierarchyDepth`, `parentId`, `sourceParentId`, `semanticReviewStatus`, `coverageStatus`, `codes`,
`names`, and `source` metadata where the source provides enough evidence.

See [Turkey V2 data contract](./turkey-v2-data-contract.md) for the opt-in strict source-class,
provenance, stable identity, and generated-zone rules.
