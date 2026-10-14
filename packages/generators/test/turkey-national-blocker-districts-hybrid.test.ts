import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { computeTerritoryAreaM2, validateGeometryDataset } from "@territory-kit/dataset";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  buildTurkeyV2HybridDistrict,
  createTurkeyOsmSmartFallbackGeneratedOptions,
  readTurkeyOsmAdm2BarrierArtifact
} from "../src/turkey-adm3.js";

const ROOT = resolve(__dirname, "../../..");
const BARRIER_ROOT = resolve(ROOT, ".territory/sprint-6/calibration/barriers");
const DATASET_PATH = resolve(ROOT, "datasets/generated/countries/TR/dataset.json");

const BLOCKER_DISTRICTS = [
  { id: "tr:adm2:54988432b81567150601582", name: "Ağrı merkez" },
  { id: "tr:adm2:54988432b95277821649488", name: "İskenderun" },
  { id: "tr:adm2:54988432b28913521474336", name: "Erbaa" }
] as const;

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

describe("rc.8 national blocker districts (current hybrid production)", () => {
  const hasLocalInputs = existsSync(BARRIER_ROOT) && existsSync(DATASET_PATH);

  for (const spec of BLOCKER_DISTRICTS) {
    it(`builds ${spec.name} without material sibling overlap on effective generated zones`, async () => {
      if (!hasLocalInputs) {
        return;
      }

      const dataset = JSON.parse(await readFile(DATASET_PATH, "utf8")) as TerritoryDataset;
      const district = dataset.zones.find((zone) => zone.id === spec.id);
      expect(district).toBeDefined();

      const artifact = await readTurkeyOsmAdm2BarrierArtifact(BARRIER_ROOT, spec.id);
      const areaM2 = computeTerritoryAreaM2(district!.geometry);
      const generated = createTurkeyOsmSmartFallbackGeneratedOptions(artifact, {
        smartFallbackOptions: {
          maxTerritories: areaM2 > 100_000_000 ? 32 : 128
        }
      });
      const territory = district!.properties.territory as Record<string, unknown>;

      const result = await buildTurkeyV2HybridDistrict({
        district: district!,
        provinceCode: String(territory.provinceCode),
        districtCode: String(territory.districtCode),
        officialZones: [],
        osmZones: [],
        generated,
        buildDate: "2026-10-14T00:00:00.000Z"
      });

      expect(result.quality.gates.effectiveSiblingOverlap).toBe(true);
      expect(siblingOverlapErrors(result.effective.generated)).toEqual([]);
    }, 180_000);
  }
});
