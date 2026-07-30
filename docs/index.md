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
- [Runtime architecture audit](./architecture/runtime-architecture-audit.md)
- [Runtime contract](./architecture/runtime-contract.md)
- [Runtime viewport audit](./architecture/runtime-viewport-audit.md)
- [Runtime viewport lifecycle](./architecture/runtime-viewport-lifecycle.md)
- [Runtime cache](./runtime-cache.md)
- [Multi-dataset catalog](./catalog.md)
- [Binary spatial index](./binary-spatial-index.md)
- [Worker loading](./worker-loading.md)
- [Game territory engine](./game/overview.md)
- [Game domain model](./game/domain-model.md)
- [Game persistence](./game/persistence.md)
- [Game concurrency](./game/concurrency.md)
- [Game dataset migrations](./game/dataset-migrations.md)
- [Adapter contract](./architecture/adapter-contract.md)
- [Core/registry boundary](./architecture/core-registry-boundary.md)
- [Errors](./errors.md)
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
- [Artifact publishing](./artifact-publishing.md)
- [Registry rollback](./registry-rollback.md)
- [Offline datasets](./offline-datasets.md)
- [Dataset versioning](./dataset-versioning.md)
- [Query artifacts](./query-artifacts.md)
- [Render artifacts](./render-artifacts.md)
- [Vector tile pipeline](./vector-tile-pipeline.md)
- [MapLibre registry integration](./maplibre-registry-integration.md)
- [Leaflet integration](./leaflet-integration.md)
- [OpenLayers integration](./openlayers-integration.md)
- [Renderer adapter comparison](./renderer-adapter-comparison.md)
- [Turkey MapLibre example](./examples/turkey-maplibre.md)
- [Turkey Leaflet example](./examples/turkey-leaflet.md)
- [Turkey OpenLayers example](./examples/turkey-openlayers.md)
- [Registry deployment example](./examples/registry-deployment.md)
- [ADR 0012: Hosted registry publishing boundary](./adr/0012-hosted-registry-publishing.md)
- [Render/query compatibility](./render-query-compatibility.md)
- [Mobile map loading](./mobile-map-loading.md)
- [React Native runtime](./react-native.md)
- [Mobile offline datasets](./mobile-offline-datasets.md)
- [Mobile cache policy](./mobile-cache-policy.md)
- [React Native MapLibre example](./examples/react-native-maplibre.md)
- [Adjacency artifacts](./adjacency.md)
- [Geometry quality](./geometry-quality.md)
- [Geometry validation](./geometry-validation.md)
- [Geometry repair](./geometry-repair.md)
- [Geometry simplification](./geometry-simplification.md)
- [Geometry backends](./geometry-backends.md)
- [Natural Earth source](./sources/natural-earth.md)
- [geoBoundaries source](./sources/geoboundaries.md)
- [Generic GeoJSON source](./sources/geojson.md)
- [World countries ADM0 dataset](./datasets/world-countries.md)
- [Turkiye pilot dataset](./datasets/tr.md)
- [Turkey administrative model](./datasets/turkey-administrative-model.md)
- [Turkey sources](./datasets/turkey-sources.md)
- [Turkey national coverage](./datasets/turkey-national-coverage.md)
- [Turkey build](./datasets/turkey-build.md)
- [Turkey licensing](./datasets/turkey-licensing.md)
- [Turkey neighbourhoods](./datasets/turkey-neighbourhoods.md)
- [Turkey ADM3 ingestion](./datasets/turkey-adm3-ingestion.md)
- [Turkey ADM3 source contract](./datasets/turkey-adm3-source-contract.md)
- [Turkey ADM3 identity](./datasets/turkey-adm3-identity.md)
- [Turkey ADM3 quality gates](./datasets/turkey-adm3-quality-gates.md)
- [ADR 0013: Turkey ADM3 province-scoped ingestion](./adr/0013-turkey-adm3-ingestion.md)
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

The core engine has no dependency on renderers, backend frameworks, or game-specific state.
Dynamic ownership, faction, and score data should be layered through adapters, runtime
coordination, or application state.
