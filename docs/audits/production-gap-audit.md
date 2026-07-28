# Production Gap Audit

Audit date: 2026-07-28  
Branch: `audit/production-gap-roadmap`  
Base: `main` at `23f29d0` (`Merge pull request #27 from mberatkaya/perf/turkey-full-build-mvt`)

This audit checks the repository state, documentation claims, package publishability,
generated dataset policy, and remaining production gaps after the post-1.1 work
already merged to `main`. It intentionally does not implement production features.

## Method

- Pulled `main` with `git pull --ff-only`; it was already up to date.
- Created `audit/production-gap-roadmap`.
- Inspected README, package manifests, workspace layout, packages, examples,
  datasets, scripts, docs, ADRs, GitHub Actions, and changesets.
- Ran the requested release-readiness commands and additional package/security
  checks.
- Compared documentation claims against code, generated reports, source locks,
  package dry-runs, and npm registry state.

## Command Results

| Command                                    | Result  | Evidence                                                                                                          |
| ------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                             | passed  | Lockfile up to date; pnpm 11.7.0 reported no install changes.                                                     |
| `pnpm format:check`                        | passed  | Prettier check completed.                                                                                         |
| `pnpm lint`                                | passed  | Turbo reported 20 successful tasks.                                                                               |
| `pnpm package:boundaries`                  | passed  | Package dependency boundary script completed.                                                                     |
| `pnpm typecheck`                           | passed  | Turbo reported 30 successful tasks.                                                                               |
| `pnpm test`                                | passed  | Core, dataset, runtime, generators, CLI, adapters, data loaders, and example test commands completed.             |
| `pnpm build`                               | passed  | All build tasks completed; Vite emitted non-failing chunk-size warnings for MapLibre examples.                    |
| `pnpm bundle:size`                         | passed  | Bundle budget check completed.                                                                                    |
| `pnpm verify`                              | passed  | Includes format, lint, package boundaries, typecheck, tests, build, bundle size, and Turkey ADM3 artifact policy. |
| `pnpm release:check`                       | passed  | Release check completed package dry-run, docs links, smoke tests, benchmarks, and registry checks.                |
| `pnpm package:dry-run`                     | passed  | 14 public packages packed successfully in dry-run mode.                                                           |
| `npm view @territory-kit/* version`        | partial | Six packages are published at `1.0.0`; eight public workspace packages are not published.                         |
| `pnpm audit --prod --audit-level moderate` | passed  | Production dependency audit found no known vulnerabilities.                                                       |
| `pnpm audit --audit-level moderate`        | failed  | Dev dependency audit reported 6 vulnerabilities: 3 high, 3 moderate.                                              |

### Failed Command Root Causes

