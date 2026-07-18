import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { isTerritoryError } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import type { TerritoryEngine } from "../src/index.js";

describe("public API compatibility", () => {
  it("keeps the stable runtime export surface for 1.0", () => {
    expect(Object.keys(core).sort()).toEqual([
      "TerritoryZoneNotFoundError",
      "createTerritoryCountryDatasetDescriptor",
      "createTerritoryEngine",
      "createTerritoryRegistryClient",
      "defaultZoomLevelStrategy",
      "loadTerritoryCountryDataset",
      "loadTerritoryQueryDataset",
      "zoomToDefaultLevel"
    ]);
  });

  it("keeps the typed engine contract compatible with territory-schema@1 datasets", () => {
    const engine: TerritoryEngine = core.createTerritoryEngine({
      dataset: createSampleTerritoryDataset()
    });

    expect(engine.dataset.manifest.schemaVersion).toBe("territory-schema@1");
    expect(engine.latLngToZones([{ lat: 41.01, lng: 28.95 }], { level: 3 })).toEqual([
      "tr:34:fatih"
    ]);
  });

  it("keeps zone-not-found errors compatible while adding stable codes", () => {
    const engine = core.createTerritoryEngine({
      dataset: createSampleTerritoryDataset()
    });

    try {
      engine.zoneToBoundary("missing");
    } catch (error) {
      expect(error).toBeInstanceOf(core.TerritoryZoneNotFoundError);
      expect(isTerritoryError(error)).toBe(true);
      expect(error).toMatchObject({ code: "ZONE_NOT_FOUND", zoneId: "missing" });
    }
  });
});
