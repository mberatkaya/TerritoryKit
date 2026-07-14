# Vector Tile Pipeline

The render builder converts TerritoryKit datasets to a render feature collection and slices it with
`@maplibre/geojson-vt`. Tiles are serialized with `@maplibre/vt-pbf` into:

```text
render/manifest.json
render/tiles/{z}/{x}/{y}.mvt
query/query-artifact.json
```

Use `--min-zoom` and `--max-zoom` to keep fixture and CI builds small. Production builds should set
an explicit zoom policy per dataset and verify tile counts before hosting.
