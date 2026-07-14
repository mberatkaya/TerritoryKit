# CLI

The CLI is JSON-first so import pipelines can parse every command.

```sh
territory validate dataset.json
territory index dataset.json
territory adjacency dataset.json
territory import source.geojson --dataset-id demo --source-date 2026-07
territory source list
territory source info natural-earth
territory import natural-earth --input ./natural-earth.geojson --output ./dist/world-countries
territory import geoboundaries --input ./geoBoundaries-TUR-ADM1.geojson --country TR --admin-level ADM1 --output ./dist/tr-adm1
territory import geojson --input ./regions.geojson --country TR --admin-level ADM2 --name-property region.name --output ./dist/regions
territory simplify dataset.json
territory generate --kind grid --dataset-id demo --rows 10 --columns 10
territory generate --kind weighted-voronoi --dataset-id demo
territory dataset build world-countries --source ./sources/ne-admin0.geojson --output ./dist/world-countries
```

Every command returns:

```json
{
  "ok": true,
  "command": "index",
  "data": {}
}
```

Errors use `issues`; GeoJSON import issues include `featureId`, `sourcePath`, and
`repairSuggestion` when available.

`territory import` recomputes `manifest.geometryHash` before printing the imported dataset,
even when the manifest flag used `import-pending`.

`territory import <source-id>` uses the source adapter pipeline. Common options are `--input`,
`--url`, `--output`, `--source-version`, `--source-date`, `--source-sha256`, `--strict`, `--force`,
`--refresh`, `--no-cache`, `--cache-dir`, and `--build-date`.

`territory generate` rejects invalid grid dimensions, invalid cell sizes, invalid levels, and
unordered weighted-voronoi bounds using the same JSON-first error shape.

`territory dataset build world-countries` builds Natural Earth ADM0 artifacts from a local GeoJSON
source. It writes `manifest.json`, `attribution.txt`, `checksums.json`, `build-report.json`, and
detail-specific `dataset.json` files. Use `--source-sha256` to verify the source before parsing,
`--build-date` or `SOURCE_DATE_EPOCH` for reproducible output, `--strict` to fail on warnings, and
`--force` to replace an existing output directory.
