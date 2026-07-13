# Contributing

Thanks for helping shape TerritoryKit.

## Development Setup

```sh
pnpm install --ignore-scripts
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Use Node.js `22` or `24` and pnpm `11`.

## Roadmap Discipline

Do not mark roadmap work complete unless the code, tests, docs, examples, and
benchmark/security/license impact for that item are covered.

## Package Boundaries

- `@territory-kit/core` must not depend on MapLibre, NestJS, PostGIS, or game state.
- Dataset geometry is GeoJSON `Polygon`/`MultiPolygon`; no H3 grid or hex math is implemented.
- Dynamic ownership, score, and faction state belong outside the core geometry model.

## Pull Requests

Include the checklist item, tests run, docs updated, and any benchmark/security/license notes.
Public API changes need TypeScript types and docs.
