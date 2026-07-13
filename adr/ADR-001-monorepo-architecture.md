# ADR-001: TypeScript Monorepo Architecture

## Status

Accepted for `0.0.1`.

## Context

TerritoryKit is an open source SDK made of multiple npm packages rather than a single
application. The core engine must stay independent from map renderers, NestJS, PostGIS,
and game-specific state.

## Decision

- Use pnpm workspaces and Turborepo for task orchestration.
- Use Changesets with fixed `@territory-kit/*` package versions.
- Use TypeScript `6.0.3`, ESM and CJS package outputs, and generated declaration files.
- Keep dependency direction as `dataset -> core -> adapters/integrations -> examples`.
- Use Apache-2.0 as the default project license.

## Consequences

- Every public package can be built and released independently while sharing a version line.
- Adapters cannot leak renderer or backend dependencies into `@territory-kit/core`.
- The first implementation can focus on dataset validation and core geospatial behavior
  before visual adapters and backend integrations become production-ready.
