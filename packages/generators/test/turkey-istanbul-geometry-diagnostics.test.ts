import type { TerritoryZone } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import type { TurkeySmartFallbackBarrier } from "../src/turkey-smart-fallback.js";
import {
  classifyTurkeyRuralGeneratorQuality,
  inspectTurkeyGeneratedCoastlineSpill,
  inspectTurkeyIslandMultipolygonSafety,
  summarizeTurkeyNetworkRouteRootCause
} from "../src/turkey-istanbul-geometry-diagnostics.js";

function generatedZone(id: string, geometry: TerritoryZone["geometry"]): TerritoryZone {
  return {
    id,
    datasetId: "fixture",
    level: 3,
    parentId: "tr:adm2:adalar",
    name: id,
    neighborIds: [],
    geometry,
    bbox: [29.1, 40.85, 29.21, 40.86],
    center: [29.155, 40.855],
    properties: { territory: { sourceClass: "generated", administrative: false } }
  };
}

function waterBarrier(coordinates: [number, number][]): TurkeySmartFallbackBarrier {
  return {
    id: "water-1",
    sourceLayer: "water",
    barrierClass: "water",
    strengthClass: "strong",
    strength: 1,
    coordinates,
    lengthKm: 1,
    tags: { natural: "water" }
  };
}

describe("Istanbul pilot geometry diagnostics", () => {
  it("classifies Çatalca-like rural low-confidence signals", () => {
    const report = classifyTurkeyRuralGeneratorQuality({
      longestUnsupportedChainMeters: 7802,
      localitySeedCount: 248,
      roadDensityKmPerKm2: 2.4,
      networkCoveragePercent: 18
    });
    expect(report.confidenceTier).toBe("low");
    expect(report.reasonCodes).toContain("LONG_UNSUPPORTED_CHAIN");
    expect(report.reasonCodes).toContain("LOW_NETWORK_FACE_COVERAGE");
  });

  it("measures real water overlap and ignores coastline lines and missing water", () => {
    const land = generatedZone("land-over-water", {
      type: "Polygon",
      coordinates: [
        [
          [29.0, 41.0],
          [29.01, 41.0],
          [29.01, 41.01],
          [29.0, 41.01],
          [29.0, 41.0]
        ]
      ]
    });
    const water = waterBarrier([
      [28.995, 40.995],
      [29.015, 40.995],
      [29.015, 41.015],
      [28.995, 41.015],
      [28.995, 40.995]
    ]);
    const overlap = inspectTurkeyGeneratedCoastlineSpill({
      zones: [land],
      waterBarriers: [water]
    });
    expect(overlap.assessmentStatus).toBe("VERIFIED_FINDING");
    expect(overlap.ok).toBe(false);
    expect(overlap.spillFindings[0]?.waterOverlapAreaKm2).toBeGreaterThan(0);

    const disjoint = inspectTurkeyGeneratedCoastlineSpill({
      zones: [land],
      waterBarriers: [
        waterBarrier([
          [30.0, 41.0],
          [30.01, 41.0],
          [30.01, 41.01],
          [30.0, 41.01],
          [30.0, 41.0]
        ])
      ]
    });
    expect(disjoint.assessmentStatus).toBe("ASSESSED_CLEAR");
    expect(disjoint.spillFindings).toHaveLength(0);

    const coastlineOnly = inspectTurkeyGeneratedCoastlineSpill({
      zones: [land],
      waterBarriers: [
        {
          ...water,
          id: "coast-1",
          barrierClass: "coastline",
          coordinates: [
            [29.0, 41.0],
            [29.02, 41.0]
          ]
        }
      ]
    });
    expect(coastlineOnly.assessmentStatus).toBe("NOT_ASSESSED");
    expect(coastlineOnly.ok).toBe(false);
    expect(coastlineOnly.unclosedCoastlineBarrierCount).toBe(1);

    const missingWater = inspectTurkeyGeneratedCoastlineSpill({ zones: [land], waterBarriers: [] });
    expect(missingWater.assessmentStatus).toBe("NOT_ASSESSED");
    expect(missingWater.ok).toBe(false);
  });

  it("preserves distant island multipolygons and flags bbox-narrow necks as suspected", () => {
    const validIslands = generatedZone("island-valid", {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [29.1, 40.85],
            [29.11, 40.85],
            [29.11, 40.86],
            [29.1, 40.86],
            [29.1, 40.85]
          ]
        ],
        [
          [
            [29.2, 40.85],
            [29.21, 40.85],
            [29.21, 40.86],
            [29.2, 40.86],
            [29.2, 40.85]
          ]
        ]
      ]
    });
    const narrowNeck = generatedZone("narrow-neck", {
      type: "Polygon",
      coordinates: [
        [
          [29.1, 40.85],
          [29.102, 40.85],
          [29.102, 40.85001],
          [29.1, 40.85001],
          [29.1, 40.85]
        ]
      ]
    });
    expect(inspectTurkeyIslandMultipolygonSafety([validIslands]).assessmentStatus).toBe(
      "ASSESSED_CLEAR"
    );
    const narrowReport = inspectTurkeyIslandMultipolygonSafety([narrowNeck]);
    expect(narrowReport.assessmentStatus).toBe("SUSPECTED");
    expect(narrowReport.ok).toBe(false);
    expect(
      narrowReport.findings.some((finding) => finding.code === "NARROW_NECK_BBOX_APPROX")
    ).toBe(true);
    expect(narrowReport.artificialConnectorFindings).toHaveLength(0);
  });

  it("handles polygon holes without treating coastline barriers as water bodies", () => {
    const zoneWithHole = generatedZone("zone-hole", {
      type: "Polygon",
      coordinates: [
        [
          [29.0, 41.0],
          [29.02, 41.0],
          [29.02, 41.02],
          [29.0, 41.02],
          [29.0, 41.0]
        ],
        [
          [29.005, 41.005],
          [29.015, 41.005],
          [29.015, 41.015],
          [29.005, 41.015],
          [29.005, 41.005]
        ]
      ]
    });
    const waterInHole = waterBarrier([
      [29.006, 41.006],
      [29.014, 41.006],
      [29.014, 41.014],
      [29.006, 41.014],
      [29.006, 41.006]
    ]);
    const report = inspectTurkeyGeneratedCoastlineSpill({
      zones: [zoneWithHole],
      waterBarriers: [waterInHole]
    });
    expect(report.assessmentStatus).toBe("ASSESSED_CLEAR");
    expect(report.spillFindings).toHaveLength(0);
  });

  it("summarizes Eyüpsultan NO_ROUTE root cause from network diagnostics", () => {
    const report = summarizeTurkeyNetworkRouteRootCause({
      longestUnsupportedStraightChainMeters: 3611,
      networkConstruction: {
        constructionStatus: "constructed",
        graphComponentCount: 368,
        networkCoveragePercent: 23.8,
        residualAreaPercent: 76.2,
        finalRouting: {
          attemptedLongEdges: 7,
          routeFound: 2,
          routeSupportImproved: 1,
          routeGeometryRejected: 0,
          routeTopologyRejected: 0,
          routeApplied: 1,
          longestUnroutedMeters: 5974,
          longestUnroutedReason: "NO_ROUTE"
        }
      } as never
    });
    expect(report.routeFailureReason).toBe("NO_ROUTE");
    expect(report.reasonCodes).toContain("ORGANIC_ROUTE_NO_PATH");
    expect(report.reasonCodes).toContain("NETWORK_GRAPH_FRAGMENTED");
    expect(report.summaryTr).toMatch(/NO_ROUTE|bariyer/i);
  });
});
