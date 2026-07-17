# ADR 0010: Global Dataset Strategy

## Status

Accepted

## Context

TerritoryKit currently ships a compact `territory-schema@1` dataset contract, validation helpers,
generators, a JSON-first CLI, and runtime packages for engines and adapters. The next product
direction is global administrative data across countries, cities, districts, and other local
boundaries. That work needs stable identifiers, provenance, license metadata, and source-specific
import pipelines before large real-world artifacts are added.

## Decision

TerritoryKit core remains separate from data production systems. `@territory-kit/core` consumes
validated territory datasets; source downloads, transforms, simplification, artifact packaging,
and license checks belong in generators, CLIs, or future importer packages.

Country identifiers use ISO 3166-1 alpha-2 codes. TerritoryKit global IDs store the country prefix
in lowercase, for example `tr` and `us`. Metadata may also store official uppercase codes in
`properties.territory.codes.iso3166_1`.

Sub-country identifiers use ISO 3166-2 when it is stable and available. If ISO 3166-2 is missing or
too coarse for the local level, importers must use a stable official code or source-system ID. Names
alone are not acceptable as canonical identifiers.

Administrative levels were originally represented with `ADM0`, `ADM1`, `ADM2`, `ADM3`, and `ADM4`.
ADR 0011 extends the supported range to `ADM5`.
`adminLevel` is the global semantic level. The existing numeric `level` field remains the
schema-v1 engine ordering field. For global datasets, `level` maps to the hierarchy order
(`ADM0 -> 0`, `ADM1 -> 1`, and so on), while `adminLevel` is stored as metadata in
`zone.properties.territory.adminLevel`.

Local administrative kinds are stored separately in `localType`. Values may include `province`,
`state`, `county`, `district`, `municipality`, `neighborhood`, or source-specific equivalents. This
avoids pretending that every country has the same legal subdivision model.

Every global dataset manifest must record source provider, source date, build date, license,
attribution, coordinate reference system, geometry detail level, geometry hash, artifact checksum,
boundary policy, worldview, and disputed-area policy. Zone-level source metadata may be used when a
dataset mixes sources.

Disputed boundaries are not presented as one absolute truth. Global manifests must document the
selected `worldview`, `boundaryPolicy`, and `disputedAreaPolicy`. Importers should preserve source
flags where available and documentation must state the selected representation.

The query format and map-display format may diverge later. `territory-schema@1` remains the query
and engine format. Future map artifacts may use simplified, tiled, or vector-tile-friendly shapes
derived from the canonical dataset.

Large dataset artifacts are not embedded directly in npm packages. Packages contain schema,
validation, helpers, and import/build code. Large generated data should be published as external
artifacts with checksums and manifests.

`territory-schema@1` is extended without breaking its public shape. Global metadata is standardized
inside `zone.properties.territory`, and manifest metadata is added through optional schema-v1
fields plus a stricter opt-in global manifest validator.

## ID Standard

Global territory IDs use:

```text
<country>
<country>:<admin-level>:<stable-local-id>
```

Examples:

```text
tr
tr:adm1:34
tr:adm2:fatih
us:adm1:ca
us:adm2:los-angeles-county
```

The stable local ID may be an official code, an ISO 3166-2 subdivision code component, or a source
ID. Slugs are lowercase ASCII, deterministic, and must not be regenerated solely because a display
name changes.

## Schema v2 Strategy

Schema v2 should only be introduced when compatibility cannot be preserved through optional
manifest fields and `properties.territory`. Candidate reasons include a first-class `adminLevel`
field on zones, separate query/render geometry stores, temporal boundary versions, or explicit
multi-worldview boundary collections.

Migration from v1 to v2 should provide:

- a v1 reader that keeps loading existing datasets;
- a deterministic v1-to-v2 migration utility;
- fixtures for global manifests and mixed-source metadata;
- a documented deprecation window for any renamed fields;
- clear artifact checksums before and after migration.

## Consequences

Global datasets can be validated without breaking existing `territory-schema@1` consumers.
Importers must do more provenance work up front, but downstream users can inspect license,
attribution, worldview, and boundary policy before using a dataset.
