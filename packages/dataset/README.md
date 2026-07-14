# @territory-kit/dataset

Dataset schema, validation, and GeoJSON conversion utilities for TerritoryKit.

## Installation

```sh
pnpm add @territory-kit/dataset
```

## Basic Usage

```ts
import { loadTerritoryDataset, validateTerritoryDataset } from "@territory-kit/dataset";

const result = validateTerritoryDataset(input);

if (!result.ok) {
  console.error(result.issues);
}

const dataset = loadTerritoryDataset(input);
```

## API Summary

- `validateTerritoryDataset(input)` validates a TerritoryKit dataset and returns structured issues.
- `loadTerritoryDataset(input)` validates and returns a typed dataset or throws.
- `createTerritoryDatasetFromGeoJson(input, options)` imports GeoJSON features into the schema.
- `computeGeometryBBox`, `computeGeometryCenter`, and `geometryToPolygons` provide geometry helpers.
- `TERRITORY_SCHEMA_VERSION` exposes the current `territory-schema@1` identifier.

## License

Apache-2.0
