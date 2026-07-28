# ADR 0012: Hosted Registry Publishing Boundary

## Status

Accepted

## Context

TerritoryKit needs hosted dataset artifacts with immutable version URLs, mutable aliases, checksum
verification, rollback metadata, and cache headers. The repository should not become tied to one
cloud provider, and tests must not require production credentials.

## Decision

Hosted publishing uses a provider-neutral object-store boundary in `@territory-kit/registry/node`.
The CLI implements the local filesystem target and prepares a deterministic object tree. Generic
HTTP/CDN verification and S3-compatible object-store publishing are exposed as adapter contracts.

The active `registry.json` is written last. Immutable artifact objects, immutable version
registries, inventory reports, and rollback manifests are uploaded before the active alias changes.

## Consequences

- PR CI can test publishing with small local and in-memory fixtures.
- S3-compatible behavior is contract-tested without cloud credentials.
- Production teams can add provider-specific sync after environment approval.
- The CLI does not claim to deploy to production storage by itself.
