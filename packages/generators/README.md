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
- `simplifyTerritoryDatasetPath(inputPath, options)` writes audited topology-safe geometry
  simplification tiers that simplify canonical shared-boundary arcs once and reuse them across
  adjacent polygons.
- `createTerritoryCountrySourceLock(options)` resolves and checksums country source artifacts,
  including reviewed HDX/OCHA COD-AB Turkey ADM0-ADM2 ZIP members.
- `buildTerritoryCountryDatasetPath(options)` writes country manifests, per-level datasets,
  hierarchy reports, identity maps, quality reports, and optional adjacency, query, render, and
  binary index artifacts.
- `createDefaultTerritorySourceRegistry()` returns built-in adapters for Natural Earth,
  geoBoundaries, HDX/OCHA COD-AB, and generic GeoJSON.
- `parseNaturalEarthAdm0FeatureCollection(input, source)` parses local Natural Earth-like GeoJSON
  without network access.
- `inferBBoxAdjacency(zones, options)` returns neighbor IDs inferred from bounding boxes for
  development fixtures.
- `inferBBoxAdjacencyConnections(zones, options)` returns adjacency connection objects.
- `buildTurkeyGameZones(options)` and `buildTurkeyGameZonesWithAdjacency(options)` build Turkey V2
  generated game zones with `urban`, `suburban`, `rural`, `auto`, and `custom` profiles.

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
  levels: ["ADM0", "ADM1", "ADM2", "ADM3", "ADM4"],
  adm3Provinces: ["27"],
  adm3CatalogPath: "datasets/sources/TR/adm3-catalog.json",
  outputPath: "./dist/tr/sources.lock.json"
});

await buildTerritoryCountryDatasetPath({
  country: "TR",
  sourceLockPath: "./dist/tr/sources.lock.json",
  outputPath: "./dist/tr",
  buildAdjacency: true,
  buildQueryArtifacts: true,
  buildRenderArtifacts: true,
  buildBinaryIndex: true,
  strict: true,
  allowPartial: true
});
```

Configured pilot countries are `TR`, `US`, `DE`, `JP`, and `ID`.
Turkey resolves national ADM0-ADM2 from HDX/OCHA COD-AB by default. ADM3 and ADM4 remain explicit
unavailable levels unless a reviewed redistributable source is added to the source lock.
Turkey ADM3 ingestion is province-scoped and writes `extensions.turkeyAdm3`, `coverage.json`,
`adm3-quality-gates.json`, and `adm3-source-provenance-report.json` when requested.

## Turkey V2 Game Zones

```ts
import { buildTurkeyGameZonesWithAdjacency } from "@territory-kit/generators/turkey-adm3";

const result = await buildTurkeyGameZonesWithAdjacency({
  district,
  provinceCode: "34",
  districtCode: "003",
  profile: "auto",
  seed: "kaprota-v2"
});
```

The V2 algorithm version is `tr-adm3-game-zone-v2`. Generated game zones are deterministic
`generated-zone` ADM3 records, not official mahalle or köy polygons.

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
