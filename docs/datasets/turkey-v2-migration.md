# Turkey V2 Migration

Turkey V2 keeps `territory-schema@1` and adds an opt-in strict profile. Existing Turkey ADM0-ADM2
artifacts and the Gaziantep ADM3 pilot remain legacy-readable; they are not rewritten automatically.

## Version Fields

- NPM package version: package release line for SDK code.
- `datasetVersion`: semver for a published dataset artifact.
- `schemaVersion`: JSON shape, currently `territory-schema@1`.
- `algorithmVersion`: generated-zone algorithm contract.
- `sourceDate`: source snapshot date.
- `buildDate`: artifact build timestamp.
- source-lock schema/version: source acquisition and checksum contract.

Dataset version and NPM package version are different concepts.

For the TerritoryKit 2.0 handoff they are intentionally aligned: the SDK fixed-group release target
is `2.0.0` and the Turkey V2 national playable dataset version is also `2.0.0`. This alignment is
release policy for this handoff, not a rule that future dataset versions must always match package
versions.

The final RC-to-stable promotion changes active dataset metadata from `2.0.0-rc.1` to `2.0.0`.
Geometry and stable zone IDs are expected to remain unchanged when sources and generation
configuration are unchanged; source-lock and deterministic hashes may change because release
metadata is part of those hashes.

## Turkey Dataset Semver

Major:

- breaking stable ID standard change
- breaking ADM level meaning change
- breaking parent hierarchy change
- breaking consumer contract change

Minor:

- new real polygon coverage
- generated polygon replaced by real polygon
- new il, ilçe, or ADM3 coverage
- backwards-compatible metadata or artifact addition

Patch:

- attribution or metadata correction
- source URL correction
- stable-ID-preserving geometry repair
- report or manifest correction

Geometry changes do not automatically mean ID changes. IDs follow the stable identity standard.

## Generated Zone V1 to V2

`tr-adm3-game-zone-v2` is not a geometry-preserving update to
`tr-adm3-generated-zone-v1`. The algorithm version is part of generated stable identity, so V2
generated IDs intentionally differ from V1. Applications that persist generated-zone ownership,
scores, route summaries, or claims must apply an explicit migration mapping before switching a
district or national artifact to V2.

The V2 generator is available through `buildTurkeyGameZones`,
`buildTurkeyGameZonesWithAdjacency`, and `territory tr adm3 generate`. The national playable
artifact is produced by the separate `territory tr v2 national publish-ready` pipeline.

## Migration Artifacts

Future national Turkey V2 migrations should emit:

- old dataset reference
- new dataset reference
- old ID to new ID mappings
- generated-to-real replacement records
- stable ID diff report
- review items for splits, merges, parent changes, or source-class changes

Applications should apply mappings only after validating the migration artifact. TerritoryKit does
not mutate application-owned scores, ownership, or route history.

## Hybrid Migration Plan

The Sprint 3 hybrid builder emits `territorykit-tr-v2-hybrid-migration@1` records for:

- `preserved`
- `added`
- `removed`
- `geometry-changed`
- `source-replaced`
- `split`
- `merged`
- `parent-changed`
- `source-class-changed`

Each record carries old/new zone IDs, source classes, parent IDs, intersection area, old/new
overlap percentages, confidence, manual-review status, and a reason. The plan is evidence only; it
does not transfer KapRota ownership, scores, or route history.

## Sprint 6 National Candidate

The historical `2.0.0` national dataset is preserved. The next candidate is `2.1.0-rc.1`: it adds
a compatible source resolver and sharded artifacts while changing generated geometry and IDs.
Consumers must explicitly opt into the candidate and inspect `--migration-baseline <old dataset>`.
The existing migration planner runs within each district and reports old/new IDs, intersection
area, old/new overlap shares, intersection-over-union, splits, merges, removals, additions, and
manual-review flags. It does not transfer game state automatically.

Sprint 6 uses `overlap-components-v2`. Actual old/new intersection pairs form connected
bipartite components, so a merge retains every old ID and many-to-many changes retain every
participating ID. Records include per-pair shares and IoU, mapping cardinality, and old/new
algorithm versions and source tiers. Many-to-many components always require manual review;
they are not represented as independent one-to-one transfers.
