# @territory-kit/generators

Deterministic dataset generation and adjacency helpers for tests, examples, benchmarks, and local tooling.

## Installation

```sh
pnpm add @territory-kit/generators @territory-kit/core @territory-kit/dataset
```

## Basic Usage

```ts
import { createSyntheticGridDataset, inferBBoxAdjacency } from "@territory-kit/generators";

const dataset = createSyntheticGridDataset({
  datasetId: "demo-grid",
  rows: 4,
  columns: 4
});

const adjacency = inferBBoxAdjacency(dataset.zones);
```

## API Summary

- `createSyntheticGridDataset(options)` creates deterministic rectangular territory fixtures.
- `createWeightedVoronoiDataset(options)` creates a simple weighted territory dataset.
- `createDatasetGeometryHash(dataset)` returns a deterministic geometry hash.
- `buildWorldCountriesDataset(options)` builds Natural Earth ADM0 world-countries artifacts.
- `parseNaturalEarthAdm0FeatureCollection(input, source)` parses local Natural Earth-like GeoJSON
  without network access.
- `inferBBoxAdjacency(zones, options)` returns neighbor IDs inferred from bounding boxes.
- `inferBBoxAdjacencyConnections(zones, options)` returns adjacency connection objects.

## World Countries ADM0

```ts
import { buildWorldCountriesDataset } from "@territory-kit/generators";

await buildWorldCountriesDataset({
  sourcePath: "./sources/ne-admin0.geojson",
  outputPath: "./dist/world-countries",
  sourceVersion: "5.1.2",
  sourceSha256: "<sha256>",
  buildDate: "2026-01-01T00:00:00.000Z"
});
```

The builder writes `manifest.json`, `checksums.json`, `attribution.txt`, `build-report.json`, and
detail-specific `dataset.json` files.

## License

Apache-2.0
