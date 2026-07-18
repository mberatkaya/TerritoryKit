# TerritoryKit

TerritoryKit is a TypeScript-first geospatial SDK for hierarchical, irregular polygon
territories. It aims for an H3-like developer experience while keeping the core engine
independent from map renderers, backend frameworks, and game-specific state.

## Current Release

Public packages in this workspace are currently on the `1.1.0` package line. The root workspace is
private; its `0.0.0-private` version is tooling metadata and is not a public product version.
Sprint 11 and Sprint 12 changesets are pending minor releases; the next public package line remains
unpublished from this workspace until maintainers run the release flow.

## Package Maturity

- Stable core line: `@territory-kit/dataset`, `@territory-kit/core`, `@territory-kit/registry`,
  `@territory-kit/maplibre`, `@territory-kit/nestjs`, `@territory-kit/generators`,
  `@territory-kit/cli`, and pilot country loader packages.
- New runtime line: `@territory-kit/adapter-core` and `@territory-kit/runtime`.
- Future packages: Leaflet, OpenLayers, React Native, game, Studio, hosted registry, and dataset
  diff/migration tooling remain roadmap items.

## Historical Sprint Track

The table below is historical roadmap context, not a claim that every future adapter exists today:

| Product version | Sprint range | Status                         |
| --------------- | ------------ | ------------------------------ |
| `0.0.1`         | Sprint 0     | Complete                       |
| `0.1.0-alpha.1` | Sprint 1     | Hardened on roadmap branch     |
| `0.1.0`         | Sprint 2     | Hardened on roadmap branch     |
| `0.2.0-alpha.1` | Sprint 3     | Hardened on roadmap branch     |
| `0.2.0`         | Sprint 4     | Hardened on roadmap branch     |
| `0.3.0`         | Sprint 5     | Hardened on roadmap branch     |
| `0.4.0`         | Sprint 6     | Hardened on roadmap branch     |
| `0.5.0`         | Sprint 7     | Hardened on roadmap branch     |
| `0.6.0`         | Sprint 8     | Hardened on roadmap branch     |
| `0.9.0-rc.1`    | Sprint 9     | Verified on roadmap branch     |
| `1.0.0`         | Sprint 10    | Prepared on release branch     |
| `1.2.0`         | Sprint 11    | Runtime and adapter boundaries |
| `1.3.0`         | Sprint 12    | Runtime viewport lifecycle     |

## Packages

- `@territory-kit/dataset`: dataset manifest, schema, validation, and loading.
- `@territory-kit/adapter-core`: renderer-independent adapter contracts and capability helpers.
- `@territory-kit/core`: engine APIs, spatial lookup, hierarchy, adjacency, viewport queries.
- `@territory-kit/registry`: registry discovery, artifact resolution, verified cache, and Node
  download helpers.
- `@territory-kit/runtime`: viewport request orchestration across datasets, core engines, runtime
  cache, cancellation, scheduler, and renderer-independent adapters.
- `@territory-kit/maplibre`: first map adapter boundary for MapLibre GL JS.
- `@territory-kit/nestjs`: NestJS integration boundary and PostGIS repository contracts.
- `@territory-kit/generators`: deterministic dataset helper, source, and adjacency utilities.
- `@territory-kit/cli`: `territory validate`, `territory geometry`, `territory index`, and
  adjacency artifact tools.
- `@territory-kit/data-tr`, `@territory-kit/data-us`, `@territory-kit/data-de`,
  `@territory-kit/data-jp`, `@territory-kit/data-id`: thin resolver-driven pilot country loaders
  without embedded geometry artifacts.
- `@territory-kit/shared-testkit`: private fixtures for tests and examples.

## Migration And Deprecation

New code should import registry APIs from `@territory-kit/registry`. Core still exposes registry
exports for compatibility, but they are deprecated and mirrored under
`@territory-kit/core/legacy-registry` for migration work. Runtime orchestration is additive and
does not replace existing core engine or MapLibre APIs.

## Global Dataset Builds

The global dataset pipeline starts with source adapters and a local Natural Earth ADM0 builder:

```bash
territory dataset build world-countries \
  --source ./sources/ne-admin0.geojson \
  --output ./dist/world-countries
```

```bash
territory source list
territory sources inspect --provider geoboundaries --country TR --level ADM3 --json
territory dataset coverage
territory import geojson --input ./regions.geojson --output ./dist/regions --country TR --admin-level ADM2 --name-property name
territory geometry validate ./dist/regions --checks full --report ./geometry-report.json
territory adjacency build ./dist/regions --output ./dist/regions-adjacency
territory country source lock TR --output ./dist/tr/sources.lock.json
territory country build TR --source-lock ./dist/tr/sources.lock.json --output ./dist/tr --build-adjacency --strict
territory registry build --input ./dist --output ./dist/registry.json --base-url https://cdn.example.test/datasets/
territory dataset install territory-kit-tr --registry ./dist/registry.json --levels ADM0,ADM1 --load-adjacency
```

