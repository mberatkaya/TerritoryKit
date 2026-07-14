# Real-World Benchmarks

TerritoryKit benchmarks have two execution modes:

- `fixture`: CI-safe synthetic grids generated at runtime. This mode never reads network resources
  and never commits large data.
- `local-real`: opt-in local datasets supplied with `--dataset <dataset.json>`. If no dataset path
  is supplied, release automation treats the scenario as skipped instead of silently downloading
  data.

Run the fixture smoke:

```sh
pnpm benchmark:fixture
```

Run and save a local result:

```sh
pnpm benchmark:run -- --mode local-real --dataset datasets/local/dataset.json --output tmp/result.json
```

Compare a saved result with a baseline:

```sh
pnpm benchmark:compare -- --baseline benchmarks/baselines/fixture-smoke.json --current tmp/result.json
```

The committed baseline uses broad budgets so it catches regressions, missing metrics, and malformed
results without turning ordinary CI variance into noise.

Large source datasets, generated caches, benchmark outputs, and registry artifacts must stay out of
git and npm packages. Store them under ignored local paths such as `.territory/cache/` or an
operator-provided data directory.
