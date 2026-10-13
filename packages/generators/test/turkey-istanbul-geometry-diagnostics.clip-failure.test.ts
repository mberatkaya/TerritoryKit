import type { TerritoryZone } from "@territory-kit/dataset";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clipFailure = vi.hoisted(() => ({ enabled: false }));

vi.mock("polygon-clipping", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const wrap =
    (name: "intersection" | "union") =>
    (...args: unknown[]) => {
      if (clipFailure.enabled && name === "intersection") {
        throw new Error("clip_fail");
      }
      const fn = actual[name] as (...fnArgs: unknown[]) => unknown;
      return fn(...args);
    };
  return {
    ...actual,
    default: {
      union: wrap("union"),
      intersection: wrap("intersection"),
      difference: actual.difference as (...fnArgs: unknown[]) => unknown,
      xor: actual.xor as (...fnArgs: unknown[]) => unknown
    },
    union: wrap("union"),
    intersection: wrap("intersection"),
    difference: actual.difference,
    xor: actual.xor
  };
});

import { inspectTurkeyGeneratedCoastlineSpill } from "../src/turkey-istanbul-geometry-diagnostics.js";

function generatedZone(id: string): TerritoryZone {
  return {
    id,
    datasetId: "fixture",
    level: 3,
    parentId: "tr:adm2:test",
    name: id,
    neighborIds: [],
    geometry: {
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
    },
    bbox: [29.0, 41.0, 29.01, 41.01],
    center: [29.005, 41.005],
    properties: { territory: { sourceClass: "generated", administrative: false } }
  };
}

describe("Istanbul coastline spill clipping failures", () => {
  beforeEach(() => {
    clipFailure.enabled = false;
  });

  it("returns NOT_ASSESSED when polygon-clipping intersection throws", () => {
    clipFailure.enabled = true;
    const report = inspectTurkeyGeneratedCoastlineSpill({
      zones: [generatedZone("land")],
      verifiedWaterAreas: [
        {
          type: "Polygon",
          coordinates: [
            [
              [28.995, 40.995],
              [29.015, 40.995],
              [29.015, 41.015],
              [28.995, 41.015],
              [28.995, 40.995]
            ]
          ]
        }
      ]
    });
    expect(report.assessmentStatus).toBe("NOT_ASSESSED");
    expect(report.intersectionFailureCount).toBeGreaterThan(0);
    expect(report.ok).toBe(false);
  });
});
