# Release Notes Draft

Draft release notes for the next Changesets release from `release/production-hardening`.
Do not publish these notes as a GitHub Release until npm and registry verification succeed.

## Summary

TerritoryKit `1.2.0` is a production hardening release for the expanded package set. It
keeps `territory-schema@1`, verifies package boundaries and tarball contents, adds release
artifact checksums, strengthens GitHub Actions permissions, and records full Turkey ADM0-ADM2
production evidence.

## Highlights

- Added release hardening evidence with vulnerability audit, production license inventory,
  package metadata validation, package export smoke, import-boundary checks, Turkey checksum
  verification, and benchmark comparison.
- Hardened package tarball dry-runs with SHA-256 output and checks for accidental large
  geometry artifacts.
- Added a maintainer-triggered Turkey dataset build workflow that records performance, peak
  resource usage, artifact size, MVT tile counts, adjacency, geometry, checksum, and benchmark
  evidence.
- Confirmed Turkey ADM0-ADM2 production artifacts: ADM0 1, ADM1 81, ADM2 973.
- Documented Gaziantep-only ADM3 partial coverage with real source lock, attribution,
  checksum, artifact policy, and known quality limitations.
- Added production release docs: checklist, security posture, rollback plan, support matrix,
  known limitations, migration guide updates, and release-readiness decision.

## Package Versions

Changesets currently recommends no major release.

- Minor `1.2.0`: main published package set including dataset, core, adapter-core, registry,
  runtime, generators, cli, data packages, maplibre, leaflet, openlayers, nestjs, and game.
- Patch `1.1.1`: `@territory-kit/react-native`.
- Patch example versions: private example workspaces reported by Changesets.

## Breaking Changes

No undocumented breaking public API change is included in this hardening PR.

## Migration Notes

No dataset schema migration is required for `territory-schema@1`. See
`docs/migration-guide.md` for package import guidance, deprecated core registry re-exports,
and dataset migration-plan tooling.

## Publish Checklist

Before publishing, maintainers must merge the PR, run the Turkey dataset build workflow from
`main`, review uploaded artifacts, merge the Changesets version PR, and then use the guarded
Release workflow. Do not publish from this branch.
