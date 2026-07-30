# Turkey OpenLayers Example

`examples/web-openlayers-turkey` demonstrates runtime-driven TerritoryKit rendering on
OpenLayers. It uses the synthetic Turkey ADM0-ADM3 fixture by default, so it works without a
registry, API token, or proprietary basemap.

```bash
pnpm --filter @territory-kit/example-web-openlayers-turkey dev
```

To use a hosted registry, provide:

```bash
VITE_TERRITORY_REGISTRY_URL=https://cdn.example.test/registry.json \
VITE_TERRITORY_DATASET_ID=territory-kit-tr \
pnpm --filter @territory-kit/example-web-openlayers-turkey dev
```

The example transforms the OpenLayers view extent from EPSG:3857 to EPSG:4326 before calling
`runtime.setViewport()`. The adapter reads GeoJSON with `dataProjection: "EPSG:4326"` and
`featureProjection: "EPSG:3857"`, then renders through a managed `VectorSource` and `VectorLayer`.
Zoom levels below 6 request ADM1, zoom levels below 10 request ADM2, and deeper zooms request ADM3
for the fixture. The side panel shows selected territory ID, name, level, parent, rendered level,
and fixture/registry fallback status.

Run the browser smoke test with:

```bash
pnpm --filter @territory-kit/example-web-openlayers-turkey test:visual
```
