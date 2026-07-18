# Changelog

All notable changes will be tracked here until Changesets generates release notes.

## 1.2.0 - Unreleased

- Added `@territory-kit/adapter-core` renderer-independent adapter contracts.
- Added `@territory-kit/runtime` minimal lifecycle contracts.
- Added shared `TerritoryError` codes and safe serialization in `@territory-kit/dataset`.
- Deprecated core registry re-exports and added `@territory-kit/core/legacy-registry`.
- Updated MapLibre to expose shared adapter capabilities and lifecycle state.
- Strengthened package boundary, circular dependency, browser-safety, and bundle-size checks.
- Added Sprint 13 multi-dataset catalog, engine pool, binary spatial index, worker-loading
  contracts, and CLI index artifact commands.

## 1.0.0 - 2026-07-14

- Prepared public packages for the `1.0.0` stable release with the current public API surface
  frozen.
- Hardened dataset validation for bbox/center drift and reciprocal neighbor warnings.
- Hardened GeoJSON import for invalid hierarchy array properties with repair suggestions.
- Hardened core lookup, viewport, and logical adjacency behavior for invalid inputs.
- Hardened CLI/generator contracts with deterministic import hashes and option validation.
- Hardened MapLibre initial state/lifecycle and NestJS request parsing/PostGIS row mapping.
- Added GeoJSON FeatureCollection import hardening with feature-aware validation issues.
- Added core debug brute-force lookup, `polygonToZones`, viewport cache keys, transition
  payloads, and typed adjacency connections.
- Added benchmark and bundle-size gates.
- Added MapLibre adapter lifecycle API and real web example.
- Added NestJS viewport/locate controller contracts and PostGIS repository SQL.
- Added JSON-first CLI output plus import, simplify, generate, and typed adjacency outputs.
