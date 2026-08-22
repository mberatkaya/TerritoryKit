# Release Governance

This page records the release governance checks that must stay green before a sprint item can be
marked complete in the master checklist.

## Package Boundaries

`pnpm package:boundaries` is the automated boundary gate. It scans package manifests and
`packages/*/src` imports so adapters, backend integrations, CLI code, and future game state cannot
leak into lower-level packages.

The enforced source dependency direction is:

| Package                       | Allowed workspace imports                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@territory-kit/dataset`      | none                                                                                                      |
| `@territory-kit/adapter-core` | `@territory-kit/dataset`                                                                                  |
| `@territory-kit/registry`     | `@territory-kit/dataset`                                                                                  |
| `@territory-kit/core`         | `@territory-kit/dataset`; `@territory-kit/registry` only through deprecated compatibility exports         |
| `@territory-kit/runtime`      | `@territory-kit/adapter-core`, `@territory-kit/core`, `@territory-kit/dataset`, `@territory-kit/registry` |
| `@territory-kit/generators`   | `@territory-kit/core`, `@territory-kit/dataset`                                                           |
| `@territory-kit/maplibre`     | `@territory-kit/adapter-core`, `@territory-kit/dataset`, `@territory-kit/registry`                        |
| `@territory-kit/nestjs`       | `@territory-kit/core`, `@territory-kit/dataset`                                                           |
| `@territory-kit/cli`          | `@territory-kit/core`, `@territory-kit/dataset`, `@territory-kit/generators`, `@territory-kit/registry`   |

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

World-scale support remains staged after the TerritoryKit 2.0 stable handoff:

- Keep core SDK releases focused on verified query/render/registry contracts and benchmark
  evidence.
- Add opt-in large benchmark evidence before marking 1M feature scenarios complete.
- Keep global administrative datasets out of npm packages until source licensing and
  redistribution are reviewed; large geography should flow through resolver/registry artifacts.
- Treat the Turkey V2 national playable artifact as a reviewed country-specific release path, not
  as a blanket claim that every country has complete lower-admin source coverage.

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
- Depend only on the documented adapter boundary packages. Renderer adapters should use
  `@territory-kit/adapter-core`; runtime coordination should use `@territory-kit/runtime`.
- Provide capability metadata, lifecycle methods, theme/state update helpers, and visual or
  interaction tests for the target runtime.

## Feedback And Security Channels

Release blockers are tracked through GitHub issues, PR review comments, or private security
advisories when disclosure would be unsafe. Public issues are appropriate for documentation,
compatibility, performance, and feature requests. Exploitable reports follow `SECURITY.md`.
