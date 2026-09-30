import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { osmBlockToPbfBlobBytes } from "@osmix/pbf";
import type { TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import type { MultiPolygon, Polygon } from "geojson";
import { describe, expect, it } from "vitest";
import {
  TURKEY_OSM_BARRIER_ALGORITHM_VERSION,
  TURKEY_OSM_BARRIER_ATTRIBUTION,
  TURKEY_OSM_BARRIER_LICENSE,
  TURKEY_OSM_BARRIER_PROVIDER_ID,
  TURKEY_OSM_BARRIER_PROVIDER_NAME,
  TURKEY_OSM_BARRIER_SNAPSHOT_SOURCE_LOCK_SCHEMA_VERSION,
  buildTurkeyOsmBarrierArtifacts,
  createTurkeyGeofabrikSnapshotDescriptor,
  createTurkeyOsmSmartCoverageReport,
  createTurkeyOsmSmartFallbackGeneratedOptions,
  extractTurkeyOsmBarriersFromPbf,
  readTurkeyOsmAdm2BarrierArtifact,
  verifyTurkeyOsmSnapshot
} from "../src/turkey-adm3.js";
import type { TurkeyOsmSnapshotSourceLock } from "../src/turkey-adm3.js";
import { sha256Hex } from "../src/sources/utils.js";

const encoder = new TextEncoder();

describe("Turkey OSM barrier snapshot pipeline", () => {
  it("resolves the Geofabrik Turkey snapshot descriptor with ODbL metadata", () => {
    expect(createTurkeyGeofabrikSnapshotDescriptor()).toMatchObject({
      providerId: TURKEY_OSM_BARRIER_PROVIDER_ID,
      providerName: TURKEY_OSM_BARRIER_PROVIDER_NAME,
      countryCode: "TR",
      sourceDatasetId: "geofabrik:europe:turkey",
      format: "osm-pbf",
      license: TURKEY_OSM_BARRIER_LICENSE,
      attribution: TURKEY_OSM_BARRIER_ATTRIBUTION
    });
  });

  it("extracts roads, rail, water, park/landuse, locality seeds, and stable OSM IDs", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-tr-osm-barriers-"));

    try {
      const pbfPath = join(tempDir, "fixture.osm.pbf");
      await writeFile(pbfPath, await createBarrierFixturePbf());
      const sourceLock = await sourceLockForFixture(pbfPath);
      const normalized = await extractTurkeyOsmBarriersFromPbf({ pbfPath, sourceLock });

      expect(normalized.roads.features.map((feature) => feature.id)).toEqual(["osm:way:100"]);
      expect(normalized.railways.features.map((feature) => feature.id)).toEqual(["osm:way:102"]);
      expect(normalized.water.features.map((feature) => feature.id)).toEqual(["osm:way:101"]);
      expect(normalized.parks.features.map((feature) => feature.id)).toEqual(["osm:way:103"]);
      expect(normalized.landuse.features.map((feature) => feature.id)).toEqual(["osm:way:104"]);
      expect(normalized.localitySeeds).toEqual([
        expect.objectContaining({
          source: "openstreetmap",
          sourceId: "osm:node:20",
          authoritative: false,
          type: "neighbourhood"
        })
      ]);
      expect(normalized.parser.neededNodeCount).toBeGreaterThan(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("assembles multipolygon relation outers, reversed fragments, holes, and disconnected rings", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-tr-osm-multipolygon-"));

    try {
      const pbfPath = join(tempDir, "multipolygon.osm.pbf");
      await writeFile(pbfPath, await createMultipolygonFixturePbf());
      const sourceLock = await sourceLockForFixture(pbfPath);
      const normalized = await extractTurkeyOsmBarriersFromPbf({ pbfPath, sourceLock });
      const parkGeometry = normalized.parks.features.find(
        (feature) => feature.id === "osm:relation:300"
      )?.geometry as Polygon | undefined;
      const landuseGeometry = normalized.landuse.features.find(
        (feature) => feature.id === "osm:relation:301"
      )?.geometry as Polygon | undefined;
      const waterGeometry = normalized.water.features.find(
        (feature) => feature.id === "osm:relation:302"
      )?.geometry as MultiPolygon | undefined;

      expect(normalized.parks.features.map((feature) => feature.id)).toEqual(["osm:relation:300"]);
      expect(normalized.landuse.features.map((feature) => feature.id)).toEqual([
        "osm:relation:301"
      ]);
      expect(normalized.water.features.map((feature) => feature.id)).toEqual(["osm:relation:302"]);
      expect(parkGeometry).toMatchObject({ type: "Polygon" });
      expect(parkGeometry?.coordinates).toHaveLength(1);
      expect(landuseGeometry).toMatchObject({ type: "Polygon" });
      expect(landuseGeometry?.coordinates).toHaveLength(3);
      expect(waterGeometry).toMatchObject({ type: "MultiPolygon" });
      expect(waterGeometry?.coordinates).toHaveLength(2);
      expect(waterGeometry?.coordinates.map((polygon) => polygon.length).sort()).toEqual([1, 2]);
      expect(parkGeometry?.coordinates[0]).toEqual([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0]
      ]);
      expect(normalized.parks.features[0]?.properties).toMatchObject({
        "@id": "osm:relation:300",
        osm_type: "relation",
        barrierLayer: "parks"
      });
      expect(normalized.parser.relationCount).toBe(3);
      expect(normalized.parser.relationIssueCount).toBe(0);
      expect(normalized.parser.relationIssues).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps multipolygon relation assembly deterministic across member ordering", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-tr-osm-multipolygon-determinism-"));

    try {
      const firstPbfPath = join(tempDir, "first.osm.pbf");
      const secondPbfPath = join(tempDir, "second.osm.pbf");
      await writeFile(
        firstPbfPath,
        await createMultipolygonFixturePbf({ parkMemberOrder: [203, 201, 202] })
      );
      await writeFile(
        secondPbfPath,
        await createMultipolygonFixturePbf({ parkMemberOrder: [202, 203, 201] })
      );
      const first = await extractTurkeyOsmBarriersFromPbf({
        pbfPath: firstPbfPath,
        sourceLock: await sourceLockForFixture(firstPbfPath)
      });
      const second = await extractTurkeyOsmBarriersFromPbf({
        pbfPath: secondPbfPath,
        sourceLock: await sourceLockForFixture(secondPbfPath)
      });

      expect(second.parks.features[0]?.geometry).toEqual(first.parks.features[0]?.geometry);
      expect(sha256Hex(JSON.stringify(second.parks.features[0]?.geometry))).toBe(
        sha256Hex(JSON.stringify(first.parks.features[0]?.geometry))
      );
      expect(second.landuse.features[0]?.geometry).toEqual(first.landuse.features[0]?.geometry);
      expect(second.water.features[0]?.geometry).toEqual(first.water.features[0]?.geometry);
      expect(second.parser.relationIssues).toEqual(first.parser.relationIssues);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves all members of a spatially retained relation before clipping", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-tr-osm-multipolygon-spatial-"));
    try {
      const pbfPath = join(tempDir, "spatial.osm.pbf");
      await writeFile(pbfPath, await createMultipolygonFixturePbf());
      const normalized = await extractTurkeyOsmBarriersFromPbf({
        pbfPath,
        sourceLock: await sourceLockForFixture(pbfPath),
        adm2Zones: [zone("spatial", "Spatial", square(2.1, 0.1, 2.3, 0.3))]
      });
      expect(normalized.landuse.features[0]?.geometry).toMatchObject({ type: "Polygon" });
      expect((normalized.landuse.features[0]?.geometry as Polygon).coordinates).toHaveLength(3);
      expect(normalized.parser.relationIssues).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("reports incomplete, orphan, nested, and unsupported multipolygon relation diagnostics", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-tr-osm-multipolygon-diagnostics-"));

    try {
      const pbfPath = join(tempDir, "diagnostics.osm.pbf");
      await writeFile(pbfPath, await createMultipolygonDiagnosticsFixturePbf());
      const sourceLock = await sourceLockForFixture(pbfPath);
      const normalized = await extractTurkeyOsmBarriersFromPbf({ pbfPath, sourceLock });
      const issueCodes = normalized.parser.relationIssues.map((issue) => issue.code);
      const orphanIssue = normalized.parser.relationIssues.find(
        (issue) => issue.code === "OSM_MULTIPOLYGON_ORPHAN_INNER"
      );
      const landuseGeometry = normalized.landuse.features.find(
        (feature) => feature.id === "osm:relation:501"
      )?.geometry as Polygon | undefined;

      expect(issueCodes).toEqual(
        expect.arrayContaining([
          "OSM_MULTIPOLYGON_INCOMPLETE_OUTER",
          "OSM_MULTIPOLYGON_INCOMPLETE_INNER",
          "OSM_MULTIPOLYGON_ORPHAN_INNER",
          "OSM_MULTIPOLYGON_NESTED_RELATION_UNSUPPORTED",
          "OSM_MULTIPOLYGON_UNSUPPORTED_RELATION_TYPE"
        ])
      );
      expect(normalized.parks.features).toEqual([]);
      expect(normalized.landuse.features.map((feature) => feature.id)).toEqual([
        "osm:relation:501"
      ]);
      expect(landuseGeometry?.coordinates).toHaveLength(1);
      expect(normalized.water.features).toEqual([]);
      expect(orphanIssue?.details).toMatchObject({
        relationId: 501,
        sourceNativeId: "osm:relation:501",
        layer: "landuse"
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("verifies source locks and rejects corrupted cached snapshots", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-tr-osm-verify-"));

    try {
      const pbfPath = join(tempDir, "fixture.osm.pbf");
      const sourceLockPath = join(tempDir, "source-lock.json");
      await writeFile(pbfPath, await createBarrierFixturePbf());
      const sourceLock = await sourceLockForFixture(pbfPath);
      await writeFile(sourceLockPath, JSON.stringify(sourceLock), "utf8");

      await expect(
        verifyTurkeyOsmSnapshot({ sourceLockPath, snapshotPath: pbfPath })
      ).resolves.toMatchObject({
        ok: true,
        expectedSha256: sourceLock.sha256,
        actualSha256: sourceLock.sha256
      });

      await writeFile(
        sourceLockPath,
        JSON.stringify({ ...sourceLock, sha256: "0".repeat(64) }),
        "utf8"
      );

      await expect(
        verifyTurkeyOsmSnapshot({ sourceLockPath, snapshotPath: pbfPath })
      ).resolves.toMatchObject({
        ok: false,
        issues: [expect.objectContaining({ code: "OSM_SNAPSHOT_CHECKSUM_MISMATCH" })]
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("clips barriers to ADM2 geometry and writes deterministic reusable artifacts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-tr-osm-build-"));

    try {
      const pbfPath = join(tempDir, "fixture.osm.pbf");
      const outputRoot = join(tempDir, "barriers");
      const outputRootAgain = join(tempDir, "barriers-again");
      await writeFile(pbfPath, await createBarrierFixturePbf());
      const sourceLock = await sourceLockForFixture(pbfPath);
      const adm2 = zone("tr:adm2:fixture", "Fixture", square(0, 0, 1, 1));

      const first = await buildTurkeyOsmBarrierArtifacts({
        snapshotPath: pbfPath,
        sourceLock,
        adm2Zones: [adm2],
        outputRoot,
        generatedAt: "2026-08-28T00:00:00.000Z",
        force: true
      });
      const second = await buildTurkeyOsmBarrierArtifacts({
        snapshotPath: pbfPath,
        sourceLock,
        adm2Zones: [adm2],
        outputRoot: outputRootAgain,
        generatedAt: "2026-08-28T00:00:00.000Z",
        force: true
      });
      const artifact = await readTurkeyOsmAdm2BarrierArtifact(outputRoot, adm2.id);
      const roadGeometry = artifact.roads.features[0]?.geometry;
      const waterGeometry = artifact.water.features[0]?.geometry;
      const railGeometry = artifact.railways.features[0]?.geometry;

      expect(first).toMatchObject({
        ok: true,
        adm2Total: 1,
        processedAdm2Count: 1,
        eligibleAdm2Count: 1
      });
      expect(second.artifacts[0]?.artifactChecksum).toBe(first.artifacts[0]?.artifactChecksum);
      expect(artifact.manifest.algorithmVersion).toBe(TURKEY_OSM_BARRIER_ALGORITHM_VERSION);
      expect(artifact.quality.status).toBe("eligible");
      expect(roadGeometry).toMatchObject({
        type: "LineString",
        coordinates: [
          [0, 0.5],
          [1, 0.5]
        ]
      });
      expect(waterGeometry).toMatchObject({
        type: "LineString",
        coordinates: [
          [0.5, 0],
          [0.5, 1]
        ]
      });
      expect(railGeometry).toMatchObject({
        type: "LineString",
        coordinates: [
          [0.75, 0],
          [0.75, 1]
        ]
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("resumes only intact artifacts with matching parent and extraction configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "tr-barrier-resume-"));
    try {
      const snapshotPath = join(root, "fixture.osm.pbf");
      await writeFile(snapshotPath, await createBarrierFixturePbf());
      const sourceLock = await sourceLockForFixture(snapshotPath);
      const parent = zone("tr:adm2:resume", "Resume", square(0, 0, 1, 1));
      const options = {
        snapshotPath,
        sourceLock,
        adm2Zones: [parent],
        outputRoot: join(root, "barriers")
      };
      const first = await buildTurkeyOsmBarrierArtifacts(options);
      const resumed = await buildTurkeyOsmBarrierArtifacts(options);
      expect(resumed.skippedAdm2Count).toBe(1);
      expect(resumed.artifacts[0]?.artifactChecksum).toBe(first.artifacts[0]?.artifactChecksum);
      await writeFile(
        join(first.artifacts[0]!.outputPath, "roads.geojson"),
        JSON.stringify({ type: "FeatureCollection", features: [] })
      );
      const repaired = await buildTurkeyOsmBarrierArtifacts(options);
      expect(repaired.processedAdm2Count).toBe(1);
      expect(repaired.artifacts[0]?.artifactChecksum).toBe(first.artifacts[0]?.artifactChecksum);
      const changedParent = await buildTurkeyOsmBarrierArtifacts({
        ...options,
        adm2Zones: [{ ...parent, geometry: square(0, 0, 0.8, 0.8) }]
      });
      expect(changedParent.processedAdm2Count).toBe(1);
      expect(changedParent.artifacts[0]?.artifactChecksum).not.toBe(
        first.artifacts[0]?.artifactChecksum
      );
      const changedConfig = await buildTurkeyOsmBarrierArtifacts({
        ...options,
        maxPrimitiveBlocks: 1
      });
      expect(changedConfig.processedAdm2Count).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports insufficient rural input and keeps smart coverage accounting consistent", async () => {
    const sparseAdm2 = zone("tr:adm2:sparse", "Sparse", square(10, 10, 11, 11));
    const eligibleAdm2 = zone("tr:adm2:eligible", "Eligible", square(0, 0, 1, 1));
    const artifact = {
      manifest: {
        schemaVersion: "territorykit-tr-osm-barrier-artifact@1" as const,
        countryCode: "TR" as const,
        adm2Id: eligibleAdm2.id,
        algorithmVersion: TURKEY_OSM_BARRIER_ALGORITHM_VERSION,
        generatedAt: "2026-08-28T00:00:00.000Z",
        source: {
          providerId: TURKEY_OSM_BARRIER_PROVIDER_ID,
          providerName: TURKEY_OSM_BARRIER_PROVIDER_NAME,
          sourceUrl: "https://download.geofabrik.de/europe/turkey.html",
          sourceDatasetId: "geofabrik:europe:turkey",
          snapshotSha256: "a".repeat(64),
          snapshotDate: "2026-08-26T20:22:15.000Z",
          license: TURKEY_OSM_BARRIER_LICENSE,
          attribution: TURKEY_OSM_BARRIER_ATTRIBUTION,
          format: "osm-pbf" as const
        },
        counts: {
          roads: 1,
          railways: 0,
          water: 0,
          landuse: 0,
          parks: 0,
          localitySeeds: 1
        },
        hashes: {
          roads: "r",
          railways: "r",
          water: "r",
          landuse: "r",
          parks: "r",
          localitySeeds: "r",
          quality: "r"
        },
        artifactChecksum: "checksum",
        sourceSnapshotChecksum: "a".repeat(64)
      },
      quality: {
        schemaVersion: "territorykit-tr-osm-barrier-quality@1" as const,
        adm2Id: eligibleAdm2.id,
        ok: true,
        status: "eligible" as const,
        roadFeatureCount: 1,
        majorRoadCount: 1,
        railFeatureCount: 0,
        waterFeatureCount: 0,
        parkFeatureCount: 0,
        landuseFeatureCount: 0,
        localitySeedCount: 1,
        barrierLengthKm: 111,
        majorBarrierLengthKm: 111,
        inputCoverageConfidence: 1,
        issues: []
      },
      roads: { type: "FeatureCollection" as const, features: [] },
      railways: { type: "FeatureCollection" as const, features: [] },
      water: { type: "FeatureCollection" as const, features: [] },
      landuse: { type: "FeatureCollection" as const, features: [] },
      parks: { type: "FeatureCollection" as const, features: [] },
      localitySeeds: []
    };

    expect(createTurkeyOsmSmartFallbackGeneratedOptions(artifact)).toMatchObject({
      enabled: true,
      strategy: "smart",
      smartFallback: {
        options: {
          sourceMetadata: {
            sourceSnapshotChecksum: "a".repeat(64),
            license: TURKEY_OSM_BARRIER_LICENSE
          }
        }
      }
    });
    expect(
      createTurkeyOsmSmartCoverageReport({
        adm2Zones: [eligibleAdm2, sparseAdm2],
        barrierArtifacts: [artifact]
      })
    ).toMatchObject({
      adm2Total: 2,
      smart: {
        eligible: 1,
        inputInsufficient: 1
      },
      legacyRequired: 1,
      consistency: { ok: true }
    });
  });
});

async function createBarrierFixturePbf(): Promise<Uint8Array> {
  const header = await osmBlockToPbfBlobBytes({
    bbox: { left: -1, right: 2, top: 2, bottom: -1 },
    required_features: ["OsmSchema-V0.6"],
    optional_features: [],
    writingprogram: "territory-kit-test",
    source: "territory-kit fixture",
    osmosis_replication_timestamp: 1787727735
  });
  const primitive = await osmBlockToPbfBlobBytes({
    stringtable: [
      "",
      "highway",
      "primary",
      "waterway",
      "river",
      "railway",
      "rail",
      "leisure",
      "park",
      "landuse",
      "forest",
      "place",
      "neighbourhood",
      "name",
      "Fixture Mahalle"
    ].map((value) => encoder.encode(value)),
    primitivegroup: [
      {
        nodes: [
          node(1, -0.5, 0.5),
          node(2, 1.5, 0.5),
          node(3, 0.5, -0.5),
          node(4, 0.5, 1.5),
          node(5, 0.75, -0.5),
          node(6, 0.75, 1.5),
          node(7, 0.2, 0.2),
          node(8, 0.8, 0.2),
          node(9, 0.8, 0.8),
          node(10, 0.2, 0.8),
          node(11, 1.2, 0.2),
          node(12, 1.8, 0.2),
          node(13, 1.8, 0.8),
          node(14, 1.2, 0.8),
          node(20, 0.3, 0.3, [11, 13], [12, 14])
        ],
        ways: [
          { id: 100, keys: [1], vals: [2], refs: [1, 1] },
          { id: 101, keys: [3], vals: [4], refs: [3, 1] },
          { id: 102, keys: [5], vals: [6], refs: [5, 1] },
          { id: 103, keys: [7], vals: [8], refs: [7, 1, 1, 1, -3] },
          { id: 104, keys: [9], vals: [10], refs: [11, 1, 1, 1, -3] }
        ],
        relations: []
      }
    ]
  });
  const output = new Uint8Array(header.length + primitive.length);
  output.set(header, 0);
  output.set(primitive, header.length);
  return output;
}

async function sourceLockForFixture(pbfPath: string): Promise<TurkeyOsmSnapshotSourceLock> {
  const bytes = await readFile(pbfPath);
  const sha256 = sha256Hex(bytes);

  return {
    schemaVersion: TURKEY_OSM_BARRIER_SNAPSHOT_SOURCE_LOCK_SCHEMA_VERSION,
    providerId: TURKEY_OSM_BARRIER_PROVIDER_ID,
    providerName: TURKEY_OSM_BARRIER_PROVIDER_NAME,
    countryCode: "TR",
    sourceUrl: "https://download.geofabrik.de/europe/turkey.html",
    downloadUrl: "https://download.geofabrik.de/europe/turkey-latest.osm.pbf",
    sourceDatasetId: "geofabrik:europe:turkey",
    snapshotDate: "2026-08-26T20:22:15.000Z",
    downloadedAt: "2026-08-28T00:00:00.000Z",
    fileSizeBytes: bytes.byteLength,
    sha256,
    license: TURKEY_OSM_BARRIER_LICENSE,
    attribution: TURKEY_OSM_BARRIER_ATTRIBUTION,
    format: "osm-pbf",
    contentAddressedSnapshotId: `TR-${sha256.slice(0, 16)}`,
    cachePath: pbfPath,
    pbfHeader: {
      osmosisReplicationTimestamp: "2026-08-26T20:22:15.000Z",
      writingProgram: "territory-kit-test",
      source: "territory-kit fixture"
    }
  };
}

function node(id: number, lng: number, lat: number, keys: number[] = [], vals: number[] = []) {
  return {
    id,
    lat: Math.round(lat * 10_000_000),
    lon: Math.round(lng * 10_000_000),
    keys,
    vals
  };
}

interface FixtureRelationMember {
  ref: number;
  type: "way" | "relation";
  roleSid: number;
}

const multipolygonStringIds = {
  type: 1,
  multipolygon: 2,
  leisure: 3,
  park: 4,
  landuse: 5,
  forest: 6,
  natural: 7,
  water: 8,
  outer: 9,
  inner: 10,
  name: 11,
  relationPark: 12,
  relationLanduse: 13,
  relationWater: 14,
  route: 15,
  bus: 16
} as const;

async function createMultipolygonFixturePbf(
  options: { parkMemberOrder?: readonly number[] } = {}
): Promise<Uint8Array> {
  const s = multipolygonStringIds;
  const header = await osmBlockToPbfBlobBytes({
    bbox: { left: -1, right: 8, top: 2, bottom: -1 },
    required_features: ["OsmSchema-V0.6"],
    optional_features: [],
    writingprogram: "territory-kit-test",
    source: "territory-kit multipolygon fixture",
    osmosis_replication_timestamp: 1787727735
  });
  const primitive = await osmBlockToPbfBlobBytes({
    stringtable: multipolygonStringTable(),
    primitivegroup: [
      {
        nodes: [
          node(1000, 0, 0),
          node(1001, 1, 0),
          node(1002, 1, 1),
          node(1003, 0, 1),
          node(1100, 2, 0),
          node(1101, 3, 0),
          node(1102, 3, 1),
          node(1103, 2, 1),
          node(1110, 2.2, 0.2),
          node(1111, 2.4, 0.2),
          node(1112, 2.4, 0.4),
          node(1113, 2.2, 0.4),
          node(1120, 2.6, 0.2),
          node(1121, 2.8, 0.2),
          node(1122, 2.8, 0.4),
          node(1123, 2.6, 0.4),
          node(1200, 4, 0),
          node(1201, 5, 0),
          node(1202, 5, 1),
          node(1203, 4, 1),
          node(1210, 6, 0),
          node(1211, 7, 0),
          node(1212, 7, 1),
          node(1213, 6, 1),
          node(1220, 4.2, 0.2),
          node(1221, 4.4, 0.2),
          node(1222, 4.4, 0.4),
          node(1223, 4.2, 0.4)
        ],
        ways: [
          way(201, [1000, 1001]),
          way(202, [1003, 1002, 1001]),
          way(203, [1003, 1000]),
          way(211, [1100, 1101, 1102, 1103, 1100]),
          way(212, [1110, 1111]),
          way(213, [1113, 1112, 1111]),
          way(214, [1113, 1110]),
          way(215, [1120, 1121, 1122, 1123, 1120]),
          way(221, [1200, 1201, 1202, 1203, 1200]),
          way(222, [1210, 1211, 1212, 1213, 1210]),
          way(223, [1220, 1221, 1222, 1223, 1220])
        ],
        relations: [
          relation(
            300,
            [s.type, s.leisure, s.name],
            [s.multipolygon, s.park, s.relationPark],
            relationWayMembers(options.parkMemberOrder ?? [203, 201, 202], s.outer)
          ),
          relation(
            301,
            [s.type, s.landuse, s.name],
            [s.multipolygon, s.forest, s.relationLanduse],
            [
              ...relationWayMembers([211], s.outer),
              ...relationWayMembers([212, 213, 214], s.inner),
              ...relationWayMembers([215], s.inner)
            ]
          ),
          relation(
            302,
            [s.type, s.natural, s.name],
            [s.multipolygon, s.water, s.relationWater],
            [
              ...relationWayMembers([221], s.outer),
              ...relationWayMembers([222], s.outer),
              ...relationWayMembers([223], s.inner)
            ]
          )
        ]
      }
    ]
  });
  const output = new Uint8Array(header.length + primitive.length);
  output.set(header, 0);
  output.set(primitive, header.length);
  return output;
}

async function createMultipolygonDiagnosticsFixturePbf(): Promise<Uint8Array> {
  const s = multipolygonStringIds;
  const header = await osmBlockToPbfBlobBytes({
    bbox: { left: -1, right: 6, top: 3, bottom: -1 },
    required_features: ["OsmSchema-V0.6"],
    optional_features: [],
    writingprogram: "territory-kit-test",
    source: "territory-kit multipolygon diagnostics fixture",
    osmosis_replication_timestamp: 1787727735
  });
  const primitive = await osmBlockToPbfBlobBytes({
    stringtable: multipolygonStringTable(),
    primitivegroup: [
      {
        nodes: [
          node(2000, 0, 0),
          node(2001, 1, 0),
          node(2002, 1, 1),
          node(2003, 0, 1),
          node(2010, 3, 0),
          node(2011, 4, 0),
          node(2012, 4, 1),
          node(2013, 3, 1),
          node(2014, 0, 0)
        ],
        ways: [
          way(401, [2000, 2001, 2002, 2003, 2000]),
          way(402, [2010, 2011, 2012, 2013, 2010]),
          way(403, [2000, 2001, 2002]),
          way(404, [2000, 2001, 2002, 9999, 2000]),
          way(405, [2000, 2001, 2002, 2003, 2014])
        ],
        relations: [
          relation(
            500,
            [s.type, s.leisure, s.name],
            [s.multipolygon, s.park, s.relationPark],
            [...relationWayMembers([403], s.outer)]
          ),
          relation(
            501,
            [s.type, s.landuse, s.name],
            [s.multipolygon, s.forest, s.relationLanduse],
            [...relationWayMembers([401], s.outer), ...relationWayMembers([402], s.inner)]
          ),
          relation(
            502,
            [s.type, s.natural, s.name],
            [s.multipolygon, s.water, s.relationWater],
            [
              ...relationWayMembers([401], s.outer),
              { ref: 999, type: "relation", roleSid: s.inner }
            ]
          ),
          relation(
            503,
            [s.type, s.natural, s.name],
            [s.route, s.water, s.relationWater],
            [...relationWayMembers([401], s.outer)]
          ),
          relation(
            504,
            [s.type, s.leisure],
            [s.multipolygon, s.park],
            relationWayMembers([401, 403], s.outer)
          ),
          relation(
            505,
            [s.type, s.leisure],
            [s.multipolygon, s.park],
            [...relationWayMembers([401], s.outer), ...relationWayMembers([403], s.inner)]
          ),
          relation(
            506,
            [s.type, s.leisure],
            [s.multipolygon, s.park],
            relationWayMembers([404], s.outer)
          ),
          relation(
            507,
            [s.type, s.leisure],
            [s.multipolygon, s.park],
            relationWayMembers([405], s.outer)
          )
        ]
      }
    ]
  });
  const output = new Uint8Array(header.length + primitive.length);
  output.set(header, 0);
  output.set(primitive, header.length);
  return output;
}

function multipolygonStringTable(): Uint8Array[] {
  return [
    "",
    "type",
    "multipolygon",
    "leisure",
    "park",
    "landuse",
    "forest",
    "natural",
    "water",
    "outer",
    "inner",
    "name",
    "Relation Park",
    "Relation Forest",
    "Relation Water",
    "route",
    "bus"
  ].map((value) => encoder.encode(value));
}

function way(id: number, refs: readonly number[], keys: number[] = [], vals: number[] = []) {
  return {
    id,
    keys,
    vals,
    refs: deltaEncode(refs)
  };
}

function relation(
  id: number,
  keys: number[],
  vals: number[],
  members: readonly FixtureRelationMember[]
) {
  return {
    id,
    keys,
    vals,
    roles_sid: members.map((member) => member.roleSid),
    memids: deltaEncode(members.map((member) => member.ref)),
    types: members.map((member) => (member.type === "way" ? 1 : 2))
  };
}

function relationWayMembers(wayIds: readonly number[], roleSid: number): FixtureRelationMember[] {
  return wayIds.map((ref) => ({ ref, type: "way", roleSid }));
}

function deltaEncode(values: readonly number[]): number[] {
  let previous = 0;

  return values.map((value) => {
    const delta = value - previous;
    previous = value;
    return delta;
  });
}

function zone(id: string, name: string, geometry: TerritoryGeometry): TerritoryZone {
  return {
    id,
    datasetId: "fixture",
    countryCode: "TR",
    level: 2,
    sourceAdminLevel: "ADM2",
    semanticType: "district",
    name,
    neighborIds: [],
    geometry,
    center: [0.5, 0.5],
    bbox: [0, 0, 1, 1],
    properties: { territory: { adminLevel: "ADM2" } }
  };
}

function square(west: number, south: number, east: number, north: number): TerritoryGeometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south]
      ]
    ]
  };
}
