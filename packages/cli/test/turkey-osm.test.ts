import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TURKEY_OSM_BARRIER_ATTRIBUTION,
  TURKEY_OSM_BARRIER_LICENSE,
  TURKEY_OSM_BARRIER_PROVIDER_ID,
  TURKEY_OSM_BARRIER_PROVIDER_NAME,
  TURKEY_OSM_BARRIER_SNAPSHOT_SOURCE_LOCK_SCHEMA_VERSION
} from "@territory-kit/generators/turkey-adm3";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";

describe("territory cli Turkey OSM snapshot pipeline", () => {
  it("exposes acquire and barrier build dry-runs without network or extraction", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-cli-tr-osm-"));

    try {
      const adm2Path = join(tempDir, "adm2.json");
      const sourceLockPath = join(tempDir, "source-lock.json");
      await writeFile(adm2Path, JSON.stringify(adm2Dataset()), "utf8");
      await writeFile(sourceLockPath, JSON.stringify(sourceLock(tempDir)), "utf8");

      await expect(captureCli(["tr", "osm", "acquire", "--dry-run"])).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "tr osm acquire",
          data: {
            provider: {
              id: TURKEY_OSM_BARRIER_PROVIDER_ID,
              license: TURKEY_OSM_BARRIER_LICENSE
            },
            expectedOperations: expect.arrayContaining(["lock snapshot by SHA-256"])
          }
        }
      });

      await expect(
        captureCli([
          "tr",
          "osm",
          "barriers",
          "build",
          "--adm2",
          adm2Path,
          "--source-lock",
          sourceLockPath,
          "--output",
          join(tempDir, "barriers"),
          "--dry-run"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "tr osm barriers build",
          data: {
            adm2Count: 1,
            selectedAdm2Count: 1,
            selectedFeatureClasses: {
              roads: expect.arrayContaining(["primary", "secondary"]),
              localitySeeds: expect.arrayContaining(["neighbourhood"])
            }
          }
        }
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function captureCli(args: string[]): Promise<{ code: number; payload: unknown }> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

  try {
    const code = await runCli(args);
    const payload = JSON.parse(spy.mock.calls.at(-1)?.[0] ?? "{}") as unknown;

    return { code, payload };
  } finally {
    spy.mockRestore();
  }
}

function sourceLock(tempDir: string) {
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
    fileSizeBytes: 10,
    sha256: "a".repeat(64),
    license: TURKEY_OSM_BARRIER_LICENSE,
    attribution: TURKEY_OSM_BARRIER_ATTRIBUTION,
    format: "osm-pbf",
    contentAddressedSnapshotId: "TR-aaaaaaaaaaaaaaaa",
    cachePath: join(tempDir, "turkey.osm.pbf"),
    pbfHeader: {
      osmosisReplicationTimestamp: "2026-08-26T20:22:15.000Z"
    }
  };
}

function adm2Dataset() {
  return {
    manifest: {
      datasetId: "fixture",
      datasetVersion: "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-08-28T00:00:00.000Z",
      geometryHash: "fixture"
    },
    zones: [
      {
        id: "tr:adm2:fixture",
        datasetId: "fixture",
        countryCode: "TR",
        level: 2,
        sourceAdminLevel: "ADM2",
        semanticType: "district",
        name: "Fixture",
        neighborIds: [],
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
        center: [0.5, 0.5],
        bbox: [0, 0, 1, 1],
        properties: { territory: { adminLevel: "ADM2" } }
      }
    ]
  };
}
