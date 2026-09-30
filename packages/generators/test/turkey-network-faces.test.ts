import { describe, expect, it } from "vitest";
import type { TerritoryGeometry } from "@territory-kit/dataset";
import type { TurkeySmartFallbackBarrier } from "../src/turkey-smart-fallback.js";
import { polygonizeTurkeyBarrierNetwork } from "../src/turkey-network-faces.js";
import { polygonizeTurkeyBarrierNetworkBounded } from "../src/turkey-network-bounded.js";
import {
  buildTurkeySmartFallback,
  passesTurkeySmartGeographicRealism
} from "../src/turkey-smart-fallback.js";
import { createSquareZone } from "@territory-kit/shared-testkit";

const parent: TerritoryGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [29, 40],
      [29.02, 40],
      [29.02, 40.02],
      [29, 40.02],
      [29, 40]
    ]
  ]
};
function road(
  id: string,
  coordinates: [number, number][],
  tags: Record<string, string> = {}
): TurkeySmartFallbackBarrier {
  return {
    id,
    sourceLayer: "roads",
    barrierClass: "road",
    strengthClass: "strong",
    strength: 0.9,
    coordinates,
    lengthKm: 1,
    tags: { highway: "primary", ...tags }
  };
}

describe("network face polygonization", () => {
  it("splits components at at-grade crossings without source vertices", () => {
    const result = polygonizeTurkeyBarrierNetworkBounded(
      [
        road("horizontal", [
          [29, 40.01],
          [29.02, 40.01]
        ]),
        road("vertical", [
          [29.01, 40],
          [29.01, 40.02]
        ])
      ],
      0.001,
      parent
    );
    expect(result.componentCount).toBe(1);
    expect(result.faces).toHaveLength(4);
  });

  it("processes a connected graph beyond the old monolithic guard without tile edges", () => {
    const barriers: TurkeySmartFallbackBarrier[] = [];
    const columns = 81;
    const rows = 53;
    for (let row = 0; row < rows; row++)
      barriers.push(
        road(
          `horizontal-${row}`,
          Array.from(
            { length: columns },
            (_, column) => [29 + column * 0.0002, 40 + row * 0.0002] as [number, number]
          )
        )
      );
    for (let column = 0; column < columns; column++)
      barriers.push(
        road(
          `vertical-${column}`,
          Array.from(
            { length: rows },
            (_, row) => [29 + column * 0.0002, 40 + row * 0.0002] as [number, number]
          )
        )
      );
    const result = polygonizeTurkeyBarrierNetworkBounded(barriers, 0.00001);
    expect(result.largestComponentSegments).toBeGreaterThan(8_000);
    expect(result.chunkCount).toBeGreaterThan(1);
    expect(result.largestChunkSegments).toBeLessThanOrEqual(8_000);
    expect(result.faces.length).toBeGreaterThan(1_000);
    expect(result.chunkOnlyBoundaryCount).toBe(0);
    expect(result.failureReason).toBeUndefined();
  });

  it("nodes at-grade crossings and extracts four real bounded faces", () => {
    const statistics: { rawFaceCount: number; graphComponentCount?: number } = { rawFaceCount: 0 };
    const faces = polygonizeTurkeyBarrierNetwork(
      parent,
      [
        road("horizontal", [
          [29, 40.01],
          [29.02, 40.01]
        ]),
        road("vertical", [
          [29.01, 40],
          [29.01, 40.02]
        ])
      ],
      0.001,
      statistics
    );
    expect(faces).toHaveLength(4);
    expect(statistics.rawFaceCount).toBe(4);
    expect(statistics.graphComponentCount).toBe(1);
    expect(faces.every((face) => face.realBoundaryLengthMeters > 0)).toBe(true);
    expect(faces.reduce((sum, face) => sum + face.areaKm2, 0)).toBeCloseTo(3.785, 1);
  });

  it("does not join a grade-separated crossing", () => {
    const faces = polygonizeTurkeyBarrierNetwork(parent, [
      road("horizontal", [
        [29, 40.01],
        [29.02, 40.01]
      ]),
      road(
        "bridge",
        [
          [29.01, 40],
          [29.01, 40.02]
        ],
        { bridge: "yes", layer: "1" }
      )
    ]);
    expect(faces).toHaveLength(2);
  });

  it("does not close a dead end with invented geometry", () => {
    const faces = polygonizeTurkeyBarrierNetwork(parent, [
      road("dead-end", [
        [29.005, 40.005],
        [29.015, 40.015]
      ])
    ]);
    expect(faces).toHaveLength(0);
  });

  it("does not count a parent-attached dead end as an ADM2-sized Network face", () => {
    const faces = polygonizeTurkeyBarrierNetwork(parent, [
      road("parent-spur", [
        [29, 40.01],
        [29.01, 40.01]
      ])
    ]);
    expect(faces).toHaveLength(0);
  });

  it("ignores service roads", () => {
    const faces = polygonizeTurkeyBarrierNetwork(parent, [
      road(
        "service",
        [
          [29, 40.01],
          [29.02, 40.01]
        ],
        { highway: "service" }
      )
    ]);
    expect(faces).toHaveLength(0);
  });
});

