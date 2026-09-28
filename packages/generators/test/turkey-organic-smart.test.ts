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
  it("keeps small disconnected geographic components whole without invented shared seams", async () => {
    const geometry: TerritoryGeometry = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [29, 40],
            [29.01, 40],
            [29.01, 40.01],
            [29, 40.01],
            [29, 40]
          ]
        ],
        [
          [
            [29.02, 40],
            [29.03, 40],
            [29.03, 40.01],
            [29.02, 40.01],
            [29.02, 40]
          ]
        ]
      ]
    };
    const result = await buildTurkeyOrganicSmartFallbackWithAdjacency({
      ...input,
      parent: { ...parent, geometry, bbox: computeGeometryBBox(geometry) },
      localitySeeds: [
        { name: "A", coordinate: [29.003, 40.003] },
        { name: "B", coordinate: [29.027, 40.007] }
      ],
      roads: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { highway: "primary" },
            geometry: {
              type: "LineString",
              coordinates: [
                [29, 40.005],
                [29.03, 40.005]
              ]
            }
          }
        ]
      },
      options: { targetAreaKm2: 0.2, minAreaKm2: 0.01, maxAreaKm2: 1.1, minFragmentAreaKm2: 0.001 }
    });
    expect(result.quality.ok).toBe(true);
    expect(result.zones).toHaveLength(2);
    expect(result.quality.longUnsupportedStraightBoundaryRatio).toBe(0);
    expect(result.quality.overlapAreaKm2).toBe(0);
    expect(result.quality.spillAreaKm2).toBe(0);
    for (const zone of result.zones) {
      expect(zone.geometry.type).toBe("Polygon");
      if (zone.geometry.type === "Polygon") expect(zone.geometry.coordinates[0]).toHaveLength(5);
    }
  });
  it("keeps a small single missing region whole and explicitly estimated", async () => {
    const result = await buildTurkeyOrganicSmartFallbackWithAdjacency({
      ...input,
      parent: createSquareZone({
        id: "small-gap",
        datasetId: "organic-test",
        level: 2,
        west: 29,
        south: 40,
        east: 29.01,
        north: 40.01
      }),
      localitySeeds: [],
      options: { targetAreaKm2: 2, minAreaKm2: 0.01, maxAreaKm2: 2.1, minFragmentAreaKm2: 0.001 }
    });
    expect(result.quality.ok).toBe(true);
    expect(result.zones).toHaveLength(1);
    expect(result.quality.longUnsupportedStraightBoundaryRatio).toBe(0);
    expect(result.zones[0]!.properties.territory).toMatchObject({
      administrative: false,
      authoritative: false,
      boundaryKind: "estimated",
      confidence: "low",
      gameplayOnly: true
    });
  });
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
  it("rejects unsupported axis alignment in a disconnected parent despite valid area and topology", async () => {
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
    expect(result.reasonCodes).toContain("SMART_FALLBACK_GRID_LIKENESS_REJECTED");
    expect(result.quality.outsideSpillKm2).toBe(0);
    expect(result.quality.overlapAreaKm2).toBe(0);
    expect(result.quality.syntheticSplitCount).toBe(0);
  });
  it("rejects unsupported locality-only rulers while retaining deterministic valid coverage", async () => {
    const a = await buildTurkeyOrganicSmartFallbackWithAdjacency(input);
    const b = await buildTurkeyOrganicSmartFallbackWithAdjacency(input);
    expect(a.quality.ok).toBe(false);
    expect(a.reasonCodes).toContain("SMART_FALLBACK_GEOGRAPHIC_REALISM_REJECTED");
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
  it("rejects unsupported organic after standard rejects and never invokes production legacy", async () => {
    const standard = buildTurkeySmartFallback(input);
    expect(standard.quality.ok).toBe(false);
    expect(standard.quality.gates.geographicRealism).toBe(false);
    expect(standard.reasonCodes).toContain("SMART_FALLBACK_GEOGRAPHIC_REALISM_REJECTED");
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
    expect(result.quality.smartAttempt?.selectedFallback).toBe("none");
    expect(result.smartFallbackResult?.reasonCodes).toContain(
      "SMART_FALLBACK_GEOGRAPHIC_REALISM_REJECTED"
    );
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
