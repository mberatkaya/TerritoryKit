import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hasRingSelfIntersection, computeTerritoryAreaM2 } from "@territory-kit/dataset";
import type { TerritoryGeometry } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import { regularizeTurkeySmartFallbackGeometry } from "../src/turkey-smart-fallback.js";

for (const district of ["golkoy", "sarioglan"]) {
  describe(`${district} real precision regression`, () => {
    it("repairs the captured crossing without rerounding the new intersection vertices", async () => {
      const fixture = JSON.parse(
        await readFile(resolve(__dirname, `fixtures/precision/${district}.json`), "utf8")
      ) as { geometry: TerritoryGeometry };
      const original = JSON.stringify(fixture.geometry);
      const repaired = regularizeTurkeySmartFallbackGeometry(fixture.geometry);
      const polygons = repaired.type === "Polygon" ? [repaired.coordinates] : repaired.coordinates;
      expect(
        polygons.every((polygon) =>
          polygon.every(
            (ring) =>
              !hasRingSelfIntersection(
                ring.map((point) => [point[0]!, point[1]!] as [number, number])
              )
          )
        )
      ).toBe(true);
      expect(
        polygons.every((polygon) =>
          polygon.every((ring) => {
            const area = Math.abs(
              ring.slice(0, -1).reduce((sum, point, index) => {
                const next = ring[index + 1]!;
                return sum + point[0]! * next[1]! - next[0]! * point[1]!;
              }, 0) / 2
            );
            return (
              area > 1e-9 &&
              ring.every((point, index) => {
                const next = ring[index + 1];
                return (
                  !next ||
                  Math.abs(point[0]! - next[0]!) > 1e-9 ||
                  Math.abs(point[1]! - next[1]!) > 1e-9
                );
              })
            );
          })
        )
      ).toBe(true);
      expect(
        Math.abs(computeTerritoryAreaM2(repaired) - computeTerritoryAreaM2(fixture.geometry))
      ).toBeLessThan(10);
      expect(JSON.stringify(fixture.geometry)).toBe(original);
    });
  });
}
