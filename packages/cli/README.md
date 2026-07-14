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
territory dataset build world-countries --source ./sources/ne-admin0.geojson --output ./dist/world-countries
```

## API Summary

- `territory validate <file>` validates a TerritoryKit dataset.
- `territory import <geojson>` converts GeoJSON features into a TerritoryKit dataset.
- `territory index <file>` builds engine metadata and reports dataset stats.
- `territory adjacency <file>` infers bounding-box adjacency.
- `territory generate grid` and `territory generate weighted-voronoi` create deterministic datasets.
- `territory dataset build world-countries` builds Natural Earth ADM0 artifacts from a local source
  file.

Dataset build options include `--detail`, `--source-version`, `--source-url`, `--source-sha256`,
`--build-date`, `--strict`, and `--force`.

The package also exports `runCli(argv)` for tests and embedded command runners.

## License

Apache-2.0
