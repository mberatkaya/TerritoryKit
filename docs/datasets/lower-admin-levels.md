# Lower Administrative Levels

TerritoryKit supports administrative levels `ADM0` through `ADM5`. The numeric level only describes
hierarchy depth; local meaning is stored separately as semantic metadata such as `province`,
`district`, `municipality`, or `neighbourhood`.

TerritoryKit supports lower administrative levels when a suitable source exists. It does not
guarantee neighbourhood-level coverage for every country.

## Model

- `adminLevel` is the TerritoryKit level (`ADM0` through `ADM5`).
- `sourceAdminLevel` records the provider's source level when it differs or needs auditability.
- `semanticType` records meaning, for example `district` or `neighbourhood`.
- `localTypeName` records the local-language label when reviewed.
- `semanticReviewStatus` records whether the mapping is reviewed.
- `coverageStatus` records artifact/source coverage independently from semantic review.

Never model `municipality` or `neighbourhood` as pseudo-levels. Store them as `semanticType` on the
appropriate ADM record.

## Fallbacks

Registry and MapLibre helpers may explicitly request deepest-available fallback. A fallback result
must expose both `requestedLevel` and `resolvedLevel`; an ADM2 artifact must never be labelled as
ADM3.
