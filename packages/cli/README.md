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
territory generate grid --rows 4 --columns 4
territory source list
territory import geojson --input ./regions.geojson --country TR --admin-level ADM2 --name-property name --output ./dist/regions
territory geometry validate ./dist/regions --checks full --report ./geometry-report.json
territory geometry repair ./dist/regions --checks basic --output ./dist/regions-repaired --report ./repair-report.json
territory adjacency build ./dist/regions --output ./dist/regions-adjacency --build-date 2026-01-01T00:00:00.000Z
territory adjacency validate ./dist/regions ./dist/regions-adjacency
territory adjacency inspect ./dist/regions-adjacency tr:adm2:fatih --type shared-border --json
territory dataset build world-countries --source ./sources/ne-admin0.geojson --output ./dist/world-countries
territory country source lock TR --output ./dist/tr/sources.lock.json
territory country build TR --source-lock ./dist/tr/sources.lock.json --output ./dist/tr --build-adjacency --strict
territory country validate ./dist/tr --strict
```

## API Summary

- `territory validate <file>` validates a TerritoryKit dataset.
- `territory import <geojson>` converts GeoJSON features into a TerritoryKit dataset.
- `territory source list` and `territory source info <id>` inspect source adapters.
- `territory import natural-earth|geoboundaries|geojson` runs the source adapter pipeline.
- `territory geometry validate <dataset-path>` runs validate-only geometry quality checks.
- `territory geometry repair <dataset-path> --output <dir>` applies safe audited repairs.
- `territory adjacency build <dataset-path> --output <dir|json>` builds exact polygon adjacency
  artifacts.
- `territory adjacency validate <dataset-path> <dir|json>` validates an adjacency artifact.
- `territory adjacency inspect <dir|json> <zone-id>` inspects typed neighbors.
- `territory index <file>` builds engine metadata and reports dataset stats.
- `territory adjacency <file>` remains a legacy bounding-box development helper.
- `territory generate grid` and `territory generate weighted-voronoi` create deterministic datasets.
- `territory dataset build world-countries` builds Natural Earth ADM0 artifacts from a local source
  file.
- `territory country source lock|verify`, `territory country build`, `territory country validate`,
  and `territory country inspect` manage pilot ADM0/ADM1/ADM2 country artifacts.

Dataset build options include `--detail`, `--source-version`, `--source-url`, `--source-sha256`,
`--build-date`, `--strict`, and `--force`.

The package also exports `runCli(argv)` for tests and embedded command runners.

## License

Apache-2.0
