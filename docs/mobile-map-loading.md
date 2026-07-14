# Mobile Map Loading

Mobile and browser clients should load render artifacts first. Render sources use vector tiles or
GeoJSON optimized for display and keep feature properties small:

- `territoryId`
- `adminLevel`
- `name`
- dataset id/version

Query artifacts are loaded lazily for selected territories or search workflows. Node filesystem
cache helpers stay under `@territory-kit/registry/node`; browser and React Native integrations
should inject platform transport/cache adapters.
