import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
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
});
