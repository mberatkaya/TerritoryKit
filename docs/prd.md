# TerritoryKit Product Requirements

## Purpose

TerritoryKit is an open source TypeScript SDK for hierarchical, irregular polygon territories. It should give developers an H3-like API while working with real administrative boundaries or custom-designed regions instead of mathematical hexagons.

## Primary Users

- SDK users building strategy games, delivery zones, field operations, election maps, campus maps, and administrative boundary tools.
- Backend developers serving large territory datasets through Node.js, NestJS, and PostGIS.
- Frontend developers rendering territory layers in MapLibre first, then other map renderers later.

## MVP Scope

- Load and validate GeoJSON Polygon and MultiPolygon datasets.
- Resolve a coordinate to a zone ID.
- Return zone boundary, center, bbox, parent, children, ancestors, descendants, and neighbors.
- Select active detail level from zoom.
- Query zones by viewport bounds.
- Provide a first MapLibre adapter package boundary.
- Provide a NestJS integration package boundary.
- Provide generator and CLI package boundaries.
- Include small Turkey, Istanbul, and Fatih example datasets.

## Out Of Scope For MVP

- Full global administrative dataset distribution.
- Satellite imagery or tile server operation.
- Custom projection engine.
- H3-grade global geodesic math.
- Full visual territory editor.
- Game ownership, scoring, or conquest rules inside `@territory-kit/core`.

## Success Criteria

- Public API stays simple and H3-like.
- Core package remains independent from renderers, backend frameworks, and game state.
- Dataset schema is versioned and validates hierarchy and geometry quality.
- Spatial lookup avoids brute-force production scans.
- Examples prove Node.js, browser, MapLibre, and NestJS integration paths.
- Checklist, roadmap, docs, and release notes stay consistent.

## Non-Functional Requirements

- Runtime: Node.js `>=22`; CI covers Node 22 and 24.
- Package manager: pnpm workspace with Turborepo.
- Package output: ESM, CJS, and declarations.
- License: Apache-2.0 unless changed by ADR.
- Documentation: VitePress and API docs.
- Verification: build, typecheck, lint, unit tests, integration tests where relevant, and benchmark gates for spatial work.
