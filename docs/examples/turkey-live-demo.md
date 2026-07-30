# Turkey Live Demo

`examples/web-maplibre-turkey` is the browser demo for exploring TerritoryKit Turkey ADM1,
ADM2, and partial ADM3 coverage.

The demo has two explicit modes:

- `fixture`: default CI-safe mode. It uses a small synthetic Turkey ADM3 fixture and must not be
  described as a production deployment.
- `registry`: hosted registry mode. It requires `VITE_TERRITORY_REGISTRY_URL` and resolves real
  hosted render/query artifacts from the registry.

## Local Commands

```bash
pnpm --filter @territory-kit/example-web-maplibre-turkey dev
pnpm --filter @territory-kit/example-web-maplibre-turkey test
pnpm --filter @territory-kit/example-web-maplibre-turkey test:e2e
pnpm --filter @territory-kit/example-web-maplibre-turkey perf:budget
```

Registry mode:

```bash
VITE_TERRITORY_REGISTRY_URL=https://datasets.example.invalid/registry.json \
VITE_TERRITORY_DATASET_VERSION=0.1.0 \
pnpm --filter @territory-kit/example-web-maplibre-turkey dev
```

Operators must provide the real public registry URL. This repository intentionally does not commit
production URLs, tokens, or provider credentials.

## Capabilities

- MapLibre map with token-free default style and optional `VITE_MAP_STYLE_URL`.
- Zoom-driven ADM1, ADM2, and ADM3 render transitions.
- Registry MVT render manifest loading and vector tile rendering.
- Lazy query artifact loading for search, click selection, parent/children/neighbors, and
  coordinate lookup.
- URL state sharing with `?territory=<id>&level=<ADM*>`.
- Registry status, dataset version, source/license, coverage, load time, cache, visible feature
  count, error, and fallback panels.
- ADM3 partial coverage warning. Turkey ADM3 is limited to reviewed parent areas until a reviewed
  nationwide source is available.

The fixture tests cover map open, metadata, ADM1/ADM2 selection, search, URL state, registry error
fallback, ADM3 warning, accessibility smoke, visual regression, and performance smoke.

## Production Preconditions

Before calling this a live production demo, verify:

```bash
pnpm registry:publish:smoke
pnpm query-render:smoke
territory registry verify --registry "$PUBLIC_REGISTRY_URL" --dataset territory-kit-tr --version "$VERSION"
```

Without a real verified registry URL, publish only fixture or deployment-ready previews and label
them accordingly.
