# @territory-kit/adapter-core

Renderer-independent contracts for TerritoryKit map adapters.

```bash
pnpm add @territory-kit/adapter-core
```

This package defines shared adapter capabilities, lifecycle states, render source/state/theme
contracts, and small pure helpers. It does not import MapLibre, Leaflet, OpenLayers, React Native,
DOM APIs, network APIs, or filesystem APIs.

## Contract Policy

- `attach(target)` binds the adapter to a renderer target. Attaching a different target first
  detaches or replaces the previous target according to the implementation.
- Attaching the same target twice must be deterministic and must not register duplicate listeners.
- `setSource`, `updateState`, and `updateTheme` require `lifecycleState === "attached"` unless an
  adapter documents a legacy compatibility method separately.
- Unsupported capability calls throw `TerritoryError` with code `CAPABILITY_UNSUPPORTED`.
- Calls after disposal throw `TerritoryError` with code `ADAPTER_DISPOSED`.
- Async implementations reject with `TerritoryError` or preserve the original error as `cause`.

See [adapter contract](../../docs/architecture/adapter-contract.md) for the architecture notes.
