import { describe, expect, it } from "vitest";
import {
  buildSettlementIdentityLayer,
  type SettlementIdentitySeedInput,
  type TerritoryDataset,
  type TerritoryZone
} from "@territory-kit/dataset";
import { createSettlementIdentityLookup, loadSettlementIdentityConsumer } from "../src/index.js";

function squareZone(id: string, west: number, south: number, size: number): TerritoryZone {
  const east = west + size;
  const north = south + size;
  return {
    id,
    datasetId: "territory-kit-tr-v2-playable",
    level: 3,
    name: id,
    parentId: "tr:adm2:parent",
    geometry: {
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
    },
    neighborIds: [],
    center: [(west + east) / 2, (south + north) / 2],
    bbox: [west, south, east, north],
    properties: {}
  };
}

function buildDataset(): TerritoryDataset {
  const parent: TerritoryZone = {
    id: "tr:adm2:parent",
    datasetId: "territory-kit-tr-v2-playable",
    level: 2,
    name: "Parent",
    geometry: squareZone("parent-geom", 0, 0, 10).geometry,
    neighborIds: [],
    center: [5, 5],
    bbox: [0, 0, 10, 10],
    properties: {}
  };

  return {
    manifest: {
      datasetId: "territory-kit-tr-v2-playable",
      datasetVersion: "2.1.0-rc.8",
      schemaVersion: "territory-schema@1",
      sourceDate: "test",
      geometryHash: "test",
      license: "Apache-2.0",
      name: "Fixture"
    },
    zones: [parent, squareZone("z-a", 0, 0, 5), squareZone("z-unseeded", 5, 0, 5)]
  };
}

describe("loadSettlementIdentityConsumer", () => {
  const dataset = buildDataset();
  const parent = dataset.zones[0]!;
  const seeds: SettlementIdentitySeedInput[] = [
    { name: "Alpha", coordinate: [1, 1], sourceId: "osm:node:1", type: "quarter" }
  ];
  const layer = buildSettlementIdentityLayer({
    gameplayZones: [dataset.zones[1]!, dataset.zones[2]!],
    parentAdm2Zone: parent,
    seeds,
    gameplayDatasetVersion: dataset.manifest.datasetVersion,
    identityLayerVersion: "test@1",
    generatedAt: "2026-10-15T00:00:00.000Z",
    defaultProvenance: {
      providerId: "openstreetmap",
      licenseState: "pending",
      permissionStatus: "redistribution-unknown",
      sourceLockState: "unknown",
      snapshotChecksum: "sha256:test-snapshot"
    }
  });

  it("returns lookup only when validation passes", () => {
    const loaded = loadSettlementIdentityConsumer({
      layer,
      gameplayDataset: dataset,
      pins: { parentAdm2Id: parent.id }
    });
    expect(loaded.ok).toBe(true);
    expect(loaded.lookup).not.toBeNull();
    const zoneView = loaded.lookup!.listSettlementsForZone("z-a");
    expect(zoneView.zoneResolution).toBe("associated");
  });

  it("distinguishes unseeded and unknown zones", () => {
    const unseededLayer = buildSettlementIdentityLayer({
      gameplayZones: [dataset.zones[1]!, dataset.zones[2]!],
      parentAdm2Zone: parent,
      seeds,
      gameplayDatasetVersion: dataset.manifest.datasetVersion,
      identityLayerVersion: "test@1",
      generatedAt: "2026-10-15T00:00:00.000Z",
      defaultProvenance: {
        providerId: "openstreetmap",
        licenseState: "pending",
        permissionStatus: "redistribution-unknown",
        sourceLockState: "unknown",
        snapshotChecksum: "sha256:test-snapshot"
      }
    });

    const lookup = createSettlementIdentityLookup({
      layer: unseededLayer,
      gameplayZoneIds: new Set(["z-a", "z-unseeded"]),
      parentAdm2Id: parent.id
    });

    expect(lookup.listSettlementsForZone("z-unseeded").zoneResolution).toBe("unseeded");
    expect(lookup.listSettlementsForZone("tr:adm3:missing").zoneResolution).toBe("unknown-zone");
  });

  it("fails closed on wrong geometry hash pin", () => {
    const loaded = loadSettlementIdentityConsumer({
      layer,
      gameplayDataset: dataset,
      pins: {
        parentAdm2Id: parent.id,
        geometryHashSetSha256: "0000000000000000000000000000000000000000000000000000000000000000"
      }
    });
    expect(loaded.ok).toBe(false);
    expect(loaded.lookup).toBeNull();
  });
});
