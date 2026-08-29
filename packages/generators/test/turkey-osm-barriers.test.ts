import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { osmBlockToPbfBlobBytes } from "@osmix/pbf";
import type { TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
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
