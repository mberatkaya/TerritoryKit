# Artifact Publishing

Artifact publishing turns a validated dataset artifact directory into a hosted, immutable registry
release. It does not upload secrets, choose a cloud provider, or claim a production deployment.

## Inputs

The artifact root must contain at least:

```text
manifest.json
checksums.json
levels/<ADM*>/dataset.json
```

`manifest.json` must record the same `datasetId` and `datasetVersion` passed to
`territory registry publish`. Publish fails instead of creating a registry that lies about artifact
contents.

## Provider Adapters

`@territory-kit/registry/node` exposes these adapter boundaries:

- `createLocalTerritoryRegistryPublishTarget`: writes a local object tree with atomic temp-file
  rename.
- `createHttpTerritoryRegistryReadTarget`: reads a generic HTTP/CDN object tree for smoke tests and
  verification.
- `createS3CompatibleTerritoryRegistryPublishTarget`: maps TerritoryKit object writes to an
  injected S3-compatible client contract. Tests use an in-memory fake client, so no cloud call or
  credential is required.

The CLI intentionally implements only `--target local`. Provider-specific sync belongs in release
infrastructure after environment approval.

## Metadata

Published registry artifacts include:

- `sha256`
- `sizeBytes`
- `contentType`
- `cacheControl`
- `etag`
- `immutable`
- source/build provenance metadata

The inventory report repeats this metadata per object and records `registry.json`,
immutable registry, inventory, and rollback keys.

## CI Smoke

`pnpm registry:publish:smoke` runs small fixture coverage for:

- fixture registry publish
- manifest and checksum verification
- corrupted file verification failure
- duplicate immutable version rejection
- dry-run no-write behavior
- S3-compatible adapter contract calls

Normal PR CI must not build or commit large Turkey artifacts. Manual workflows can build real
artifacts when an operator intentionally triggers them.

## Production Inputs

Before a real deployment, operators must provide:

- approved public base URL
- object storage bucket or CDN origin
- provider-specific sync mechanism
- environment protection rules
- reviewed dataset source license and attribution
- retention policy for immutable version paths and rollback manifests
- monitoring for `registry verify` against the public URL

Never commit access keys, tokens, or production URLs to the repository.
