# @territory-kit/runtime

Minimal TerritoryKit runtime lifecycle contracts.

```bash
pnpm add @territory-kit/runtime
```

This package is the future coordination boundary for registry resolution, dataset loading, cache,
engine creation, viewport lifecycle, request cancellation, workers, and renderer adapter updates.
Sprint 11 intentionally implements only the stable foundation:

- create an isolated runtime with no global singleton
- inspect initial state
- subscribe and unsubscribe event listeners
- isolate listener failures
- dispose deterministically
- throw `TerritoryError` with `RUNTIME_DISPOSED` for invalid post-dispose calls

It does not download datasets, manage a catalog, start workers, or bind viewports yet. See
[runtime contract](../../docs/architecture/runtime-contract.md) for the public lifecycle policy.
