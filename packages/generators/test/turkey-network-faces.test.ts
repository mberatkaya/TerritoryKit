import { describe, expect, it } from "vitest";
import type { TerritoryGeometry } from "@territory-kit/dataset";
import type { TurkeySmartFallbackBarrier } from "../src/turkey-smart-fallback.js";
import { polygonizeTurkeyBarrierNetwork } from "../src/turkey-network-faces.js";
import { buildTurkeySmartFallback } from "../src/turkey-smart-fallback.js";
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
  it("nodes at-grade crossings and extracts four real bounded faces", () => {
    const faces = polygonizeTurkeyBarrierNetwork(parent, [
      road("horizontal", [
        [29, 40.01],
        [29.02, 40.01]
      ]),
      road("vertical", [
        [29.01, 40],
        [29.01, 40.02]
      ])
    ]);
    expect(faces).toHaveLength(4);
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
