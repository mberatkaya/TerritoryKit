# Dataset Versioning

Registry dataset versions are semver. Exact versions can be requested with `--version` or
`version`; otherwise the client chooses the latest compatible non-prerelease dataset.

```bash
territory dataset install territory-kit-tr --registry ./registry.json --version 1.2.3
territory dataset install territory-kit-tr --registry ./registry.json --allow-prerelease
```

`latest-compatible` keeps `territory-schema@1` datasets on the current schema line. Prereleases are
excluded unless `allowPrerelease` or `--allow-prerelease` is set.

## Turkey V2 Versioning

Turkey V2 separates:

- NPM package version
- `datasetVersion`
- `schemaVersion`
- generated-zone `algorithmVersion`
- `sourceDate`
- `buildDate`
- source-lock schema/version

Turkey dataset semver:

- Major: breaking stable ID standard, ADM meaning, parent hierarchy, or consumer contract change.
- Minor: new real polygon coverage, generated-to-real replacement, new il/ilçe/ADM3 coverage, or
  backwards-compatible metadata/artifact additions.
- Patch: metadata, attribution, URL, manifest, report, or stable-ID-preserving geometry fixes.

A geometry edit does not automatically change stable identity. Consumers should use migration plans
when IDs, source class, or parent context change.
