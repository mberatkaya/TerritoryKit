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

Sprint 13 extends `pnpm bench` with binary spatial index encode/decode, binary Flatbush restore,
and binary-backed `getZonesInBounds` scenarios for both 10K and 100K fixtures. The benchmark
report for a PR should include those results alongside the existing Flatbush runtime-build path.

## Latest Smoke Run

Recorded on 2026-07-18 with `pnpm bench`:

| Benchmark                                         |          Mean |           p99 |          p995 |
| ------------------------------------------------- | ------------: | ------------: | ------------: |
| `latLngToZone`, 10K polygons                      |   `0.0003 ms` |   `0.0004 ms` |   `0.0005 ms` |
| `getZonesInBounds`, 10K polygons                  |   `0.0627 ms` |   `0.0731 ms` |   `0.0786 ms` |
| `getZoneById`, 10K polygons                       |   `0.0000 ms` |   `0.0000 ms` |   `0.0000 ms` |
| Engine construction, 10K polygons                 |   `9.9545 ms` |  `12.4770 ms` |  `12.4770 ms` |
| Binary Flatbush restore, 10K polygons             |  `33.6617 ms` |  `37.5232 ms` |  `37.5232 ms` |
| Binary index encode, 10K polygons                 |  `21.5522 ms` |  `48.5029 ms` |  `48.5029 ms` |
| Binary index decode, 10K polygons                 |   `5.3586 ms` |   `6.5699 ms` |   `6.5699 ms` |
| Binary Flatbush `getZonesInBounds`, 10K polygons  |   `0.0757 ms` |   `0.0867 ms` |   `0.0930 ms` |
| Dataset validation load, 10K polygons             |   `7.9838 ms` |  `10.8999 ms` |  `10.8999 ms` |
| `latLngToZone`, 100K polygons                     |   `0.0004 ms` |   `0.0005 ms` |   `0.0006 ms` |
| `getZonesInBounds`, 100K polygons                 |   `1.7539 ms` |   `2.4769 ms` |   `2.4946 ms` |
| Engine construction, 100K polygons                |  `94.8328 ms` | `128.3800 ms` | `128.3800 ms` |
| Binary Flatbush restore, 100K polygons            | `345.8200 ms` | `413.4700 ms` | `413.4700 ms` |
| Binary index decode, 100K polygons                |  `70.2483 ms` |  `75.1889 ms` |  `75.1889 ms` |
| Binary Flatbush `getZonesInBounds`, 100K polygons |   `2.0043 ms` |   `2.8110 ms` |   `2.8160 ms` |

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

| Package      | ESM size        | Budget          | Reason                                                       |
| ------------ | --------------- | --------------- | ------------------------------------------------------------ |
| `dataset`    | `132,919 bytes` | `140,000 bytes` | Exact polygon relations and artifact index.                  |
| `generators` | `373,084 bytes` | `390,000 bytes` | Global ADM0-ADM2 build orchestration and source locks.       |
| `core`       | `60,843 bytes`  | `65,000 bytes`  | Binary spatial index encode/decode API.                      |
| `runtime`    | `79,272 bytes`  | `82,000 bytes`  | Catalog invariants, collision policy, pool/worker hardening. |
| `cli`        | `96,896 bytes`  | `100,000 bytes` | Binary index build/inspect/validate commands.                |

The `maplibre`, `nestjs`, and data loader packages remain within their previous bundle budgets.
