import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
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

  it("rejects invalid controller input before repository calls", async () => {
    const repository = {
      findVisibleZones: vi.fn(),
      locateZone: vi.fn()
    };
    const controller = new TerritoryKitController(
      createTerritoryEngine({ dataset: createSampleTerritoryDataset() }),
      repository
    );

    await expect(
      controller.getTerritories({
        west: "bad",
        south: "40",
        east: "30",
        north: "42"
      })
    ).rejects.toThrow(BadRequestException);
    await expect(controller.locateTerritory({ lat: 91, lng: 28.95 })).rejects.toThrow(
      BadRequestException
    );

    expect(repository.findVisibleZones).not.toHaveBeenCalled();
    expect(repository.locateZone).not.toHaveBeenCalled();
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

  it("maps PostGIS rows into TerritoryKit zones", async () => {
    const geometry = {
      type: "Polygon" as const,
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0]
        ]
      ]
    };
    const repository = createPostgisTerritoryRepository(
      {
        async query<Row>(sql: string, values: unknown[]): Promise<{ rows: Row[] }> {
          expect(values.length).toBeGreaterThan(0);

          if (sql === POSTGIS_LOCATE_SQL) {
            return { rows: [{ id: "pg:1" } as Row] };
          }

          return {
            rows: [
              {
                id: "pg:1",
                dataset_id: "territorykit-sample",
                level: 3,
                parent_id: "pg",
                child_ids: null,
                neighbor_ids: ["pg:2"],
                properties: { name: "PostGIS zone" },
                geometry
              } as Row
            ]
          };
        }
      },
      { datasetId: "territorykit-sample" }
    );

    await expect(
      repository.findVisibleZones({ west: 0, south: 0, east: 1, north: 1, level: 3 })
    ).resolves.toEqual([
      expect.objectContaining({
        id: "pg:1",
        datasetId: "territorykit-sample",
        parentId: "pg",
        neighborIds: ["pg:2"],
        center: [0.5, 0.5],
        bbox: [0, 0, 1, 1],
        properties: { name: "PostGIS zone" }
      })
    ]);
    await expect(
      repository.locateZone({ coordinate: { lat: 0.5, lng: 0.5 }, level: 3 })
    ).resolves.toBe("pg:1");
  });
});