| Command                             | Root cause                                                                               | Files or packages                                                                                                                                | Impact                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm audit --audit-level moderate` | Vulnerable dev dependency chain for `vite`, `postcss`, `brace-expansion`, and `esbuild`. | Lockfile paths through `vitepress@1.6.4`, `@vitejs/plugin-vue@5.2.4`, `vite@5.4.21`, `eslint@10.7.0`, `minimatch@10.2.5`, and `typedoc@0.28.20`. | Does not affect `pnpm audit --prod`, but blocks a clean supply-chain posture for development, docs, examples, and CI tooling. |

## Repository Inventory

Workspace packages:

- `packages/adapter-core`
- `packages/cli`
- `packages/core`
- `packages/data-de`
- `packages/data-id`
- `packages/data-jp`
- `packages/data-tr`
- `packages/data-us`
- `packages/dataset`
- `packages/generators`
- `packages/maplibre`
- `packages/nestjs`
- `packages/registry`
- `packages/runtime`
- `packages/shared-testkit`

Examples:

- `examples/nestjs-postgis`
- `examples/node-basic`
- `examples/web-maplibre`
- `examples/web-maplibre-turkey`

No package or example exists for Leaflet, OpenLayers, React Native, game,
dataset diff, migration, hosted registry deployment, CDN promotion, or rollback
tooling.

## Published Package Reality

`pnpm package:dry-run` verifies that the current workspace packages are packable,
but npm registry state does not match the local post-1.1 package line.

Published on npm:

- `@territory-kit/cli`: `1.0.0`
- `@territory-kit/core`: `1.0.0`
- `@territory-kit/dataset`: `1.0.0`
- `@territory-kit/generators`: `1.0.0`
- `@territory-kit/maplibre`: `1.0.0`
- `@territory-kit/nestjs`: `1.0.0`

Not found on npm:

- `@territory-kit/adapter-core`
- `@territory-kit/registry`
- `@territory-kit/runtime`
- `@territory-kit/data-de`
- `@territory-kit/data-id`
- `@territory-kit/data-jp`
- `@territory-kit/data-tr`
- `@territory-kit/data-us`

The repository is packable, but it is not currently published as the documented
1.1 package line. Release/publishing remains a production blocker until npm
state, changesets, tags, and documentation are reconciled.

## Geometry Artifact Reality

Tracked geometry artifacts in Git:

- `datasets/fatih-example/dataset.json`
- `datasets/istanbul-example/dataset.json`
- `datasets/turkey-example/dataset.json`
- `datasets/generated/countries/TR/levels/ADM3/**`

Tracked Turkey ADM3 pilot artifact facts:

- `manifest.json`: dataset `territory-kit-tr-adm3-gaziantep-pilot`, coverage
  status `partial`, `publishReady: false`.
- Feature counts: ADM0 `1`, ADM1 `1`, ADM2 `9`, ADM3 `786`.
- `sources.lock.json`: Gaziantep KML, CC BY 4.0, SHA-256
  `f145ae9edd2db7a341634e14d59060a535258461794d361c3f49bdec2bcbfa9a`.
- Artifact policy check: `47,328,263` bytes, `184` files, `155` MVT tiles,
  largest tile `27,168` bytes, policy result `ok: true`.
- Production quality report: `productionReady: false`, with unresolved full
  quality issues.

Not tracked in Git:

- `dist/**`
- generated country artifacts outside the committed Turkey ADM3 pilot
- Turkey ADM0-ADM2 full-build output artifacts
- hosted registry manifests
- CDN bundles

Large local generated artifacts may exist in a developer checkout under ignored
paths such as `dist/` and `datasets/generated/`, but those are not repository
deliverables. The current policy keeps large production geometry out of Git and
expects generated CI/release artifacts or a hosted artifact channel.

## Audit Matrix

| Özellik                                 | Mevcut durum   | Kanıt                                                                                                                                                                                                        | Eksik parça                                                                                                                    | Teknik risk                                                                                                           | Veri veya lisans riski                                                                           | Bağımlılıklar                                                     | Önerilen sprint | Kabul kriteri                                                                                                             | Tahmini değişecek paketler                                                                 | Breaking change ihtimali |
| --------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------ |
| Hosted production dataset registry      | missing        | `docs/registry-hosting.md` explains how to host a registry, but no production URL, deploy workflow, environment, or published manifest exists.                                                               | Production registry endpoint, promotion workflow, immutable release manifests, monitoring, rollback pointer.                   | Clients cannot reliably discover production datasets without a user-supplied registry.                                | Registry may point to data whose redistribution terms are not validated at publish time.         | Artifact publishing, checksum manifests, release governance.      | S1              | A public immutable registry manifest and a promoted `latest` endpoint are deployed from CI with checksum validation.      | `packages/registry`, `packages/cli`, `scripts`, `.github/workflows`, `docs`                | low                      |
| Artifact publishing and CDN process     | missing        | `scripts/generate-dataset-registry.mjs` builds local registry JSON; Turkey build workflow uploads GitHub Actions artifacts only.                                                                             | CDN upload, immutable object layout, metadata signing/checksums, promotion/rollback procedure.                                 | CI artifacts expire or are not suitable for production clients.                                                       | Public redistribution must be checked before CDN upload.                                         | Hosted registry, source locks, license metadata.                  | S1              | A release workflow publishes approved artifacts to a stable object path and writes verifiable manifests.                  | `scripts`, `.github/workflows`, `packages/registry`, `docs`                                | low                      |
| Registry manifest versioning            | partial        | `docs/dataset-registry.md` defines `registryVersion: "1"`; registry client validates manifest shape and semver artifact selection.                                                                           | Hosted manifest promotion history, compatibility policy for registry schema changes, rollback aliasing.                        | Future schema changes could strand older clients if compatibility is not enforced.                                    | Wrong manifest metadata can expose unapproved datasets.                                          | Registry hosting, release governance.                             | S1              | Registry schema compatibility tests cover v1 clients and promoted manifests include immutable version metadata.           | `packages/registry`, `packages/cli`, `scripts`, `docs`                                     | medium                   |
| Dataset checksum verification           | implemented    | `packages/registry/src/client.ts`, `packages/registry/src/node.ts`, and `packages/core/src/country-loader.ts` verify SHA-256/size metadata; tests cover mismatch failure.                                    | Signed manifests are still absent.                                                                                             | Unsigned checksums protect corruption but not a compromised manifest origin.                                          | Checksum does not validate licensing by itself.                                                  | Hosted registry, artifact publish workflow.                       | S1              | Loader and registry install paths reject modified artifacts and publish workflow emits checksum manifests.                | `packages/registry`, `packages/core`, `packages/cli`, `scripts`                            | low                      |
| Turkey ADM0-ADM2 source/build coverage  | partial        | HDX COD-AB source resolver locks ADM0, ADM1, ADM2 with SHA-256 metadata; Turkey workflow defaults to ADM0-ADM2; local build report shows 1,055 features and zero build errors.                               | Generated ADM0-ADM2 artifacts are not committed, hosted, or discoverable through a production registry.                        | Rebuild-only availability makes client adoption fragile until artifact publishing exists.                             | HDX COD-AB license and attribution must be preserved in hosted metadata.                         | Artifact publishing, hosted registry, license review.             | S1              | CI can rebuild ADM0-ADM2 from source locks and publish approved artifacts with checksums and attribution.                 | `packages/generators`, `packages/data-tr`, `scripts`, `.github/workflows`, `docs`          | low                      |
| Turkey ADM3 ingestion infrastructure    | partial        | `scripts/data-tr-adm3.mjs`, committed Gaziantep ADM3 pilot artifacts, source evaluation, source metadata, source lock, and policy reports exist.                                                             | Nationwide source abstraction, merge/conflict handling across municipalities, production quality pass, publish-ready manifest. | Municipality-by-municipality inputs may create duplicate IDs, topology inconsistencies, and unstable parent mappings. | Current pilot uses CC BY 4.0; nationwide sources may have incompatible or missing licenses.      | Source expansion, stable IDs, quality gates, artifact publishing. | S2              | ADM3 ingestion accepts multiple approved source manifests and produces deterministic artifacts plus quality reports.      | `packages/generators`, `packages/dataset`, `scripts`, `datasets/registry`, `docs`          | medium                   |
| Turkey nationwide neighborhood coverage | blocked        | Turkey ADM3 manifest is Gaziantep-only and `publishReady: false`; source resolver says HDX COD-AB lacks nationwide ADM3/ADM4 metadata.                                                                       | Approved nationwide or federated ADM3 polygon source with redistribution rights.                                               | Attempting nationwide coverage without source certainty can produce incomplete or legally unsafe data.                | Main blocker is authoritative source availability and license approval.                          | Source research, legal/license review, ADM3 ingestion.            | S3              | Coverage report lists all expected ADM3 parents or explicitly approved gaps with source/license proof.                    | `packages/data-tr`, `packages/generators`, `datasets/registry`, `docs`                     | medium                   |
| Leaflet adapter                         | future roadmap | README marks Leaflet adapter as future; no `packages/leaflet` or example exists.                                                                                                                             | Package API, renderer lifecycle, tests, example, docs.                                                                         | Divergent adapter lifecycle from MapLibre/runtime could fragment integrations.                                        | No direct data risk unless bundled datasets are added.                                           | Adapter-core/runtime stabilization, hosted registry.              | S4              | Leaflet package renders loaded territories and passes shared adapter contract tests.                                      | `packages/adapter-core`, `packages/runtime`, new `packages/leaflet`, examples, docs        | low                      |
| OpenLayers adapter                      | future roadmap | README marks OpenLayers adapter as future; no package or example exists.                                                                                                                                     | Package API, vector/tile layer integration, tests, example, docs.                                                              | OpenLayers projection/source abstractions need careful parity with runtime contracts.                                 | No direct data risk unless bundled datasets are added.                                           | Adapter-core/runtime stabilization, hosted registry.              | S4              | OpenLayers package renders loaded territories and passes shared adapter contract tests.                                   | `packages/adapter-core`, `packages/runtime`, new `packages/openlayers`, examples, docs     | low                      |
| React Native adapter                    | future roadmap | README marks React Native/mobile SDK as future; no package exists.                                                                                                                                           | Native-friendly loader, cache/storage bridge, map provider adapter, mobile tests.                                              | Mobile storage, bundle size, offline cache eviction, and network interruption semantics are unresolved.               | Offline mobile datasets need explicit licensing and redistribution terms.                        | Offline loading, hosted registry, adapter-core/runtime.           | S5              | React Native package loads a registry dataset offline and renders through a documented provider path.                     | `packages/adapter-core`, `packages/runtime`, `packages/registry`, new mobile package, docs | medium                   |
| Dataset diff and migration tools        | future roadmap | `docs/schema-migrations.md` defines policy, but no public diff/migration CLI or package exists.                                                                                                              | Dataset-to-dataset diff, stable ID continuity report, migration manifest, breaking-change detector.                            | Dataset upgrades may silently change IDs, parents, or coverage.                                                       | Source changes can invalidate redistribution assumptions if not carried into migration metadata. | Stable IDs, registry versioning, hosted artifacts.                | S6              | CLI reports added/removed/changed zones and emits migration metadata for a registry release.                              | `packages/dataset`, `packages/generators`, `packages/cli`, `packages/registry`, docs       | medium                   |
| Hosted live Turkey demo                 | partial        | `examples/web-maplibre-turkey` exists and loads registry/render artifacts from `VITE_TERRITORY_REGISTRY_URL`; no hosted deployment workflow or URL exists.                                                   | Public deployment, registry endpoint, visual smoke checks against production artifacts.                                        | Demo can drift from production data if it depends on local configuration.                                             | Demo must not expose unapproved or unpublished geometry.                                         | Hosted registry, artifact CDN, MapLibre adapter.                  | S7              | Public demo URL renders Turkey artifacts from the production registry and passes visual smoke checks.                     | `examples/web-maplibre-turkey`, `packages/maplibre`, `.github/workflows`, docs             | low                      |
| Offline and mobile data loading         | partial        | Registry node cache and docs for offline/mobile loading exist; data packages are loaders, not geometry bundles.                                                                                              | Mobile storage adapter, offline policy tests, explicit cache invalidation UX, React Native integration.                        | Offline cache corruption or stale data can be hard to diagnose without platform-specific tests.                       | Cached redistribution must follow source licenses and attribution requirements.                  | Registry, React Native adapter, hosted artifacts.                 | S5              | Offline install/verify/update flows pass on Node and one mobile storage abstraction.                                      | `packages/registry`, `packages/runtime`, new mobile package, docs                          | medium                   |
| Game package                            | future roadmap | README lists game as future; no package exists.                                                                                                                                                              | Game-specific APIs, examples, state engine integration, docs.                                                                  | Game logic could pressure core APIs if built before stable dataset/runtime foundations.                               | No direct data risk unless bundling production geometry.                                         | Adapters, stable data APIs, hosted artifacts.                     | S8              | Game package consumes public TerritoryKit APIs without changing core contracts.                                           | new `packages/game`, examples, docs                                                        | medium                   |
| Production geometry quality gates       | partial        | Dataset validation and quality reports exist; Turkey ADM3 production quality report has `productionReady: false`. ADM0-ADM2 strict build completed locally with zero build errors.                           | CI gate that blocks publish for non-production-ready datasets; ADM3 issue remediation workflow.                                | Bad topology can break adjacency, hit tests, simplification, and MVT rendering.                                       | Geometry fixes may derive from licensed sources and must preserve attribution.                   | Source locks, QA reports, artifact publishing.                    | S2              | Publish workflow refuses datasets with unresolved blocking quality reports unless explicitly marked non-production pilot. | `packages/generators`, `packages/dataset`, `scripts`, `.github/workflows`, docs            | low                      |
| MVT tile budget and performance policy  | partial        | `packages/generators/src/render-artifacts.ts` emits MVT policy reports; Turkey ADM3 artifact policy passes size/tile limits; bundle-size script includes updated budgets.                                    | Production CDN tile budgets, per-dataset trend reporting, CI alert thresholds.                                                 | Tile count or tile size regressions can increase hosting cost and client latency.                                     | Generated vector tiles inherit source license constraints.                                       | Artifact publishing, performance reporting.                       | S2              | Each published dataset includes MVT budget report and CI fails on budget regressions.                                     | `packages/generators`, `scripts`, `.github/workflows`, docs                                | low                      |
| Stable ID continuity                    | partial        | Country builds emit identity maps and identity diff reports; code has deterministic ID handling.                                                                                                             | Public migration report across source updates and registry releases.                                                           | Untracked ID churn can break saved user data and external references.                                                 | Source replacement may require new attribution or license review.                                | Dataset diff/migration, registry versioning.                      | S6              | Release check compares previous and next artifacts and fails on undocumented stable-ID breaks.                            | `packages/dataset`, `packages/generators`, `packages/cli`, `packages/registry`, docs       | medium                   |
| Release and npm publishing              | partial        | Release workflow, Changesets config, dry-run packaging, and npm-publishing docs exist; npm registry currently exposes only six packages at `1.0.0` and misses eight public packages.                         | Actual 1.1+ npm release, reconciled docs, tags, provenance verification.                                                       | Consumers cannot install documented packages or versions.                                                             | Publishing metadata must not imply production data readiness.                                    | Npm auth/provenance, changesets, security audit.                  | S0              | npm package list and docs agree, all intended public packages are published with provenance.                              | package manifests, `.changeset`, `.github/workflows`, docs                                 | medium                   |
| Rollback procedure                      | partial        | Release governance describes immutable npm versions and forward-fix approach; dataset hosted rollback is not implemented.                                                                                    | Registry pointer rollback, artifact retention, incident checklist, compatibility tests.                                        | A bad dataset release may remain discoverable without a fast registry rollback.                                       | Rollback must not point to artifacts with revoked or invalid licenses.                           | Hosted registry, artifact CDN.                                    | S9              | Operators can promote a previous registry version without republishing mutable artifacts.                                 | `packages/registry`, `scripts`, `.github/workflows`, docs                                  | low                      |
| Security and supply-chain posture       | partial        | CI/release use frozen lockfile and ignore install scripts; production audit passes. Dev audit fails on Vite/PostCSS/esbuild/brace-expansion chains.                                                          | Dependency upgrade plan, audit exceptions policy if needed, regenerated lockfile.                                              | Compromised or vulnerable tooling can affect docs/examples/CI even when runtime prod deps are clean.                  | No direct data license risk.                                                                     | Dependency upgrades, CI validation.                               | S0              | `pnpm audit --audit-level moderate` passes or documented exceptions are approved.                                         | `package.json`, `pnpm-lock.yaml`, docs                                                     | medium                   |
| Test coverage                           | partial        | Unit/integration tests pass across packages; release check includes smoke, benchmark, registry install, docs links, and package dry-run. Some docs/examples/shared-testkit commands pass with no test files. | Hosted registry e2e, CDN publish smoke, adapter visual tests beyond MapLibre, migration tests.                                 | Production gaps can pass current tests because no tests exercise missing production workflows.                        | Test fixtures must not include unapproved production geometry.                                   | Hosted registry, adapters, diff/migration, demos.                 | S1-S9           | Each production workflow has at least one CI smoke test and one artifact-level assertion.                                 | all affected packages, examples, `.github/workflows`                                       | low                      |
| CI duration and bottlenecks             | partial        | CI matrix runs Node 22 release check and Node 24 verify plus visual MapLibre tests; local cached release check passes. Turkey dataset build is manual workflow and can take minutes with large artifacts.    | CI timing budgets, artifact size trend reports, cache policy, manual build SLA.                                                | Slow release checks can discourage frequent validation or hide regressions in manual workflows.                       | Large generated data must remain out of npm/Git unless policy permits.                           | Performance reports, artifact publishing.                         | S9              | CI reports stage durations and fails only on defined performance regressions.                                             | `.github/workflows`, `scripts`, docs                                                       | low                      |
| Provider registry completeness          | partial        | Built-in HDX COD-AB source adapter exists and is documented, but `scripts/generate-dataset-registry.mjs` provider registry lists natural-earth, geoboundaries, gaziantep-open-data, and geojson only.        | Generated provider registry entry for HDX COD-AB or explicit exclusion rationale.                                              | Users may not discover a source adapter that production Turkey builds depend on.                                      | Provider metadata must include license and attribution terms accurately.                         | Registry generation, source metadata.                             | S1              | Provider registry includes every built-in production source adapter or documents why it is intentionally hidden.          | `scripts`, `datasets/registry`, docs                                                       | low                      |
| Documentation/code consistency          | partial        | README claims public packages are on the 1.1 package line; npm shows six packages at 1.0.0 and eight missing. `docs/roadmap.md` still describes recently merged work as branch-level/in progress.            | Reconcile release docs, roadmap state, README commands, and npm package reality.                                               | Users may follow stale commands or install unavailable packages.                                                      | Docs may overstate production data readiness.                                                    | Release publish, audit roadmap.                                   | S0              | README, publishing docs, roadmap docs, and npm registry state agree.                                                      | docs, README, package manifests                                                            | low                      |
| Real geometry artifact governance       | partial        | Committed ADM3 pilot is policy-bounded; large `dist/**` and generated full-country artifacts are ignored.                                                                                                    | Clear artifact channel for production geometry and explicit “metadata/loader only” wording for data packages.                  | Developers may confuse local ignored artifacts with distributable package contents.                                   | Publishing local artifacts without license review is unsafe.                                     | Hosted registry, artifact policy, package docs.                   | S1              | Docs state exactly which repo files contain real geometry and which packages only contain metadata/loaders.               | docs, `packages/data-*`, `datasets/registry`                                               | low                      |

## Documentation Claims That Are Not Yet Backed by Production Reality

- README and publishing docs describe the workspace as a 1.1 public package line,
  but npm currently has only six packages at `1.0.0` and eight public workspace
  packages are unpublished.
- `docs/roadmap.md` still presents the Turkey full-build performance work as
  branch/in-progress work, even though it is merged into `main`.
- README contains an older broad country-build example including ADM3/ADM4 with
  `--allow-partial`; Turkey production source code now treats nationwide
  ADM3/ADM4 as blocked without approved source metadata.
- Hosted registry, CDN artifact publishing, hosted Turkey demo, Leaflet,
  OpenLayers, React Native, dataset diff/migration, and game package remain
  roadmap items, not implemented production features.

## Implemented Code That Is Under-Documented or Not Reflected Everywhere

- HDX COD-AB source support is implemented and used for Turkey ADM0-ADM2, but
  generated provider registry metadata omits `hdx-cod-ab`.
- Turkey ADM0-ADM2 source locks and strict build workflow are stronger than some
  older roadmap prose suggests, but production artifacts are still not hosted.
- Turkey ADM3 Gaziantep pilot artifacts are real tracked geometry artifacts, not
  just metadata, but they are explicitly partial and not publish-ready.
- Registry clients already support checksum verification and offline cache
  validation; the remaining gap is signed/hosted production promotion.

## Blockers

1. npm package reality does not match documented post-1.1 package state.
2. No hosted production registry or artifact CDN exists.
3. Turkey nationwide ADM3 neighborhood coverage lacks an approved source/license
   path.
4. ADM3 pilot is not production-ready because quality reports are unresolved.
5. Dev dependency audit fails on tooling vulnerabilities.
6. Provider registry metadata does not include all built-in production source
   adapters.

## Next Sprint Starting Conditions

- Decide whether the next sprint is a release-truth sprint (`S0`) or the hosted
  registry/artifact publishing sprint (`S1`). The audit recommends `S0` first
  because npm/docs/security mismatches affect every downstream production claim.
- Confirm npm publishing access and Trusted Publishing configuration.
- Confirm the target object storage/CDN provider and public registry URL before
  implementing hosted artifact publishing.
- Confirm that Turkey ADM3 remains a partial pilot until source/license coverage
  is expanded and quality gates pass.
- Keep large generated geometry out of Git unless a reviewed artifact policy
  explicitly permits it.
