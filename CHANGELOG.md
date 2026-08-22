# Changelog

All notable changes will be tracked here until Changesets generates release notes.

## 2.0.0 - 2026-08-22

- Promoted TerritoryKit V2 to the stable `2.0.0` release target while leaving package manifest
  version changes to the Changesets Version Packages PR.
- Promoted the Turkey V2 national playable dataset contract to
  `territory-kit-tr-v2-playable@2.0.0`.
- Added nationwide Turkey playable ADM3 coverage across 1 ADM0, 81 ADM1 provinces, and 973 ADM2
  districts using official > OSM > generated source priority.
- Preserved generated ADM3 zones as deterministic, playable, explicitly non-official
  `generated-zone` records.
- Added resolver/registry metadata, source-locks, checksums, artifact integrity validation, and
  strict publish-ready national validation for the Turkey V2 artifact.
- Added topology-safe ADM1/ADM2 simplification evidence and real shared-boundary topology audit
  semantics.
- Hardened the release path with canonical Turkey V2 stable build/validate scripts, package
  dry-run checks, release-hardening V2 gates, and a final major Changeset.

## 1.2.0 - 2026-07-30

- Added `@territory-kit/adapter-core` renderer-independent adapter contracts.
- Added `@territory-kit/runtime` minimal lifecycle contracts.
- Added shared `TerritoryError` codes and safe serialization in `@territory-kit/dataset`.
- Deprecated core registry re-exports and added `@territory-kit/core/legacy-registry`.
- Updated MapLibre to expose shared adapter capabilities and lifecycle state.
- Strengthened package boundary, circular dependency, browser-safety, and bundle-size checks.
- Added Sprint 13 multi-dataset catalog, engine pool, binary spatial index, worker-loading
  contracts, and CLI index artifact commands.
- Added Turkey national ADM0-ADM2 HDX/OCHA COD-AB source locking, optional query/render/binary
  country build artifacts, topology-safe simplification CLI, and a registry-backed Turkey MapLibre
  example while keeping ADM3/ADM4 as partial or blocked.
- Added production hardening evidence for security audit, production license inventory, package
  exports, ESM/CJS dry-runs, tarball checksums, import boundaries, Turkey production validation,
  benchmark comparison, rollback, support matrix, release notes, and release-readiness decision.
- Hardened Turkey build workflow as a maintainer-triggered gate that stores resource usage,
  artifact size, MVT tile count, adjacency, geometry, checksum, and benchmark reports outside
  normal PR CI.

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
