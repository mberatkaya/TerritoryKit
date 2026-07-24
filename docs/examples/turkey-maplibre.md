# Turkey MapLibre Example

`examples/web-maplibre-turkey` is a registry-backed MapLibre demo for real Turkey artifacts. It does
not embed geometry or API tokens.

```bash
VITE_TERRITORY_REGISTRY_URL=http://localhost:4173/tr/ \
VITE_MAP_STYLE_URL=https://demotiles.maplibre.org/style.json \
pnpm --filter @territory-kit/example-web-maplibre-turkey dev
```

`VITE_TERRITORY_REGISTRY_URL` should point at an artifact root containing `render/manifest.json` and
`render/tiles/{z}/{x}/{y}.mvt`. The demo displays ADM2 national coverage metadata and surfaces ADM3
and ADM4 fallback status until nationwide lower-admin sources are available.
