# Renderer Adapter Comparison

All web renderer adapters implement `TerritoryRendererAdapter<TTarget>` from
`@territory-kit/adapter-core`. Runtime viewport loading is renderer independent: the runtime queries
visible zones, serializes them to GeoJSON, calls `setSource()`, and passes an abort signal so stale
operations cannot commit.

| Capability                       | MapLibre                                                             | Leaflet                                                            | OpenLayers                                                               |
| -------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Package                          | `@territory-kit/maplibre`                                            | `@territory-kit/leaflet`                                           | `@territory-kit/openlayers`                                              |
| Factory                          | `createMapLibreTerritoryAdapter` or `createTerritoryMapLibreAdapter` | `createLeafletTerritoryAdapter` or `createTerritoryLeafletAdapter` | `createOpenLayersTerritoryAdapter` or `createTerritoryOpenLayersAdapter` |
| Renderer peer dependency         | `maplibre-gl >=5`                                                    | `leaflet >=1.9`                                                    | `ol >=10`                                                                |
| Runtime GeoJSON updates          | Supported                                                            | Supported                                                          | Supported                                                                |
| Native GeoJSON renderer          | GeoJSON source and fill/line layers                                  | `L.geoJSON`                                                        | `VectorSource` and `VectorLayer`                                         |
| MVT render artifact path         | Source/layer helper supports vector tile source specs                | Optional via application-provided Leaflet plugin factory           | Optional via application-provided vector tile source/layer factories     |
| Feature state                    | MapLibre feature state                                               | Style refresh from adapter state                                   | Feature properties plus style refresh                                    |
| Click and hover                  | Layer events                                                         | GeoJSON layer events                                               | Map feature picking                                                      |
| Selected territory and highlight | `updateState()`                                                      | `updateState()` with style callback                                | `updateState()` with style callback                                      |
| Viewport event helper            | Application or runtime owns map event binding                        | Application reads Leaflet bounds/zoom and calls runtime            | Application reads transformed OpenLayers extent/zoom and calls runtime   |
| Projection checks                | Renderer source CRS is assumed by MapLibre style/source config       | GeoJSON must be EPSG:4326/CRS84                                    | `dataProjection` and `featureProjection` are validated                   |
| SSR import safety                | Type-only renderer boundary                                          | Type-only renderer boundary                                        | Structural types and injected OpenLayers objects                         |
| Dispose lifecycle                | Removes managed layers, source, and listeners                        | Removes managed layer and listeners                                | Removes managed layer and map listeners                                  |

## Unsupported Or Optional Features

Leaflet vector tiles are not enabled by default because Leaflet does not include native MVT support.
Choose a plugin in the application and pass `createVectorTileLayer`.

OpenLayers vector tiles are not enabled by default because applications need to own `MVT`,
`VectorTileSource`, `VectorTileLayer`, and style construction. Pass both vector tile factories to
enable the capability.

Runtime viewport updates currently commit GeoJSON sources to attached adapters. Registry render
artifact helpers can resolve MVT or GeoJSON render source metadata, but applications decide whether
to render those registry sources directly or use runtime query-driven GeoJSON viewport updates.

Symbol layers, transitions, and live renderer theme transitions are not implemented uniformly
across all renderers. Adapters report unsupported features through immutable capability metadata and
throw `CAPABILITY_UNSUPPORTED` for unsupported source replacement calls.

## Bundle Budgets

Renderer packages keep their renderer libraries as peer dependencies and mark package modules as
side-effect free. Current bundle-size gates are:

| Bundle                                 | Limit |
| -------------------------------------- | ----: |
| `packages/maplibre/dist/index.mjs`     | 45 KB |
| `packages/leaflet/dist/index.mjs`      | 45 KB |
| `packages/openlayers/dist/index.mjs`   | 55 KB |
| `packages/adapter-core/dist/index.mjs` | 32 KB |
