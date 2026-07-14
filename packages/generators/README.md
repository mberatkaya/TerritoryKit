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
- `inferBBoxAdjacency(zones, options)` returns neighbor IDs inferred from bounding boxes.
- `inferBBoxAdjacencyConnections(zones, options)` returns adjacency connection objects.

## License

Apache-2.0
