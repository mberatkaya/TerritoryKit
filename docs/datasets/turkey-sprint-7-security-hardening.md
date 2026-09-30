# Sprint 7 security hardening evidence

## Threat model

| Threat                 | Entry and boundary                   | Current mitigation      | Remaining gap and action                                                                            | Regression evidence        |
| ---------------------- | ------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------- | -------------------------- |
| Compromised registry   | JSON crossing from host into client  | Schema and SHA-256      | HTTPS, local opt-in, origin policy; pin manifest hash for authenticity                              | Registry security tests    |
| Corrupt host or shard  | Bytes crossing network into resolver | Checksum                | Size before parse, parent and semantics fail closed                                                 | Runtime delivery tests     |
| Dispatch injection     | GitHub inputs entering Bash          | Workflow permissions    | Environment variables and input validation                                                          | Workflow security tests    |
| Action compromise      | External action executing in CI      | Version tags            | Immutable action SHA pins; Dependabot updates                                                       | Workflow inspection        |
| Oversized artifact     | HTTP or file into memory             | Post-read checks        | Stream ceiling and file stat; bounded decompression                                                 | Registry security tests    |
| Stale manifest/cache   | Persisted bytes crossing versions    | Checksum and version    | Self-hash, optional trusted pin, cache identity includes manifest hash                              | Runtime delivery tests     |
| Accidental npm publish | Push to main                         | Changesets              | Explicit dispatch and npm-production environment                                                    | Release workflow audit     |
| Path traversal         | Workflow input or artifact path      | Partial path validation | Realpath containment and encoded path rejection                                                     | Workflow and runtime tests |
| SSRF/redirect          | Registry URL to Node fetch           | None previously         | Block local/private addresses and validate redirects                                                | Registry security tests    |
| Dependency compromise  | Lockfile install                     | Frozen lockfile         | Ignore scripts, audit gate; high advisories remain                                                  | Current pnpm audit         |
| Credential inclusion   | Reports or tarballs                  | Package files allowlist | Gitleaks history and relevant worktree scans found zero findings; package dry-run inspects tarballs | Pending                    |

## Findings and residual risks

The code changes block direct dispatch expression interpolation, narrow npm OIDC to the explicit publish job, and add URL, byte, manifest, shard and semantic validation. These controls require the tests and release gates to pass before merge.

The registry default URL policy changes behavior for HTTP, local-file and cross-origin callers. The Changeset marks the fixed family major; migrate by passing `allowHttp`, `allowFile` or `allowedOrigins` only for trusted sources.

The current dependency audit reports **2 high production** advisories in `image-size` through React Native/Metro and **13 high total** advisories. The patched `image-size` release is a major-version jump, so compatibility must be evaluated before changing the lockfile. The release hardening gate now fails while these are unresolved. No exception has been approved.

GitHub currently reports no main ruleset and no legacy branch protection. The `npm-production` environment approval policy has not been verified. Maintainers must enable main pull request review, required CI, conversation resolution, force-push and deletion protection, and required reviewers for `npm-production`.

The Node transport checks resolved DNS addresses before `fetch`, but DNS rebinding between lookup and connection remains possible; highly sensitive servers should also enforce egress firewall rules. A caller supplied transport has its own trust responsibility. A checksum-only manifest is not authenticated without a trusted pinned hash or distribution channel.

## Source updates

Source-lock diff is stage one: it reports added, removed, checksum, version and metadata changes, and province or national rebuild scope. `kinds[]` retains multiple changes for one source. Stage two requires the existing `migration-plan.json`, replacement map and quality report produced by candidate rebuild; a source lock alone cannot reveal exact changed ADM2 or territory geometry.

## Tests and release

Run `pnpm security:test`, package tests, `pnpm verify`, `pnpm release:check`, `pnpm release:hardening`, registry smoke tests, strict Turkey V2 validation and MVT validation before review. npm publication and dataset hosting are separate operations and were not performed by this hardening work.

Gitleaks scanned Git history and the changed source, workflow, documentation and report directories with redaction enabled. It reported zero findings. This does not prove that external systems contain no exposed credentials.

After rebuilding a candidate, `tr v2 national source-diff --previous-lock <file> --candidate-lock <file> --migration-plan <candidate/migration-plan.json> --previous-quality <file> --candidate-quality <file>` includes a `postRebuildImpact` summary. It derives exact affected parent and territory IDs from the existing migration plan and compares quality fields. The stage-one source-lock report remains available without these optional files.

The hardened resolver was exercised against all 973 district shards in the validated Sprint 6 candidate with the regenerated, pinned manifest: 20,392 ADM3 features resolved and no checksum, byte-size, parent or semantic failures. Canonical geometry was not regenerated or edited.
