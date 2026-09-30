/** Large national artifacts use compact, bounded chunks so serialization never creates a V8-sized string. */
export function isLargeNationalJsonArtifact(path: string): boolean {
  return (
    path === "dataset.json" ||
    path === "levels/ADM3/dataset.json" ||
    path === "levels/ADM3/full.geojson" ||
    path === "query/query-artifact.json"
  );
}

export function* serializeNationalJsonChunks(value: unknown): Generator<string> {
  yield* serializeChunks(value, 0);
  yield "\n";
}

function* serializeChunks(value: unknown, depth: number): Generator<string> {
  if (depth >= 2 || value === null || typeof value !== "object") {
    yield JSON.stringify(value) ?? "null";
    return;
  }

  if (Array.isArray(value)) {
    yield "[";
    for (let index = 0; index < value.length; index++) {
      if (index > 0) yield ",";
      yield* serializeChunks(value[index], depth + 1);
    }
    yield "]";
    return;
  }

  yield "{";
  let first = true;
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
    if (!first) yield ",";
    first = false;
    yield JSON.stringify(key);
    yield ":";
    yield* serializeChunks(item, depth + 1);
  }
  yield "}";
}
