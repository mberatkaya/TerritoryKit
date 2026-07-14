import type { TerritoryZone } from "@territory-kit/dataset";
import { createTerritoryEngine } from "@territory-kit/core";
import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it } from "vitest";
import {
  POSTGIS_LOCATE_SQL,
  POSTGIS_VIEWPORT_SQL,
  TerritoryKitController,
  createPostgisTerritoryRepository
} from "../src/index.js";
import type { PostgisQueryClient } from "../src/index.js";

describe("PostGIS integration harness", () => {
  it("serves viewport and coordinate endpoints through the PostGIS repository contract", async () => {
    const dataset = createSampleTerritoryDataset();
    const engine = createTerritoryEngine({ dataset });
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const client: PostgisQueryClient = {
      async query<Row>(sql: string, values: unknown[]): Promise<{ rows: Row[] }> {
        queries.push({ sql, values });

        if (sql === POSTGIS_VIEWPORT_SQL) {
          const [datasetId, level, west, south, east, north] = values;
          const zones = engine
            .getZonesInBounds({
              west: Number(west),
              south: Number(south),
              east: Number(east),
              north: Number(north),
              level: Number(level)
            })
            .filter((zone) => zone.datasetId === datasetId)
            .map(toPostgisRow);

          return { rows: zones as Row[] };
        }

        if (sql === POSTGIS_LOCATE_SQL) {
          const [datasetId, level, lng, lat] = values;
          const zoneId = engine.latLngToZone(
            { lng: Number(lng), lat: Number(lat) },
            { level: Number(level) }
          );
          const zone = zoneId
            ? dataset.zones.find((candidate) => candidate.id === zoneId)
            : undefined;

          return {
            rows:
              zone && zone.datasetId === datasetId ? ([{ id: zone.id }] as Row[]) : ([] as Row[])
          };
        }

        throw new Error(`Unexpected PostGIS SQL: ${sql}`);
      }
    };
    const repository = createPostgisTerritoryRepository(client, {
      datasetId: "territorykit-sample",
      defaultLevel: 3
    });
    const controller = new TerritoryKitController(engine, repository);
    const headers = new Map<string, string>();

    const viewport = await controller.getTerritories(
      {
        west: "28.94",
        south: "41.0",
        east: "28.99",
        north: "41.04",
        level: "3"
      },
      {
        setHeader(name, value) {
          headers.set(name, value);
        }
      }
    );
    const locate = await controller.locateTerritory({ lat: 41.01, lng: 28.95, level: 3 });

    expect(viewport.zones.map((zone) => zone.id)).toEqual(["tr:34:fatih"]);
    expect(viewport.cacheKey).toContain("territorykit-sample");
    expect(headers.get("ETag")).toBe(`"${viewport.cacheKey}"`);
    expect(locate.zoneId).toBe("tr:34:fatih");
    expect(queries).toEqual([
      {
        sql: POSTGIS_VIEWPORT_SQL,
        values: ["territorykit-sample", 3, 28.94, 41, 28.99, 41.04]
      },
      {
        sql: POSTGIS_LOCATE_SQL,
        values: ["territorykit-sample", 3, 28.95, 41.01]
      }
    ]);
  });
});

function toPostgisRow(zone: TerritoryZone) {
  return {
    id: zone.id,
    dataset_id: zone.datasetId,
    level: zone.level,
    parent_id: zone.parentId ?? null,
    child_ids: zone.childIds ?? null,
    neighbor_ids: zone.neighborIds,
    properties: zone.properties,
    geometry: zone.geometry
  };
}
