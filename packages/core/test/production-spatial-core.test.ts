import {
  createSampleTerritoryDataset,
  createSquareZone,
  createTurkeyAdm3DemoDataset
} from "@territory-kit/shared-testkit";
import { computeGeometryBBox, computeGeometryCenter } from "@territory-kit/dataset";
import type { TerritoryDataset, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  computeTerritoryAreaM2,
  createTerritoryEngine,
  createTerritoryGeometryVersion
} from "../src/index.js";

describe("production spatial core contracts", () => {
  it("keeps territory identity stable across rebuilds and separates dataset/geometry versions", () => {
    const dataset = createSampleTerritoryDataset();
    const rebuilt = structuredClone(dataset);
    const upgraded = structuredClone(dataset);
    upgraded.manifest.datasetVersion = "0.1.1";
    const changedGeometry = structuredClone(dataset);
    const zone = changedGeometry.zones.find((candidate) => candidate.id === "tr:34:fatih");

    if (!zone || zone.geometry.type !== "Polygon") {
      throw new Error("Expected Fatih sample polygon fixture.");
    }

    zone.geometry.coordinates[0] = rotateClosedRing(zone.geometry.coordinates[0] ?? []);
    const rebuiltIdentity = createTerritoryEngine({ dataset: rebuilt }).getIdentity("tr:34:fatih");
    const originalIdentity = createTerritoryEngine({ dataset }).getIdentity("tr:34:fatih");
    const upgradedIdentity = createTerritoryEngine({ dataset: upgraded }).getIdentity(
      "tr:34:fatih"
    );

    expect(originalIdentity?.territoryId).toBe("tr:34:fatih");
    expect(rebuiltIdentity?.territoryId).toBe(originalIdentity?.territoryId);
    expect(rebuiltIdentity?.geometryVersion).toBe(originalIdentity?.geometryVersion);
    expect(upgradedIdentity?.territoryId).toBe(originalIdentity?.territoryId);
    expect(upgradedIdentity?.datasetVersion).toBe("0.1.1");

    zone.geometry.coordinates[0] = [
      [28.93, 41],
      [29.01, 41],
      [29.01, 41.05],
      [28.93, 41.05],
      [28.93, 41]
    ];
    zone.bbox = computeGeometryBBox(zone.geometry);
    zone.center = computeGeometryCenter(zone.geometry);

    const changedIdentity = createTerritoryEngine({ dataset: changedGeometry }).getIdentity(
      "tr:34:fatih"
    );

    expect(changedIdentity?.territoryId).toBe(originalIdentity?.territoryId);
    expect(changedIdentity?.geometryVersion).not.toBe(originalIdentity?.geometryVersion);
  });

  it("preserves generated deterministic IDs and explicit custom stable IDs", () => {
    const generatedA = generatedDataset();
    const generatedB = generatedDataset();
    const custom = createDataset([
      createSquareZone({
        id: "custom:venue:blue-market",
        level: 0,
        west: 0,
        south: 0,
        east: 1,
        north: 1,
        properties: {
          territory: {
            stableId: "venue-blue-market",
            sourceClass: "official",
            geometryVersion: "custom-boundary-v1"
          }
        }
      })
    ]);

    expect(generatedB.zones.map((zone) => zone.id)).toEqual(
      generatedA.zones.map((zone) => zone.id)
    );
    expect(
      createTerritoryEngine({ dataset: custom }).getIdentity("custom:venue:blue-market")
    ).toMatchObject({
      territoryId: "custom:venue:blue-market",
      stableId: "venue-blue-market",
      geometryVersion: "custom-boundary-v1"
    });
  });

  it("locates deepest, level-filtered, boundary, hole, MultiPolygon, and wrapped-longitude matches", () => {
    const dataset = createLookupDataset();
    const engine = createTerritoryEngine({ dataset });

    expect(engine.findTerritoryAtPoint({ lat: 0.25, lng: 0.25 })?.territoryId).toBe("parent:child");
    expect(
      engine.findTerritoriesAtPoint({ lat: 0.25, lng: 0.25 }).map((match) => match.territoryId)
    ).toEqual(["parent:child", "parent", "world"]);
    expect(
      engine.findTerritoryAtPoint({ lat: 0.25, lng: 0.25 }, { level: "ADM1" })?.territoryId
    ).toBe("parent");
    expect(
      engine.findTerritoryAtPoint({ lat: 0.25, lng: 0.25 }, { levels: ["ADM2"] })?.territoryId
    ).toBe("parent:child");
    expect(
      engine.findTerritoryAtPoint({ lat: 0, lng: 0 }, { boundaryMode: "covers" })?.territoryId
    ).toBe("parent:child");
    expect(
      engine.findTerritoryAtPoint({ lat: 0, lng: 0 }, { boundaryMode: "contains" })?.territoryId
    ).toBe("parent");
    expect(engine.findTerritoryAtPoint({ lat: 2, lng: 4 }, { level: 1 })?.territoryId).toBe(
      "parent"
    );
    expect(engine.findTerritoryAtPoint({ lat: 2, lng: 4 }, { level: 2 })).toBeNull();
    expect(engine.findTerritoryAtPoint({ lat: 2, lng: 3 }, { level: 2 })?.territoryId).toBe(
      "donut"
    );
    expect(engine.findTerritoryAtPoint({ lat: 0.5, lng: 11.5 }, { level: 2 })?.territoryId).toBe(
      "multi"
    );
    expect(engine.findTerritoryAtPoint({ lat: 0.5, lng: 181 }, { level: 2 })?.territoryId).toBe(
      "wrapped"
    );
    expect(engine.findTerritoryAtPoint({ lat: 91, lng: 0 })).toBeNull();
  });

  it("returns geometry metrics, hierarchy, adjacency, and stable bounds results", () => {
    const engine = createTerritoryEngine({ dataset: createLookupDataset() });
    const metrics = engine.getMetrics("donut");
    const representative = metrics?.representativePoint;

    expect(engine.getGeometry("multi")?.type).toBe("MultiPolygon");
    expect(metrics?.areaM2).toBeGreaterThan(0);
    expect(metrics?.areaKm2).toBeCloseTo((metrics?.areaM2 ?? 0) / 1_000_000);
    expect(representative).toBeDefined();
    expect(
      representative
        ? engine.latLngToZone({ lat: representative[1], lng: representative[0] }, { level: 2 })
        : null
    ).toBe("donut");
    expect(engine.getHierarchy("parent:child")).toMatchObject({
      territoryId: "parent:child",
      parentId: "parent",
      ancestorIds: ["parent", "world"],
      pathIds: ["world", "parent", "parent:child"],
      isRoot: false,
      isOrphan: false
    });
    expect(engine.getHierarchy("world")).toMatchObject({
      territoryId: "world",
      parentId: null,
      ancestorIds: [],
      pathIds: ["world"],
      isRoot: true,
      isOrphan: false
    });
    expect(engine.getParent("parent:child")?.id).toBe("parent");
    expect(engine.getAncestors("parent:child")).toEqual(["parent", "world"]);
    expect(engine.getChildren("parent").map((zone) => zone.id)).toEqual(["parent:child"]);
    expect(engine.getAdjacentTerritories("parent:child").map((zone) => zone.id)).toEqual(["donut"]);
    expect(
      engine
        .findTerritoriesInBounds(
          { west: -1, south: -1, east: 13, north: 2 },
          { levels: [2], limit: 2 }
        )
        .map((match) => match.territoryId)
    ).toEqual(["donut", "multi"]);
    expect(
      engine.findTerritoriesInBounds(
        { west: Number.NaN, south: -1, east: 13, north: 2 },
        { level: 2 }
      )
    ).toEqual([]);
    expect(engine.getDatasetVersionInfo()).toMatchObject({
      datasetId: "production-spatial-fixture",
      datasetVersion: "1.0.0",
      geometryHash: "fixture-v1"
    });
  });

  it("finds exact route intersections with traversal order, repeat entries, holes, and touches", () => {
    const engine = createTerritoryEngine({ dataset: createLookupDataset() });
    const route = {
      type: "LineString" as const,
      coordinates: [
        [0.5, 0.5],
        [2.5, 0.5],
        [0.5, 0.5]
      ] as Array<[number, number]>
    };
    const result = engine.findTerritoriesAlongRoute(route, { level: 2 });

    expect(result.mode).toBe("exact");
    expect(result.territories.map((territory) => territory.territoryId)).toEqual([
      "parent:child",
      "donut"
    ]);
    expect(result.traversal.map((segment) => segment.territoryId)).toEqual([
      "parent:child",
      "donut",
      "parent:child"
    ]);
    expect(result.territories[0]).toMatchObject({
      method: "exact",
      entered: true,
      boundaryOnly: false,
      datasetVersion: "1.0.0",
      segmentCount: 2
    });
    expect(result.territories[0]?.intersectionLengthM).toBeGreaterThan(0);

    const hole = engine.findTerritoriesAlongRoute(
      {
        type: "LineString",
        coordinates: [
          [2.5, 2],
          [5.5, 2]
        ]
      },
      { level: 2 }
    );
    expect(hole.territories.map((territory) => territory.territoryId)).toEqual(["donut"]);
    expect(hole.territories[0]?.segmentCount).toBe(2);

    const onlyHole = engine.findTerritoriesAlongRoute(
      {
        type: "LineString",
        coordinates: [
          [3.2, 2],
          [4.8, 2]
        ]
      },
      { level: 2 }
    );
    expect(onlyHole.territories).toEqual([]);

    const cornerTouch = engine.findTerritoriesAlongRoute(
      {
        type: "LineString",
        coordinates: [
          [1, 1],
          [1.5, 1.5]
        ]
      },
      { level: 2 }
    );
    expect(cornerTouch.territories).toEqual([
      expect.objectContaining({
        territoryId: "parent:child",
        entered: false,
        boundaryOnly: true,
        intersectionLengthM: 0
      })
    ]);
  });

  it("keeps sampled route fallback explicitly approximate", () => {
    const engine = createTerritoryEngine({ dataset: createLookupDataset() });
    const sampled = engine.findTerritoriesAlongRoute(
      [
        { lng: 0.5, lat: 0.5 },
        { lng: 2.5, lat: 0.5 }
      ],
      { level: 2, mode: "sampled", sampleDistanceM: 500_000 }
    );

    expect(sampled.mode).toBe("sampled");
    expect(sampled.territories.map((territory) => territory.territoryId)).toEqual([
      "parent:child",
      "donut"
    ]);
    expect(sampled.territories.every((territory) => territory.method === "sampled")).toBe(true);
    expect(sampled.territories[0]?.intersectionLengthM).toBeUndefined();
    expect(engine.findTerritoriesAlongRoute({ type: "LineString", coordinates: [[0, 0]] })).toEqual(
      {
        mode: "exact",
        routeLengthM: 0,
        territories: [],
        traversal: []
      }
    );
    expect(
      engine.findTerritoriesAlongRoute({
        type: "LineString",
        coordinates: [
          [0, 0],
          [Number.NaN, 1]
        ]
      }).territories
    ).toEqual([]);
  });

  it("delivers production viewport pages with level filters and dateline bounds", () => {
    const engine = createTerritoryEngine({ dataset: createLookupDataset() });
    const firstPage = engine.queryTerritoriesInViewport({
      bounds: { west: -180, south: -1, east: 13, north: 2 },
      levels: ["ADM2"],
      limit: 2
    });

    expect(firstPage).toMatchObject({
      level: 2,
      levels: [2],
      limit: 2,
      hasMore: true,
      totalEstimate: 4,
      datelineSplit: false
    });
    expect(firstPage.zones.map((zone) => zone.id)).toEqual(["donut", "multi"]);
    expect(firstPage.nextCursor).toBe("offset:2");

    const secondPage = engine.queryTerritoriesInViewport({
      bounds: { west: -180, south: -1, east: 13, north: 2 },
      levels: ["ADM2"],
      limit: 2,
      ...(firstPage.nextCursor ? { cursor: firstPage.nextCursor } : {})
    });
    expect(secondPage.zones.map((zone) => zone.id)).toEqual(["parent:child", "wrapped"]);
    expect(secondPage.hasMore).toBe(false);

    const dateline = engine.queryTerritoriesInViewport({
      bounds: { west: 179.8, south: 0, east: -178, north: 1 },
      level: "ADM2"
    });
    expect(dateline.datelineSplit).toBe(true);
    expect(dateline.zones.map((zone) => zone.id)).toEqual(["wrapped"]);

    expect(
      engine.queryTerritoriesInViewport({
        bounds: { west: 0, south: -95, east: 1, north: 1 },
        level: "ADM2"
      }).zones
    ).toEqual([]);
  });

  it("creates canonical geometry versions independent of ring orientation and start coordinate", () => {
    const geometryA: TerritoryGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0]
        ]
      ]
    };
    const geometryB: TerritoryGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [2, 2],
          [2, 0],
          [0, 0],
          [0, 2],
          [2, 2]
        ]
      ]
    };

    expect(createTerritoryGeometryVersion(geometryB)).toBe(
      createTerritoryGeometryVersion(geometryA)
    );
    expect(computeTerritoryAreaM2(geometryA)).toBeGreaterThan(49_000_000_000);
  });

  it("supports the Turkey ADM3 production lookup flow with hierarchy, geometry, metrics, and bounds", () => {
    const engine = createTerritoryEngine({ dataset: createTurkeyAdm3DemoDataset() });
    const match = engine.findTerritoryAtPoint({ lat: 41.03, lng: 28.965 }, { level: "ADM3" });
    const metrics = match ? engine.getMetrics(match.territoryId) : null;
    const representative = metrics?.representativePoint;

    expect(match?.territoryId).toBe("tr:adm3:demo-neighbourhood-b");
    expect(match?.hierarchy.pathIds).toEqual([
      "tr",
      "tr:adm1:istanbul",
      "tr:adm2:fatih",
      "tr:adm3:demo-neighbourhood-b"
    ]);
    expect(engine.getGeometry("tr:adm3:demo-neighbourhood-b")?.type).toBe("Polygon");
    expect(metrics?.areaM2).toBeGreaterThan(0);
    expect(
      representative
        ? engine.findTerritoryAtPoint(
            { lat: representative[1], lng: representative[0] },
            { level: "ADM3" }
          )?.territoryId
        : null
    ).toBe("tr:adm3:demo-neighbourhood-b");
    expect(
      engine
        .findTerritoriesInBounds(
          { west: 28.94, south: 41, east: 28.99, north: 41.06 },
          { level: "ADM3" }
        )
        .map((result) => result.territoryId)
    ).toEqual([
      "tr:adm3:demo-neighbourhood-a",
      "tr:adm3:demo-neighbourhood-b",
      "tr:adm3:demo-neighbourhood-c"
    ]);
  });
});