Generated world-country artifacts are documented in
[docs/datasets/world-countries.md](./docs/datasets/world-countries.md) and are not embedded in npm
packages. Pilot country artifacts are documented in
[docs/country-datasets.md](./docs/country-datasets.md); their loader packages also do not embed
geometry.

The generated coverage registry lives in `datasets/registry/coverage.json` and is summarized in
[docs/datasets/coverage.md](./docs/datasets/coverage.md). TerritoryKit supports lower
administrative levels when a suitable source exists, but it does not guarantee neighbourhood-level
coverage for every country. Municipality and neighbourhood are semantic types on ADM records, not
pseudo-administrative levels. Turkey includes a partial official Gaziantep ADM3 neighbourhood pilot
documented in [docs/datasets/turkey-neighbourhoods.md](./docs/datasets/turkey-neighbourhoods.md).
The current product gap analysis is tracked in
[docs/product-gap-analysis.md](./docs/product-gap-analysis.md).

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm bundle:size
pnpm release:check
```

Node.js `>=22` and pnpm `>=11` are required. The current TypeScript baseline is `6.0.3`;
TypeScript 7 will be evaluated in a later ADR before adoption.

## 1.0 Release Scope

The `1.0.0` release branch freezes the current public API surface and keeps
`territory-schema@1` unchanged. It prepares package versions, release notes, benchmark
evidence, and verification gates for a stable PR, but publishing, tagging, and GitHub release
creation remain post-merge maintainer actions. The master sprint checklist separates completed
repo evidence from repo-owned hardening work, external release handoff, and post-1.0 roadmap
items.

## Planning Docs

- [Product requirements](./docs/prd.md)
- [H3 comparison](./docs/h3-comparison.md)
- [Risk register](./docs/risk-register.md)
- [Release governance](./docs/release-governance.md)
- [Roadmap](./docs/roadmap.md)
- [Release check](./docs/release-check.md)
- [Runtime architecture audit](./docs/architecture/runtime-architecture-audit.md)
- [Runtime contract](./docs/architecture/runtime-contract.md)
- [Runtime viewport audit](./docs/architecture/runtime-viewport-audit.md)
- [Runtime viewport lifecycle](./docs/architecture/runtime-viewport-lifecycle.md)
- [Runtime cache](./docs/runtime-cache.md)
- [Adapter contract](./docs/architecture/adapter-contract.md)
- [Core/registry boundary](./docs/architecture/core-registry-boundary.md)
- [Errors](./docs/errors.md)
- [Product gap analysis](./docs/product-gap-analysis.md)
- [Dataset compatibility](./docs/dataset-compatibility.md)
- [Source adapters](./docs/source-adapters.md)
- [Source pipeline](./docs/source-pipeline.md)
- [Source cache](./docs/source-cache.md)
- [Country datasets](./docs/country-datasets.md)
- [Country source locks](./docs/country-source-locks.md)
- [Country loaders](./docs/country-loaders.md)
- [Dataset registry](./docs/dataset-registry.md)
- [Dataset installation](./docs/dataset-installation.md)
- [Dataset cache](./docs/dataset-cache.md)
- [Registry hosting](./docs/registry-hosting.md)
- [Offline datasets](./docs/offline-datasets.md)
- [Dataset versioning](./docs/dataset-versioning.md)
- [Query artifacts](./docs/query-artifacts.md)
- [Render artifacts](./docs/render-artifacts.md)
- [Vector tile pipeline](./docs/vector-tile-pipeline.md)
- [MapLibre registry integration](./docs/maplibre-registry-integration.md)
- [Turkey neighbourhood MapLibre example](./docs/examples/turkey-neighbourhood-maplibre.md)
- [Render/query compatibility](./docs/render-query-compatibility.md)
- [Mobile map loading](./docs/mobile-map-loading.md)
- [Adjacency artifacts](./docs/adjacency.md)
- [Geometry quality](./docs/geometry-quality.md)
- [Geometry validation](./docs/geometry-validation.md)
- [Geometry repair](./docs/geometry-repair.md)
- [Geometry backends](./docs/geometry-backends.md)
- [World countries ADM0 dataset](./docs/datasets/world-countries.md)
- [Global dataset overview](./docs/datasets/global-overview.md)
- [Dataset coverage](./docs/datasets/coverage.md)
- [Lower administrative levels](./docs/datasets/lower-admin-levels.md)
- [Administrative semantics](./docs/datasets/admin-semantics.md)
- [Partial coverage](./docs/datasets/partial-coverage.md)
- [Turkey neighbourhoods](./docs/datasets/turkey-neighbourhoods.md)
- [Dataset providers](./docs/datasets/providers.md)
- [Lower-admin providers](./docs/sources/lower-admin-providers.md)
- [Gaziantep ADM3 source](./docs/sources/gaziantep-open-data.md)
- [Benchmarks](./docs/benchmarks.md)
- [Real-world benchmarks](./docs/real-world-benchmarks.md)
- [NestJS and PostGIS](./docs/nestjs-postgis.md)
- [Release readiness](./docs/release-readiness.md)
- [Master sprint checklist](./docs/sprint-checklist.md)
