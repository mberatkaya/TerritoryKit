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

Sprint 13 extends `pnpm bench` with binary spatial index encode/decode and binary-backed
`getZonesInBounds` scenarios for the 10K fixture. The benchmark report for a PR should include
those results alongside the existing Flatbush runtime-build path.

## Latest Smoke Run

Recorded on 2026-07-18 with `pnpm bench`:

| Benchmark                               |         Mean |          p99 |         p995 |
| --------------------------------------- | -----------: | -----------: | -----------: |
| `latLngToZone`, 10K polygons            |  `0.0003 ms` |  `0.0009 ms` |  `0.0013 ms` |
| `getZonesInBounds`, 10K polygons        |  `0.1133 ms` |  `0.3412 ms` |  `0.4193 ms` |
| `getZoneById`, 10K polygons             |  `0.0000 ms` |  `0.0000 ms` |  `0.0001 ms` |
| Engine construction, 10K polygons       |  `9.9055 ms` | `12.3280 ms` | `12.3280 ms` |
| Binary index encode, 10K polygons       | `17.4557 ms` | `20.0765 ms` | `20.0765 ms` |
| Binary index decode, 10K polygons       |  `3.2186 ms` |  `4.5002 ms` |  `4.5488 ms` |
| Binary `getZonesInBounds`, 10K polygons |  `0.2712 ms` |  `0.3110 ms` |  `0.3158 ms` |
| Dataset validation load, 10K polygons   |  `9.5160 ms` | `27.6651 ms` | `27.6651 ms` |
| `latLngToZone`, 100K polygons           |  `0.0004 ms` |  `0.0005 ms` |  `0.0006 ms` |

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

Recorded on 2026-07-18 after the Sprint 13 catalog and binary-index runtime work:

| Package      | ESM size        | Budget          | Reason                                                 |
| ------------ | --------------- | --------------- | ------------------------------------------------------ |
| `dataset`    | `132,919 bytes` | `140,000 bytes` | Exact polygon relations and artifact index.            |
| `generators` | `373,084 bytes` | `390,000 bytes` | Global ADM0-ADM2 build orchestration and source locks. |
| `core`       | `41,878 bytes`  | `65,000 bytes`  | Binary spatial index encode/decode API.                |
| `runtime`    | `64,763 bytes`  | `70,000 bytes`  | Catalog, engine pool, and worker loading contracts.    |
| `cli`        | `96,896 bytes`  | `100,000 bytes` | Binary index build/inspect/validate commands.          |

The `maplibre`, `nestjs`, and data loader packages remain within their previous bundle budgets.
