import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { osmBlockToPbfBlobBytes } from "@osmix/pbf";
import type { TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import { extractTurkeyAdm3OsmPbf } from "../src/turkey-adm3.js";

const encoder = new TextEncoder();

describe("Turkey ADM3 OSM PBF extraction", () => {
  it("parses a PBF smoke fixture, rejects broken polygons, and preserves ODbL metadata", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-tr-adm3-osm-"));

    try {
      const pbfPath = join(tempDir, "fixture.osm.pbf");
      await writeFile(pbfPath, await createMiniOsmPbf());

      const result = await extractTurkeyAdm3OsmPbf({
        pbfPath,
        generatedAt: "2026-08-07T00:00:00.000Z",
        providerId: "tr-adm3-osm-fixture",
        provinceCode: "34",
        districtZones: [zone("tr:adm2:kadikoy", "Kadıköy", square(-1, -1, 2, 2))]
      });

      expect(result.zones).toHaveLength(1);
      const territory = result.zones[0]?.properties.territory as Record<string, unknown>;
      expect(result.zones[0]?.parentId).toBe("tr:adm2:kadikoy");
      expect(territory).toMatchObject({
        sourceClass: "osm",
        official: false,
        osmType: "way",
        osmId: 10,
        sourceNativeId: "osm:way:10"
      });
      expect(territory.source).toMatchObject({
        license: "ODbL-1.0",
        attribution: "OpenStreetMap contributors, ODbL 1.0"
      });
      expect(result.unresolved).toEqual([
        expect.objectContaining({
          osmType: "relation",
          osmId: 20,
          reason: "geometry-unavailable"
        })
      ]);
      expect(result.duplicates).toEqual([]);
      expect(result.sourceLock).toMatchObject({
        license: "ODbL-1.0",
        attribution: "OpenStreetMap contributors, ODbL 1.0"
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function createMiniOsmPbf(): Promise<Uint8Array> {
  const header = await osmBlockToPbfBlobBytes({
    bbox: { left: 0, right: 1, top: 1, bottom: 0 },
    required_features: ["OsmSchema-V0.6", "DenseNodes"],
    optional_features: [],
    writingprogram: "territory-kit-test"
  });
  const primitive = await osmBlockToPbfBlobBytes({
    stringtable: [
      "",
      "boundary",
      "administrative",
      "admin_level",
      "10",
      "name",
      "Fixture Mahalle",
      "place",
      "neighbourhood",
      "type",
      "multipolygon"
    ].map((value) => encoder.encode(value)),
    primitivegroup: [
      {
        nodes: [],
        dense: {
          id: [1, 1, 1, 1],
          lat: [0, 0, 10_000_000, 0],
          lon: [0, 10_000_000, 0, -10_000_000],
          keys_vals: []
        },
        ways: [
          {
            id: 10,
            keys: [1, 3, 5, 7],
            vals: [2, 4, 6, 8],
            refs: [1, 1, 1, 1, -3]
          }
        ],
        relations: [
          {
            id: 20,
            keys: [1, 3, 9],
            vals: [2, 4, 10],
            roles_sid: [],
            memids: [],
            types: []
          }
        ]
      }
    ]
  });
  const output = new Uint8Array(header.length + primitive.length);
  output.set(header, 0);
  output.set(primitive, header.length);
  return output;
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
    bbox: [-1, -1, 2, 2],
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
