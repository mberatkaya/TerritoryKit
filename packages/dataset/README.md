# @territory-kit/dataset

Dataset schema, validation, and GeoJSON conversion utilities for TerritoryKit.

## Installation

```sh
pnpm add @territory-kit/dataset
```

## Basic Usage

```ts
import {
  loadTerritoryDataset,
  createTerritoryAdjacencyIndex,
  validateGeometryDataset,
  validateTerritoryAdjacencyArtifact,
  validateTerritoryDataset
} from "@territory-kit/dataset";

const result = validateTerritoryDataset(input);

if (!result.ok) {
  console.error(result.issues);
}

const dataset = loadTerritoryDataset(input);
const geometryReport = validateGeometryDataset(dataset, { checks: "full" });
const adjacencyReport = validateTerritoryAdjacencyArtifact(dataset, adjacencyArtifact);
const adjacencyIndex = createTerritoryAdjacencyIndex(adjacencyArtifact);
```

## API Summary

- `validateTerritoryDataset(input)` validates a TerritoryKit dataset and returns structured issues.
- `loadTerritoryDataset(input)` validates and returns a typed dataset or throws.
- `createTerritoryDatasetFromGeoJson(input, options)` imports GeoJSON features into the schema.
- `createTerritoryGlobalId(input)` creates deterministic global territory IDs.
- `validateGlobalDatasetManifest(input)` validates the stricter global dataset manifest contract.
- `validateTerritoryGlobalMetadata(input)` validates `zone.properties.territory` metadata.
- `validateGeometryDataset(dataset, options)` runs validate-only geometry quality checks.
- `repairGeometryDataset(dataset, options)` applies explicit safe repairs and returns an audit
  report.
- `computeGeometryBBox`, `computeGeometryCenter`, and `geometryToPolygons` provide geometry helpers.
- `classifyTerritoryGeometryRelation` and `computeSharedBoundaryMeters` provide exact polygon
  adjacency primitives.
- `validateTerritoryAdjacencyArtifact` and `createTerritoryAdjacencyIndex` support separate
  adjacency artifacts.
- `TERRITORY_SCHEMA_VERSION` exposes the current `territory-schema@1` identifier.

## Global Dataset Metadata

Global datasets keep `territory-schema@1` compatibility by storing semantic administrative metadata
inside `zone.properties.territory`.

```ts
import { createTerritoryGlobalId, validateGlobalDatasetManifest } from "@territory-kit/dataset";

const id = createTerritoryGlobalId({
  countryCode: "TR",
  adminLevel: "ADM2",
  localId: "Fatih"
});

const manifestResult = validateGlobalDatasetManifest(manifest);
```

## License

Apache-2.0
