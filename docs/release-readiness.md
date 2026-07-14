# Release Readiness

This page is the final verification gate for Sprint 9-10 release hardening. It prepares the
repository for a stable release without publishing packages automatically.

The master sprint checklist is the ongoing source of truth for completed evidence, repo-owned
hardening branches, external release handoff, and post-1.0 roadmap work.
Release governance checks are tracked in [release governance](./release-governance.md).

## Branch Scope

- The release-readiness branch is `release/1.0.0-readiness`.
- Sprint 10 freezes the current public API and keeps `territory-schema@1` unchanged.
- Public packages are prepared at `1.0.0`; private docs, examples, and shared test fixtures
  remain out of publish scope.
- The branch may update package versions, changesets, release notes, benchmark evidence, and
  verification records.
- Publishing, tagging, and GitHub release creation stay out of scope for the branch and remain
  post-merge maintainer actions.

## Workflow Behavior

- Pull requests and `main` pushes must keep the CI matrix green on Node.js 22 and 24.
- The Release workflow runs verification on `main` pushes, but it does not publish packages.
- Publishing is only enabled through `workflow_dispatch` with `publish=true`.
- The publish command is `pnpm changeset publish`. The current Changesets CLI does not accept
  `--provenance`; npm trusted publishing is handled by the GitHub/npm OIDC configuration instead.

## Final Verification

Run these checks before tagging or manually dispatching publish:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm bundle:size
pnpm bench
```

MapLibre visual smoke is a separate manual gate because it requires Playwright browser
availability:

```sh
pnpm test:visual:maplibre
```

Record benchmark deltas in [benchmarks](./benchmarks.md) before creating a release candidate.

## Branch Verification

Recorded on 2026-07-14 for `release/1.0.0-readiness`:

- `pnpm verify` passed.
- `pnpm bench` passed.
- `pnpm test:visual:maplibre` passed.
- `npm pack --dry-run --json` passed for `@territory-kit/dataset`, `@territory-kit/core`,
  `@territory-kit/maplibre`, `@territory-kit/nestjs`, `@territory-kit/generators`, and
  `@territory-kit/cli` at `1.0.0`.
- Before applying `pnpm changeset version`, `pnpm changeset status --verbose` listed only the
  six public packages above for the `1.0.0` release plan.

## Post-Merge Readiness

Recorded on 2026-07-14 after PR #3 merged:

- PR #3, `Prepare TerritoryKit 1.0 release readiness`, merged into `main` at
  `27eb9a05e61cb9f8c2acae77dccdd35fa40bd7a3`.
- The `main` branch `CI` workflow passed for the merge commit.
- The `main` branch `Release` workflow passed for the merge commit with publish disabled.
- `gh pr list --state open` and `gh issue list --state open` returned no open blockers.
- No Git tags or GitHub Releases exist yet for `v1.0.0`.
- npm registry checks returned `E404` for the six public packages, so publishing has not
  happened yet.

## Final Checklist Closure Verification

Recorded on 2026-07-14 for `release/final-checklist-closure`:

- `pnpm format:check` passed.
- `pnpm verify` passed.
- `pnpm bench` passed.
- `pnpm test:visual:maplibre` passed.
- `npm pack --dry-run --json` passed for `@territory-kit/dataset`, `@territory-kit/core`,
  `@territory-kit/maplibre`, `@territory-kit/nestjs`, `@territory-kit/generators`, and
  `@territory-kit/cli` at `1.0.0`.

## Master Checklist Adoption

Recorded on 2026-07-14 for `checklist/master-adoption`:

- `docs/sprint-checklist.md` now contains the master sprint checklist.
- Remaining unchecked items are classified as repo-owned hardening, external release handoff, or
  post-1.0 roadmap work.
- The remaining repo-owned branches are `hardening/release-quality` and
  `hardening/runtime-integrations`.
- Branch verification passed: `pnpm format:check` and `pnpm verify`.

## Release Quality Verification

Recorded on 2026-07-14 for `hardening/release-quality`:

- `pnpm package:boundaries` is part of `pnpm verify`.
- `pnpm verify` passed.
- `pnpm bench` passed and refreshed dataset-load benchmark evidence.
- `pnpm bench:memory` passed and recorded deterministic 10K fixture heap deltas.
- The remaining repo-owned branch is `hardening/runtime-integrations`.

## Triage And Security

- New release blockers are tracked as GitHub issues or PR review comments and triaged before a
  release candidate is tagged.
- Public API changes require matching TypeScript types, docs, tests, and migration notes in the
  same PR.
- Security reports follow the private reporting path in the repository `SECURITY.md`. Do not open
  public issues for exploitable reports.

## Publish Checklist

Only dispatch publish after:

- CI is green on the release branch and after merge to `main`.
- `pnpm bench` output has been reviewed and documented.
- `CHANGELOG.md`, changesets, and migration docs are current.
- The npm package versions and generated package contents have been reviewed.

## External Release Handoff

These steps are maintainer actions after the final checklist PR merges:

1. Dispatch the `Release` workflow from GitHub Actions with `publish=true`.
2. Confirm the workflow completes successfully and runs `pnpm changeset publish`.
3. Verify npm shows version `1.0.0` for `@territory-kit/dataset`, `@territory-kit/core`,
   `@territory-kit/maplibre`, `@territory-kit/nestjs`, `@territory-kit/generators`, and
   `@territory-kit/cli`.
4. Create the `v1.0.0` tag and GitHub Release if maintainers want a GitHub release artifact.
5. Keep failed publish attempts private until any npm or credential issues are resolved.

Do not publish packages, create tags, or create GitHub Releases from a normal PR branch.
