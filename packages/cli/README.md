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
```

## API Summary

- `territory validate <file>` validates a TerritoryKit dataset.
- `territory import <geojson>` converts GeoJSON features into a TerritoryKit dataset.
- `territory index <file>` builds engine metadata and reports dataset stats.
- `territory adjacency <file>` infers bounding-box adjacency.
- `territory generate grid` and `territory generate weighted-voronoi` create deterministic datasets.

The package also exports `runCli(argv)` for tests and embedded command runners.

## License

Apache-2.0
