import type { TerritoryZone } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  classifyTurkeyRuralGeneratorQuality,
  inspectTurkeyIslandMultipolygonSafety,
  summarizeTurkeyNetworkRouteRootCause
} from "../src/turkey-istanbul-geometry-diagnostics.js";

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

  it("flags artificial cross-island connectors but allows valid multipolygons", () => {
    const validIslands: TerritoryZone = {
      id: "island-valid",
      datasetId: "fixture",
      level: 3,
      parentId: "tr:adm2:adalar",
      name: "valid",
      neighborIds: [],
      geometry: {
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
      },
      bbox: [29.1, 40.85, 29.21, 40.86],
      center: [29.155, 40.855],
      properties: { territory: { sourceClass: "generated", administrative: false } }
    };
    const invalidConnector: TerritoryZone = {
      ...validIslands,
      id: "island-invalid",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [29.1, 40.85],
              [29.105, 40.85],
              [29.105, 40.85001],
              [29.1, 40.85001],
              [29.1, 40.85]
            ]
          ],
          [
            [
              [29.19, 40.85],
              [29.195, 40.85],
              [29.195, 40.85001],
              [29.19, 40.85001],
              [29.19, 40.85]
            ]
          ]
        ]
      }
    };
    expect(inspectTurkeyIslandMultipolygonSafety([validIslands]).ok).toBe(true);
    expect(inspectTurkeyIslandMultipolygonSafety([invalidConnector]).ok).toBe(false);
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
