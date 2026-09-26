import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildTurkeyOsmBarrierArtifacts,
  extractTurkeyOsmBarriersFromPbf,
  readTurkeyOsmAdm2BarrierArtifact
} from "../packages/generators/dist/turkey-adm3.mjs";

// Run the built ESM API in native Node: Vitest interop can hide CommonJS export errors.
const require = createRequire(new URL("../packages/generators/package.json", import.meta.url));
const { osmBlockToPbfBlobBytes } = await import(pathToFileURL(require.resolve("@osmix/pbf")));
const encoder = new TextEncoder();
const delta = (values) => values.map((value, index) => value - (values[index - 1] ?? 0));
const coordinates = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0.2, 0.2],
  [0.4, 0.2],
  [0.4, 0.4],
  [0.2, 0.4]
];
const header = await osmBlockToPbfBlobBytes({
  required_features: ["OsmSchema-V0.6"],
  optional_features: []
});
const primitive = await osmBlockToPbfBlobBytes({
  stringtable: ["", "type", "multipolygon", "leisure", "park", "outer", "inner"].map((value) =>
    encoder.encode(value)
  ),
  primitivegroup: [
    {
      nodes: coordinates.map(([lng, lat], index) => ({
        id: index + 1,
        lon: Math.round(lng * 1e7),
        lat: Math.round(lat * 1e7),
        keys: [],
        vals: []
      })),
      ways: [
        [1, 2],
        [4, 3, 2],
        [4, 1],
        [5, 6, 7, 8, 5]
      ].map((refs, index) => ({ id: index + 10, refs: delta(refs), keys: [], vals: [] })),
      relations: [
        {
          id: 100,
          keys: [1, 3],
          vals: [2, 4],
          roles_sid: [5, 5, 5, 6],
          memids: delta([10, 11, 12, 13]),
          types: [1, 1, 1, 1]
        }
      ]
    }
  ]
});
const bytes = new Uint8Array(header.length + primitive.length);
bytes.set(header);
bytes.set(primitive, header.length);
const directory = await mkdtemp(join(tmpdir(), "territory-osm-runtime-"));
try {
  const snapshotPath = join(directory, "fixture.osm.pbf");
  await writeFile(snapshotPath, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sourceLock = {
    schemaVersion: "territorykit-tr-osm-snapshot-source-lock@1",
    providerId: "geofabrik-osm-extracts",
    providerName: "Geofabrik",
    countryCode: "TR",
    sourceUrl: "https://download.geofabrik.de/europe/turkey.html",
    downloadUrl: "https://download.geofabrik.de/europe/turkey-latest.osm.pbf",
    sourceDatasetId: "geofabrik:europe:turkey",
    snapshotDate: "2026-08-27T00:00:00.000Z",
    downloadedAt: "2026-08-27T00:00:00.000Z",
    fileSizeBytes: bytes.length,
    sha256,
    license: "ODbL-1.0",
    attribution: "OpenStreetMap contributors, ODbL 1.0",
    format: "osm-pbf",
    contentAddressedSnapshotId: `TR-${sha256.slice(0, 16)}`,
    cachePath: snapshotPath,
    pbfHeader: {}
  };
  const normalized = await extractTurkeyOsmBarriersFromPbf({ pbfPath: snapshotPath, sourceLock });
  assert.equal(normalized.parks.features.length, 1);
  assert.equal(normalized.parks.features[0].geometry.coordinates.length, 2);
  assert.deepEqual(normalized.parser.relationIssues, []);
  const adm2 = {
    id: "tr:adm2:runtime",
    countryCode: "TR",
    level: 2,
    name: "Runtime",
    bbox: [0, 0, 1, 1],
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0]
        ]
      ]
    },
    properties: {}
  };
  const outputRoot = join(directory, "barriers");
  await buildTurkeyOsmBarrierArtifacts({ snapshotPath, sourceLock, adm2Zones: [adm2], outputRoot });
  const artifact = await readTurkeyOsmAdm2BarrierArtifact(outputRoot, adm2.id);
  assert.equal(
    artifact.parks.features.length,
    1,
    "Native ESM must not silently discard polygon clipping"
  );
  assert.equal(artifact.parks.features[0].id, "osm:relation:100");
  assert.equal(
    artifact.parks.features[0].geometry.coordinates.length,
    2,
    "Clipping must preserve the inner hole"
  );
  console.log("OSM multipolygon native ESM extraction and ADM2 clipping: PASS");
} finally {
  await rm(directory, { recursive: true, force: true });
}
