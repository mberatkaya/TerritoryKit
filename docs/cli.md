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
