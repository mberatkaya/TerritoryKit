#!/usr/bin/env node
import { compareBenchmarkResult, readJson, runFixtureBenchmark } from "./benchmark-lib.mjs";

const baselinePath = "benchmarks/baselines/fixture-smoke.json";
const baseline = await readJson(baselinePath);
const result = runFixtureBenchmark();
const comparison = compareBenchmarkResult(result, baseline);

console.log(
  JSON.stringify(
    {
      ok: comparison.ok,
      baseline: baselinePath,
      result,
      issues: comparison.issues
    },
    null,
    2
  )
);

if (!comparison.ok) {
  process.exit(1);
}
