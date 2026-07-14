import { spawnSync } from "node:child_process";

const commands = [
  [
    "pnpm",
    ["--filter", "@territory-kit/generators", "exec", "vitest", "run", "test/countries.test.ts"]
  ],
  ["pnpm", ["--filter", "@territory-kit/cli", "exec", "vitest", "run", "test/cli.test.ts"]],
  ["pnpm", ["--filter", "@territory-kit/data-tr", "test"]],
  ["pnpm", ["--filter", "@territory-kit/data-us", "test"]],
  ["pnpm", ["--filter", "@territory-kit/data-de", "test"]],
  ["pnpm", ["--filter", "@territory-kit/data-jp", "test"]],
  ["pnpm", ["--filter", "@territory-kit/data-id", "test"]]
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
