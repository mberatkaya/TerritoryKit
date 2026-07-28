# @territory-kit/registry

Registry client, artifact resolver, and verified dataset cache helpers for TerritoryKit.

The root package is browser-safe and uses injected transports/caches. Node filesystem download and
cache helpers live under `@territory-kit/registry/node`.

Node helpers also include hosted registry publishing primitives:

- local filesystem publish target
- generic HTTP/CDN verification target
- S3-compatible object-store adapter contract
- provider-neutral `publishTerritoryDatasetRegistry`
- hosted `verifyTerritoryRegistryPublication`
