#!/usr/bin/env node
import { compareBenchmarkResult, readJson } from "./benchmark-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const baselinePath = args.get("baseline");
const currentPath = args.get("current");

if (!baselinePath || !currentPath) {
  console.error(
    "Usage: node scripts/benchmark-compare.mjs --baseline <baseline.json> --current <result.json>"
  );
  process.exit(2);
}

const baseline = await readJson(baselinePath);
const current = await readJson(currentPath);
const comparison = compareBenchmarkResult(current, baseline);

console.log(
  JSON.stringify(
    {
      ok: comparison.ok,
      baseline: baselinePath,
      current: currentPath,
      issues: comparison.issues
    },
    null,
    2
  )
);

if (!comparison.ok) {
  process.exit(1);
}

function parseArgs(values) {
  const flags = new Map();

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (!value?.startsWith("--")) {
      continue;
    }

    const key = value.slice(2);
    const next = values[index + 1];

    if (!next || next.startsWith("--")) {
      flags.set(key, "true");
      continue;
    }

    flags.set(key, next);
    index += 1;
  }

  return flags;
}
