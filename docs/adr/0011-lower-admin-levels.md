# ADR 0011: Lower Administrative Levels

## Status

Accepted.

## Context

TerritoryKit previously treated ADM0-ADM2 as the practical country pipeline surface, with scattered
ADM4 assumptions and pseudo coverage entries for municipality/neighbourhood data.

## Decision

TerritoryKit supports `ADM0` through `ADM5` as administrative depths. Semantic meaning is separate
from level and is stored with `semanticType`, `localTypeName`, and review status metadata.

Coverage registries use only ADM levels. Municipality, neighbourhood, commune, ward, and similar
terms are semantic types, not separate administrative levels.

Fallback is explicit and metadata-bearing. A deepest-available fallback result reports
`requestedLevel`, `resolvedLevel`, `exactMatch`, `reason`, and `coverageStatus`.

## Consequences

Existing ADM0-ADM2 identifiers and loaders remain compatible. Lower levels require reviewed
semantics and suitable redistributable sources before production publication.
