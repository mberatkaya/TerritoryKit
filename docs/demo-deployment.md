# Demo Deployment

The Turkey demo is a static Vite build and can be hosted on GitHub Pages, Cloudflare Pages, Netlify,
or any generic static host.

## Build

```bash
pnpm --filter @territory-kit/example-web-maplibre-turkey build
```

Output:

```text
examples/web-maplibre-turkey/dist/
```

Use `VITE_TERRITORY_BASE_PATH` when serving from a subpath:

```bash
VITE_TERRITORY_BASE_PATH=/TerritoryKit/ \
pnpm --filter @territory-kit/example-web-maplibre-turkey build
```

## GitHub Pages

1. Provide a public registry URL only after `territory registry verify` passes.
2. Build with `VITE_TERRITORY_BASE_PATH=/REPOSITORY_NAME/`.
3. Upload `examples/web-maplibre-turkey/dist` as the Pages artifact.

If no registry URL is available, deploy only as fixture mode and label it as a fixture preview.

## Cloudflare Pages

Build command:

```bash
pnpm --filter @territory-kit/example-web-maplibre-turkey build
```

Output directory:

```text
examples/web-maplibre-turkey/dist
```

Set production environment variables in the Cloudflare dashboard. Do not commit `.env` files.

## Suggested Headers

For immutable Vite assets:

```text
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

For `index.html`:

```text
/
  Cache-Control: no-cache
```

For registry artifacts, prefer immutable version paths:

```text
/datasets/*/versions/*
  Cache-Control: public, max-age=31536000, immutable
```

For mutable `registry.json`:

```text
/registry.json
  Cache-Control: public, max-age=60, stale-while-revalidate=300
```

## CSP Starting Point

Adjust origins for the real registry, tile source, and optional style URL:

```text
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
worker-src 'self' blob:;
connect-src 'self' https://YOUR_PUBLIC_DATASET_ORIGIN https://YOUR_TILE_ORIGIN;
font-src 'self' data:;
base-uri 'self';
frame-ancestors 'none';
```

MapLibre workers may require `blob:` in `worker-src`. If a custom style references sprites, glyphs,
or raster tiles, include those origins in `connect-src` and `img-src`.
