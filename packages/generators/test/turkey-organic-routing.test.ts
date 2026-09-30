import { describe, expect, it } from "vitest";
import type { LngLat } from "@territory-kit/dataset";
import type { MultiPolygon } from "polygon-clipping";
import {
  findOrganicBarrierRoute,
  routeOrganicSharedBoundaries
} from "../src/turkey-organic-routing.js";
import { measureLongUnsupportedStraightBoundaryMeters } from "../src/turkey-smart-fallback.js";
import type { TurkeySmartFallbackBarrier } from "../src/turkey-smart-fallback.js";
import { clipTurkeyOsmLinePathToGeometry } from "../src/turkey-osm-barriers.js";
import { createSquareZone } from "@territory-kit/shared-testkit";
import {
  inspectTurkeySmartBoundaryAlignment,
  passesTurkeySmartGeographicRealism,
  resolveTurkeySmartFallbackConfiguration
} from "../src/turkey-smart-fallback.js";

const a: LngLat = [29, 40],
  b: LngLat = [29, 40.02];
function barrier(
  coordinates: LngLat[],
  barrierClass: TurkeySmartFallbackBarrier["barrierClass"] = "road",
  id = "real",
  tags: Record<string, string> = {}
): TurkeySmartFallbackBarrier {
  return {
    id,
    coordinates,
    barrierClass,
    sourceLayer:
      barrierClass === "rail" ? "railways" : barrierClass === "water" ? "water" : "roads",
    strength: 0.9,
    strengthClass: "strong",
    lengthKm: 2,
    tags
  };
}
const segments = (barriers: TurkeySmartFallbackBarrier[]) =>
  barriers.flatMap((barrier) =>
    barrier.coordinates.slice(1).map((b, i) => ({ a: barrier.coordinates[i]!, b, barrier }))
  );
