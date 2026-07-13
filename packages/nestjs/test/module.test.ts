import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it } from "vitest";
import {
  POSTGIS_LOCATE_SQL,
  POSTGIS_VIEWPORT_SQL,
  TERRITORY_KIT_ENGINE,
  TerritoryKitController,
  TerritoryKitModule,
  createPostgisTerritoryRepository
} from "../src/index.js";
import { createTerritoryEngine } from "@territory-kit/core";

describe("TerritoryKitModule", () => {
  it("creates a dynamic module with an engine provider", () => {
    const module = TerritoryKitModule.forRoot({ dataset: createSampleTerritoryDataset() });

    expect(module.module).toBe(TerritoryKitModule);
    expect(module.exports).toContain(TERRITORY_KIT_ENGINE);
    expect(module.controllers).toContain(TerritoryKitController);
  });

  it("serves viewport and locate contracts through the in-memory engine", async () => {
    const controller = new TerritoryKitController(
      createTerritoryEngine({ dataset: createSampleTerritoryDataset() })
    );
    const headers = new Map<string, string>();
    const viewport = await controller.getTerritories(
      {
        west: "28",
        south: "40",
        east: "30",
        north: "42",
        zoom: "10"
      },
      {
        setHeader(name, value) {
          headers.set(name, value);
        }
      }
    );
    const locate = await controller.locateTerritory({ lat: 41.01, lng: 28.95, level: 3 });

    expect(viewport.zones.map((zone) => zone.id)).toEqual(["tr:34:fatih", "tr:34:kadikoy"]);
    expect(headers.get("ETag")).toContain("territorykit-sample");
    expect(locate.zoneId).toBe("tr:34:fatih");
  });

  it("exposes PostGIS SQL using ST_Intersects, ST_Covers, and bbox index prefilters", async () => {
    const repository = createPostgisTerritoryRepository(
      {
        async query(sql) {
          expect([POSTGIS_VIEWPORT_SQL, POSTGIS_LOCATE_SQL]).toContain(sql);
          return { rows: [] };
        }
      },
      { datasetId: "territorykit-sample" }
    );

    await expect(
      repository.findVisibleZones({ west: 28, south: 40, east: 30, north: 42, level: 3 })
    ).resolves.toEqual([]);
    await expect(
      repository.locateZone({ coordinate: { lat: 41, lng: 29 }, level: 3 })
    ).resolves.toBeNull();
    expect(POSTGIS_VIEWPORT_SQL).toContain("ST_Intersects");
    expect(POSTGIS_VIEWPORT_SQL).toContain("&& ST_MakeEnvelope");
    expect(POSTGIS_LOCATE_SQL).toContain("ST_Covers");
  });
});
