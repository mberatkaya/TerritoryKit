import { describe, expect, it } from "vitest";
import {
  computeGeometryBBox,
  hashTerritoryGeometry,
  repairGeometryDataset,
  validateGeometryDataset
} from "../src/index.js";
import type { TerritoryDataset, TerritoryGeometry, TerritoryZone } from "../src/index.js";

describe("validateGeometryDataset", () => {
  it("computes bbox iteratively for very large coordinate arrays", () => {
    const ring = createLargeRectangleRing(60_000);
    const bbox = computeGeometryBBox({
      type: "Polygon",
      coordinates: [ring]
    });

    expect(ring.length).toBeGreaterThan(100_000);
    expect(bbox).toEqual([0, 0, 10, 5]);
  });

  it("validates a simple hierarchy with full geometry checks", () => {
    const result = validateGeometryDataset(validDataset(), { checks: "full" });

    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({
      zoneCount: 3,
      errorCount: 0,
      backend: "typescript"
    });
    expect(result.summary.performance.candidatePairCount).toBeGreaterThan(0);
  });

  it("reports self-intersections and sibling overlaps without repairing input", () => {
    const dataset = validDataset();
    dataset.zones[1] = {
      ...dataset.zones[1]!,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [4, 4],
            [4, 0],
            [0, 4],
            [0, 0]
          ]
        ]
      }
    };
    dataset.zones[2] = square("right", 1, 2, 0, 6, 4, { parentId: "root" });
    const hashBeforeValidation = hashTerritoryGeometry(dataset.zones[1]!.geometry);

    const result = validateGeometryDataset(dataset, { checks: "full" });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SELF_INTERSECTION", zoneId: "left" }),
        expect.objectContaining({ code: "SIBLING_GEOMETRY_OVERLAP", zoneId: "left" })
      ])
    );
    expect(hashTerritoryGeometry(dataset.zones[1]!.geometry)).toBe(hashBeforeValidation);
  });

  it("does not report GEOS-valid endpoint-only survey spikes as self-intersections", () => {
    const dataset = validDataset();
    dataset.zones[1] = {
      ...dataset.zones[1]!,
      geometry: {
        type: "Polygon",
        coordinates: [geosValidSurveySpikeRing()]
      }
    };

    const result = validateGeometryDataset(dataset, {
      checks: { coordinates: true, rings: true, selfIntersections: true }
    });

    expect(result.issues.map((issue) => issue.code)).not.toContain("SELF_INTERSECTION");
  });

  it("still reports positive-length collinear ring overlaps as self-intersections", () => {
    const dataset = validDataset();
    dataset.zones[1] = {
      ...dataset.zones[1]!,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
            [0, 2],
            [2, 2],
            [2, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0]
          ]
        ]
      }
    };

    const result = validateGeometryDataset(dataset, {
      checks: { coordinates: true, rings: true, selfIntersections: true }
    });

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SELF_INTERSECTION", zoneId: "left" })
      ])
    );
  });

  it("does not flag the closing segment as intersecting the first segment after bbox sorting", () => {
    const dataset = validDataset();
    dataset.zones[1] = {
      ...dataset.zones[1]!,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [4, 0],
            [4, 4],
            [0, 4],
            [0, 0],
            [4, 0]
          ]
        ]
      }
    };

    const result = validateGeometryDataset(dataset, {
      checks: { coordinates: true, rings: true, selfIntersections: true }
    });

    expect(result.ok).toBe(true);
  });
});

describe("repairGeometryDataset", () => {
  it("applies only safe audited repairs and revalidates the repaired dataset", () => {
    const dataset = validDataset();
    dataset.zones[1] = {
      ...dataset.zones[1]!,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [4, 0],
            [4, 0],
            [4, 4],
            [0, 4]
          ]
        ]
      },
      bbox: [99, 99, 100, 100],
      center: [99, 99]
    };

    const validation = validateGeometryDataset(dataset, { checks: "basic" });
    expect(validation.ok).toBe(false);

    const result = repairGeometryDataset(dataset, { checks: "basic" });

    expect(result.ok).toBe(true);
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0]).toMatchObject({
      zoneId: "left",
      accepted: true
    });
    expect(result.repairs[0]!.operations.map((operation) => operation.type)).toEqual([
      "remove-consecutive-duplicate-coordinate",
      "close-ring",
      "recompute-bbox",
      "recompute-center"
    ]);
    expect(result.revalidation.ok).toBe(true);
    expect(result.dataset.zones[1]!.geometry.coordinates[0]).toEqual([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0]
    ]);
  });
});

function validDataset(): TerritoryDataset {
  return {
    manifest: {
      datasetId: "quality-test",
      datasetVersion: "0.1.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-07",
      geometryHash: "quality-test"
    },
    zones: [
      {
        ...square("root", 0, 0, 0, 10, 10),
        childIds: ["left", "right"]
      },
      square("left", 1, 0, 0, 4, 4, { parentId: "root" }),
      square("right", 1, 6, 0, 10, 4, { parentId: "root" })
    ]
  };
}

