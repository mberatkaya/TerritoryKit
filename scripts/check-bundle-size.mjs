import { statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const maxBytesByFile = new Map([
  // Sprint 4 real adjacency adds exact polygon relation primitives and artifact indexing.
  // Sprint 7 adds query/render artifact metadata and compatibility helpers.
  // Lower-admin support adds ADM5 metadata, semantic review, and coverage statuses.
  // Runtime architecture adds the shared TerritoryError serializer and stable error codes.
  // Dataset diff/migration adds versioned report schemas, deterministic matching, geometry
  // signals, coverage reporting, and migration-plan validation to the public dataset API.
  ["packages/dataset/dist/index.mjs", 210_000],
  // Web renderer adapters share GeoJSON feature serialization and event identity helpers here.
  ["packages/adapter-core/dist/index.mjs", 32_000],
  ["packages/core/dist/index.mjs", 65_000],
  ["packages/core/dist/legacy-registry.mjs", 5_000],
  ["packages/registry/dist/index.mjs", 5_000],
  // Hosted registry publishing adds provider-neutral local, HTTP, and S3-compatible object-store
  // adapter contracts plus inventory, rollback, and publish verification helpers to the Node entry.
  ["packages/registry/dist/node.mjs", 48_000],
  // Sprint 12 turns runtime from lifecycle contracts into viewport request orchestration with
  // scheduler injection, cancellation, cache, lazy engine reuse, adapter updates, stale adapter
  // operation guards, managed source binding, and cache ownership handling.
  // Sprint 13 merge-blocker hardening keeps the root runtime export self-contained while adding
  // strict catalog registration invariants, overlap-aware shard selection, namespace collision
  // rewrites, in-flight engine creation dedupe, worker protocol correlation, and worker binary
  // index initialization reuse.
  ["packages/runtime/dist/index.mjs", 82_000],
  ["packages/maplibre/dist/index.mjs", 45_000],
  // React Native runtime keeps storage/fetch/checksum abstractions in the core entry and leaves
  // MapLibre Native behind an optional structural integration entry point.
  ["packages/react-native/dist/index.mjs", 72_000],
  ["packages/react-native/dist/maplibre.mjs", 18_000],
  // Leaflet/OpenLayers adapters keep renderer packages external and expose only structural
  // adapter contracts plus registry source metadata helpers.
  ["packages/leaflet/dist/index.mjs", 45_000],
  ["packages/openlayers/dist/index.mjs", 55_000],
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
  // Turkey national source work adds ZIP-member source locks, HDX COD-AB adapter metadata,
  // topology-safe simplification reports, and optional country query/render/binary artifacts.
  // Turkey ADM0-ADM2 full-build performance work adds Flatbush-backed adjacency statistics,
  // bounded MVT policy reports, and production build evidence outputs.
  // Turkey ADM3 ingestion adds province-scoped source catalogs, provider adapters, source locks,
  // parent matching, identity, quality gates, coverage, and provenance reporting.
  ["packages/generators/dist/index.mjs", 480_000],
  // Dataset build-all/global-admin CLI commands now expose ADM0 completion controls and reports.
  // Lower-admin support adds level filtering, source capability output, and artifact fallback.
  // Sprint 13 adds binary spatial index build/inspect/validate commands.
  // Turkey national source work adds HDX COD-AB import options and simplification/country flags.
  // Turkey ADM0-ADM2 full-build performance work adds phase timeouts and profile reports.
  // Hosted registry publishing adds registry publish/verify commands and provenance reporting.
  // Dataset diff/migration adds Markdown/JSON/CSV report outputs and CI migration gates.
  // Turkey ADM3 real coverage adds national geometry-build artifact orchestration and source
  // coverage reporting while keeping the heavy geometry implementation external in generators.
  ["packages/cli/dist/index.mjs", 160_000]
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
