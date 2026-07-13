# Migration Guide

## Before `1.0.0`

Public APIs may still change during prerelease sprint work. Breaking changes must be recorded
in `CHANGELOG.md`, and dataset schema changes must be documented in Schema Migrations.

Before the stable release, additive API changes must include TypeScript exports, API docs,
tests, and a changelog note. Breaking API changes require a new migration section and should
not be mixed with release-hardening fixes.

## Dataset Schema

`territory-schema@1` is the current schema. Geometry updates should change `datasetVersion`,
`sourceDate`, and `geometryHash`; shape-breaking changes require a new schema id and migration
notes.

## H3 Non-Goal

TerritoryKit does not migrate H3 indexes or hex cells. H3-like ergonomics map to dataset zone
APIs such as `latLngToZone`, `zoneToBoundary`, `zoneNeighbors`, and `polygonToZones`.
