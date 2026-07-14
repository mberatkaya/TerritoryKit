# @territory-kit/generators

Deterministic dataset generation and adjacency helpers for tests, examples, benchmarks, and local tooling.

## Installation

```sh
pnpm add @territory-kit/generators @territory-kit/core @territory-kit/dataset
```

## Basic Usage

```ts
import {
  buildTerritoryAdjacency,
  createSyntheticGridDataset,
  inferBBoxAdjacency
} from "@territory-kit/generators";

const dataset = createSyntheticGridDataset({
  datasetId: "demo-grid",
  rows: 4,
  columns: 4
});

const adjacency = inferBBoxAdjacency(dataset.zones);
const realAdjacency = await buildTerritoryAdjacency(dataset, {
  includePointTouches: true,
  buildDate: "2026-01-01T00:00:00.000Z"
});
```

## API Summary

- `createSyntheticGridDataset(options)` creates deterministic rectangular territory fixtures.
- `createWeightedVoronoiDataset(options)` creates a simple weighted territory dataset.
- `createDatasetGeometryHash(dataset)` returns a deterministic geometry hash.
- `buildWorldCountriesDataset(options)` builds Natural Earth ADM0 world-countries artifacts.
- `runTerritorySourcePipeline(options)` runs the shared source adapter pipeline.
- `validateTerritoryDatasetPath(inputPath, options)` and `repairTerritoryDatasetPath(...)` provide
  filesystem helpers for geometry quality reports and repaired dataset output.
- `buildTerritoryAdjacency(dataset, options)` builds exact polygon adjacency artifacts.
- `buildTerritoryAdjacencyPath(inputPath, options)` writes `adjacency.json`, `build-report.json`,
  and `checksums.json`.
- `createTerritoryCountrySourceLock(options)` resolves and checksums pilot country source artifacts.
- `buildTerritoryCountryDatasetPath(options)` writes country manifests, per-level datasets,
  hierarchy reports, identity maps, quality reports, and optional adjacency artifacts.
- `createDefaultTerritorySourceRegistry()` returns built-in adapters for Natural Earth,
  geoBoundaries, and generic GeoJSON.
- `parseNaturalEarthAdm0FeatureCollection(input, source)` parses local Natural Earth-like GeoJSON
  without network access.
- `inferBBoxAdjacency(zones, options)` returns neighbor IDs inferred from bounding boxes for
  development fixtures.
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

## Pilot Country Datasets

```ts
import {
  buildTerritoryCountryDatasetPath,
  createTerritoryCountrySourceLock
} from "@territory-kit/generators";

await createTerritoryCountrySourceLock({
  country: "TR",
  levels: ["ADM0", "ADM1", "ADM2"],
  outputPath: "./dist/tr/sources.lock.json"
});

await buildTerritoryCountryDatasetPath({
  country: "TR",
  sourceLockPath: "./dist/tr/sources.lock.json",
  outputPath: "./dist/tr",
  buildAdjacency: true,
  strict: true
});
```

Configured pilot countries are `TR`, `US`, `DE`, `JP`, and `ID`.

## Source Adapters

```ts
import { runTerritorySourcePipeline } from "@territory-kit/generators";

await runTerritorySourcePipeline({
  adapter: "geojson",
  request: { input: "./regions.geojson" },
  options: {
    countryCode: "TR",
    adminLevel: "ADM2",
    idProperty: "region.code",
    nameProperty: "region.name"
  },
  geometryQuality: "basic",
  outputPath: "./dist/regions"
});
```

Set `geometryQuality` to `"full"` for topology and hierarchy checks, or `"none"` to skip geometry
quality in a source import.

## License

Apache-2.0
