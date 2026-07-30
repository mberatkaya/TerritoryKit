# Support Matrix

Support entries are derived from package peer dependencies, `pnpm-lock.yaml`, and the CI/test
environment for `release/production-hardening`.

| Area                  | Supported range                                             | Verified environment                                                          |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Node.js               | `>=22`                                                      | CI matrix Node 22 and 24; local hardening Node `v24.14.0`                     |
| pnpm                  | `>=11`                                                      | `pnpm@11.7.0`                                                                 |
| TypeScript            | repo compiler                                               | `typescript@6.0.3`                                                            |
| Browser               | modern ESM browsers                                         | Vite `8.1.4`, Playwright `1.61.1`, Chromium visual smoke for MapLibre example |
| MapLibre GL JS        | `maplibre-gl >=5`                                           | `maplibre-gl@5.24.0`                                                          |
| Leaflet               | `leaflet >=1.9`                                             | `leaflet@1.9.4`                                                               |
| OpenLayers            | `ol >=10`                                                   | `ol@10.10.0`                                                                  |
| React Native          | `react-native >=0.72`, `react >=18`                         | lockfile has `react-native@0.86.2`, `react@19.2.8`                            |
| MapLibre React Native | `@maplibre/maplibre-react-native >=11`                      | lockfile has `11.3.6`                                                         |
| Android               | inherited from React Native and MapLibre React Native peers | no native Android CI job in this repo                                         |
| iOS                   | inherited from React Native and MapLibre React Native peers | no native iOS CI job in this repo                                             |
| NestJS                | `@nestjs/common >=11`, `@nestjs/swagger >=11`, `rxjs >=7`   | `@nestjs/common@11.1.28`, `@nestjs/swagger@11.4.5`, `rxjs@7.8.2`              |
| PostGIS               | extension required by example SQL                           | no version-pinned package dependency or live DB CI matrix                     |

## Package Runtime Boundaries

| Package group                                        | Runtime boundary                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `dataset`, `core`, `adapter-core`, `runtime`, `game` | Browser-safe TypeScript packages with no Node-only imports in source.                                                  |
| `registry`                                           | Root entry is browser-safe; Node filesystem/cache helpers live under `@territory-kit/registry/node`.                   |
| `maplibre`, `leaflet`, `openlayers`                  | Renderer libraries are peer dependencies and are not bundled by applications that do not import that renderer package. |
| `react-native`                                       | Mobile runtime avoids Node filesystem APIs, browser workers, IndexedDB, Cache API, `window`, and `document`.           |
| `nestjs`, `cli`, `generators`                        | Node-oriented packages; do not import them in browser or React Native bundles.                                         |

## Verification Notes

- SSR import smoke is covered by ESM/CJS export checks in `pnpm release:hardening`.
- MapLibre visual verification runs in CI on Node 24 after installing Chromium.
- React Native is verified at package/type/import-boundary level only; native Android and iOS
  app builds remain manual consumer validation.
- PostGIS SQL and repository contracts are covered by TypeScript tests and docs, but no
  containerized PostGIS service is launched in normal CI.
