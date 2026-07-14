import { createSyntheticGridDataset } from "@territory-kit/shared-testkit";
import { bench, describe } from "vitest";
import { createTerritoryEngine } from "../src/index.js";

const grid10k = createSyntheticGridDataset({
  rows: 100,
  columns: 100,
  cellSize: 0.01,
  withNeighbors: true
});
const grid100k = createSyntheticGridDataset({
  rows: 250,
  columns: 400,
  cellSize: 0.001
});
const engine10k = createTerritoryEngine({ dataset: grid10k });
const engine100k = createTerritoryEngine({ dataset: grid100k });
const lookupZoneId = "z:50:50";

describe("TerritoryEngine spatial lookup", () => {
  bench("latLngToZone indexed lookup, 10K polygons", () => {
    engine10k.latLngToZone({ lat: 0.455, lng: 0.375 }, { level: 0 });
  });

  bench("getZonesInBounds indexed bbox query, 10K polygons", () => {
    engine10k.getZonesInBounds({
      west: 0.2,
      south: 0.2,
      east: 0.4,
      north: 0.4,
      level: 0
    });
  });

  bench("getZoneById map lookup, 10K polygons", () => {
    engine10k.getZoneById(lookupZoneId);
  });

  bench("createTerritoryEngine index construction, 10K polygons", () => {
    createTerritoryEngine({ dataset: grid10k });
  });

  bench("latLngToZone indexed lookup, 100K polygons", () => {
    engine100k.latLngToZone({ lat: 0.1115, lng: 0.2225 }, { level: 0 });
  });
});
