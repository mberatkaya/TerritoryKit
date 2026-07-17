# TerritoryKit

TerritoryKit manages real administrative or custom polygon territories with an H3-like
developer experience.

The first implementation focuses on dataset validation, a core zone engine, and the
package boundaries required for MapLibre, NestJS/PostGIS, generators, and CLI tools.

## Planning

- [Product requirements](./prd.md)
- [H3 comparison](./h3-comparison.md)
- [Risk register](./risk-register.md)
- [Release governance](./release-governance.md)
- [Roadmap](./roadmap.md)
- [Benchmarks](./benchmarks.md)
- [Real-world benchmarks](./real-world-benchmarks.md)
- [Release check](./release-check.md)
- [Global datasets](./global-datasets.md)
- [Lower administrative levels](./datasets/lower-admin-levels.md)
- [Administrative semantics](./datasets/admin-semantics.md)
- [Partial coverage](./datasets/partial-coverage.md)
- [Source adapters](./source-adapters.md)
- [Lower-admin providers](./sources/lower-admin-providers.md)
- [Source pipeline](./source-pipeline.md)
- [Source cache](./source-cache.md)
- [Country datasets](./country-datasets.md)
- [Country source locks](./country-source-locks.md)
- [Country identity](./country-identity.md)
- [Country hierarchy](./country-hierarchy.md)
- [Country loaders](./country-loaders.md)
- [Dataset registry](./dataset-registry.md)
- [Dataset installation](./dataset-installation.md)
- [Dataset cache](./dataset-cache.md)
- [Registry hosting](./registry-hosting.md)
- [Offline datasets](./offline-datasets.md)
- [Dataset versioning](./dataset-versioning.md)
- [Query artifacts](./query-artifacts.md)
- [Render artifacts](./render-artifacts.md)
- [Vector tile pipeline](./vector-tile-pipeline.md)
- [MapLibre registry integration](./maplibre-registry-integration.md)
- [Render/query compatibility](./render-query-compatibility.md)
- [Mobile map loading](./mobile-map-loading.md)
- [Adjacency artifacts](./adjacency.md)
- [Geometry quality](./geometry-quality.md)
- [Geometry validation](./geometry-validation.md)
- [Geometry repair](./geometry-repair.md)
- [Geometry backends](./geometry-backends.md)
- [Natural Earth source](./sources/natural-earth.md)
- [geoBoundaries source](./sources/geoboundaries.md)
- [Generic GeoJSON source](./sources/geojson.md)
- [World countries ADM0 dataset](./datasets/world-countries.md)
- [Turkiye pilot dataset](./datasets/tr.md)
- [Turkey neighbourhoods](./datasets/turkey-neighbourhoods.md)
- [United States pilot dataset](./datasets/us.md)
- [Germany pilot dataset](./datasets/de.md)
- [Japan pilot dataset](./datasets/jp.md)
- [Indonesia pilot dataset](./datasets/id.md)
- [Dataset ID conventions](./dataset-id-conventions.md)
- [Dataset provenance](./dataset-provenance.md)
- [Dataset licensing](./dataset-licensing.md)
- [NestJS and PostGIS](./nestjs-postgis.md)
- [NestJS OpenAPI contract](./nestjs-openapi.md)
- [Release readiness](./release-readiness.md)
- [Master sprint checklist](./sprint-checklist.md)

The public roadmap documents major milestones; completion status is tracked in the master sprint
checklist.

## Install

```bash
pnpm add @territory-kit/core @territory-kit/dataset
```

## Package Boundary

The core engine has no dependency on renderers, backend frameworks, or game-specific
state. Dynamic ownership, faction, and score data should be layered through adapters or
application state.
