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
- `buildTurkeySmartFallback(options)` and `buildTurkeySmartFallbackWithAdjacency(options)` build
  OSM-barrier-guided, non-authoritative Turkey ADM3 fallback zones and return gate diagnostics,
  real-barrier alignment metrics, input counts, and deterministic output hashes.
- `acquireTurkeyOsmSnapshot`, `verifyTurkeyOsmSnapshot`,
  `extractTurkeyOsmBarriersFromPbf`, `buildTurkeyOsmBarrierArtifacts`, and
  `createTurkeyOsmSmartFallbackGeneratedOptions` provide the Turkey OSM barrier snapshot pipeline
  for source-locked, offline-rebuildable smart fallback input.

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

## Turkey OSM Barrier Snapshots

```ts
import {
  buildTurkeyOsmBarrierArtifacts,
  createTurkeyOsmSmartFallbackGeneratedOptions,
  readTurkeyOsmAdm2BarrierArtifact,
  verifyTurkeyOsmSnapshot
} from "@territory-kit/generators/turkey-adm3";

const verified = await verifyTurkeyOsmSnapshot({
  sourceLockPath: ".territory/cache/osm/TR/<snapshot-id>/source-lock.json"
});

if (!verified.ok) {
  throw new Error("OSM snapshot checksum mismatch");
}

await buildTurkeyOsmBarrierArtifacts({
  snapshotPath: verified.snapshotPath,
  sourceLock: verified.sourceLock,
  adm2Zones,
  outputRoot: ".territory/build/TR/OSM-barriers",
  concurrency: 2
});

const artifact = await readTurkeyOsmAdm2BarrierArtifact(
  ".territory/build/TR/OSM-barriers",
  "tr:adm2:example"
);
const generated = createTurkeyOsmSmartFallbackGeneratedOptions(artifact);
```

The pipeline uses the Geofabrik Turkey OpenStreetMap `.osm.pbf` country extract as the default
provider, locks cached snapshots by SHA-256, extracts road/rail/water/park/landuse barriers and
locality seeds, clips artifacts to ADM2 geometry, and keeps raw PBF files under `.territory/cache`.
Real-sized PBF builds use ADM2 spatial prefiltering and deterministic province-oriented batches to
keep memory bounded. The output feeds the existing smart fallback engine and does not promote OSM
place nodes or smart-derived output to official administrative boundaries.

Smart fallback quality reports include raw input diagnostics, raw and normalized topology coverage
areas, global real-barrier alignment ratios, synthetic-boundary ratios, and explicit rejection
codes for failing gates. Hybrid builds expose the same evidence under `quality.smartAttempt`, so
callers can distinguish accepted smart output from a smart rejection that selected legacy fallback.

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
