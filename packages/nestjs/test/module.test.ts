import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import {
  POSTGIS_BOUNDS_SQL,
  POSTGIS_DELETE_STALE_VERSION_SQL,
  POSTGIS_ADJACENT_SQL,
  POSTGIS_FIND_BY_ID_SQL,
  POSTGIS_HIERARCHY_SQL,
  POSTGIS_IMPORT_ZONES_SQL,
  POSTGIS_INDEX_SQL,
  POSTGIS_LOCATE_SQL,
  POSTGIS_POINT_LOOKUP_SQL,
  POSTGIS_SCHEMA_SQL,
  POSTGIS_VIEWPORT_SQL,
  TERRITORY_KIT_ENGINE,
  TerritoryKitController,
  TerritoryKitModule,
  createPostgisTerritoryRepository,
  importTerritoryDatasetToPostgis
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
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const repository = createPostgisTerritoryRepository(
      {
        async query(sql, values) {
          queries.push({ sql, values });
          expect([POSTGIS_VIEWPORT_SQL, POSTGIS_LOCATE_SQL]).toContain(sql);
          return { rows: [] };
        }
      },
      { datasetId: "territorykit-sample", datasetVersion: "0.1.0-alpha.1" }
    );

    await expect(
      repository.findVisibleZones({ west: 28, south: 40, east: 30, north: 42, level: 3 })
    ).resolves.toEqual([]);
    await expect(
      repository.locateZone({ coordinate: { lat: 41, lng: 389 }, level: 3 })
    ).resolves.toBeNull();
    expect(queries).toEqual([
      {
        sql: POSTGIS_BOUNDS_SQL,
        values: ["territorykit-sample", "0.1.0-alpha.1", 3, 28, 40, 30, 42, null]
      },
      {
        sql: POSTGIS_POINT_LOOKUP_SQL,
        values: ["territorykit-sample", "0.1.0-alpha.1", 3, 29, 41]
      }
    ]);
    expect(POSTGIS_VIEWPORT_SQL).toContain("ST_Intersects");
    expect(POSTGIS_VIEWPORT_SQL).toContain("&& ST_MakeEnvelope");
    expect(POSTGIS_LOCATE_SQL).toContain("ST_Covers");
    expect(POSTGIS_SCHEMA_SQL).toContain("geometry(MultiPolygon, 4326)");
    expect(POSTGIS_SCHEMA_SQL).toContain("primary key (dataset_id, dataset_version, id)");
    expect(POSTGIS_INDEX_SQL).toContain("using gist (geometry)");
    expect(POSTGIS_INDEX_SQL).toContain("using gist (bbox)");
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
            return {
              rows: [
                {
                  id: "pg:1",
                  dataset_id: "territorykit-sample",
                  dataset_version: "1.0.0",
                  geometry_version: "pg:1-boundary-v1",
                  level: 3,
                  parent_id: "pg",
                  child_ids: null,
                  neighbor_ids: ["pg:2"],
                  properties: { name: "PostGIS zone" },
                  geometry,
                  area_m2: 12,
                  representative_point: { type: "Point", coordinates: [0.5, 0.5] }
                } as Row
              ]
            };
          }

          return {
            rows: [
              {
                id: "pg:1",
                dataset_id: "territorykit-sample",
                dataset_version: "1.0.0",
                geometry_version: "pg:1-boundary-v1",
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

  it("imports datasets with version-aware idempotent PostGIS batches", async () => {
    const dataset = createSampleTerritoryDataset();
    const queries: Array<{ sql: string; values: unknown[] }> = [];

    const result = await importTerritoryDatasetToPostgis(
      {
        async query<Row>(sql: string, values: unknown[]): Promise<{ rows: Row[] }> {
          queries.push({ sql, values });
          return { rows: [] };
        }
      },
      dataset,
      { batchSize: 2 }
    );
    const importQueries = queries.filter((query) => query.sql === POSTGIS_IMPORT_ZONES_SQL);
    const firstBatch = JSON.parse(String(importQueries[0]?.values[0])) as Array<{
      dataset_version: string;
      geometry_version: string;
      area_m2: number;
      representative_lng: number;
      representative_lat: number;
    }>;

    expect(result).toMatchObject({
      datasetId: "territorykit-sample",
      datasetVersion: "0.1.0-alpha.1",
      geometryHash: "sample-fixture-v1",
      zoneCount: dataset.zones.length,
      batchCount: 3,
      indexesEnsured: true
    });
    expect(queries.map((query) => query.sql)).toEqual([
      "begin",
      POSTGIS_SCHEMA_SQL,
      POSTGIS_INDEX_SQL,
      POSTGIS_DELETE_STALE_VERSION_SQL,
      POSTGIS_IMPORT_ZONES_SQL,
      POSTGIS_IMPORT_ZONES_SQL,
      POSTGIS_IMPORT_ZONES_SQL,
      "commit"
    ]);
    expect(queries.find((query) => query.sql === POSTGIS_DELETE_STALE_VERSION_SQL)?.values).toEqual(
      ["territorykit-sample", "0.1.0-alpha.1", dataset.zones.map((zone) => zone.id)]
    );
    expect(firstBatch[0]).toMatchObject({
      dataset_version: "0.1.0-alpha.1",
      geometry_version: expect.stringMatching(/^fnv1a32:/),
      area_m2: expect.any(Number),
      representative_lng: expect.any(Number),
      representative_lat: expect.any(Number)
    });
    expect(POSTGIS_IMPORT_ZONES_SQL).toContain("on conflict (dataset_id, dataset_version, id)");
    expect(POSTGIS_IMPORT_ZONES_SQL).toContain("ST_Multi");
  });

  it("serves extended PostGIS repository helpers for bounds, IDs, hierarchy, and adjacency", async () => {
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
    const parentRow = {
      id: "pg",
      dataset_id: "territorykit-sample",
      dataset_version: "1.0.0",
      geometry_version: "pg-boundary-v1",
      level: 2,
      parent_id: null,
      child_ids: ["pg:1"],
      neighbor_ids: [],
      properties: {},
      geometry
    };
    const childRow = {
      id: "pg:1",
      dataset_id: "territorykit-sample",
      dataset_version: "1.0.0",
      geometry_version: "pg:1-boundary-v1",
      level: 3,
      parent_id: "pg",
      child_ids: [],
      neighbor_ids: ["pg:2"],
      properties: { name: "Child" },
      geometry,
      area_m2: 42,
      representative_point: { type: "Point" as const, coordinates: [0.5, 0.5] as [number, number] }
    };
    const neighborRow = {
      ...childRow,
      id: "pg:2",
      parent_id: "pg",
      neighbor_ids: ["pg:1"],
      properties: { name: "Neighbor" }
    };
    const repository = createPostgisTerritoryRepository(
      {
        async query<Row>(sql: string): Promise<{ rows: Row[] }> {
          if (
            sql === POSTGIS_VIEWPORT_SQL ||
            sql === POSTGIS_LOCATE_SQL ||
            sql === POSTGIS_FIND_BY_ID_SQL
          ) {
            return { rows: [childRow as Row] };
          }

          if (sql === POSTGIS_HIERARCHY_SQL) {
            return {
              rows: [
                { ...childRow, depth: 0 },
                { ...parentRow, depth: 1 }
              ] as Row[]
            };
          }

          if (sql === POSTGIS_ADJACENT_SQL) {
            return { rows: [neighborRow as Row] };
          }

          return { rows: [] };
        }
      },
      { datasetId: "territorykit-sample", datasetVersion: "1.0.0", defaultLimit: 100 }
    );

    await expect(
      repository.findInBounds({ west: 0, south: 0, east: 1, north: 1 })
    ).resolves.toEqual([expect.objectContaining({ id: "pg:1" })]);
    await expect(repository.findById("pg:1")).resolves.toEqual(
      expect.objectContaining({ id: "pg:1" })
    );
    await expect(repository.getGeometry("pg:1")).resolves.toEqual(geometry);
    await expect(repository.getMetrics("pg:1")).resolves.toMatchObject({
      areaM2: 42,
      representativePoint: [0.5, 0.5]
    });
    await expect(repository.getHierarchy("pg:1")).resolves.toMatchObject({
      territoryId: "pg:1",
      parentId: "pg",
      ancestorIds: ["pg"],
      pathIds: ["pg", "pg:1"]
    });
    await expect(repository.getAdjacentTerritories("pg:1")).resolves.toEqual([
      expect.objectContaining({ id: "pg:2" })
    ]);
  });
});
