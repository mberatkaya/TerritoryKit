# Production Checklist

This checklist is the production hardening gate for `release/production-hardening`.
Refresh the generated evidence with:

```sh
pnpm install
pnpm format:check
pnpm lint
pnpm package:boundaries
pnpm typecheck
pnpm test
pnpm coverage
pnpm build
pnpm bundle:size
pnpm package:dry-run
pnpm release:check
pnpm verify
pnpm docs:links
pnpm release:hardening
```

## Required Gates

| Gate                       | Required evidence         | Current status |
| -------------------------- | ------------------------- | -------------- |
| Formatting                 | `pnpm format:check`       | passed         |
| Lint                       | `pnpm lint`               | passed         |
| Package boundaries         | `pnpm package:boundaries` | passed         |
| TypeScript                 | `pnpm typecheck`          | passed         |
| Unit and integration tests | `pnpm test`               | passed         |
| Coverage                   | `pnpm coverage`           | passed         |
| Build                      | `pnpm build`              | passed         |
| Bundle budgets             | `pnpm bundle:size`        | passed         |
| Package dry-run            | `pnpm package:dry-run`    | passed         |
| Release smoke gate         | `pnpm release:check`      | passed         |
| Full verification          | `pnpm verify`             | passed         |
| Broken links               | `pnpm docs:links`         | passed         |
| Hardening evidence         | `pnpm release:hardening`  | passed         |

## Hardening Gates

| Area                       | Evidence                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Vulnerability audit        | Critical vulnerabilities are 0; high/moderate findings are dev tooling only.                                  |
| License inventory          | Production inventory has 260 packages, 12 license groups, and no unknown licenses.                            |
| Package exports            | 21 ESM/CJS/type export targets import or require successfully.                                                |
| ESM/CJS strategy           | Public packages publish `dist/*.mjs`, `dist/*.cjs`, `dist/*.d.mts`, and `dist/*.d.cts`.                       |
| Tree-shaking               | Public library packages declare `sideEffects: false`; CLI is excluded.                                        |
| Node/browser boundaries    | Browser-safe packages have no `node:` imports and do not import `@territory-kit/registry/node`.               |
| React Native boundaries    | `@territory-kit/react-native` has no Node-only, DOM, IndexedDB, Cache API, or worker imports.                 |
| SSR compatibility          | MapLibre, Leaflet, and OpenLayers packages keep renderer dependencies as peers and pass import smoke tests.   |
| Public API snapshot        | API surface is checked through package exports, typecheck, type tests, and Changesets status.                 |
| Type tests                 | Package tests and `tsc --noEmit` pass across the workspace.                                                   |
| Docs/code alignment        | Links, package metadata, support matrix, migration guide, and release notes are updated together.             |
| Changeset consistency      | `pnpm changeset status --verbose` passes and reports no major release.                                        |
| Registry schema versioning | Registry smoke uses the existing registry schema and checksum verification path.                              |
| Dataset schema versioning  | Turkey artifacts remain on `territory-schema@1`; ADM3 coverage uses `territorykit-partial-coverage@1`.        |
| Migration plan             | Dataset and game migration-plan APIs are documented in `docs/migration-guide.md`.                             |
| Rollback plan              | `docs/rollback.md` covers npm, dataset registry, and PR rollback.                                             |
| Artifact checksum          | Dataset checksums and release-artifact checksums are verified.                                                |
| Supply chain               | CI uses frozen installs and least-privilege workflow permissions; publish uses provenance/trusted publishing. |
| Secrets                    | Normal CI uses no secrets; publish and registry activation secrets are scoped to guarded workflows.           |

## Turkey Gates

| Turkey gate  | Required state                                              | Current status                 |
| ------------ | ----------------------------------------------------------- | ------------------------------ |
| ADM0         | exactly 1 generated feature                                 | passed                         |
| ADM1         | exactly 81 generated features                               | passed                         |
| ADM2         | current verified national generated count                   | passed, 973                    |
| ADM3         | only real confirmed scope                                   | passed, Gaziantep partial only |
| Source lock  | current lock hash recorded                                  | passed                         |
| Strict build | ADM0-ADM2 strict validation passes                          | passed                         |
| Checksums    | generated artifact checksums match                          | passed                         |
| Adjacency    | ADM1/ADM2 reports stored                                    | passed                         |
| Geometry     | quality and repair reports stored                           | passed                         |
| Performance  | benchmark compared to baseline                              | passed                         |
| CI placement | full Turkey build is maintainer-triggered, not normal PR CI | passed                         |

## Release Gate Fail Conditions

Do not mark release-ready if any of these are true:

- `pnpm verify` fails.
- A critical vulnerability is present.
- A public API breaking change is undocumented.
- Package dry-run fails.
- Registry publish or verify smoke fails.
- Turkey ADM0-ADM2 strict build fails.
- Public package license metadata is missing.
- Artifact checksum verification fails.
- React Native package contains Node-only imports.
- Adapter dispose or lifecycle tests fail.
- Dataset migration tooling fails critical scenarios.