function createLookupDataset(): TerritoryDataset {
  return createDataset([
    createSquareZone({
      id: "world",
      level: 0,
      west: -180,
      south: -10,
      east: 180,
      north: 20,
      childIds: ["parent"]
    }),
    createSquareZone({
      id: "parent",
      level: 1,
      west: -1,
      south: -1,
      east: 6,
      north: 5,
      parentId: "world",
      childIds: ["parent:child"]
    }),
    createSquareZone({
      id: "parent:child",
      level: 2,
      west: 0,
      south: 0,
      east: 1,
      north: 1,
      parentId: "parent",
      neighborIds: ["donut"]
    }),
    createZone({
      id: "donut",
      level: 2,
      parentId: "parent",
      neighborIds: ["parent:child"],
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [2, 0],
            [6, 0],
            [6, 4],
            [2, 4],
            [2, 0]
          ],
          [
            [3, 1],
            [5, 1],
            [5, 3],
            [3, 3],
            [3, 1]
          ]
        ]
      }
    }),
    createZone({
      id: "multi",
      level: 2,
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [10, 0],
              [11, 0],
              [11, 1],
              [10, 1],
              [10, 0]
            ]
          ],
          [
            [
              [11, 0],
              [12, 0],
              [12, 1],
              [11, 1],
              [11, 0]
            ]
          ]
        ]
      }
    }),
    createSquareZone({
      id: "wrapped",
      level: 2,
      west: -179.5,
      south: 0,
      east: -178.5,
      north: 1
    })
  ]);
}