function createLargeRectangleRing(pointsPerEdge: number): Array<[number, number]> {
  const ring: Array<[number, number]> = [];

  for (let index = 0; index < pointsPerEdge; index += 1) {
    ring.push([(10 * index) / pointsPerEdge, 0]);
  }

  for (let index = 0; index < pointsPerEdge; index += 1) {
    ring.push([10, (5 * index) / pointsPerEdge]);
  }

  for (let index = 0; index < pointsPerEdge; index += 1) {
    ring.push([10 - (10 * index) / pointsPerEdge, 5]);
  }

  for (let index = 0; index < pointsPerEdge; index += 1) {
    ring.push([0, 5 - (5 * index) / pointsPerEdge]);
  }

  ring.push([0, 0]);
  return ring;
}

function geosValidSurveySpikeRing(): Array<[number, number]> {
  return [
    [29.089373728107727, 39.88088018486203],
    [29.092315, 39.875372],
    [29.092143, 39.871258],
    [29.09131546641702, 39.870421809384766],
    [29.091393, 39.870321],
    [29.091152, 39.86914],
    [29.090113, 39.868685],
    [29.090109020641542, 39.86867196236505],
    [29.090858, 39.863669],
    [29.092978642609744, 39.86327414431964],
    [29.097336, 39.86591],
    [29.098833, 39.865883],
    [29.101161, 39.866918],
    [29.10482, 39.862465],
    [29.107241, 39.863268],
    [29.109274, 39.861153],
    [29.116576, 39.858327],
    [29.123944, 39.860885],
    [29.133124, 39.857408],
    [29.137365, 39.858946],
    [29.140044, 39.857602],
    [29.145835, 39.855401],
    [29.143251, 39.849141],
    [29.143158, 39.846141],
    [29.143676, 39.841681],
    [29.144527, 39.841882],
    [29.147749, 39.840565],
    [29.150337, 39.839558],
    [29.151619, 39.839048],
    [29.155139, 39.837608],
    [29.155138, 39.83761],
    [29.155141, 39.837608],
    [29.154826, 39.838308],
    [29.154623, 39.840827],
    [29.157978, 39.842022],
    [29.158245, 39.841584],
    [29.160924, 39.840884],
    [29.165253, 39.840803],
    [29.167073, 39.841419],
    [29.16866, 39.84178],
    [29.170648, 39.842393],
    [29.172164, 39.842278],
    [29.173001, 39.842739],
    [29.17312, 39.843352],
    [29.167973, 39.844757],
    [29.170178, 39.848178],
    [29.171022, 39.849625],
    [29.171182, 39.851546],
    [29.165321, 39.855657],
    [29.161938, 39.856028],
    [29.158267, 39.856789],
    [29.157292, 39.860732],
    [29.157228, 39.861887],
    [29.157666, 39.86311],
    [29.155015, 39.864545],
    [29.155572, 39.866381],
    [29.157412, 39.867732],
    [29.158864, 39.869475],
    [29.159726, 39.87146],
    [29.159752, 39.872306],
    [29.158904, 39.873938],
    [29.156864, 39.875746],
    [29.156418, 39.877447],
    [29.155463, 39.87885],
    [29.155323, 39.880777],
    [29.156068, 39.882225],
    [29.157105, 39.883437],
    [29.151987, 39.882685],
    [29.150501, 39.883098],
    [29.146484, 39.882326],
    [29.145396, 39.882731],
    [29.144224, 39.883599],
    [29.140732, 39.88374],
    [29.138222, 39.883325],
    [29.136758, 39.884429],
    [29.135263, 39.884534],
    [29.13378, 39.885023],
    [29.132035, 39.886748],
    [29.130263, 39.88755],
    [29.127542, 39.886754],
    [29.124112, 39.885662],
    [29.12241, 39.885539],
    [29.120661, 39.883878],
    [29.11895, 39.883448],
    [29.116986, 39.881329],
    [29.113843, 39.881329],
    [29.111681, 39.881308],
    [29.108593, 39.881251],
    [29.103709, 39.881648],
    [29.101445, 39.882689],
    [29.100343, 39.88271],
    [29.098864, 39.883352],
    [29.096579, 39.883779],
    [29.094088, 39.8839],
    [29.092119, 39.884782],
    [29.09167517430604, 39.88481682736834],
    [29.091689, 39.884532],
    [29.09064677361289, 39.88359919654958],
    [29.090594, 39.881866],
    [29.09058, 39.881856],
    [29.089373728107727, 39.88088018486203]
  ];
}

function square(
  id: string,
  level: number,
  west: number,
  south: number,
  east: number,
  north: number,
  options: { parentId?: string } = {}
): TerritoryZone {
  const geometry: TerritoryGeometry = {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south]
      ]
    ]
  };

  return {
    id,
    datasetId: "quality-test",
    level,
    ...(options.parentId ? { parentId: options.parentId } : {}),
    neighborIds: [],
    geometry,
    center: [(west + east) / 2, (south + north) / 2],
    bbox: [west, south, east, north],
    properties: {}
  };
}
