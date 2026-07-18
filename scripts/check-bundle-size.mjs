import { statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const maxBytesByFile = new Map([
  // Sprint 4 real adjacency adds exact polygon relation primitives and artifact indexing.
  // Sprint 7 adds query/render artifact metadata and compatibility helpers.
  // Lower-admin support adds ADM5 metadata, semantic review, and coverage statuses.
  // Runtime architecture adds the shared TerritoryError serializer and stable error codes.
  ["packages/dataset/dist/index.mjs", 140_000],
  ["packages/adapter-core/dist/index.mjs", 24_000],
  ["packages/core/dist/index.mjs", 65_000],
  ["packages/core/dist/legacy-registry.mjs", 5_000],
  ["packages/registry/dist/index.mjs", 5_000],
  ["packages/registry/dist/node.mjs", 28_000],
  ["packages/runtime/dist/index.mjs", 24_000],
  ["packages/maplibre/dist/index.mjs", 45_000],
  ["packages/nestjs/dist/index.mjs", 45_000],
  ["packages/data-tr/dist/index.mjs", 8_000],
  ["packages/data-us/dist/index.mjs", 8_000],
  ["packages/data-de/dist/index.mjs", 8_000],
  ["packages/data-jp/dist/index.mjs", 8_000],
  ["packages/data-id/dist/index.mjs", 8_000],
  // Global ADM0-ADM2 completion adds GEOS repair orchestration, phased country builds,
  // source-lock reuse, lifecycle reporting, and Natural Earth overview artifact generation.
  // Lower-admin support adds provider capability inspection and open-data manifest gates.
  // Turkey ADM3 hardening adds production-quality, repair, overlap, containment, and artifact gates.
  ["packages/generators/dist/index.mjs", 390_000],
  // Dataset build-all/global-admin CLI commands now expose ADM0 completion controls and reports.
  // Lower-admin support adds level filtering, source capability output, and artifact fallback.
  ["packages/cli/dist/index.mjs", 96_000]
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
