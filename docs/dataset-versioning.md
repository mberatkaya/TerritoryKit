# Dataset Versioning

Registry dataset versions are semver. Exact versions can be requested with `--version` or
`version`; otherwise the client chooses the latest compatible non-prerelease dataset.

```bash
territory dataset install territory-kit-tr --registry ./registry.json --version 1.2.3
territory dataset install territory-kit-tr --registry ./registry.json --allow-prerelease
```

`latest-compatible` keeps `territory-schema@1` datasets on the current schema line. Prereleases are
excluded unless `allowPrerelease` or `--allow-prerelease` is set.
