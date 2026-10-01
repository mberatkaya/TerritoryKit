# Security

This page records the Sprint 7 security hardening posture. Private vulnerability reporting remains in the repository
`SECURITY.md`.

## Audit Result

The production audit reports zero vulnerabilities. The full audit recorded in
`docs/release-artifacts/production-hardening-report.json` reports:

| Severity | Count | Scope             |
| -------- | ----: | ----------------- |
| Critical |     0 | none              |
| High     |     1 | dev tooling path  |
| Moderate |     6 | dev tooling paths |
| Low      |     0 | none              |
| Info     |     0 | none              |

The remaining non-critical advisories are in dev paths:

| Module            | Severity      | Patched version | Notes                                                   |
| ----------------- | ------------- | --------------- | ------------------------------------------------------- |
| `vite`            | high/moderate | `>=6.4.3`       | Stable VitePress 1.6.4 requires Vite 5.4.21.            |
| `esbuild`         | moderate      | `>=0.24.3`      | VitePress dev server path; not used by package runtime. |
| `vitest` / mocker | moderate      | `>=4.1.11`      | Test runner; requires a same-major tooling update.      |
| `markdown-it`     | moderate      | `>=14.3.1`      | Documentation rendering path.                           |

The raw Vite high advisory remains. A narrow exception for `GHSA-fx2h-pf6j-xcff` is recorded in
`reports/baselines/sprint-7-security-exceptions.json` and expires on 2026-10-29, with review due
2026-10-15. The release hardening gate accepts it only while the exact package, version, affected
range, dependency paths, dev-only classification, and documentation exposure checks match. Other
high or critical findings still block. The moderate findings require tooling maintenance and are
not published package runtime dependencies.

The advisory concerns Vite `server.fs.deny` bypass on Windows alternate path forms. Exploitation
requires a network-exposed development server and a sensitive file on a qualifying Windows
volume. CI and release jobs use Ubuntu and build docs without running VitePress dev. The docs dev
script has no `--host`, and VitePress config does not set `server.host`. Example dev servers that
use `--host` resolve patched Vite 8, not the vulnerable VitePress Vite 5 path. Re-review or remove
the exception immediately if docs deployment changes, Windows or network-exposed docs development
is supported, a Vite 5 backport appears, or stable VitePress supports patched Vite.

Release hardening passing does not authorize publication. Main branch protection and the
`npm-production` environment reviewer policy are still missing and must be configured first.

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

| Workflow                       | Trigger                   | Permissions                                              | Secrets                              |
| ------------------------------ | ------------------------- | -------------------------------------------------------- | ------------------------------------ |
| `ci.yml`                       | pull request, `main` push | `contents: read`                                         | none                                 |
| `turkey-dataset-build.yml`     | manual                    | `contents: read`                                         | none                                 |
| `dataset-registry-publish.yml` | manual                    | `contents: read`                                         | `TERRITORY_REGISTRY_PUBLISH_ENABLED` |
| `release.yml`                  | `main` push, manual       | read-only release job; publish job has `id-token: write` | `GITHUB_TOKEN`                       |

Use trusted publishing/provenance. Do not commit npm
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
