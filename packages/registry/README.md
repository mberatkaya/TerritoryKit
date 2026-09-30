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

## URL trust policy

Remote registry access requires HTTPS. Use `allowHttp: true` only for a trusted HTTP endpoint. Local registry files require `allowFile: true`; remote registries cannot select local artifact files. Absolute artifact URLs stay on the artifact base origin unless listed in `allowedOrigins`. The Node transport rejects private and local destinations, including redirects, unless `allowPrivateNetwork: true` is supplied for trusted internal hosting. A custom transport is responsible for its own URL and redirect policy. Registry JSON is capped at 8 MiB; artifact and decoded bytes default to 512 MiB ceilings, configurable with `maxArtifactBytes` and `maxDecompressedBytes`.
