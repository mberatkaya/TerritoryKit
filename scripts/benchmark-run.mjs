#!/usr/bin/env node
import { runFixtureBenchmark, runLocalRealBenchmark, writeJson } from "./benchmark-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const mode = args.get("mode") ?? "fixture";
const outputPath = args.get("output");

try {
  const result =
    mode === "local-real"
      ? await runLocalRealBenchmark({
          datasetPath: args.get("dataset"),
          iterations: args.get("iterations"),
          scenario: args.get("scenario")
        })
      : runFixtureBenchmark({
          rows: args.get("rows"),
          columns: args.get("columns"),
          cellSize: args.get("cell-size"),
          iterations: args.get("iterations"),
          scenario: args.get("scenario")
        });

  if (mode === "local-real" && result.skipped && !args.has("allow-skip")) {
    console.error(result.skipped.join("\n"));
    process.exit(2);
  }

  if (outputPath) {
    await writeJson(outputPath, result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
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
