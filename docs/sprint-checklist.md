# Remaining Sprint Checklist

This checklist tracks the implementation branch for roadmap items that were not marked
complete after Sprint 0. The working order is intentionally dependency-first:
dataset, core, performance, tooling, adapters, backend, docs, then release readiness.

| Order | Sprint    | Version         | Status         | Branch evidence                                                                                                                |
| ----- | --------- | --------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Sprint 1  | `0.1.0-alpha.1` | Hardened       | Dataset validation reports stale bbox, out-of-bounds centers, reciprocal-neighbor warnings, and GeoJSON property repair hints. |
| 2     | Sprint 2  | `0.1.0`         | Hardened       | Core lookup rejects invalid coordinates and levels without throwing from lookup APIs.                                          |
| 3     | Sprint 3  | `0.2.0-alpha.1` | Hardened       | Spatial-index queries normalize ordered bounds and keep benchmark coverage in `docs/benchmarks.md`.                            |
| 4     | Sprint 4  | `0.2.0`         | Hardened       | Hierarchy errors include repair suggestions; logical adjacency ignores unknown-zone connections.                               |
| 5     | Sprint 5  | `0.3.0`         | Hardened       | Viewport query and zoom-selected visible zones keep deterministic cache keys and invalid-bound fallbacks.                      |
| 6     | Sprint 8  | `0.6.0`         | Hardened       | Generator options are validated; CLI keeps JSON-first output and deterministic import geometry hashes.                         |
| 7     | Sprint 6  | `0.4.0`         | Hardened       | MapLibre source data includes initial state and adapter attach/detach is idempotent.                                           |
| 8     | Sprint 7  | `0.5.0`         | Hardened       | NestJS validates query/body input before repository calls and maps PostGIS rows into TerritoryKit zones.                       |
| 9     | Sprint 9  | `0.9.0-rc.1`    | Verified       | Docs, changelog, risk register, and benchmark notes are synchronized; `pnpm verify` and `pnpm bench` pass.                     |
| 10    | Sprint 10 | `1.0.0`         | Release branch | Public API freeze, package versioning, release verification, and post-merge Release workflow gates are listed below.           |

## Release Gates

- Sprint 10 branch target: `release/1.0.0-readiness`.
- Keep the current public API surface frozen; do not add new feature APIs on this branch.
- Last branch verification: `pnpm verify` and `pnpm bench` passed on 2026-07-14.
- Run `pnpm verify` on the branch before opening or merging the PR.
- Run `pnpm bench` before marking Sprint 9 complete; update `docs/benchmarks.md` when benchmark numbers change materially.
- Keep `territory-schema@1` unchanged for this hardening branch.
- Confirm README, API docs, CLI docs, roadmap, risk register, changelog, and migration guide agree before `1.0.0`.
- Do not run package publish from this branch; Release workflow remains a main-branch post-merge action.
