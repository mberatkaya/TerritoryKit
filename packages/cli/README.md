# @territory-kit/cli

Command line tools for validating, importing, generating, indexing, and inspecting TerritoryKit datasets.

## Installation

```sh
pnpm add -g @territory-kit/cli
```

## Basic Usage

```sh
territory validate dataset.json
territory index dataset.json
territory index build dataset.json --output dataset.tksi
territory index inspect dataset.tksi
territory index validate dataset.tksi --dataset dataset.json
territory generate grid --rows 4 --columns 4
territory source list
territory import geojson --input ./regions.geojson --country TR --admin-level ADM2 --name-property name --output ./dist/regions
territory import hdx-cod-ab --input ./tur_admin2.geojson --country TR --admin-level ADM2 --output ./dist/tr-adm2
territory geometry validate ./dist/regions --checks full --report ./geometry-report.json
territory geometry repair ./dist/regions --checks basic --output ./dist/regions-repaired --report ./repair-report.json
territory geometry simplify ./dist/regions --strategy topology-safe --detail high,medium,low --output ./dist/regions-simplified --report ./simplification-report.json
territory adjacency build ./dist/regions --output ./dist/regions-adjacency --build-date 2026-01-01T00:00:00.000Z
territory adjacency validate ./dist/regions ./dist/regions-adjacency
territory adjacency inspect ./dist/regions-adjacency tr:adm2:fatih --type shared-border --json
territory dataset build world-countries --source ./sources/ne-admin0.geojson --output ./dist/world-countries
territory country source lock TR --output ./dist/tr/sources.lock.json
territory country source lock TR --levels ADM0,ADM1,ADM2,ADM3 --adm3-provinces 27 --adm3-catalog datasets/sources/TR/adm3-catalog.json --output ./dist/tr/sources.lock.json
territory country build TR --source-lock ./dist/tr/sources.lock.json --output ./dist/tr --build-adjacency --build-query-artifacts --build-render-artifacts --build-binary-index --strict --allow-partial
territory country validate ./dist/tr --strict
territory registry publish --artifact-root ./dist/tr/artifact --registry-output ./dist/registry --dataset territory-kit-tr --version 1.0.0 --base-url https://datasets.example.com/tr/1.0.0/ --artifact-prefix tr/1.0.0 --dry-run
territory registry verify --registry https://datasets.example.com/registry.json --dataset territory-kit-tr --version 1.0.0
```

## API Summary

- `territory validate <file>` validates a TerritoryKit dataset.
- `territory import <geojson>` converts GeoJSON features into a TerritoryKit dataset.
- `territory source list` and `territory source info <id>` inspect source adapters.
- `territory import natural-earth|geoboundaries|geojson` runs the source adapter pipeline.
- `territory import hdx-cod-ab` imports reviewed HDX/OCHA COD-AB GeoJSON members for Turkey
  ADM0-ADM2.
- `territory geometry validate <dataset-path>` runs validate-only geometry quality checks.
- `territory geometry repair <dataset-path> --output <dir>` applies safe audited repairs.
- `territory geometry simplify <dataset-path> --strategy topology-safe` writes audited real
  simplification tiers and omits duplicate-hash placeholders.
- `territory adjacency build <dataset-path> --output <dir|json>` builds exact polygon adjacency
  artifacts.
- `territory adjacency validate <dataset-path> <dir|json>` validates an adjacency artifact.
- `territory adjacency inspect <dir|json> <zone-id>` inspects typed neighbors.
- `territory index <file>` builds engine metadata and reports dataset stats.
- `territory index build <dataset.json> --output <index.tksi>` writes a binary spatial index.
- `territory index inspect <index.tksi>` prints index metadata.
- `territory index validate <index.tksi> [--dataset <dataset.json>]` checks checksum and optional
  dataset metadata.
- `territory adjacency <file>` remains a legacy bounding-box development helper.
- `territory generate grid` and `territory generate weighted-voronoi` create deterministic datasets.
- `territory dataset build world-countries` builds Natural Earth ADM0 artifacts from a local source
  file.
- `territory country source lock|verify`, `territory country build`, `territory country validate`,
  and `territory country inspect` manage country artifacts. Turkey's default national path verifies
  ADM0-ADM2 from HDX/OCHA COD-AB and records ADM3/ADM4 as unavailable unless a reviewed source lock
  provides them.
- `territory country source lock TR --adm3-provinces <codes> --adm3-catalog <catalog>` enables
  province-scoped Turkey ADM3 ingestion with checksum, byte-size, license, coverage, and provenance
  metadata.
- `territory registry publish` prepares provider-neutral hosted registry bundles with immutable
  version artifacts, inventory metadata, and rollback manifests.
- `territory registry verify` validates a hosted registry and checks artifact SHA-256 and byte
  sizes.

Dataset build options include `--detail`, `--source-version`, `--source-url`, `--source-sha256`,
`--build-date`, `--strict`, and `--force`.

The package also exports `runCli(argv)` for tests and embedded command runners.

## License

Apache-2.0
