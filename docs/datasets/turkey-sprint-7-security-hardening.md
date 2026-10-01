# Sprint 7 security hardening evidence

## Threat model

| Threat                 | Entry and boundary                   | Current mitigation      | Remaining gap and action                                                                                | Regression evidence                         |
| ---------------------- | ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Compromised registry   | JSON crossing from host into client  | Schema and SHA-256      | HTTPS, local opt-in, origin policy; pin manifest hash for authenticity                                  | Registry security tests                     |
| Corrupt host or shard  | Bytes crossing network into resolver | Checksum                | Size before parse, parent and semantics fail closed                                                     | Runtime delivery tests                      |
| Dispatch injection     | GitHub inputs entering Bash          | Workflow permissions    | Environment variables and input validation                                                              | Workflow security tests                     |
| Action compromise      | External action executing in CI      | Version tags            | Immutable action SHA pins; Dependabot updates                                                           | Workflow inspection                         |
| Oversized artifact     | HTTP or file into memory             | Post-read checks        | Stream ceiling and file stat; bounded decompression                                                     | Registry security tests                     |
| Stale manifest/cache   | Persisted bytes crossing versions    | Checksum and version    | Self-hash, optional trusted pin, cache identity includes manifest hash                                  | Runtime delivery tests                      |
| Accidental npm publish | Push to main                         | Changesets              | Explicit dispatch, main-only npm-production environment; add a second trusted reviewer for dual control | Release workflow and GitHub environment API |
| Path traversal         | Workflow input or artifact path      | Partial path validation | Realpath containment and encoded path rejection                                                         | Workflow and runtime tests                  |
| SSRF/redirect          | Registry URL to Node fetch           | None previously         | Block local/private addresses and validate redirects                                                    | Registry security tests                     |
| Dependency compromise  | Lockfile install                     | Frozen lockfile         | Ignore scripts, audit gate; high advisories remain                                                      | Current pnpm audit                          |
| Credential inclusion   | Reports or tarballs                  | Package files allowlist | Gitleaks history and relevant worktree scans found zero findings; package dry-run inspects tarballs     | Pending                                     |

## Findings and residual risks

The code changes block direct dispatch expression interpolation, narrow npm OIDC to the explicit publish job, and add URL, byte, manifest, shard and semantic validation. These controls require the tests and release gates to pass before merge.

The registry default URL policy changes behavior for HTTP, local-file and cross-origin callers. The Changeset marks the fixed family major; migrate by passing `allowHttp`, `allowFile` or `allowedOrigins` only for trusted sources.

The current dependency audit reports **0 production** advisories and **1 raw high total** advisory. pnpm's workspace auto-install of optional React Native peers previously resolved React Native 0.86.2, whose Metro 0.84.4 tooling depended on vulnerable `image-size@1.2.1`. The workspace now resolves React Native 0.87.1 and Metro 0.87.1, which no longer depends on `image-size`. The published TerritoryKit React Native tarball contains only its own build files and declares React Native and MapLibre as optional peers; this workspace resolution does not force consumer applications to upgrade React Native. Same-major transitive patches also removed the high `brace-expansion`, `js-yaml`, `nanoid`, and `postcss` findings. The remaining high finding is `GHSA-fx2h-pf6j-xcff` in Vite 5.4.21 through stable VitePress 1.6.4 documentation tooling. The advisory has no patched Vite 5 line. A reviewed, exact-match exception expires 2026-10-29 and is reevaluated on each release hardening run. It does not change the raw audit count and does not permit any other high finding.

The exception is restricted to the present Linux CI/release path, static docs builds, and a docs dev script with no network host flag. It fails if the VitePress version path or Vite 5 finding changes, a docs dev server is launched in CI/release, or the docs server is configured with `--host` or `server.host`. A stable patched VitePress path, a Vite 5 backport, Windows or network-exposed docs development, or changed docs deployment requires immediate removal or review. The tracked report identifies `auditedCodeHead` and `auditedTreeHash` as the committed source/dependency snapshot audited; its later evidence commit necessarily has a different SHA. `lockfileSha256` identifies the audited lockfile.

GitHub repository ruleset **24299690** (`Protect main`) is active on `refs/heads/main`. The ruleset and effective main rules API confirm required pull requests, exact GitHub Actions checks `Node 22`, `Node 24`, and `Live PostGIS validation`, up-to-date branch checks, conversation resolution, blocked force pushes, restricted deletion, and no bypass actors. The pre-governance PR head `c40d49a` passed all three checks; the evidence commit requires its own CI run. Only `mberatkaya` has repository write/maintain/admin access, so required approvals are **0** and CODEOWNER approval is not required; this is the single-maintainer approval exception that keeps owner-authored PRs mergeable after the other gates pass. Stale-review dismissal and latest-push approval are off because neither adds protection with zero required approvals. The CODEOWNERS file still identifies the owner for workflow, release script, registry, and runtime changes.

The `npm-production` environment (ID **23192095401**) exists and its only custom deployment branch policy is the branch `main`; no tag policy is configured. The release workflow uses this exact environment and publishes only after `workflow_dispatch` with `publish=true`, no pending Changesets, and `main`, with `id-token: write` scoped to the publish job. A required production reviewer is **not configured**: GitHub lists no second trusted maintainer, and selecting the owner would not provide two-person approval. To establish dual control, add a second trusted maintainer as the environment's required reviewer and enable prevent-self-review. No package was published.

The Node transport checks resolved DNS addresses before `fetch`, but DNS rebinding between lookup and connection remains possible; highly sensitive servers should also enforce egress firewall rules. A caller supplied transport has its own trust responsibility. A checksum-only manifest is not authenticated without a trusted pinned hash or distribution channel.

## Source updates

Source-lock diff is stage one: it reports added, removed, checksum, version and metadata changes, and province or national rebuild scope. `kinds[]` retains multiple changes for one source. Stage two requires the existing `migration-plan.json`, replacement map and quality report produced by candidate rebuild; a source lock alone cannot reveal exact changed ADM2 or territory geometry.

## Tests and release

Run `pnpm security:test`, package tests, `pnpm verify`, `pnpm release:check`, `pnpm release:hardening`, registry smoke tests, strict Turkey V2 validation and MVT validation before review. npm publication and dataset hosting are separate operations and were not performed by this hardening work.

Gitleaks scanned Git history and the changed source, workflow, documentation and report directories with redaction enabled. It reported zero findings. This does not prove that external systems contain no exposed credentials.

After rebuilding a candidate, `tr v2 national source-diff --previous-lock <file> --candidate-lock <file> --migration-plan <candidate/migration-plan.json> --previous-quality <file> --candidate-quality <file>` includes a `postRebuildImpact` summary. It derives exact affected parent and territory IDs from the existing migration plan and compares quality fields. The stage-one source-lock report remains available without these optional files.

The hardened resolver was exercised against all 973 district shards in the validated Sprint 6 candidate with the regenerated, pinned manifest: 20,392 ADM3 features resolved and no checksum, byte-size, parent or semantic failures. Canonical geometry was not regenerated or edited.
