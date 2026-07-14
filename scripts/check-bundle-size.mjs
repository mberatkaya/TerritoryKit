import { statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const maxBytesByFile = new Map([
  // Sprint 4 real adjacency adds exact polygon relation primitives and artifact indexing.
  // Sprint 7 adds query/render artifact metadata and compatibility helpers.
  ["packages/dataset/dist/index.mjs", 118_000],
  ["packages/core/dist/index.mjs", 65_000],
  ["packages/registry/dist/index.mjs", 5_000],
  ["packages/registry/dist/node.mjs", 28_000],
  ["packages/maplibre/dist/index.mjs", 45_000],
  ["packages/nestjs/dist/index.mjs", 45_000],
  ["packages/data-tr/dist/index.mjs", 8_000],
  ["packages/data-us/dist/index.mjs", 8_000],
  ["packages/data-de/dist/index.mjs", 8_000],
  ["packages/data-jp/dist/index.mjs", 8_000],
  ["packages/data-id/dist/index.mjs", 8_000],
  // Generators now include adjacency artifact build/validate filesystem helpers.
  ["packages/generators/dist/index.mjs", 190_000],
  // Sprint 7 adds render artifact management commands.
  ["packages/cli/dist/index.mjs", 72_000]
]);

const failures = [];

for (const [relativePath, maxBytes] of maxBytesByFile) {
  const absolutePath = join(root, relativePath);
  let size = 0;

  try {
    size = statSync(absolutePath).size;
  } catch {
    failures.push(`${relativePath} is missing; run pnpm build first.`);
    continue;
  }

  if (size > maxBytes) {
    failures.push(`${relativePath} is ${size} bytes; limit is ${maxBytes} bytes.`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Bundle size check passed.");
