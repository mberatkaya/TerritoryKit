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

`territory country build --build-render-artifacts` uses the country render policy. Turkey defaults
to ADM0 z0-z4, ADM1 z5-z7, ADM2 z8-z11, ADM3 z12-z14, and ADM4 z15-z17, but ADM3/ADM4 tiles are
not emitted unless reviewed source data exists in the source lock. Render manifests record layer
coverage, tile counts, byte totals, max tile size, checksums, attribution, and source-layer
metadata.