function generatedDataset(): TerritoryDataset {
  return createDataset([
    createSquareZone({
      id: "generated:seed-a:0:0",
      level: 0,
      west: 0,
      south: 0,
      east: 1,
      north: 1,
      properties: {
        territory: {
          generated: true,
          sourceClass: "generated",
          generatedZone: {
            algorithm: "deterministic-grid",
            algorithmVersion: "1",
            generationSeed: "seed-a",
            localKey: "0:0"
          }
        }
      }
    })
  ]);
}

function createDataset(zones: TerritoryZone[]): TerritoryDataset {
  return {
    manifest: {
      datasetId: "production-spatial-fixture",
      datasetVersion: "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "synthetic",
      geometryHash: "fixture-v1"
    },
    zones: zones.map((zone) => ({ ...zone, datasetId: "production-spatial-fixture" }))
  };
}

function createZone(input: {
  id: string;
  level: number;
  geometry: TerritoryGeometry;
  parentId?: string;
  neighborIds?: string[];
}): TerritoryZone {
  return {
    id: input.id,
    datasetId: "production-spatial-fixture",
    level: input.level,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    neighborIds: input.neighborIds ?? [],
    geometry: input.geometry,
    center: computeGeometryCenter(input.geometry),
    bbox: computeGeometryBBox(input.geometry),
    properties: {}
  };
}

function rotateClosedRing(ring: number[][]): number[][] {
  const open = ring.slice(0, -1);
  const rotated = open.slice(2).concat(open.slice(0, 2));
  const first = rotated[0];

  return first ? [...rotated, first] : ring;
}
