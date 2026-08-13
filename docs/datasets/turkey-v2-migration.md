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
