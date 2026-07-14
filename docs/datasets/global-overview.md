# Global Dataset Overview

TerritoryKit separates the engine from administrative boundary data. The engine handles hierarchy,
adjacency, spatial lookup, render/query artifacts, and integrations. Dataset providers handle real
boundary source discovery, licensing, download, normalization, and artifact generation.

The global dataset registry is generated with:

```bash
pnpm registry:generate
territory dataset coverage
```

Generated registry files:

- `datasets/registry/countries.json`: ISO 3166 country/area config seed with per-level semantic
  mappings.
- `datasets/registry/coverage.json`: country/level coverage status.
- `datasets/registry/providers.json`: implemented provider metadata and redistribution flags.
- `docs/datasets/coverage.md`: human-readable coverage summary.

## Coverage Rules

Coverage is intentionally conservative:

- ADM0 is source-available for 249 ISO countries/areas through the Natural Earth ADM0 pipeline.
- ADM1 and ADM2 are reviewed only for DE, ID, JP, TR, and US in this repository state.
- Non-pilot ADM1/ADM2 entries are `not-reviewed` and use `semanticType: "unknown"`.
- Municipality and neighbourhood levels are `unavailable` until a real, licensed source is wired.
- Missing local data must not be silently replaced with broader ADM2 geometry.

Large generated geometry artifacts stay out of Git and npm packages. Commit source definitions,
locks, manifests, checksums, attribution, coverage, and small fixtures instead.
