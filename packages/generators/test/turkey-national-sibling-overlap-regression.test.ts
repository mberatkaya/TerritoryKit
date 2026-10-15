import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateGeometryDataset } from "@territory-kit/dataset";
import type { TerritoryDataset, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import type { MultiPolygon as ClippingMultiPolygon } from "polygon-clipping";
import { describe, expect, it } from "vitest";
import { enforceDisjointSmartFallbackZones } from "../src/turkey-smart-fallback.js";

const ROOT = resolve(__dirname, "../../..");

const RC7_BLOCKER_DISTRICTS = [
  {
    hash: "54988432b81567150601582",
    name: "Ağrı merkez",
    zoneSuffixes: ["422efbefdd4032cbcf2a", "50b1113821a46da462f0"]
  },
  {
    hash: "54988432b95277821649488",
    name: "İskenderun",
    zoneSuffixes: ["70e84dcdbfac39525936", "380085c34c10d2e066fd"]
  },
  {
    hash: "54988432b28913521474336",
    name: "Erbaa",
    zoneSuffixes: ["bea456747f46667714a1", "9fdfd2c3e8ccafc9f967"]
  }
] as const;

function toClippingParent(geometry: TerritoryGeometry): ClippingMultiPolygon {
  return (
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates
  ) as ClippingMultiPolygon;
}

function siblingOverlapErrors(zones: readonly TerritoryZone[]) {
  return validateGeometryDataset(
    {
      manifest: {
        datasetId: "regression",
        datasetVersion: "0",
        schemaVersion: "territory-schema@1",
        sourceDate: "2026-01-01",
        geometryHash: "00"
      },
      zones: [...zones]
    } satisfies TerritoryDataset,
    { checks: { siblingOverlaps: true } }
  ).issues.filter(
    (issue) => issue.code === "SIBLING_GEOMETRY_OVERLAP" && issue.severity === "error"
  );
}

describe("rc.7 national sibling overlap blockers", () => {
  for (const district of RC7_BLOCKER_DISTRICTS) {
    const checkpointPath = resolve(
      ROOT,
      `.territory/sprint-6/final/candidate/districts/tr_adm2_${district.hash}.json`
    );

    it(`removes material overlap for ${district.name}`, async () => {
      if (!existsSync(checkpointPath)) {
        return;
      }

      const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as {
        result: {
          district: TerritoryZone;
          smartFallbackResult?: { zones: TerritoryZone[] };
        };
      };
      const smartZones = checkpoint.result.smartFallbackResult?.zones ?? [];
      expect(smartZones.length).toBeGreaterThan(0);

      const before = siblingOverlapErrors(smartZones);
      expect(before.length).toBeGreaterThan(0);

      const repaired = enforceDisjointSmartFallbackZones(
        smartZones,
        toClippingParent(checkpoint.result.district.geometry)
      );
      const after = siblingOverlapErrors(repaired);
      expect(after).toEqual([]);
      expect(repaired.length).toBeGreaterThanOrEqual(smartZones.length - 1);
    });
  }
});
