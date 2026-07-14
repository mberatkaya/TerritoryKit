#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const steps = [
  ["Format", "pnpm", ["format:check"]],
  ["Lint", "pnpm", ["lint"]],
  ["Package boundaries", "pnpm", ["package:boundaries"]],
  ["Typecheck", "pnpm", ["typecheck"]],
  ["Tests", "pnpm", ["test"]],
  ["Build", "pnpm", ["build"]],
  ["Bundle size", "pnpm", ["bundle:size"]],
  ["Geometry fixtures", "pnpm", ["geometry:validate:fixtures"]],
  ["Country smoke", "pnpm", ["country:smoke"]],
  ["Registry install smoke", "pnpm", ["registry:smoke"]],
  ["Query/render compatibility", "pnpm", ["query-render:smoke"]],
  ["Fixture benchmark", "pnpm", ["benchmark:fixture"]],
  ["Package dry-run audit", "pnpm", ["package:dry-run"]],
  ["Docs link check", "pnpm", ["docs:links"]]
];

for (const [name, command, args] of steps) {
  console.log(`\n[release:check] ${name}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\n[release:check] All release readiness checks passed.");
