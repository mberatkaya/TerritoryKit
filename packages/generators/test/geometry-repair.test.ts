import { describe, expect, it } from "vitest";
import {
  computeGeometryRepresentativePoint,
  pointCoveredByGeometry,
  repairTerritoryGeometries
} from "../src/index.js";
import type { LngLat, TerritoryGeometry } from "@territory-kit/dataset";

const SHAPELY_PYTHON = process.env.TERRITORYKIT_GEOMETRY_REPAIR_PYTHON;
const maybeShapelyIt = SHAPELY_PYTHON ? it : it.skip;

describe("geometry repair", () => {
  it("uses a representative point covered by the final polygon instead of a bare centroid", () => {
    const geometry: TerritoryGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0]
        ],
        [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
          [4, 4]
        ]
      ]
    };

    const point = computeGeometryRepresentativePoint(geometry);

    expect(pointCoveredByGeometry(point, geometry)).toBe(true);
  });

  maybeShapelyIt("repairs bow-tie polygons with GEOS MakeValid", async () => {
    const report = await repairTerritoryGeometries(
      [
        {
          id: "bow-tie",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [2, 2],
                [0, 2],
                [2, 0],
                [0, 0]
              ]
            ]
          }
        }
      ],
      {
        engine: "shapely",
        pythonPath: SHAPELY_PYTHON!
      }
    );
    const repaired = report.results[0];

    expect(report.engineVersion).toContain("GEOS");
    expect(report.featuresRepaired).toBe(1);
    expect(report.featuresRejected).toBe(0);
    expect(repaired?.geometry?.type).toBe("MultiPolygon");
    expect(
      repaired?.center &&
        repaired.geometry &&
        pointCoveredByGeometry(repaired.center, repaired.geometry)
    ).toBe(true);
  });

  maybeShapelyIt("keeps antimeridian fixture geometries polygonal after repair", async () => {
    const report = await repairTerritoryGeometries(antimeridianFixtures(), {
      engine: "shapely",
      pythonPath: SHAPELY_PYTHON!
    });

    expect(report.featuresRejected).toBe(0);
    expect(report.results.map((result) => result.id)).toEqual([
      "fiji",
      "russia-far-east",
      "alaska-aleutian",
      "synthetic-180-crossing"
    ]);

    for (const result of report.results) {
      expect(result.geometry?.type === "Polygon" || result.geometry?.type === "MultiPolygon").toBe(
        true
      );
      expect(
        result.center && result.geometry && pointCoveredByGeometry(result.center, result.geometry)
      ).toBe(true);
      expect(allLongitudesInRange(result.geometry)).toBe(true);
    }
  });
});

function antimeridianFixtures(): Array<{ id: string; geometry: TerritoryGeometry }> {
  return [
    {
      id: "fiji",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          polygonRing(177.5, -18.5, 179.8, -16),
          polygonRing(-179.7, -18.2, -178.1, -16.4)
        ]
      }
    },
    {
      id: "russia-far-east",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [170, 60],
            [-170, 60],
            [-170, 65],
            [170, 65],
            [170, 60]
          ]
        ]
      }
    },
    {
      id: "alaska-aleutian",
      geometry: {
        type: "MultiPolygon",
        coordinates: [polygonRing(172, 51, 179.5, 54), polygonRing(-179.5, 51, -168, 54)]
      }
    },
    {
      id: "synthetic-180-crossing",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [179, 10],
            [-179, 10],
            [-179, 12],
            [179, 12],
            [179, 10]
          ]
        ]
      }
    }
  ];
}

function polygonRing(west: number, south: number, east: number, north: number): LngLat[][] {
  return [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south]
    ]
  ];
}

function allLongitudesInRange(geometry: TerritoryGeometry | undefined): boolean {
  if (!geometry) {
    return false;
  }

  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

  return polygons.every((polygon) =>
    polygon.every((ring) =>
      ring.every((point) => {
        const longitude = point[0];
        return longitude !== undefined && longitude >= -180 && longitude <= 180;
      })
    )
  );
}
