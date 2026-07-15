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
pnpm benchmark:fixture
```

The first tracked fixture is 10K polygons (`100 x 100`). A 100K polygon fixture exists for
larger smoke runs, but it should not be committed as static data.

## Latest Smoke Run

Recorded on 2026-07-14 with `pnpm bench`:

| Benchmark                             |        Mean |          p99 |         p995 |
| ------------------------------------- | ----------: | -----------: | -----------: |
| `latLngToZone`, 10K polygons          | `0.0003 ms` |  `0.0007 ms` |  `0.0009 ms` |
| `getZonesInBounds`, 10K polygons      | `0.0650 ms` |  `0.1762 ms` |  `0.2130 ms` |
| `getZoneById`, 10K polygons           | `0.0000 ms` |  `0.0000 ms` |  `0.0001 ms` |
| Engine construction, 10K polygons     | `9.8093 ms` | `23.2468 ms` | `23.2468 ms` |
| Dataset validation load, 10K polygons | `7.8898 ms` | `15.1426 ms` | `15.1426 ms` |
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

## Sprint 8 Fixture Baseline

`pnpm benchmark:fixture` runs the release-safe benchmark schema and compares it with
`benchmarks/baselines/fixture-smoke.json`. The result schema is
`territorykit-benchmark-result@1`; the baseline schema is `territorykit-benchmark-baseline@1`.

`pnpm benchmark:run -- --mode local-real --dataset <dataset.json>` enables local real-world
benchmarking without committing large source data. When local-real mode has no dataset path,
automation can use `--allow-skip` to record an explicit skip instead of downloading data.

## Bundle Budget Notes

Recorded on 2026-07-15 after the global ADM1/ADM2 completion work:

| Package      | ESM size        | Budget          | Reason                                                 |
| ------------ | --------------- | --------------- | ------------------------------------------------------ |
| `dataset`    | `116,734 bytes` | `118,000 bytes` | Exact polygon relations and artifact index.            |
| `generators` | `293,923 bytes` | `300,000 bytes` | Global ADM0-ADM2 build orchestration and source locks. |
| `cli`        | `88,575 bytes`  | `92,000 bytes`  | Dataset build-all controls and coverage/report output. |

The `core`, `maplibre`, and `nestjs` packages remain within their previous bundle budgets.
