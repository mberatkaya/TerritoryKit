# Sprint Completion Checklist

This checklist records the repo-owned work needed to complete the TerritoryKit 1.0 readiness
track. Items are checked only when code, tests, docs, examples, release evidence, and package
boundaries are represented in the repository.

## Completed Sprint Ledger

- [x] Sprint 1 / `0.1.0-alpha.1`: Dataset validation reports stale bbox,
      out-of-bounds centers, reciprocal-neighbor warnings, and GeoJSON property repair hints.
- [x] Sprint 2 / `0.1.0`: Core lookup rejects invalid coordinates and levels without throwing
      from lookup APIs.
- [x] Sprint 3 / `0.2.0-alpha.1`: Spatial-index queries normalize ordered bounds and keep
      benchmark coverage in `docs/benchmarks.md`.
- [x] Sprint 4 / `0.2.0`: Hierarchy errors include repair suggestions, and logical adjacency
      ignores unknown-zone connections.
- [x] Sprint 5 / `0.3.0`: Viewport query and zoom-selected visible zones keep deterministic
      cache keys and invalid-bound fallbacks.
- [x] Sprint 6 / `0.4.0`: MapLibre source data includes initial state, and adapter
      attach/detach is idempotent.
- [x] Sprint 7 / `0.5.0`: NestJS validates query/body input before repository calls and maps
      PostGIS rows into TerritoryKit zones.
- [x] Sprint 8 / `0.6.0`: Generator options are validated; CLI keeps JSON-first output and
      deterministic import geometry hashes.
- [x] Sprint 9 / `0.9.0-rc.1`: Docs, changelog, risk register, and benchmark notes are
      synchronized; `pnpm verify` and `pnpm bench` pass.
- [x] Sprint 10 / `1.0.0`: Public API is frozen, public package versions are `1.0.0`, and
      release verification evidence is recorded.

## Completed Release Gates

- [x] Release readiness branch `release/1.0.0-readiness` was merged through PR #3.
- [x] Public packages prepared at `1.0.0`: `@territory-kit/dataset`, `@territory-kit/core`,
      `@territory-kit/maplibre`, `@territory-kit/nestjs`, `@territory-kit/generators`, and
      `@territory-kit/cli`.
- [x] Public API surface is frozen for the readiness branch; no feature APIs were added after
      the freeze.
- [x] `territory-schema@1` remains unchanged for the hardening track.
- [x] README, API docs, CLI docs, roadmap, risk register, changelog, migration guide, and
      benchmark notes agree for `1.0.0`.
- [x] Branch verification passed on 2026-07-14: `pnpm verify`, `pnpm bench`,
      `pnpm test:visual:maplibre`, and public package `npm pack --dry-run --json` checks.
- [x] Main-branch CI and Release workflows passed after PR #3 merged into `main`.
- [x] There are no open GitHub PRs or issues blocking the release-readiness handoff.

## External Handoff

These actions are intentionally not checked here because they happen outside a normal PR:

- Dispatch the Release workflow with `publish=true` when maintainers are ready to publish.
- Verify npm registry versions for the six public packages after publish completes.
- Create the `v1.0.0` tag and GitHub Release if the project wants a GitHub release artifact.
