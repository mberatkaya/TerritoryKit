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
- [Global datasets](./global-datasets.md)
- [World countries ADM0 dataset](./datasets/world-countries.md)
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
