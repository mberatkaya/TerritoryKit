# AI engineering handoff

Persistent context for Cursor Agent sessions (any model). This directory is the durable project memory — not a substitute for reading code when implementing.

## Read order (new session)

1. `.cursor/rules/` — especially `00-territorykit-core.mdc` (always applied).
2. This file.
3. `PROJECT_STATE.md` — verified snapshot of `main` and recent merges (check timestamps).
4. `CURRENT_MILESTONE.md` — active milestone and acceptance criteria.
5. `NEXT_ACTIONS.md` — prioritized executable backlog.
6. `ARCHITECTURE.md` — package map and data pipeline pointers.
7. `DECISIONS.md` — accepted vs open architectural decisions.

Then: `git fetch origin main`, `git status`, `git log -1 origin/main`, and inspect only code paths relevant to the task.

## Verified evidence vs historical context

| Kind                  | Where                              | Use                                             |
| --------------------- | ---------------------------------- | ----------------------------------------------- |
| Merged code on `main` | GitHub `main`, local `origin/main` | Current implementation truth                    |
| Audit reports         | `reports/tr-adm3/audit/`           | Evidence at audit time; scope labels matter     |
| Local candidates      | `.territory/` (often gitignored)   | Not production unless separately promoted       |
| Registry metadata     | `datasets/registry/`               | Registration ≠ downloaded geometry              |
| Handoff snapshots     | `PROJECT_STATE.md`                 | Point-in-time; re-fetch GitHub before decisions |

Do not promote rc.7 or audit metrics to “production deployed” without hosted/consumer verification.

## Updating handoff records

Update when engineering state meaningfully changes (milestone completed, blocker resolved, major merge on `main`):

- `PROJECT_STATE.md` — new observation timestamp and commit SHA when useful (avoid noise commits only to bump SHA).
- `CURRENT_MILESTONE.md` / `NEXT_ACTIONS.md` — status and next tasks.
- `DECISIONS.md` — new accepted decisions with evidence links.

## Resuming interrupted work

1. Identify branch and last commit from the prior session notes or `git reflog`.
2. Re-read `NEXT_ACTIONS.md` for the task marked in progress.
3. Re-run the minimum verification for that task (not necessarily full `pnpm verify`).
4. On completion: update handoff files, open/update PR, record CI URL.

## Session completion checklist

- Objective completed or blocked with explicit reason.
- Branch, commit SHA, PR link recorded (in PR body or handoff).
- Commands actually executed listed with pass/fail.
- Unresolved errors and external blockers documented.
- Facts separated from proposals.

## Related repository docs

- `CONTRIBUTING.md`, `docs/source-pipeline.md`, `docs/production-checklist.md`
- ADRs: `adr/`, `docs/adr/`
- Turkey ADM3 audit: `reports/tr-adm3/audit/current-state.md`
