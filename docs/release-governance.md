# Release Governance

This page records the release governance checks that must stay green before a sprint item can be
marked complete in the master checklist.

## Package Boundaries

`pnpm package:boundaries` is the automated boundary gate. It scans package manifests and
`packages/*/src` imports so adapters, backend integrations, CLI code, and future game state cannot
leak into lower-level packages.

The enforced source dependency direction is:

| Package                     | Allowed workspace imports                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@territory-kit/dataset`    | none                                                                                                    |
| `@territory-kit/core`       | `@territory-kit/dataset`, `@territory-kit/registry`                                                     |
| `@territory-kit/generators` | `@territory-kit/core`, `@territory-kit/dataset`                                                         |
| `@territory-kit/maplibre`   | `@territory-kit/core`, `@territory-kit/dataset`                                                         |
| `@territory-kit/nestjs`     | `@territory-kit/core`, `@territory-kit/dataset`                                                         |
| `@territory-kit/cli`        | `@territory-kit/core`, `@territory-kit/dataset`, `@territory-kit/generators`, `@territory-kit/registry` |

Tests and examples can import higher-level packages when they are proving an integration flow.

## Dataset And License Review

Real dataset imports must record these facts before they are promoted from examples to maintained
artifacts:

- Source name, owner, URL, retrieval date, and `sourceDate`.
- Source license and whether redistribution, modification, and commercial use are permitted.
- Any required attribution text.
- Projection normalization to RFC 7946 longitude/latitude coordinates.
- Geometry simplification steps and generated `geometryHash`.
- Whether derived datasets can be published to npm or must remain documentation-only fixtures.

Code license review is separate from dataset review. New code dependencies must be compatible with
Apache-2.0 package publishing, while datasets must preserve their own attribution and redistribution
rules.

## World-Scale Data Roadmap

World-scale support is deliberately staged after `1.0.0`:

- Keep `1.0.0` focused on viewport queries, simplification guidance, and benchmark evidence for
  synthetic 10K/100K datasets.
- Add opt-in large benchmark evidence before marking 1M feature scenarios complete.
- Add vector tile/MVT support in the `1.3` roadmap milestone rather than changing
  `territory-schema@1`.
- Keep global administrative datasets out of MVP package publishing until source licensing and
  redistribution are reviewed.

## Validator Rules

Cycle and orphan validation must stay schema-backed and repairable:

- `parentId` cycles are hard validation errors.
- Missing parent references are hard validation errors.
- Non-reciprocal `neighborIds` are warnings so import pipelines can repair legacy adjacency data.
- Repair suggestions should name the field, feature id, and source path when available.

These rules keep dataset validation strict without making imperfect real-world import repair
impossible.

## Community Adapter Template

The first community adapter template repo is a post-1.0 roadmap item. Until then, adapters should
copy the MapLibre package shape:

- Keep renderer-specific code outside `@territory-kit/core`.
- Depend only on `@territory-kit/core` and `@territory-kit/dataset`.
- Provide capability metadata, lifecycle methods, theme/state update helpers, and visual or
  interaction tests for the target runtime.

## Feedback And Security Channels

Release blockers are tracked through GitHub issues, PR review comments, or private security
advisories when disclosure would be unsafe. Public issues are appropriate for documentation,
compatibility, performance, and feature requests. Exploitable reports follow `SECURITY.md`.