describe("network-first candidate", () => {
  it("rejects an isolated multi-kilometre ruler seam even when aggregate following is high", () => {
    const metrics = {
      longUnsupportedStraightBoundaryRatio: 0.12,
      longestUnsupportedStraightChainMeters: 7_000,
      availableBarrierOpportunityRatio: 0.3,
      barrierRoutingUtilization: 0.9,
      barrierFollowingInternalBoundaryRatio: 0.88
    };
    expect(passesTurkeySmartGeographicRealism(metrics, 479)).toBe(false);
    expect(
      passesTurkeySmartGeographicRealism(
        { ...metrics, longestUnsupportedStraightChainMeters: 1_600 },
        45
      )
    ).toBe(true);
  });

  it("merges real micro-faces into playable zones before measuring quality", () => {
    const zone = createSquareZone({
      id: "network-parent",
      datasetId: "network-test",
      level: 2,
      west: 29,
      south: 40,
      east: 29.02,
      north: 40.02
    });
    const result = buildTurkeySmartFallback({
      parent: zone,
      provinceCode: "34",
      districtCode: "1",
      profile: "custom",
      roads: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { highway: "residential" },
            geometry: {
              type: "LineString",
              coordinates: [
                [29, 40.01],
                [29.02, 40.01]
              ]
            }
          },
          {
            type: "Feature",
            properties: { highway: "residential" },
            geometry: {
              type: "LineString",
              coordinates: [
                [29.01, 40],
                [29.01, 40.02]
              ]
            }
          }
        ]
      },
      localitySeeds: [
        { name: "West", coordinate: [29.005, 40.005] },
        { name: "East", coordinate: [29.015, 40.015] }
      ],
      options: {
        networkFirst: true,
        targetAreaKm2: 2,
        minAreaKm2: 0.01,
        maxAreaKm2: 4,
        minFragmentAreaKm2: 0.001,
        targetTerritoryCount: 2
      }
    });
    expect(result.zones.length).toBeLessThan(4);
    expect(result.zones.length).toBeGreaterThan(0);
    expect(result.quality.coveragePercent).toBeGreaterThan(99.99);
    expect(result.quality.overlapAreaKm2).toBe(0);
    expect(result.quality.networkBoundaryUsageRatio).toBeGreaterThan(0.9);
    expect(result.quality.networkConstruction?.constructionStatus).toBe("constructed");
    expect(result.quality.networkConstruction?.filteredFaceCount).toBe(4);
  });

  it("attaches a tiny residual strip to its adjacent graph zone", () => {
    const zone = createSquareZone({
      id: "network-strip",
      datasetId: "network-test",
      level: 2,
      west: 29,
      south: 40,
      east: 29.02,
      north: 40.02
    });
    const result = buildTurkeySmartFallback({
      parent: zone,
      provinceCode: "34",
      districtCode: "2",
      profile: "custom",
      roads: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { highway: "primary" },
            geometry: {
              type: "LineString",
              coordinates: [
                [29.00001, 40],
                [29.00001, 40.02]
              ]
            }
          },
          {
            type: "Feature",
            properties: { highway: "primary" },
            geometry: {
              type: "LineString",
              coordinates: [
                [29.01, 40],
                [29.01, 40.02]
              ]
            }
          }
        ]
      },
      options: {
        networkFirst: true,
        targetAreaKm2: 2,
        minAreaKm2: 0.01,
        maxAreaKm2: 4,
        minFragmentAreaKm2: 0.05,
        targetTerritoryCount: 2
      }
    });
    expect(result.quality.networkFaceCountAfterFiltering).toBe(2);
    expect(result.quality.residualOrganicTerritoryCount).toBe(0);
    expect(result.quality.coveragePercent).toBeGreaterThan(99.99);
  });
});
