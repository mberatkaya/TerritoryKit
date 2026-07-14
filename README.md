# TerritoryKit

TerritoryKit is a TypeScript-first geospatial SDK for hierarchical, irregular polygon
territories. It aims for an H3-like developer experience while keeping the core engine
independent from map renderers, backend frameworks, and game-specific state.

## Current Version Track

The repository starts at `0.0.1` and follows the sprint roadmap from the technical sprint
document:

| Product version | Sprint range | Status                     |
| --------------- | ------------ | -------------------------- |
| `0.0.1`         | Sprint 0     | Complete                   |
| `0.1.0-alpha.1` | Sprint 1     | Hardened on roadmap branch |
| `0.1.0`         | Sprint 2     | Hardened on roadmap branch |
| `0.2.0-alpha.1` | Sprint 3     | Hardened on roadmap branch |
| `0.2.0`         | Sprint 4     | Hardened on roadmap branch |
| `0.3.0`         | Sprint 5     | Hardened on roadmap branch |
| `0.4.0`         | Sprint 6     | Hardened on roadmap branch |
| `0.5.0`         | Sprint 7     | Hardened on roadmap branch |
| `0.6.0`         | Sprint 8     | Hardened on roadmap branch |
| `0.9.0-rc.1`    | Sprint 9     | Verified on roadmap branch |
| `1.0.0`         | Sprint 10    | Prepared on release branch |

## Packages

- `@territory-kit/dataset`: dataset manifest, schema, validation, and loading.
- `@territory-kit/core`: engine APIs, spatial lookup, hierarchy, adjacency, viewport queries.
- `@territory-kit/maplibre`: first map adapter boundary for MapLibre GL JS.
- `@territory-kit/nestjs`: NestJS integration boundary and PostGIS repository contracts.
- `@territory-kit/generators`: deterministic dataset helper and generator utilities.
- `@territory-kit/cli`: `territory validate`, `territory index`, and related tools.
- `@territory-kit/shared-testkit`: private fixtures for tests and examples.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm bundle:size
```

Node.js `>=22` and pnpm `>=11` are required. The current TypeScript baseline is `6.0.3`;
TypeScript 7 will be evaluated in a later ADR before adoption.

## 1.0 Release Scope

The `1.0.0` release branch freezes the current public API surface and keeps
`territory-schema@1` unchanged. It prepares package versions, release notes, benchmark
evidence, and verification gates for a stable PR, but publishing, tagging, and GitHub release
creation remain post-merge maintainer actions.

## Planning Docs

- [Product requirements](./docs/prd.md)
- [H3 comparison](./docs/h3-comparison.md)
- [Risk register](./docs/risk-register.md)
- [Roadmap](./docs/roadmap.md)
- [Dataset compatibility](./docs/dataset-compatibility.md)
- [Benchmarks](./docs/benchmarks.md)
- [NestJS and PostGIS](./docs/nestjs-postgis.md)
- [Release readiness](./docs/release-readiness.md)
- [Remaining sprint checklist](./docs/sprint-checklist.md)