const cells = (): { geometry: MultiPolygon; barrierIds: string[] }[] => [
  { geometry: [[[[28.99, 40], a, b, [28.99, 40.02], [28.99, 40]]]], barrierIds: [] },
  { geometry: [[[a, [29.01, 40], [29.01, 40.02], b, a]]], barrierIds: [] }
];
function contains(p: LngLat, g: MultiPolygon) {
  const ringContains = (ring: MultiPolygon[number][number]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!,
        b = ring[j]!;
      if (
        a[1] > p[1] !== b[1] > p[1] &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
    }
    return inside;
  };
  return g.some((polygon) => ringContains(polygon[0]!) && !polygon.slice(1).some(ringContains));
}
describe("Organic shared barrier routing", () => {
  it("clips closed concave shells and official-mask holes precisely", () => {
    expect(
      clipTurkeyOsmLinePathToGeometry(
        [
          [29.015, 40.015],
          [29.019, 40.019]
        ],
        {
          type: "Polygon",
          coordinates: [
            [
              [29, 40],
              [29.02, 40],
              [29.02, 40.01],
              [29.01, 40.01],
              [29.01, 40.02],
              [29, 40.02],
              [29, 40]
            ]
          ]
        }
      )
    ).toEqual([]);
    const clipped = clipTurkeyOsmLinePathToGeometry(
      [
        [28.99, 40.01],
        [29.03, 40.01]
      ],
      {
        type: "Polygon",
        coordinates: [
          [
            [29, 40],
            [29.02, 40],
            [29.02, 40.02],
            [29, 40.02],
            [29, 40]
          ],
          [
            [29.005, 40.005],
            [29.005, 40.015],
            [29.015, 40.015],
            [29.015, 40.005],
            [29.005, 40.005]
          ]
        ]
      }
    );
    expect(clipped).toHaveLength(2);
  });
  for (const kind of ["road", "rail", "water"] as const)
    it(`routes a curved ${kind} with bounded connectors`, () => {
      const curve = barrier(
        [
          [29.0003, 40],
          [29.001, 40.005],
          [29.0005, 40.012],
          [29.0003, 40.02]
        ],
        kind
      );
      const route = findOrganicBarrierRoute(a, b, segments([curve]), 300);
      expect(route?.supportedMeters).toBeGreaterThan(2000);
      expect(route?.connectorMeters).toBeLessThan(100);
      expect(route?.path).toContainEqual([29.001, 40.005]);
    });
  it("replaces both owners consistently without coverage loss or spill", () => {
    const input = cells(),
      curve = barrier([a, [29.001, 40.005], [29.0005, 40.012], b]);
    const output = routeOrganicSharedBoundaries(input, [curve], 2);
    expect(output[0]!.geometry).not.toEqual(input[0]!.geometry);
    expect(output[0]!.geometry[0]![0]).toContainEqual([29.001, 40.005]);
    expect(output[1]!.geometry[0]![0]).toContainEqual([29.001, 40.005]);
    expect(input).toEqual(cells());
    expect(routeOrganicSharedBoundaries(input, [curve], 2)).toEqual(output);
    for (let x = 0; x < 30; x++)
      for (let y = 0; y < 30; y++) {
        const p: LngLat = [28.99 + ((x + 0.37) * 0.02) / 30, 40 + ((y + 0.41) * 0.02) / 30];
        expect(output.filter((c) => contains(p, c.geometry))).toHaveLength(1);
      }
  });
  it("routes a shared straight seam split by a collinear vertex on one owner", () => {
    const split = cells();
    split[0]!.geometry[0]![0]!.splice(2, 0, [29, 40.01]);
    const curve = barrier([a, [29.001, 40.005], [29.001, 40.015], b]);
    const diagnostics = {
      attemptedLongEdges: 0,
      routeFound: 0,
      routeSupportImproved: 0,
      routeGeometryRejected: 0,
      routeTopologyRejected: 0,
      routeApplied: 0,
      longestUnroutedMeters: 0
    };
    const output = routeOrganicSharedBoundaries(split, [curve], 2, undefined, undefined, {
      diagnostics
    });
    expect(diagnostics.routeApplied).toBeGreaterThan(0);
    expect(output[0]!.geometry[0]![0]).toContainEqual([29.001, 40.005]);
    expect(output[1]!.geometry[0]![0]).toContainEqual([29.001, 40.005]);
  });
  it("nodes a long edge where two different neighbours meet at a T-junction", () => {
    const mid: LngLat = [29, 40.01];
    const partition = [
      cells()[0]!,
      {
        geometry: [[[a, [29.01, 40], [29.01, 40.01], mid, a]]],
        barrierIds: []
      },
      {
        geometry: [[[mid, [29.01, 40.01], [29.01, 40.02], b, mid]]],
        barrierIds: []
      }
    ] as { geometry: MultiPolygon; barrierIds: string[] }[];
    const diagnostics = {
      attemptedLongEdges: 0,
      routeFound: 0,
      routeSupportImproved: 0,
      routeGeometryRejected: 0,
      routeTopologyRejected: 0,
      routeApplied: 0,
      longestUnroutedMeters: 0,
      sharedBoundaryNodedVertexCount: 0
    };
    const output = routeOrganicSharedBoundaries(
      partition,
      [
        barrier([a, [29.0006, 40.005], mid], "road", "south"),
        barrier([mid, [29.0006, 40.015], b], "road", "north")
      ],
      2,
      undefined,
      undefined,
      { diagnostics }
    );
    expect(diagnostics.sharedBoundaryNodedVertexCount).toBeGreaterThan(0);
    expect(diagnostics.routeApplied).toBeGreaterThan(0);
    expect(output[0]!.geometry[0]![0]).toContainEqual([29.0006, 40.005]);
  });
  it("routes connected road and water fragments", () => {
    const mid: LngLat = [29.001, 40.01];
    const route = findOrganicBarrierRoute(
      a,
      b,
      segments([barrier([a, mid]), barrier([mid, b], "water", "river")]),
      300
    );
    expect(route?.barrierIds).toEqual(["real", "river"]);
  });
  it("routes two disconnected local corridors through real junction anchors", () => {
    const j1: LngLat = [29, 40.007];
    const j2: LngLat = [29, 40.013];
    const barriers = [
      barrier([a, [29.0006, 40.003], j1], "road", "south-road"),
      barrier([j1, [28.9998, 40.0075]], "road", "south-branch"),
      barrier([j2, [29.0007, 40.017], b], "water", "north-water"),
      barrier([j2, [28.9998, 40.0135]], "road", "north-branch")
    ];
    const routed = routeOrganicSharedBoundaries(cells(), barriers, 2);
    expect(routed[0]!.geometry[0]![0]).toContainEqual([29.0006, 40.003]);
    expect(routed[0]!.geometry[0]![0]).toContainEqual([29.0007, 40.017]);
    expect(routed[0]!.barrierIds).toContain("south-road");
    expect(routed[0]!.barrierIds).toContain("north-water");
    expect(routed[1]!.geometry[0]![0]).toContainEqual([29.0007, 40.017]);
  });
  it("uses a connected interior road while keeping exposed ends synthetic", () => {
    const road = barrier(
      [
        [29.0008, 40.005],
        [29.0015, 40.01],
        [29.0008, 40.015]
      ],
      "road",
      "interior-road"
    );
    const output = routeOrganicSharedBoundaries(cells(), [road], 2, undefined, undefined, {
      minChordMeters: 500,
      maxExistingSupportRatio: 0.2
    });
    expect(output[0]!.barrierIds).toContain("interior-road");
    expect(output[0]!.geometry[0]![0]).toContainEqual([29.0015, 40.01]);
    expect(output[1]!.geometry[0]![0]).toContainEqual([29.0015, 40.01]);
    expect(
      routeOrganicSharedBoundaries(cells(), [road], 2, undefined, undefined, {
        minChordMeters: 500,
        maxExistingSupportRatio: 0.2
      })
    ).toEqual(output);
  });
  it("does not invent a connection at a bridge crossing", () => {
    const mid: LngLat = [29.001, 40.01];
    expect(
      findOrganicBarrierRoute(
        a,
        b,
        segments([
          barrier([a, mid], "road", "bridge", { bridge: "yes", layer: "1" }),
          barrier([mid, b], "rail", "rail")
        ]),
        300
      )
    ).toBeUndefined();
  });
  it("leaves coarse geometry when no suitable nearby barrier exists", () => {
    expect(
      routeOrganicSharedBoundaries(
        cells(),
        [
          barrier([
            [29.1, 40],
            [29.1, 40.02]
          ])
        ],
        2
      )
    ).toEqual(cells());
    expect(
      findOrganicBarrierRoute(
        a,
        b,
        segments([
          barrier([
            [28.99, 40.01],
            [29.01, 40.01]
          ])
        ]),
        300
      )
    ).toBeUndefined();
  });
  it("rejects routes leaving the owners or crossing their ring", () => {
    const outside = barrier([a, [29.02, 40.01], b]);
    expect(routeOrganicSharedBoundaries(cells(), [outside], 0)).toEqual(cells());
  });
  it("never uses a parent coastline as an internal separator", () => {
    expect(
      routeOrganicSharedBoundaries(cells(), [barrier([a, [29.001, 40.01], b], "coastline")], 0)
    ).toEqual(cells());
  });
  it("preserves supported seams and production area constraints", () => {
    const input = cells(),
      curve = barrier([a, [29.001, 40.01], b]);
    expect(routeOrganicSharedBoundaries(input, [curve], 2, () => 3000)).toEqual(input);
    expect(routeOrganicSharedBoundaries(input, [curve], 2, undefined, () => false)).toEqual(input);
  });
  it("selects the same route when source feature order changes", () => {
    const one = barrier([a, [29.001, 40.01], b], "road", "a");
    const two = barrier([a, [28.999, 40.01], b], "road", "b");
    expect(routeOrganicSharedBoundaries(cells(), [one, two], 2)).toEqual(
      routeOrganicSharedBoundaries(cells(), [two, one], 2)
    );
  });
  it("measures straight real roads and curved routes as actual support", () => {
    const parent = createSquareZone({
      id: "routing-parent",
      datasetId: "routing-test",
      level: 2,
      west: 28.99,
      south: 40,
      east: 29.01,
      north: 40.02
    });
    const configuration = resolveTurkeySmartFallbackConfiguration({
      parent,
      provinceCode: "34",
      districtCode: "routing",
      profile: "custom"
    }).configuration;
    const inspect = (pieces: ReturnType<typeof cells>, real: TurkeySmartFallbackBarrier[]) =>
      inspectTurkeySmartBoundaryAlignment({
        zones: pieces.map((p, i) => ({
          ...parent,
          id: `cell-${i}`,
          geometry: { type: "MultiPolygon" as const, coordinates: p.geometry as LngLat[][][] }
        })),
        parentGeometry: [
          [
            [
              [28.99, 40],
              [29.01, 40],
              [29.01, 40.02],
              [28.99, 40.02],
              [28.99, 40]
            ]
          ]
        ],
        barriers: real,
        configuration
      });
    expect(inspect(cells(), [barrier([a, b])]).realBarrierRatio).toBeGreaterThan(0.99);
    expect(inspect(cells(), [barrier([a, b])]).longUnsupportedStraightBoundaryRatio).toBe(0);
    expect(inspect(cells(), [barrier([a, b])]).availableBarrierOpportunityRatio).toBeGreaterThan(0);
    expect(inspect(cells(), [barrier([a, b])]).barrierRoutingUtilization).toBeGreaterThan(0.99);
    const unsupported = inspect(cells(), []);
    expect(unsupported.longUnsupportedStraightBoundaryRatio).toBeGreaterThan(0.9);
    expect(unsupported.longestUnsupportedStraightChainMeters).toBeGreaterThan(500);
    expect(unsupported.unsupportedStraightChainCountAbove500m).toBeGreaterThan(0);
    const curve = barrier([a, [29.001, 40.005], [29.0005, 40.012], b]);
    const after = inspect(routeOrganicSharedBoundaries(cells(), [curve], 2), [curve]);
    expect(after.realBarrierRatio).toBeGreaterThan(0.99);
    expect(after.barrierFollowingInternalBoundaryRatio).toBeGreaterThan(0.99);
  });
  it("does not bridge disconnected parent components or an official-mask hole", () => {
    const input = cells();
    input[1]!.geometry[0]!.push([
      [29.0004, 40.006],
      [29.0004, 40.014],
      [29.0015, 40.014],
      [29.0015, 40.006],
      [29.0004, 40.006]
    ]);
    const crossing = barrier([a, [29.001, 40.01], b]);
    expect(routeOrganicSharedBoundaries(input, [crossing], 2)).toEqual(input);
    const disconnected = cells();
    disconnected.push({
      geometry: [
        [
          [
            [29.005, 40.04],
            [29.01, 40.04],
            [29.01, 40.045],
            [29.005, 40.045],
            [29.005, 40.04]
          ]
        ]
      ],
      barrierIds: []
    });
    const routed = routeOrganicSharedBoundaries(
      disconnected,
      [barrier([a, [29.005, 40.04], b])],
      0
    );
    expect(routed[2]).toEqual(disconnected[2]);
    expect(
      routed
        .slice(0, 2)
        .flatMap((c) => c.geometry.flat(2))
        .every((p) => p[1] <= 40.02)
    ).toBe(true);
  });
});
describe("unsupported straight chain metric", () => {
  it("rejects a long unsupported seam even in sparse geography", () => {
    const metrics = {
      longUnsupportedStraightBoundaryRatio: 0.36,
      longestUnsupportedStraightChainMeters: 2_400,
      availableBarrierOpportunityRatio: 0.9,
      barrierRoutingUtilization: 0.65,
      barrierFollowingInternalBoundaryRatio: 0.6
    };
    expect(passesTurkeySmartGeographicRealism(metrics, 60)).toBe(false);
    expect(
      passesTurkeySmartGeographicRealism(
        { ...metrics, longUnsupportedStraightBoundaryRatio: 0.349 },
        60
      )
    ).toBe(false);
    expect(
      passesTurkeySmartGeographicRealism({ ...metrics, availableBarrierOpportunityRatio: 0.2 }, 60)
    ).toBe(false);
    expect(
      passesTurkeySmartGeographicRealism(
        { ...metrics, longestUnsupportedStraightChainMeters: 800 },
        60
      )
    ).toBe(true);
  });
  const chain = (angle: number, support = 0) =>
    Array.from({ length: 10 }, (_, i) => ({
      a: [i * 0.0003 * Math.cos(angle), i * 0.0003 * Math.sin(angle)] as LngLat,
      b: [(i + 1) * 0.0003 * Math.cos(angle), (i + 1) * 0.0003 * Math.sin(angle)] as LngLat,
      meters: 33,
      supportedMeters: support,
      parent: false
    }));
  it("detects densified horizontal and diagonal rulers", () => {
    expect(measureLongUnsupportedStraightBoundaryMeters(chain(0))).toBe(330);
    expect(measureLongUnsupportedStraightBoundaryMeters(chain(Math.PI / 4))).toBe(330);
  });
  it("excludes straight real roads and parent edges", () => {
    expect(measureLongUnsupportedStraightBoundaryMeters(chain(0, 33))).toBe(0);
    expect(
      measureLongUnsupportedStraightBoundaryMeters(chain(0).map((s) => ({ ...s, parent: true })))
    ).toBe(0);
  });
  it("breaks sparse rural chains at actual curvature", () => {
    expect(
      measureLongUnsupportedStraightBoundaryMeters(
        chain(0).slice(0, 2).concat(chain(0.3).slice(0, 2))
      )
    ).toBe(0);
  });
});
