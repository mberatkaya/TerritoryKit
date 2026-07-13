import { statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const maxBytesByFile = new Map([
  ["packages/dataset/dist/index.mjs", 45_000],
  ["packages/core/dist/index.mjs", 65_000],
  ["packages/maplibre/dist/index.mjs", 45_000],
  ["packages/nestjs/dist/index.mjs", 45_000],
  ["packages/generators/dist/index.mjs", 45_000],
  ["packages/cli/dist/index.mjs", 45_000]
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
