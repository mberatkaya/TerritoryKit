import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { geometryToPolygons, hasRingSelfIntersection } from "@territory-kit/dataset";
import { createSquareZone } from "@territory-kit/shared-testkit";
import { createDatasetGeometryHash } from "../src/sources/utils.js";
import { regularizeTurkeySmartFallbackGeometry } from "../src/turkey-smart-fallback.js";

describe("national precision and geometry identity", () => {
  it("preserves the established geometry hash bytes while hashing one zone at a time", () => {
    const zones = ["z", "a"].map((id) =>
      createSquareZone({
        id,
        datasetId: "hash",
        level: 2,
        west: 29,
        south: 40,
        east: 30,
        north: 41
      })
    );
    const original = zones
      .map((z) => ({
        geometry: z.geometry,
        id: z.id,
        level: z.level,
        parentId: z.parentId ?? null
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(createDatasetGeometryHash({ zones })).toBe(
      createHash("sha256").update(JSON.stringify(original)).digest("hex")
    );
  });
  it("regularizes a real Develi boundary rounding loop and retains valid geometry unchanged", () => {
    const geometry = {
      type: "Polygon" as const,
      coordinates: [
        [
          [35.573496, 38.152297],
          [35.5737925241, 38.1527628758],
          [35.5751299206, 38.1544089022],
          [35.572803, 38.151545],
          [35.573496, 38.152297]
        ]
      ] as [number, number][][]
    };
    expect(hasRingSelfIntersection(geometry.coordinates[0]!)).toBe(true);
    const result = regularizeTurkeySmartFallbackGeometry(geometry);
    expect(geometryToPolygons(result).flat().some(hasRingSelfIntersection)).toBe(false);
    expect(regularizeTurkeySmartFallbackGeometry(result)).toBe(result);
  });
});
