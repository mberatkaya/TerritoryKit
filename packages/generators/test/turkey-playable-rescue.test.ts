import { describe, expect, it } from "vitest";
import { createSquareZone } from "@territory-kit/shared-testkit";
import {
  isTopologySafePlayableRescue,
  rankPlayableRescueCandidate,
  runTurkeyAdaptivePlayableRescue
} from "../src/turkey-playable-rescue.js";
import type { TurkeySmartFallbackBuildResult } from "../src/turkey-smart-fallback.js";
import { derivePlayableRescueContext } from "../src/turkey-playable-rescue.js";

function fakeResult(input: {
  ok?: boolean;
  territoryCount?: number;
  parentAreaKm2?: number;
  largestTerritoryAreaShare?: number;
  longestUnsupportedStraightChainMeters?: number;
  barrierFollowingInternalBoundaryRatio?: number;
}): TurkeySmartFallbackBuildResult {
  const territoryCount = input.territoryCount ?? 4;
  return {
    zones: Array.from({ length: territoryCount }, (_, index) => ({
      id: `zone-${index}`,
      datasetId: "test",
      countryCode: "TR",
      level: 3,
      sourceAdminLevel: "ADM3",
      semanticType: "generated-zone",
      name: `Zone ${index}`,
      parentId: "parent",
      neighborIds: [],
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0.001, 0],
            [0.001, 0.001],
            [0, 0.001],
            [0, 0]
          ]
        ]
      },
      bbox: [0, 0, 0.001, 0.001],
      center: [0.0005, 0.0005],
      properties: { territory: {} }
    })),
    selectedProfile: "custom",
    configuration: {} as TurkeySmartFallbackBuildResult["configuration"],
    barriers: [],
    manifest: {} as TurkeySmartFallbackBuildResult["manifest"],
    quality: {
      ok: input.ok ?? true,
      territoryCount,
      parentAreaKm2: input.parentAreaKm2 ?? 120,
      largestTerritoryAreaShare: input.largestTerritoryAreaShare ?? 0.2,
      longestUnsupportedStraightChainMeters: input.longestUnsupportedStraightChainMeters ?? 0,
      barrierFollowingInternalBoundaryRatio: input.barrierFollowingInternalBoundaryRatio ?? 0.7,
      meanSyntheticBoundaryRatio: 0.05,
      meanQualityScore: 0.6,
      invalidGeometryCount: 0,
      geometryValidationErrors: [],
      gates: {
        geometryValid: true,
        overlap: true,
        outsideSpill: true,
        parentCoverage: true,
        gridLikeness: true,
        syntheticSplitLimit: true,
        geographicRealism: true,
        partitionAdequacy: true,
        minimumArea: true,
        maximumArea: true,
        inputSufficiency: true,
        meanQuality: true,
        coverage: true,
        invalidGeometry: true,
        spill: true,
        barrierSufficiency: true,
        qualityScore: true,
        barrierAlignment: true,
        syntheticLimit: true
      }
    } as unknown as TurkeySmartFallbackBuildResult["quality"],
    issues: [],
    reasonCodes: [],
    status: input.ok === false ? "rejected" : "success",
    deterministicHash: "00"
  };
}

describe("playable rescue ranking", () => {
  it("prefers balanced rural partitions over oversized network-first cells", () => {
    const parent = createSquareZone({
      id: "parent",
      datasetId: "test",
      level: 2,
      west: 28,
      south: 41,
      east: 28.8,
      north: 41.6
    });
    const context = derivePlayableRescueContext({
      parent,
      provinceCode: "34",
      districtCode: "rural",
      profile: "rural",
      water: {
        type: "FeatureCollection",
        features: Array.from({ length: 10 }, (_, index) => ({
          type: "Feature" as const,
          properties: { natural: "water", "@id": `water-${index}` },
          geometry: {
            type: "Polygon" as const,
            coordinates: [
              [
                [28 + index * 0.01, 41],
                [28.005 + index * 0.01, 41],
                [28.005 + index * 0.01, 41.005],
                [28 + index * 0.01, 41.005],
                [28 + index * 0.01, 41]
              ]
            ]
          }
        }))
      }
    });
    const network = fakeResult({
      ok: true,
      parentAreaKm2: 420,
      largestTerritoryAreaShare: 0.38,
      longestUnsupportedStraightChainMeters: 7_500
    });
    const organic = fakeResult({
      ok: true,
      parentAreaKm2: 420,
      largestTerritoryAreaShare: 0.16,
      longestUnsupportedStraightChainMeters: 9_500
    });
    expect(rankPlayableRescueCandidate(organic, context)).toBeGreaterThan(
      rankPlayableRescueCandidate(network, context)
    );
  });
});

describe("adaptive playable rescue integration", () => {
  it("runs deterministic rescue on a sparse road + seed fixture", async () => {
    const parent = createSquareZone({
      id: "rescue-parent",
      datasetId: "rescue-test",
      level: 2,
      west: 29,
      south: 40,
      east: 29.08,
      north: 40.08
    });
    const input = {
      parent,
      provinceCode: "34",
      districtCode: "rescue",
      profile: "custom" as const,
      localitySeeds: [
        { name: "A", coordinate: [29.01, 40.01] as [number, number] },
        { name: "B", coordinate: [29.06, 40.05] as [number, number] }
      ],
      roads: {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            properties: { highway: "primary" },
            geometry: {
              type: "LineString" as const,
              coordinates: [
                [29, 40.04],
                [29.08, 40.04]
              ]
            }
          }
        ]
      },
      options: {
        targetAreaKm2: 2,
        minAreaKm2: 0.01,
        maxAreaKm2: 8,
        minFragmentAreaKm2: 0.001,
        targetTerritoryCount: 2,
        seed: "playable-rescue-test"
      }
    };
    const first = await runTurkeyAdaptivePlayableRescue({
      smartInput: input,
      parentId: parent.id
    });
    const second = await runTurkeyAdaptivePlayableRescue({
      smartInput: input,
      parentId: parent.id
    });
    expect(first.result).toBeDefined();
    expect(second.result?.deterministicHash).toBe(first.result?.deterministicHash);
    expect(first.report.selectedMode).toBeTruthy();
    if (first.result) {
      expect(isTopologySafePlayableRescue(first.result.quality)).toBe(true);
    }
  });
});
