# Release Readiness

This page is the final verification gate for Sprint 9-10 release hardening. It prepares the
repository for a stable release without publishing packages automatically.

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
