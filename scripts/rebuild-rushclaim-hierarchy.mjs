import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadTerritoryDataset } from "../packages/dataset/dist/index.mjs";
import {
  buildTerritoryRenderArtifacts,
  validateTerritoryRenderArtifactPath
} from "../packages/generators/dist/index.mjs";
import { createTurkeyV2DeliveryManifest } from "../packages/generators/dist/turkey-adm3.mjs";

// Run after pnpm build. Always create a new immutable delivery namespace.
const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) throw new Error("Supply source artifact root and NEW output root");
const source = resolve(sourceArg);
const root = resolve(outputArg);
if (source === root || (await stat(root).catch(() => null)))
  throw new Error("Output must be a new directory; existing releases cannot be overwritten");
await cp(source, root, { recursive: true, mode: constants.COPYFILE_FICLONE });
// Only the new copy is mutable. Never retain tiles from an earlier encoder.
await rm(join(root, "render/tiles"), { recursive: true, force: true });
await rm(join(root, "map"), { recursive: true, force: true });
const levels = [];
for (const [level, minZoom, maxZoom] of [
  ["ADM0", 0, 4],
  ["ADM1", 5, 7],
  ["ADM2", 8, 10],
  ["ADM3", 10, 12]
]) {
  const dataset = loadTerritoryDataset(
    JSON.parse(await readFile(join(root, `levels/${level}/dataset.json`), "utf8"))
  );
  const result = buildTerritoryRenderArtifacts({
    dataset,
    format: "mvt",
    layerId: `territory-${level.toLowerCase()}`,
    minZoom,
    maxZoom,
    buildDate: "2026-10-08T00:00:00.000Z",
    includeQueryFile: false
  });
  const output = level === "ADM3" ? root : join(root, `map/${level}`);
  for (const [path, bytes] of result.files) {
    await mkdir(join(output, path, ".."), { recursive: true });
    await writeFile(join(output, path), bytes);
  }
  const validation = await validateTerritoryRenderArtifactPath(output);
  if (!validation.ok) throw new Error(JSON.stringify(validation.issues));
  levels.push({ level, layers: result.manifest.layers, ...result.mvtReport.totals });
  console.log(JSON.stringify(levels.at(-1)));
}
const checksums = JSON.parse(await readFile(join(root, "checksums.json"), "utf8"));
async function checksum(path) {
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const bytes of createReadStream(join(root, path))) {
    hash.update(bytes);
    byteSize += bytes.length;
  }
  return { sha256: hash.digest("hex"), byteSize };
}
async function* files(path) {
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) yield* files(child);
    else if (entry.isFile()) yield child;
  }
}
// Recheck canonical geometry, lookups, shards and all retained checksum entries.
for (const path of Object.keys(checksums.files)) {
  const current = await checksum(path);
  if (!path.startsWith("render/") && current.sha256 !== checksums.files[path].sha256)
    throw new Error(`Canonical artifact changed: ${path}`);
  checksums.files[path] = current;
}
for (const prefix of ["render", "map"]) {
  for await (const path of files(prefix)) checksums.files[path] = await checksum(path);
}
const read = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const plan = await read("artifact-plan.json");
for (const artifact of plan.artifacts) {
  const entry = checksums.files[artifact.path];
  if (entry) {
    artifact.sha256 = entry.sha256;
    artifact.sizeBytes = entry.byteSize;
  }
}
for (const level of levels) {
  const path =
    level.level === "ADM3" ? "render/manifest.json" : `map/${level.level}/render/manifest.json`;
  let artifact = plan.artifacts.find((entry) => entry.path === path);
  if (!artifact) {
    artifact = {
      id: `${level.level.toLowerCase()}-render-manifest`,
      purpose: "render",
      format: "mvt",
      levels: [level.level],
      path,
      url: `./${path}`,
      compression: "none"
    };
    plan.artifacts.push(artifact);
  }
  Object.assign(artifact, {
    sha256: checksums.files[path].sha256,
    sizeBytes: checksums.files[path].byteSize,
    layer: level.layers[0].id,
    minZoom: level.layers[0].minZoom,
    maxZoom: level.layers[0].maxZoom,
    tileUrlTemplate: "tiles/{z}/{x}/{y}.mvt"
  });
}
await writeFile(join(root, "artifact-plan.json"), JSON.stringify(plan, null, 2) + "\n");
checksums.files["artifact-plan.json"] = await checksum("artifact-plan.json");
const summary = await read("build-summary.json");
summary.artifactPlan = plan;
await writeFile(join(root, "build-summary.json"), JSON.stringify(summary, null, 2) + "\n");
checksums.files["build-summary.json"] = await checksum("build-summary.json");
checksums.files = Object.fromEntries(
  Object.entries(checksums.files).sort(([a], [b]) => a.localeCompare(b))
);
await writeFile(join(root, "checksums.json"), JSON.stringify(checksums, null, 2) + "\n");
const manifest = createTurkeyV2DeliveryManifest({
  canonical: await read("manifest.json"),
  sourceLock: await read("source-lock.json"),
  render: await read("render/manifest.json"),
  checksums,
  shards: await read("shards.json"),
  adm2Ids: (await read("levels/ADM2/dataset.json")).zones.map((zone) => zone.id)
});
await writeFile(join(root, "delivery-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const hierarchy = {
  datasetId: manifest.datasetId,
  datasetVersion: manifest.datasetVersion,
  manifestContentHash: manifest.contentHash,
  levels,
  files: Object.fromEntries(
    Object.entries(checksums.files).filter(
      ([path]) => path.startsWith("render/") || path.startsWith("map/")
    )
  )
};
await writeFile(join(root, "hierarchy-delivery.json"), JSON.stringify(hierarchy, null, 2) + "\n");
console.log(
  JSON.stringify({
    root,
    manifestContentHash: manifest.contentHash,
    checksummedFiles: Object.keys(checksums.files).length
  })
);
