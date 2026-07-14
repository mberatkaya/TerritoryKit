# Geometry Backends

The default backend is the pure TypeScript backend exported by `@territory-kit/dataset` as
`typescriptGeometryQualityBackend`. It is deterministic, dependency-light, and suitable for tests,
CLI usage, and source imports.

## Backend Contract

```ts
import type { GeometryQualityBackend } from "@territory-kit/dataset";

const backend: GeometryQualityBackend = {
  id: "typescript",
  validate(dataset, options) {
    // return GeometryQualityReport
  },
  repair(dataset, options) {
    // optional, return GeometryRepairDatasetResult
  }
};
```

Backends must return the same public report model. They must not silently repair during validation.

## TypeScript Backend

The TypeScript backend performs bbox candidate filtering before exact comparisons and does not
require native GIS binaries or a database. It is the only backend enabled in the CLI today.

## PostGIS Backend

`postgis` is reserved as a backend id for future integrations such as `ST_IsValid`,
`ST_Relate`, `ST_Covers`, and indexed overlap checks. The current CLI rejects `--backend postgis`
and `--repair-strategy postgis-make-valid` with input-error exit code `2` because no real PostGIS
geometry quality backend is shipped yet.
