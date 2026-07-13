# Migration Guide

## Before `1.0.0`

Public APIs may still change during prerelease sprint work. Breaking changes must be recorded
in `CHANGELOG.md`, and dataset schema changes must be documented in Schema Migrations.

## Dataset Schema

`territory-schema@1` is the current schema. Geometry updates should change `datasetVersion`,
`sourceDate`, and `geometryHash`; shape-breaking changes require a new schema id and migration
notes.

## H3 Non-Goal

TerritoryKit does not migrate H3 indexes or hex cells. H3-like ergonomics map to dataset zone
APIs such as `latLngToZone`, `zoneToBoundary`, `zoneNeighbors`, and `polygonToZones`.
