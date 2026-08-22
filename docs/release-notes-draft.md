# Release Notes Draft

Draft release notes for the TerritoryKit `2.0.0` stable handoff. Do not publish these notes as a
GitHub Release until npm publication, provenance, and registry verification succeed.

## Summary

TerritoryKit `2.0.0` promotes the V2 SDK line and the Turkey V2 national playable dataset to a
stable release target. The package manifests remain on the current source version until the
Changesets Version Packages PR applies the final `2.0.0` package versions.

## Highlights

- Stable Turkey V2 national playable dataset contract:
  `territory-kit-tr-v2-playable@2.0.0`.
- Complete Turkey ADM0-ADM2 hierarchy: 1 country, 81 provinces, and 973 districts.
- Nationwide playable ADM3 coverage using official > OSM > generated priority.
- Generated fallback zones remain deterministic, playable, explicitly generated, and non-official.
- Resolver/registry model keeps large national geometry outside npm packages.
- Strict publish-ready validation covers coverage, hierarchy, geometry, provenance, attribution,
  generated metadata, adjacency, registry artifacts, checksums, and topology evidence.
- Canonical stable scripts pin `--dataset-version 2.0.0` and build date
  `2026-08-22T00:00:00.000Z`.
- Release hardening now includes Turkey V2 stable national evidence in addition to package,
  security, license, export, bundle, and dry-run checks.

## Migration Notes

`territory-schema@1` remains unchanged. The Turkey V2 national playable dataset is an additive
resolver-driven dataset variant exposed by `@territory-kit/data-tr`; legacy `territory-kit-tr`
resolution remains separate. Applications that consume ADM3 gameplay zones should preserve the
generated-zone distinction and must not treat generated fallback as official mahalle/koy data.

## Known Limitation

No redistributable nationwide official Turkish ADM3 neighbourhood/village boundary source is
currently locked. TerritoryKit 2.0 provides complete national playable ADM3 coverage through
reviewed real sources where available and deterministic generated fallback elsewhere.

## Publish Checklist

Before publishing, maintainers must merge the release-hardening PR, review the Changesets Version
Packages PR, verify the versioned state locally or in CI, merge that PR, and then use the guarded
release workflow. Do not publish from the hardening branch.
