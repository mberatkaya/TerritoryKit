import type { TerritoryZone } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  inspectTurkeyGeneratedZonePathology,
  isTurkeyGeneratedGameplayZone
} from "../src/turkey-generated-zone-pathology.js";

function zone(
  id: string,
  geometry: TerritoryZone["geometry"],
  territory: Record<string, unknown> = {}
): TerritoryZone {
  return {
    id,
    datasetId: "fixture",
    level: 3,
    parentId: "tr:adm2:parent",
    name: id,
    geometry,
    bbox: [0, 0, 1, 1],
    center: [0.5, 0.5],
    neighborIds: [],
    properties: { territory: { sourceClass: "generated", administrative: false, ...territory } }
  };
}

describe("generated-only zone pathology", () => {
  it("skips official polygons and reports slivers for generated zones only", () => {
    const official = zone(
      "official-1",
      {
        type: "Polygon",
        coordinates: [
          [
            [28, 40],
            [28.001, 40],
            [28.001, 40.001],
            [28, 40.001],
            [28, 40]
          ]
        ]
      },
      { sourceClass: "official", administrative: true, authoritative: true }
    );
    const generated = zone("generated-1", {
      type: "Polygon",
      coordinates: [
        [
          [28.1, 40.1],
          [28.10005, 40.1],
          [28.10005, 40.10005],
          [28.1, 40.10005],
          [28.1, 40.1]
        ]
      ]
    });
    const report = inspectTurkeyGeneratedZonePathology({
      zones: [official, generated],
      thresholds: { minSliverAreaKm2: 0.01 }
    });
    expect(isTurkeyGeneratedGameplayZone(official)).toBe(false);
    expect(isTurkeyGeneratedGameplayZone(generated)).toBe(true);
    expect(report.generatedZoneCount).toBe(1);
    expect(report.skippedOfficialZoneCount).toBe(1);
    expect(report.findings.some((finding) => finding.zoneId === "generated-1")).toBe(true);
    expect(report.findings.some((finding) => finding.zoneId === "official-1")).toBe(false);
  });

  it("detects acute spikes on generated rings", () => {
    const spike = zone("spike", {
      type: "Polygon",
      coordinates: [
        [
          [29, 41],
          [29.0004, 41.00001],
          [29.0008, 41],
          [29.0004, 40.99999],
          [29, 41]
        ]
      ]
    });
    const report = inspectTurkeyGeneratedZonePathology({ zones: [spike] });
    expect(report.findings.some((finding) => finding.code === "SPIKE")).toBe(true);
  });
});
