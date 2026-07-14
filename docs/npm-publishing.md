# npm Publishing

TerritoryKit publishes only package workspaces under the `@territory-kit/*` scope. The root
workspace remains private so `npm publish` from the repository root fails safely.

## Public Packages

| Package                     | Version | Internal dependencies                                                        | Output                                                     | Publish |
| --------------------------- | ------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- | ------- |
| `@territory-kit/dataset`    | `1.0.0` | none                                                                         | `dist/*.cjs`, `dist/*.mjs`, `dist/*.d.cts`, `dist/*.d.mts` | yes     |
| `@territory-kit/core`       | `1.0.0` | `@territory-kit/dataset`                                                     | `dist/*.cjs`, `dist/*.mjs`, `dist/*.d.cts`, `dist/*.d.mts` | yes     |
| `@territory-kit/generators` | `1.0.0` | `@territory-kit/core`, `@territory-kit/dataset`                              | `dist/*.cjs`, `dist/*.mjs`, `dist/*.d.cts`, `dist/*.d.mts` | yes     |
| `@territory-kit/maplibre`   | `1.0.0` | `@territory-kit/core`, `@territory-kit/dataset`                              | `dist/*.cjs`, `dist/*.mjs`, `dist/*.d.cts`, `dist/*.d.mts` | yes     |
| `@territory-kit/nestjs`     | `1.0.0` | `@territory-kit/core`, `@territory-kit/dataset`                              | `dist/*.cjs`, `dist/*.mjs`, `dist/*.d.cts`, `dist/*.d.mts` | yes     |
| `@territory-kit/cli`        | `1.0.0` | `@territory-kit/core`, `@territory-kit/dataset`, `@territory-kit/generators` | `dist/*.cjs`, `dist/*.mjs`, `dist/*.d.cts`, `dist/*.d.mts` | yes     |

The correct first-publish order is:

```text
@territory-kit/dataset
@territory-kit/core
@territory-kit/generators
@territory-kit/maplibre
@territory-kit/nestjs
@territory-kit/cli
```

`@territory-kit/maplibre` and `@territory-kit/nestjs` are independent of each other after
`@territory-kit/core` and `@territory-kit/dataset` have been published.

## Private Workspaces

These workspaces must not be published:

- root `territory-kit`
- `@territory-kit/shared-testkit`
- `@territory-kit/docs`
- `@territory-kit/example-node-basic`
- `@territory-kit/example-web-maplibre`
- `@territory-kit/example-nestjs-postgis`

The root package keeps `"private": true`. Private packages stay in `.changeset/config.json`
`ignore`, so Changesets does not publish them.

## Local Verification

Run the full verification gate before any publish:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm bundle:size
```

Dry-run the public packages with pnpm so workspace dependencies are converted the same way they
will be during publish:

```sh
pnpm --filter @territory-kit/dataset publish --dry-run --json --access public --no-git-checks
pnpm --filter @territory-kit/core publish --dry-run --json --access public --no-git-checks
pnpm --filter @territory-kit/generators publish --dry-run --json --access public --no-git-checks
pnpm --filter @territory-kit/maplibre publish --dry-run --json --access public --no-git-checks
pnpm --filter @territory-kit/nestjs publish --dry-run --json --access public --no-git-checks
pnpm --filter @territory-kit/cli publish --dry-run --json --access public --no-git-checks
```

Expected tarball contents are `package.json`, `README.md`, `LICENSE`, and the runtime/type files
under `dist`. Source files, tests, docs, examples, `.github`, local config, and sourcemaps must not
appear in the package contents.

## First Local Publish

Confirm the logged-in npm user and organization access:

```sh
npm whoami
npm org ls territory-kit --json
```

The expected npm user is `mberat`, and `mberat` must have owner or publish access in the
`territory-kit` organization.

After verification and dry-runs pass, publish public packages in topological order:

```sh
pnpm --filter @territory-kit/dataset publish --access public --no-git-checks
pnpm --filter @territory-kit/core publish --access public --no-git-checks
pnpm --filter @territory-kit/generators publish --access public --no-git-checks
pnpm --filter @territory-kit/maplibre publish --access public --no-git-checks
pnpm --filter @territory-kit/nestjs publish --access public --no-git-checks
pnpm --filter @territory-kit/cli publish --access public --no-git-checks
```

If npm asks for a 2FA code or web authentication, stop at that prompt and complete the login or
approval locally. Do not put OTP values, npm tokens, or session data in repository files or logs.

If a package version already exists on npm, do not republish the same version. npm versions are
immutable. Add a Changeset and release a new patch version instead.

## Changesets Release Flow

The release workflow is `.github/workflows/release.yml`.

- Pushes to `main` run install, formatting, lint, typecheck, tests, build, and bundle size checks.
- If unreleased Changesets exist, `changesets/action` opens or updates the version PR.
- After the version PR is merged and no Changesets remain, the workflow runs `pnpm release`.
- `pnpm release` runs `pnpm build && changeset publish`.
- Changesets checks npm before publishing and skips package versions that already exist.
- The root workspace is private and ignored by publish tooling.

## Trusted Publishing Setup

Configure npm Trusted Publishing on npmjs.com for each public package:

- `@territory-kit/dataset`
- `@territory-kit/core`
- `@territory-kit/generators`
- `@territory-kit/maplibre`
- `@territory-kit/nestjs`
- `@territory-kit/cli`

Use these values in each package's Trusted Publisher settings:

| Field             | Value          |
| ----------------- | -------------- |
| Provider          | GitHub Actions |
| GitHub owner      | `mberatkaya`   |
| Repository        | `TerritoryKit` |
| Workflow filename | `release.yml`  |
| Environment       | leave blank    |
| Allowed actions   | `npm publish`  |

The workflow grants `id-token: write` and does not set `NPM_TOKEN` or `NODE_AUTH_TOKEN`.
Node.js 24 and npm 11 are used for the release job. `PNPM_CONFIG_PROVENANCE=true` and
`NPM_CONFIG_PROVENANCE=true` are set for the publish step; pnpm 11 supports `--provenance` and
Trusted Publishing-compatible release builds.

Trusted Publishing requires the package `repository.url` to match the GitHub repository. Public
package manifests point to `https://github.com/mberatkaya/TerritoryKit.git` and include each
workspace `directory`.

## Optional Token Fallback

Trusted Publishing is the primary path. Use a token only as a temporary fallback if npm Trusted
Publishing is unavailable.

- GitHub repository secret: `NPM_TOKEN`
- Workflow environment variable: `NODE_AUTH_TOKEN`
- Use a granular token with minimum package-scope publish permissions.
- Never write the token into repo files, `.npmrc`, logs, or docs.
- Remove the token after Trusted Publishing works.

Do not enable Trusted Publishing and token publishing in the active workflow at the same time.

## Troubleshooting

- `EPRIVATE` from the root package is expected; the root workspace must not be published.
- `E404` during Trusted Publishing usually means the npm Trusted Publisher owner, repo, workflow
  filename, package name, or repository URL does not match exactly.
- `ENEEDAUTH` means npm cannot authenticate; check Trusted Publisher settings or local login state.
- `E403 cannot publish over the previously published version` means the version already exists.
  Create a new patch version instead.
- If tarball contents include `src`, `test`, `.github`, docs, examples, sourcemaps, or local config,
  fix the package `files` list before publishing.
- If a package depends on another workspace package, publish the dependency first.
