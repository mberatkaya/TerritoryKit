import { describe, expect, it } from "vitest";
import {
  AXIS_ALIGNED_BOUNDARY_THRESHOLD,
  buildAdm2QaGeoJson,
  evaluateDistrictQaFlags,
  OVERSIZED_CELL_SHARE_THRESHOLD,
  summarizeAdm2QaGeoJson
} from "../src/qa-mode.js";

describe("qa-mode district flags", () => {
  it("maps geographic realism gate failures separately from axis-aligned warnings", () => {
    const flags = evaluateDistrictQaFlags({
      adm2Id: "tr:adm2:example",
      confidence: "medium",
      smartQualityGates: { geographicRealism: false },
      axisAlignedInternalBoundaryRatio: 0.02,
      largestTerritoryAreaShare: null
    });

    expect(flags.qaGeographicRealismFailure).toBe(true);
    expect(flags.qaAxisAlignedWarning).toBe(false);
    expect(flags.qaOversizedMetricMissing).toBe(true);
  });

  it("never treats missing metrics as pass conditions", () => {
    const flags = evaluateDistrictQaFlags({
      adm2Id: "tr:adm2:example",
      confidence: "high",
      axisAlignedInternalBoundaryRatio: 0.5
    });

    expect(flags.qaGeographicMetricMissing).toBe(true);
    expect(flags.qaGeographicRealismFailure).toBe(false);
    expect(flags.qaAxisAlignedWarning).toBe(true);
    expect(flags.qaAxisAlignedWarning).toBe(0.5 > AXIS_ALIGNED_BOUNDARY_THRESHOLD);
    expect(flags.qaOversizedMetricMissing).toBe(true);
  });

  it("builds geojson flags that align with smart-coverage totals", () => {
    const index = {
      districts: [
        {
          adm2Id: "a",
          confidence: "low",
          smartQualityGates: { geographicRealism: false },
          axisAlignedInternalBoundaryRatio: 0.02
        },
        {
          adm2Id: "b",
          confidence: "high",
          smartQualityGates: { geographicRealism: true },
          axisAlignedInternalBoundaryRatio: 0.2
        }
      ]
    };
    const geojson = buildAdm2QaGeoJson(
      {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { territoryId: "a" }, geometry: null },
          { type: "Feature", properties: { territoryId: "b" }, geometry: null }
        ]
      },
      index
    );
    const summary = summarizeAdm2QaGeoJson(geojson);

    expect(summary.qaLowConfidence).toBe(1);
    expect(summary.qaGeographicRealismFailure).toBe(1);
    expect(summary.qaAxisAlignedWarning).toBe(1);
    expect(summary.qaOversizedMetricMissing).toBe(2);
    expect(OVERSIZED_CELL_SHARE_THRESHOLD).toBe(0.35);
  });
});
