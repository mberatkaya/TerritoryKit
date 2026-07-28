# Registry Hosting

TerritoryKit registries are provider-neutral JSON manifests for hosted dataset artifacts. The
active registry can live behind any static HTTP/CDN origin, while immutable dataset versions stay
under versioned object paths such as `tr/1.0.0/`.

## Layout

`territory registry publish` writes this provider-neutral object layout when used with the local
publish target:

```text
registry.json
tr/1.0.0/
  registry.json
  inventory.json
  manifest.json
  checksums.json
  levels/ADM0/dataset.json
rollback/territory-kit-tr/1.0.0.rollback.json
```

- `registry.json` is the mutable active alias, normally `latest`.
- `tr/1.0.0/registry.json` is the immutable version registry URL.
- `inventory.json` records every published object with SHA-256, byte size, Content-Type,
  Cache-Control, ETag, object key, and provenance metadata.
- `rollback/*.rollback.json` records the previous active registry snapshot and restore target.

## Publish

```bash
territory registry publish \
  --artifact-root ./dist/tr/artifact \
  --registry-output ./dist/registry \
  --dataset territory-kit-tr \
  --version 1.0.0 \
  --base-url https://datasets.example.com/tr/1.0.0/ \
  --artifact-prefix tr/1.0.0 \
  --dry-run
```

The CLI target is local by design. Use it to prepare the exact object tree that a CDN, object
storage bucket, or release workflow will sync. The registry package also exposes local,
generic HTTP read, and S3-compatible object-store adapter boundaries from
`@territory-kit/registry/node`.

## Verify

```bash
territory registry verify \
  --registry https://datasets.example.com/registry.json \
  --dataset territory-kit-tr \
  --version 1.0.0
```

Verification fetches the registry, validates its schema, resolves artifact URLs, and verifies every
selected artifact's byte size and SHA-256. `--verify-content-type` and `--verify-etags` add
metadata checks as warnings because CDNs may normalize those headers.

## Guarantees

- Publish verifies `manifest.json`, `checksums.json`, and all listed files before upload.
- Immutable object keys are preflighted and rejected when they already exist unless
  `--allow-overwrite` is explicitly supplied.
- The active registry is written last, so a partial artifact upload cannot change active clients.
- Failed publishes clean newly uploaded immutable objects when the target supports deletion.
- Dry-run computes the full plan and inventory without writing files.

Do not point the registry at artifacts whose source license, attribution, or quality gates have not
been reviewed.
