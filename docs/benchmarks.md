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

Run:

```sh
pnpm bench
```

The first tracked fixture is 10K polygons (`100 x 100`). A 100K polygon fixture exists for
larger smoke runs, but it should not be committed as static data.

## Latest Smoke Run

Recorded on 2026-07-14 with `pnpm bench`:

| Benchmark                         |        Mean |          p99 |         p995 |
| --------------------------------- | ----------: | -----------: | -----------: |
| `latLngToZone`, 10K polygons      | `0.0003 ms` |  `0.0005 ms` |  `0.0006 ms` |
| `getZonesInBounds`, 10K polygons  | `0.0603 ms` |  `0.0663 ms` |  `0.0692 ms` |
| `getZoneById`, 10K polygons       | `0.0000 ms` |  `0.0000 ms` |  `0.0000 ms` |
| Engine construction, 10K polygons | `9.1340 ms` | `11.9017 ms` | `11.9017 ms` |
| `latLngToZone`, 100K polygons     | `0.0004 ms` |  `0.0005 ms` |  `0.0006 ms` |

Vitest reports p99/p995 instead of p95. Since p99 is below the p95 target, the p95 gate is
treated as satisfied for this smoke run.
