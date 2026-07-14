# CLI

The CLI is JSON-first so import pipelines can parse every command.

```sh
territory validate dataset.json
territory index dataset.json
territory adjacency dataset.json
territory import source.geojson --dataset-id demo --source-date 2026-07
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

`territory generate` rejects invalid grid dimensions, invalid cell sizes, invalid levels, and
unordered weighted-voronoi bounds using the same JSON-first error shape.

`territory dataset build world-countries` builds Natural Earth ADM0 artifacts from a local GeoJSON
source. It writes `manifest.json`, `attribution.txt`, `checksums.json`, `build-report.json`, and
detail-specific `dataset.json` files. Use `--source-sha256` to verify the source before parsing,
`--build-date` or `SOURCE_DATE_EPOCH` for reproducible output, `--strict` to fail on warnings, and
`--force` to replace an existing output directory.
