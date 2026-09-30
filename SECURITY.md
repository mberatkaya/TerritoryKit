# Security Policy

## Supported Versions

Security fixes target the current stable major line.

| Version line | Support status                                           |
| ------------ | -------------------------------------------------------- |
| `2.x`        | Supported for security fixes while it is the stable line |
| `1.x`        | Maintenance fixes only when explicitly announced         |
| `<1.0`       | Unsupported                                              |

## Reporting

Report suspected vulnerabilities through a private security advisory or the security contact
listed in the project repository. Do not open public issues for exploitable reports.

## Scope

In scope:

- Package supply-chain issues.
- Unsafe parsing or validation behavior in dataset and CLI tools.
- Server-side risks in NestJS/PostGIS integrations.

Out of scope:

- Incorrect or unlicensed third-party geographic source data supplied by users.
- Map tile provider availability or account configuration.

## Registry and delivery trust

Remote registry clients require HTTPS by default. `allowHttp: true` is an explicit exception for HTTP. Local `file:` registries require `allowFile: true`; a remote registry cannot choose a local artifact base. Absolute artifact URLs must stay on the registry artifact base origin unless the caller supplies `allowedOrigins`. The Node transport blocks loopback, private and link-local destinations, including redirect destinations, unless `allowPrivateNetwork: true` is supplied for trusted internal hosting. A caller supplied transport is a trust escape hatch and must enforce an equivalent policy itself.

The registry JSON response is capped at 8 MiB. Artifact downloads default to a 512 MiB compressed ceiling, adjustable with `maxArtifactBytes`; decoded artifacts default to a 512 MiB ceiling, adjustable with `maxDecompressedBytes`. The 512 MiB default accommodates the validated 306.7 MB national GeoJSON artifact while bounding memory use. Consumers should set smaller limits for district-only loading.

SHA-256 checksums prove that downloaded bytes match the registry or delivery manifest. A delivery manifest content hash detects accidental or malicious modification of the manifest body, but neither self-hash authenticates who created it. Use HTTPS from a trusted host and pin `expectedManifestContentHash` from a trusted channel when authenticity is required. Deploy the manifest, shard set and MVT tiles atomically. Future signing can be added if a signing infrastructure is established.

## Release boundary

A push to `main` can create a Changesets version PR. npm publication requires an explicit `workflow_dispatch` with `publish=true`, a successful verification run in the publish job, and the `npm-production` GitHub Environment. Only that job has `id-token: write` for npm provenance. Configure required reviewers on the environment before use. The root workspace remains private and is never published.

The stricter registry URL defaults change behavior for existing HTTP, local file, cross-origin and private-network callers. The Changeset marks the fixed package family as a major release. Migrate only trusted endpoints with `allowHttp`, `allowFile`, `allowedOrigins`, or `allowPrivateNetwork` as appropriate; never enable these for values supplied by an untrusted registry.
