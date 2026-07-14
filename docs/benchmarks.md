# Benchmarks

Benchmark fixtures are generated at runtime with deterministic rectangular polygon grids.
No H3 grid or hexagonal resolution system is used.

## Sprint 2-3 Targets

- `getZoneById`: constant-time map lookup.
- `latLngToZone`: indexed lookup path must be measured on 10K polygons before Sprint 3 is
  marked complete.
- `getZonesInBounds`: viewport-sized bbox query must use the spatial index in production.
- Dataset load: benchmark smoke must include index construction time before release
  candidate hardening.
- Memory: use `pnpm bench:memory` after a build to record heap deltas for deterministic large
  graph fixtures.

Run:

```sh
pnpm bench
```

The first tracked fixture is 10K polygons (`100 x 100`). A 100K polygon fixture exists for
larger smoke runs, but it should not be committed as static data.

## Latest Smoke Run

Recorded on 2026-07-14 with `pnpm bench`:

| Benchmark                             |        Mean |          p99 |         p995 |
| ------------------------------------- | ----------: | -----------: | -----------: |
| `latLngToZone`, 10K polygons          | `0.0003 ms` |  `0.0005 ms` |  `0.0006 ms` |
| `getZonesInBounds`, 10K polygons      | `0.0606 ms` |  `0.0665 ms` |  `0.0693 ms` |
| `getZoneById`, 10K polygons           | `0.0000 ms` |  `0.0000 ms` |  `0.0000 ms` |
| Engine construction, 10K polygons     | `9.6710 ms` | `24.7328 ms` | `24.7328 ms` |
| Dataset validation load, 10K polygons | `7.8126 ms` | `15.7765 ms` | `15.7765 ms` |
| `latLngToZone`, 100K polygons         | `0.0004 ms` |  `0.0005 ms` |  `0.0006 ms` |

Vitest reports p99/p995 instead of p95. Since p99 is below the p95 target, the p95 gate is
treated as satisfied for this smoke run.

## Latest Memory Run

Recorded on 2026-07-14 with `pnpm bench:memory`:

| Fixture                  | Features | Dataset heap delta |  Engine heap delta |   Total heap delta |
| ------------------------ | -------: | -----------------: | -----------------: | -----------------: |
| `100x100` synthetic grid | `10,000` | `11,060,496 bytes` | `11,399,240 bytes` | `22,459,736 bytes` |

The memory benchmark uses `node --expose-gc` and records heap deltas after deterministic fixture
creation and engine index construction. It is kept separate from `pnpm bench` so the regular
benchmark smoke stays quick.
