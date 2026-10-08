# Validation results

Base c6c8c4638228a2c14c98f6cb37af95c23f5fdf7a, Node v24.14.0, pnpm 11.7.0. Repository engines require Node >=22/pnpm >=11; CI runs Node 22/24. Existing scripts were inspected before execution. Local logs remain under ignored `.territory/quality-source-audit/`.

Scoped generator tests: 11 files / 122 tests passed, 1.55 s Vitest duration. Scoped dataset tests: 2 files / 17 tests passed, 0.228 s. Scoped CLI tests: 3 files / 8 tests passed, 1.534 s process time. **Local audit regression snapshot (2026-10-08, pre–parent-registry expansion):** `node --test scripts/tr-adm3-quality-source-audit.test.mjs` recorded **5** passing cases inside the first `pnpm verify` on this branch (`verifyTests.nodeAuditPassing` in [validation-executions.json](validation-executions.json)); that count is historical evidence and was not retroactively rewritten. **CI-verified audit regression matrix (PR #100 head `87b010d`, Actions run [37828925320](https://github.com/mberatkaya/TerritoryKit/actions/runs/37828925320)):** `pnpm data:tr:adm3:audit:test` executed **13** Node tests (original five plus registry parent inventory, hierarchy lookup-ref alignment, null-geometry guard, checksum fallback, polygon preference, and related cases) as part of `pnpm verify` on Node 24; Node 22 ran `pnpm release:check` only in that workflow split. Exact commands, process runtimes where measured, log SHA-256 and exit codes are in [validation-executions.json](validation-executions.json).

National CLI publish-ready validation completed with exit 0 in 7.186 s; inventory/completeness validation does not regenerate geometry or rerun all historic quality predicates. Existing full geometry QA passed on ten current Istanbul districts. Fresh Fatih/Eyüpsultan/Adalar runs matched all 63 canonical child geometries; the repeat matched seven deterministic fields for all three districts. Accepted low confidence remains low confidence.

The first evidence export was interrupted (exit 130) after choosing a quadratic ring-canonicalization helper for large source geometry. The reporting code was corrected to use existing stable serialized geometry hashes and rerun successfully. This was a reporting implementation issue, not a generation failure. An initial missing-artifact export exposed a missing province-code fallback; the exporter and an end-to-end 973-parent regression were added and the rerun passed. No earlier failure is relabelled PASS.

## Reproduction

Run from the repository root after restoring the exact ignored artifacts, using Node 24 and pnpm 11.7.0:

```sh
pnpm build
pnpm data:tr:adm3:audit:test
pnpm data:tr:adm3:audit
node --max-old-space-size=8192 scripts/tr-adm3-audit-evidence.mjs
node --max-old-space-size=8192 packages/cli/dist/index.mjs tr v2 national validate --output .territory/sprint-6/final/candidate --publish-ready
ISTANBUL_QA_DISTRICT='Fatih,Eyüpsultan,Prince Islands' ISTANBUL_QA_ARTIFACT_ROOT=.territory/quality-source-audit/istanbul-replay ISTANBUL_QA_REPORT=reports/tr-adm3/audit/istanbul-replay.json node --max-old-space-size=8192 scripts/sprint-6-istanbul-qa.mjs
ISTANBUL_QA_DISTRICT='Fatih,Eyüpsultan,Prince Islands' ISTANBUL_QA_ARTIFACT_ROOT=.territory/quality-source-audit/istanbul-replay-second ISTANBUL_QA_REPORT=.territory/quality-source-audit/istanbul-replay-second.json node --max-old-space-size=8192 scripts/sprint-6-istanbul-qa.mjs
pnpm exec prettier --write reports/tr-adm3/audit
pnpm verify
```

No nationwide rebuild was executed. The coverage command accepts `--artifact-root`, `--parent-dataset`, `--parent-registry` (defaults to `datasets/registry/tr-adm3-district-fallbacks.json` for metadata-only 973/81 parent enumeration when polygon bytes are absent or unusable) and `--output`; missing national polygons leave measurements null across all 973 canonical parents. Registry-derived ADM1 ids are `METADATA_LOOKUP_REF` values aligned to `reports/tr-v2-national/hierarchy-report.json`; they are not authoritative production identities without verified ADM1/ADM2 polygon bytes. Standalone evidence export requires the national candidate, official imported artifact/source lock, four exact cached municipal files, locked PBF, saved smart/network reports and local PR #94 comparison output `.territory/rushclaim-adm3-visibility-20261008`. It fails if those required artifacts are unavailable. Downloading a changing latest source is not a prerequisite shortcut.

In a clean checkout, the new regression tests and null-coverage export are reproducible after build. Polygon measurements/replays require exact cached external artifacts (not committed). The saved matrix is a local candidate audit snapshot, not a portable nationwide geometry package. Regeneration records the executing Git HEAD, so evidence commit fields legitimately change. Prettier normalizes report presentation after generation.

Checksums and artifact scopes: [artifact-evidence.json](artifact-evidence.json), [official-source-fidelity.json](official-source-fidelity.json), [Kadıköy acquisition](kadikoy-acquisition.json). National source lock and full/ADM3 geometry hashes independently match current bodies. Three replay bundles are checked by the existing barrier reader. All remaining nationwide barrier bundles and the raw parent archive have not been independently validated or rebuilt.

Historical main CI and PR #94 remote checks appear in [git-context.json](git-context.json) and are distinct from these local executions. This sprint does not claim a new live PostGIS or device/mobile visual test, nor a full national rerun. Source licensing freshness failures, incomplete Kadıköy companions, parent attribution mismatch and absent mobile/hosted observations remain explicit blockers.

## Completed full verification

`pnpm verify` completed successfully, exit **0**, **41.765 s**. Format check, security tests, lint, package boundaries, typecheck, workspace tests, build, release benchmark tests, OSM multipolygon native ESM smoke, bundle size, ADM3 artifact policy and the new audit regressions all completed. Workspace Vitest: **663 passed, 3 skipped, 0 failed**; Node tests: **10 security + 3 release benchmark + 5 audit passed**, total **681 passing checks/tests**, without adding the earlier scoped passes a second time. Three geometry-repair tests are intentionally skipped and are not PASS claims. No test tasks used cached results; 14 dependency/build tasks were cached in Turbo. This is one Node 24 run, not a newly executed Node 22 matrix.

| Execution                                              | Exit |            Runtime | Result                                                                                 |
| ------------------------------------------------------ | ---: | -----------------: | -------------------------------------------------------------------------------------- |
| Coverage export                                        |    0 |            3.004 s | 973 rows; 3,343 official / 0 OSM admin / 17,049 generated; locked ADM3 bytes match     |
| Full artifact/fidelity/10-district/MVT evidence export |    0 |           10.223 s | All indexed old tiles decoded and checksum checked; deliberate layer mismatch detected |
| National publish-ready inventory validation            |    0 |            7.186 s | Completeness and artifact inventory checks; no geometry regeneration                   |
| First three-district replay                            |    0 |           19.913 s | Fatih high / Eyüpsultan low / Adalar low; geometry matches current canonical sets      |
| Three-district repeat                                  |    0 | See execution JSON | Zero differences across seven deterministic fields                                     |
| Full repository verification                           |    0 |           41.765 s | 681 passing tests/checks, 3 skipped                                                    |

An initial inline geometry-set comparison also failed because the existing QA slug for Prince Islands is `prince-slands`, then the corrected comparison completed. Reporting failures and corrections are retained in execution evidence. Audit reports were finalized after verification; final formatting and diff checks are recorded separately.
