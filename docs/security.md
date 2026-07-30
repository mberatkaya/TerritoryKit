# Security

This page records the production hardening security posture for
`release/production-hardening`. Private vulnerability reporting remains in the repository
`SECURITY.md`.

## Audit Result

`pnpm audit --audit-level critical --json` passes with 0 critical vulnerabilities. The full
audit recorded in `docs/release-artifacts/production-hardening-report.json` reports:

| Severity | Count | Scope             |
| -------- | ----: | ----------------- |
| Critical |     0 | none              |
| High     |     3 | dev tooling paths |
| Moderate |     3 | dev tooling paths |
| Low      |     0 | none              |
| Info     |     0 | none              |

The remaining non-critical advisories are in dev paths:

| Module            | Severity      | Patched version | Notes                                            |
| ----------------- | ------------- | --------------- | ------------------------------------------------ |
| `vite`            | high/moderate | `>=6.4.3`       | VitePress uses Vite 5.4.21 for docs tooling.     |
| `postcss`         | high          | `>=8.5.18`      | Traversal advisory through dev/build toolchains. |
| `brace-expansion` | high          | `>=5.0.8`       | DoS advisory through lint/docs/dev dependencies. |
| `esbuild`         | moderate      | `>=0.24.3`      | Dev server advisory through VitePress tooling.   |

These findings do not block this release gate because the release condition is no critical
vulnerability and the affected paths are not published package runtime dependencies. They
should still be closed in the next dependency maintenance sprint.

## Supply Chain

- CI installs with `pnpm install --frozen-lockfile --ignore-scripts` for normal PR gates.
- The root workspace is private and has a failing `prepublishOnly` guard.
- Public packages use explicit `files` allowlists.
- `pnpm package:dry-run` builds tarballs, records SHA-256, and rejects development files or
  large geometry artifacts.
- npm publishing is expected to use GitHub Actions OIDC provenance and npm Trusted
  Publishing.
- The release workflow runs only in `mberatkaya/TerritoryKit` on `main`.
- Package provenance, npm package pages, and tarball contents must be checked after publish.

## Workflow Permissions

| Workflow                       | Trigger                   | Permissions                                                  | Secrets                              |
| ------------------------------ | ------------------------- | ------------------------------------------------------------ | ------------------------------------ |
| `ci.yml`                       | pull request, `main` push | `contents: read`                                             | none                                 |
| `turkey-dataset-build.yml`     | manual                    | `contents: read`                                             | none                                 |
| `dataset-registry-publish.yml` | manual                    | `contents: read`                                             | `TERRITORY_REGISTRY_PUBLISH_ENABLED` |
| `release.yml`                  | `main` push, manual       | `contents: write`, `id-token: write`, `pull-requests: write` | `GITHUB_TOKEN`, optional `NPM_TOKEN` |

`NPM_TOKEN` is a fallback only. Prefer trusted publishing/provenance. Do not commit npm
tokens, OTP values, registry credentials, object-store keys, or private source URLs.

## Registry And Dataset Safety

- Registry clients verify SHA-256 and size metadata before accepting artifacts.
- Hosted registry publish has a dry-run default and requires
  `TERRITORY_REGISTRY_PUBLISH_ENABLED=true` for activation.
- Turkey source locks capture provider, source URL, retrieval metadata, and content hashes.
- ADM3 Gaziantep data is marked partial and must not be presented as nationwide coverage.

## Response Policy

For exploitable reports, use a private security advisory or the repository security contact.
Do not open public issues containing exploit details. If a release artifact is affected,
freeze publish workflows, preserve immutable artifacts for investigation, and follow
`docs/rollback.md`.
