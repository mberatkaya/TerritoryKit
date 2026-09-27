import { describe, expect, it } from "vitest";
import { createSquareZone } from "@territory-kit/shared-testkit";
import { computeGeometryBBox } from "@territory-kit/dataset";
import type { TerritoryGeometry } from "@territory-kit/dataset";
import {
  buildTurkeyOrganicSmartFallbackWithAdjacency,
  buildTurkeySmartFallback,
  buildTurkeyV2HybridDistrict
} from "../src/turkey-adm3.js";

const parent = createSquareZone({
  id: "organic-parent",
  datasetId: "organic-test",
  level: 2,
  west: 29,
  south: 40,
  east: 29.04,
  north: 40.04
});
const seeds = [
  { name: "A", coordinate: [29.007, 40.008] as [number, number] },
  { name: "B", coordinate: [29.029, 40.012] as [number, number] },
  { name: "C", coordinate: [29.015, 40.032] as [number, number] },
  { name: "D", coordinate: [29.034, 40.028] as [number, number] }
];
const input = {
  parent,
  provinceCode: "34",
  districtCode: "organic",
  profile: "custom" as const,
  localitySeeds: seeds,
  options: {
    targetAreaKm2: 4,
    minAreaKm2: 0.01,
    maxAreaKm2: 10,
    minFragmentAreaKm2: 0.001,
    targetTerritoryCount: 4
  }
};

describe("organic smart production fallback", () => {
  it("rejects mathematically insufficient standard capacity before splitting", () => {
    const result = buildTurkeySmartFallback({
      ...input,
      options: { ...input.options, maxTerritories: 2, targetTerritoryCount: 2, maxAreaKm2: 1 }
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCodes).toContain("SMART_FALLBACK_CAPACITY_INSUFFICIENT");
    expect(result.quality.splitCount).toBe(0);
    expect(result.zones).toHaveLength(0);
  });
  it("rejects unsupported axis alignment even when geographic refinement resolves an oversized disconnected gap", async () => {
    const geometry: TerritoryGeometry = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [29, 40],
            [29.04, 40],
            [29.04, 40.04],
            [29, 40.04],
            [29, 40]
          ]
        ],
        [
          [
            [29.06, 40],
            [29.062, 40],
            [29.062, 40.002],
            [29.06, 40.002],
            [29.06, 40]
          ]
        ]
      ]
    };
    const result = await buildTurkeyOrganicSmartFallbackWithAdjacency({
      ...input,
      parent: { ...parent, geometry, bbox: computeGeometryBBox(geometry) },
      localitySeeds: [
        { name: "Real A", coordinate: [29.0605, 40.0005] },
        { name: "Real B", coordinate: [29.0615, 40.0015] }
      ],
      roads: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { highway: "secondary", id: "real-crossing-road" },
            geometry: {
              type: "LineString",
              coordinates: [
                [28.99, 39.99],
                [29.05, 40.05]
              ]
            }
          },
          {
            type: "Feature",
            properties: { highway: "secondary", id: "second-real-road" },
            geometry: {
              type: "LineString",
              coordinates: [
                [28.99, 40.04],
                [29.045, 39.997]
              ]
            }
          }
        ]
      },
      options: { ...input.options, targetAreaKm2: 0.5, maxAreaKm2: 1, minAreaKm2: 0.001 }
    });
    expect(result.status).toBe("rejected");
    expect(result.quality.territoryCount).toBeGreaterThan(2);
    expect(result.quality.gates.maximumArea).toBe(true);
    expect(result.quality.gates.gridLikeness).toBe(false);
    expect(result.reasonCodes).toContain("ORGANIC_GEOGRAPHIC_REFINEMENT_USED");
    expect(result.quality.outsideSpillKm2).toBe(0);
    expect(result.quality.overlapAreaKm2).toBe(0);
    expect(result.quality.syntheticSplitCount).toBe(0);
  });
  it("partitions real locality points deterministically with hard geometry gates", async () => {
    const a = await buildTurkeyOrganicSmartFallbackWithAdjacency(input);
    const b = await buildTurkeyOrganicSmartFallbackWithAdjacency(input);
    expect(a.quality.ok).toBe(true);
    expect(a.configuration.organicGeographicRefinement).toBeUndefined();
    expect(a.deterministicHash).toBe(b.deterministicHash);
    expect(a.quality.coveragePercent).toBeGreaterThanOrEqual(99.99);
    expect(a.quality.outsideSpillKm2).toBe(0);
    expect(a.quality.overlapAreaKm2).toBe(0);
    expect(a.quality.axisAlignedInternalBoundaryRatio).toBeLessThanOrEqual(0.15);
    expect(a.zones.length).toBeGreaterThan(1);
    expect(
      a.zones.every((z) => {
        const t = z.properties.territory as Record<string, unknown>;
        return (
          t.boundarySourceClass === "smart-derived" &&
          t.confidence === "low" &&
          t.gameplayOnly === true &&
          t.administrative === false &&
          t.authoritative === false
        );
      })
    ).toBe(true);
  });
  it("selects organic after standard rejects and never invokes production legacy", async () => {
    expect(buildTurkeySmartFallback(input).quality.ok).toBe(false);
    const result = await buildTurkeyV2HybridDistrict({
      district: parent,
      provinceCode: "34",
      districtCode: "organic",
      buildDate: "2026-09-27T00:00:00.000Z",
      generated: {
        enabled: true,
        strategy: "smart",
        legacyGridAllowed: false,
        smartFallback: { localitySeeds: seeds, options: input.options }
      }
    });
    expect(result.quality.smartAttempt?.selectedFallback).toBe("organic-smart");
    expect(result.generatedResult).toBeUndefined();
    expect(result.issues.some((i) => i.code === "SMART_STANDARD_QUALITY_REJECTED")).toBe(true);
  });
  it("returns explicit insufficient input instead of a silent grid", async () => {
    const result = await buildTurkeyV2HybridDistrict({
      district: parent,
      provinceCode: "34",
      districtCode: "empty",
      buildDate: "2026-09-27T00:00:00.000Z",
      generated: { enabled: true, strategy: "smart", legacyGridAllowed: false }
    });
    expect(result.generatedResult).toBeUndefined();
    expect(result.effective.generated).toHaveLength(0);
    expect(result.smartFallbackResult?.reasonCodes).toContain(
      "ORGANIC_FALLBACK_INPUT_INSUFFICIENT"
    );
  });
  it("rejects unsupported synthetic lat/lon cuts", () => {
    const result = buildTurkeySmartFallback({
      ...input,
      localitySeeds: [],
      options: {
        ...input.options,
        maxAreaKm2: 4,
        targetAreaKm2: 2,
        maxSyntheticSplits: 100,
        requireBarrierForMultiTerritory: false,
        minMeanBarrierAlignment: 0,
        minMeanQualityScore: 0
      }
    });
    expect(result.quality.axisAlignedInternalBoundaryRatio).toBeGreaterThan(0.15);
    expect(result.quality.gates.gridLikeness).toBe(false);
  });
});
