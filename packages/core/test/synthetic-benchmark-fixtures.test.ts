import { createSyntheticGridDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it } from "vitest";
import { createTerritoryEngine } from "../src/index.js";

describe("synthetic benchmark fixtures", () => {
  it("builds deterministic 10K polygon fixtures for benchmark smoke tests", () => {
    const dataset = createSyntheticGridDataset({
      rows: 100,
      columns: 100,
      cellSize: 0.01,
      withNeighbors: true
    });
    const engine = createTerritoryEngine({ dataset });

    expect(dataset.zones).toHaveLength(10_000);
    expect(engine.latLngToZone({ lat: 0.005, lng: 0.005 }, { level: 0 })).toBe("z:0:0");
    expect(engine.zoneNeighbors("z:50:50")).toEqual(["z:49:50", "z:50:49", "z:50:51", "z:51:50"]);
  });
});
