import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeGeometryBBox,
  computeGeometryCenter,
  hasRingSelfIntersection,
  validateGeometryDataset
} from "@territory-kit/dataset";
import type {
  LngLat,
  TerritoryDataset,
  TerritoryGeometry,
  TerritoryZone
} from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  createDatasetGeometryHash,
  simplifyTerritoryDataset,
  simplifyTerritoryDatasetPath
} from "../src/index.js";
import { auditSimplifiedTerritoryDataset } from "../src/geometry-simplification.js";

type Detail = "high" | "medium" | "low";

describe("topology-safe geometry simplification", () => {
  it("keeps two adjacent rectangles closed and gap-free on their shared edge", async () => {
    const source = territoryDataset("adjacent-rectangles", [
      polygonZone("left", rectangleWithSharedMidpoint(0, 0, 1, 1, "left")),
      polygonZone("right", rectangleWithSharedMidpoint(1, 0, 2, 1, "right"))
    ]);

    const simplified = await simplifyFixture(source, "low");
    const left = zoneGeometry(simplified, "left");
    const right = zoneGeometry(simplified, "right");

    expectGeometryRingsValid(simplified);
    expectSharedBoundarySynchronized(left, right);
    expect(Math.abs(geometryArea(left) + geometryArea(right) - 2)).toBeLessThan(1e-12);
  });

  it("simplifies a complex common border once and reuses the reversed sequence", async () => {
    const shared = wavySharedBoundary(1, 0, 1, 12, 0.00004);
    const source = territoryDataset("complex-shared-boundary", [
      polygonZone("left", leftOfShared(shared, 0)),
      polygonZone("right", rightOfShared(shared, 2))
    ]);
    const sourceShared = onlySharedChain(
      zoneGeometry(source, "left"),
      zoneGeometry(source, "right")
    );

    const simplified = await simplifyFixture(source, "high");
    const simplifiedShared = onlySharedChain(
      zoneGeometry(simplified, "left"),
      zoneGeometry(simplified, "right")
    );

    expect(simplifiedShared.left.length).toBeLessThan(sourceShared.left.length);
    expect(simplifiedShared.left).toEqual([...simplifiedShared.right].reverse());
  });

  it("does not count shared segment reduction as a topology mismatch", () => {
    const shared = wavySharedBoundary(1, 0, 1, 12, 0.00004);
    const source = territoryDataset("issue-56-false-positive", [
      polygonZone("left", leftOfShared(shared, 0)),
      polygonZone("right", rightOfShared(shared, 2))
    ]);

    const report = simplifyTerritoryDataset(source, {
      strategy: "topology-safe",
      details: ["high"],
      buildDate: "2026-01-01T00:00:00.000Z"
    });
    const audit = report.tiers[0]!.topologyAudit;

    expect(report.reportVersion).toBe("2");
    expect(report.ok).toBe(true);
    expect(audit.sharedSegmentCountAfter).toBeLessThan(audit.sharedSegmentCountBefore);
    expect(audit.sharedBoundaryMismatchCount).toBe(0);
    expect(audit.geometryValidation).toMatchObject({
      ok: true,
      invalidFeatureCount: 0,
      errorCount: 0
    });
    expect(audit.ok).toBe(true);
  });

  it("detects a real shared-boundary divergence in reconstructed output", () => {
    const shared = [
      [1, 0],
      [1, 0.25],
      [1, 0.5],
      [1, 0.75],
      [1, 1]
    ] as LngLat[];
    const source = territoryDataset("shared-boundary-audit-source", [
      polygonZone("left", leftOfShared(shared, 0)),
      polygonZone("right", rightOfShared(shared, 2))
    ]);
    const output = territoryDataset("shared-boundary-audit-output", [
      polygonZone("left", leftOfShared([shared[0]!, shared[2]!, shared[4]!], 0)),
      polygonZone("right", [shared[0]!, [2, 0], [2, 1], shared[4]!, shared[3]!, shared[0]!])
    ]);

    const audit = auditSimplifiedTerritoryDataset(source, output);

    expect(audit.geometryValidation.ok).toBe(true);
    expect(audit.sharedBoundaryMismatchCount).toBeGreaterThan(0);
    expect(audit.ok).toBe(false);
    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SHARED_BOUNDARY_MISMATCH",
          severity: "error",
          zoneIds: ["left", "right"]
        })
      ])
    );
  });

  it("reports invalid simplified geometry through the geometry validator", () => {
    const source = territoryDataset("invalid-output-source", [
      polygonZone("bowtie", simpleRectangle(0, 0, 1, 1))
    ]);
    const output = territoryDataset("invalid-output-corrupted", [
      polygonZone("bowtie", bowTieRing())
    ]);

    const audit = auditSimplifiedTerritoryDataset(source, output);

    expect(audit.sharedBoundaryMismatchCount).toBe(0);
    expect(audit.geometryValidation.ok).toBe(false);
    expect(audit.geometryValidation.invalidFeatureCount).toBeGreaterThan(0);
    expect(audit.geometryValidation.errorCount).toBeGreaterThan(0);
    expect(audit.ok).toBe(false);
    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SIMPLIFIED_GEOMETRY_INVALID",
          geometryIssueCode: "SELF_INTERSECTION",
          zoneId: "bowtie"
        })
      ])
    );
  });

  it("does not treat an omitted hash-equal invalid tier as quality-success", () => {
    const source = territoryDataset("invalid-omitted-tier", [polygonZone("bowtie", bowTieRing())]);

    const report = simplifyTerritoryDataset(source, {
      strategy: "topology-safe",
      details: ["high"],
      buildDate: "2026-01-01T00:00:00.000Z"
    });
    const tier = report.tiers[0]!;

    expect(tier.status).toBe("omitted");
    expect(report.ok).toBe(false);
    expect(tier.topologyAudit.geometryValidation.ok).toBe(false);
    expect(tier.topologyAudit.ok).toBe(false);
  });

  it("falls back invalid MultiPolygon component simplification to source arcs", () => {
    const source = multipolygonNarrowNotchDataset();

    expect(
      validateGeometryDataset(source, {
        checks: {
          coordinates: true,
          rings: true,
          selfIntersections: true,
          holes: true,
          bbox: true,
          center: true,
          antimeridian: true,
          parentContainment: false,
          siblingOverlaps: false
        }
      }).ok
    ).toBe(true);

    const report = simplifyTerritoryDataset(source, {
      strategy: "topology-safe",
      details: ["low"],
      buildDate: "2026-01-01T00:00:00.000Z"
    });
    const tier = report.tiers[0]!;

    expect(report.ok).toBe(true);
    expect(tier.status).toBe("omitted");
    expect(tier.topologyAudit.ok).toBe(true);
    expect(tier.topologyAudit.geometryValidation).toMatchObject({
      ok: true,
      invalidFeatureCount: 0,
      errorCount: 0
    });
  });

  it("reproduces Issue #55 with legacy per-ring RDP and fixes it with shared arcs", async () => {
    const source = issue55RegressionDataset();
    const legacyLeft = legacySimplifyGeometry(zoneGeometry(source, "left"), 0.00005);
    const legacyRight = legacySimplifyGeometry(zoneGeometry(source, "right"), 0.00005);

    expect(sharedChains(legacyLeft, sharedSegmentKeys(legacyLeft, legacyRight))).toHaveLength(2);

    const simplified = await simplifyFixture(source, "high");
    const sharedAfter = onlySharedChain(
      zoneGeometry(simplified, "left"),
      zoneGeometry(simplified, "right")
    );

    expect(sharedAfter.left).toEqual([...sharedAfter.right].reverse());
  });

  it("keeps shared arcs synchronized while exterior boundaries still simplify", async () => {
    const shared = wavySharedBoundary(1, 0, 1, 8, 0.00004);
    const left = [
      [0, 0],
      [0.2, 0.00003],
      [0.4, -0.00003],
      [0.6, 0.00002],
      ...shared,
      [0.6, 1.00002],
      [0.4, 0.99997],
      [0.2, 1.00003],
      [0, 1],
      [0, 0]
    ] as LngLat[];
    const source = territoryDataset("shared-exterior-mix", [
      polygonZone("left", left),
      polygonZone("right", rightOfShared(shared, 2))
    ]);

    const simplified = await simplifyFixture(source, "high");

    expectSharedBoundarySynchronized(
      zoneGeometry(simplified, "left"),
      zoneGeometry(simplified, "right")
    );
    expect(countGeometryVertices(zoneGeometry(simplified, "left"))).toBeLessThan(
      countGeometryVertices(zoneGeometry(source, "left"))
    );
  });

  it("preserves a three-way topology junction between adjacent polygons", async () => {
    const lower = wavySharedBoundary(1, 0, 1, 6, 0.00004);
    const upper = wavySharedBoundary(1, 1, 2, 6, 0.00004);
    const west = [[0, 0], ...lower, ...upper.slice(1), [0, 2], [0, 0]] as LngLat[];
    const source = territoryDataset("three-way-junction", [
      polygonZone("west", west),
      polygonZone("southeast", rightOfShared(lower, 2)),
      polygonZone("northeast", rightOfShared(upper, 2))
    ]);

    const simplified = await simplifyFixture(source, "high");

    expect(geometryContainsCoordinate(zoneGeometry(simplified, "west"), [1, 1])).toBe(true);
    expect(geometryContainsCoordinate(zoneGeometry(simplified, "southeast"), [1, 1])).toBe(true);
    expect(geometryContainsCoordinate(zoneGeometry(simplified, "northeast"), [1, 1])).toBe(true);
    expectSharedBoundarySynchronized(
      zoneGeometry(simplified, "west"),
      zoneGeometry(simplified, "southeast")
    );
    expectSharedBoundarySynchronized(
      zoneGeometry(simplified, "west"),
      zoneGeometry(simplified, "northeast")
    );
    expect(auditSimplifiedTerritoryDataset(source, simplified)).toMatchObject({
      ok: true,
      sharedBoundaryMismatchCount: 0
    });
  });

  it("produces the same geometries regardless of input zone order", async () => {
    const source = orderIndependenceDataset();
    const reordered = { ...source, zones: [source.zones[2]!, source.zones[0]!, source.zones[1]!] };

    const first = await simplifyFixture(source, "high");
    const second = await simplifyFixture(reordered, "high");

    expect(geometriesByZoneId(second)).toEqual(geometriesByZoneId(first));
    expect(auditSimplifiedTerritoryDataset(source, first).issues).toEqual(
      auditSimplifiedTerritoryDataset(reordered, second).issues
    );
  });

  it("matches opposing ring traversal directions with exact reversal", async () => {
    const shared = wavySharedBoundary(1, 0, 1, 10, 0.00004);
    const source = territoryDataset("ring-direction", [
      polygonZone("left", leftOfShared(shared, 0)),
      polygonZone("right", rightOfShared(shared, 2))
    ]);

    const simplified = await simplifyFixture(source, "high");
    const sharedAfter = onlySharedChain(
      zoneGeometry(simplified, "left"),
      zoneGeometry(simplified, "right")
    );

    expect(sharedAfter.left).toEqual([...sharedAfter.right].reverse());
  });

  it("preserves shared topology for MultiPolygon components", async () => {
    const shared = wavySharedBoundary(1, 0, 1, 10, 0.00004);
    const source = territoryDataset("multipolygon-shared", [
      multiPolygonZone("multi", [[leftOfShared(shared, 0)], [simpleRectangle(3, 0, 4, 1)]]),
      polygonZone("neighbor", rightOfShared(shared, 2))
    ]);

    const simplified = await simplifyFixture(source, "high");
    const multi = zoneGeometry(simplified, "multi");

    expect(multi.type).toBe("MultiPolygon");
    expect(multi.coordinates).toHaveLength(2);
    expectSharedBoundarySynchronized(multi, zoneGeometry(simplified, "neighbor"));
    expect(auditSimplifiedTerritoryDataset(source, simplified)).toMatchObject({
      ok: true,
      sharedBoundaryMismatchCount: 0
    });
  });

  it("audits disconnected MultiPolygon shared boundaries independently", () => {
    const lower = wavySharedBoundary(1, 0, 1, 8, 0.00004);
    const upper = wavySharedBoundary(1, 2, 3, 8, 0.00004);
    const source = territoryDataset("multipolygon-disconnected-shared-boundaries", [
      multiPolygonZone("multi-left", [[leftOfShared(lower, 0)], [leftOfShared(upper, 0)]]),
      multiPolygonZone("multi-right", [[rightOfShared(lower, 2)], [rightOfShared(upper, 2)]])
    ]);

    const report = simplifyTerritoryDataset(source, {
      strategy: "topology-safe",
      details: ["high"],
      buildDate: "2026-01-01T00:00:00.000Z"
    });
    const audit = report.tiers[0]!.topologyAudit;

    expect(report.source.sharedBoundaryCount).toBe(2);
    expect(audit.sharedBoundaryCountBefore).toBe(2);
    expect(audit.sharedBoundaryMismatchCount).toBe(0);
    expect(audit.ok).toBe(true);
  });

  it("keeps interior rings closed, non-degenerate, and self-intersection-free", async () => {
    const hole = [
      [0.4, 0.4],
      [0.5, 0.40003],
      [0.6, 0.4],
      [0.60003, 0.5],
      [0.6, 0.6],
      [0.5, 0.59997],
      [0.4, 0.6],
      [0.39997, 0.5],
      [0.4, 0.4]
    ] as LngLat[];
    const source = territoryDataset("hole", [
      polygonZone("donut", [simpleRectangle(0, 0, 1, 1), hole])
    ]);

    const simplified = await simplifyFixture(source, "high");
    const geometry = zoneGeometry(simplified, "donut");

    expect(geometry.type).toBe("Polygon");
    expect(geometry.coordinates).toHaveLength(2);
    expectRingValid(geometry.coordinates[1] as LngLat[]);
  });

  it("preserves topology through high, medium, and low detail tiers with useful reduction", async () => {
    const source = orderIndependenceDataset();
    const sourceVertices = countDatasetVertices(source);
    const simplified = await Promise.all(
      (["high", "medium", "low"] as const).map((detail) => simplifyFixture(source, detail))
    );
    const [high, medium, low] = simplified;

    for (const dataset of simplified) {
      expectSharedBoundarySynchronized(
        zoneGeometry(dataset, "left"),
        zoneGeometry(dataset, "right")
      );
      expectGeometryRingsValid(dataset);
    }

    expect(countDatasetVertices(high!)).toBeLessThanOrEqual(sourceVertices);
    expect(countDatasetVertices(medium!)).toBeLessThanOrEqual(countDatasetVertices(high!));
    expect(countDatasetVertices(low!)).toBeLessThanOrEqual(countDatasetVertices(medium!));
    expect(countDatasetVertices(low!)).toBeLessThan(sourceVertices);
  });

  it("adds independent topology audits for high, medium, and low tiers", () => {
    const source = orderIndependenceDataset();

    const report = simplifyTerritoryDataset(source, {
      strategy: "topology-safe",
      details: ["high", "medium", "low"],
      buildDate: "2026-01-01T00:00:00.000Z"
    });

    expect(report.ok).toBe(true);
    expect(report.tiers.map((tier) => tier.detail)).toEqual(["high", "medium", "low"]);

    for (const tier of report.tiers) {
      expect(tier.topologyAudit.ok).toBe(true);
      expect(tier.topologyAudit.sharedBoundaryMismatchCount).toBe(0);
      expect(tier.topologyAudit.geometryValidation.ok).toBe(true);
      expect(tier.topologyAudit.sharedSegmentCountAfter).toBeLessThanOrEqual(
        tier.topologyAudit.sharedSegmentCountBefore
      );
    }
  });

  it("handles a moderately sized synthetic grid without losing shared boundaries", async () => {
    const source = gridDataset(10, 10);

    const simplified = await simplifyFixture(source, "low");

    expect(simplified.zones).toHaveLength(100);
    expect(countDatasetVertices(simplified)).toBeLessThan(countDatasetVertices(source));
    expectSharedBoundarySynchronized(
      zoneGeometry(simplified, "cell-0-0"),
      zoneGeometry(simplified, "cell-0-1")
    );
    expectSharedBoundarySynchronized(
      zoneGeometry(simplified, "cell-5-5"),
      zoneGeometry(simplified, "cell-5-6")
    );
    expectSharedBoundarySynchronized(
      zoneGeometry(simplified, "cell-5-5"),
      zoneGeometry(simplified, "cell-6-5")
    );
  });

  it("returns deterministic geometry and geometry hashes for identical input", async () => {
    const source = orderIndependenceDataset();

    const first = await simplifyFixture(source, "high");
    const second = await simplifyFixture(source, "high");

    expect(createDatasetGeometryHash(second)).toBe(createDatasetGeometryHash(first));
    expect(second.zones.map((zone) => zone.geometry)).toEqual(
      first.zones.map((zone) => zone.geometry)
    );
  });

  it("keeps audit output deterministic and stable after serialization", async () => {
    const source = orderIndependenceDataset();
    const simplified = await simplifyFixture(source, "high");
    const reparsed = JSON.parse(JSON.stringify(simplified)) as TerritoryDataset;

    const first = auditSimplifiedTerritoryDataset(source, simplified);
    const second = auditSimplifiedTerritoryDataset(source, simplified);
    const afterSerialization = auditSimplifiedTerritoryDataset(source, reparsed);

    expect(second).toEqual(first);
    expect(afterSerialization.ok).toBe(first.ok);
    expect(afterSerialization.sharedBoundaryMismatchCount).toBe(first.sharedBoundaryMismatchCount);
    expect(afterSerialization.issues).toEqual(first.issues);
  });

  it("covers the Gaziantep/Kilis ADM1 regression shape with a bounded deterministic fixture", async () => {
    const shared = wavySharedBoundary(37.1, 36.65, 37.55, 14, 0.00004);
    const source = territoryDataset("turkey-adm1-gaziantep-kilis-regression", [
      polygonZone("TR-27-Gaziantep", leftOfShared(shared, 36.2), {
        countryCode: "TR",
        sourceAdminLevel: "ADM1",
        semanticType: "province",
        name: "Gaziantep"
      }),
      polygonZone("TR-79-Kilis", rightOfShared(shared, 38.1), {
        countryCode: "TR",
        sourceAdminLevel: "ADM1",
        semanticType: "province",
        name: "Kilis"
      })
    ]);

    const simplified = await simplifyFixture(source, "high");
    const sharedAfter = onlySharedChain(
      zoneGeometry(simplified, "TR-27-Gaziantep"),
      zoneGeometry(simplified, "TR-79-Kilis")
    );

    expect(sharedAfter.left).toEqual([...sharedAfter.right].reverse());
    expect(sharedAfter.left.length).toBeLessThan(shared.length);

    const audit = auditSimplifiedTerritoryDataset(source, simplified);
    expect(audit.sharedSegmentCountAfter).toBeLessThan(audit.sharedSegmentCountBefore);
    expect(audit.sharedBoundaryMismatchCount).toBe(0);
    expect(audit.geometryValidation.ok).toBe(true);
    expect(audit.ok).toBe(true);
  });
});

async function simplifyFixture(
  dataset: TerritoryDataset,
  detail: Detail
): Promise<TerritoryDataset> {
  const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-topology-simplify-"));
  const inputPath = join(tempDir, "dataset.json");
  const outputPath = join(tempDir, "out");

  try {
    await writeFile(inputPath, JSON.stringify(dataset), "utf8");
    await simplifyTerritoryDatasetPath(inputPath, outputPath, {
      strategy: "topology-safe",
      details: [detail],
      buildDate: "2026-01-01T00:00:00.000Z",
      force: true
    });

    return JSON.parse(
      await readFile(join(outputPath, detail, "dataset.json"), "utf8")
    ) as TerritoryDataset;
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function orderIndependenceDataset(): TerritoryDataset {
  const shared = wavySharedBoundary(1, 0, 1, 14, 0.00004);

  return territoryDataset("order-independence", [
    polygonZone("left", leftOfShared(shared, 0)),
    polygonZone("right", rightOfShared(shared, 2)),
    polygonZone("north", simpleRectangle(0, 2, 1, 3))
  ]);
}

function gridDataset(rows: number, columns: number): TerritoryDataset {
  const zones: TerritoryZone[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      zones.push(polygonZone(`cell-${row}-${column}`, gridCellRing(row, column)));
    }
  }

  return territoryDataset("synthetic-topology-grid", zones);
}

function gridCellRing(row: number, column: number): LngLat[] {
  const west = column;
  const east = column + 1;
  const south = row;
  const north = row + 1;

  return [
    [west, south],
    [(west + east) / 2, south],
    [east, south],
    [east, (south + north) / 2],
    [east, north],
    [(west + east) / 2, north],
    [west, north],
    [west, (south + north) / 2],
    [west, south]
  ];
}

function issue55RegressionDataset(): TerritoryDataset {
  return territoryDataset("issue-55-legacy-rdp-regression", [
    polygonZone("left", [
      [0, 0],
      [0.166666666667, -0.000024894319],
      [0.333333333333, 0.000018635373],
      [0.5, -0.000020515084],
      [0.666666666667, -0.000035383792],
      [0.833333333333, 0.000029689641],
      [1, 0],
      [1.000049998989, 0.052631578947],
      [0.999938380004, 0.105263157895],
      [1.000056971449, 0.157894736842],
      [1.000053366026, 0.210526315789],
      [1.000042387335, 0.263157894737],
      [0.999949813793, 0.315789473684],
      [0.999934761636, 0.368421052632],
      [0.999995721718, 0.421052631579],
      [0.999974075216, 0.473684210526],
      [1.000024294445, 0.526315789474],
      [0.999918766892, 0.578947368421],
      [1.000053104188, 0.631578947368],
      [1.000028635583, 0.684210526316],
      [1.000012788506, 0.736842105263],
      [0.999944285394, 0.789473684211],
      [0.999960715439, 0.842105263158],
      [1.00007754137, 0.894736842105],
      [1.000037758122, 0.947368421053],
      [1, 1],
      [0.833333333333, 1.000004216192],
      [0.666666666667, 0.999941719362],
      [0.5, 0.999956385119],
      [0.333333333333, 1.000025309028],
      [0.166666666667, 1.000045705584],
      [0, 1],
      [0.000048069634, 0.833333333333],
      [0.00003158219, 0.666666666667],
      [-0.000031965602, 0.5],
      [-0.000020028554, 0.333333333333],
      [-0.000005543828, 0.166666666667],
      [0, 0]
    ]),
    polygonZone("right", [
      [1, 0],
      [1.166666666667, 0.000034620977],
      [1.333333333333, 0.000066600576],
      [1.5, -0.000040364062],
      [1.666666666667, -0.000005559379],
      [1.833333333333, -0.0000407371],
      [2, 0],
      [2.000042322584, 0.166666666667],
      [2.00002252151, 0.333333333333],
      [2.000040579587, 0.5],
      [1.999961103585, 0.666666666667],
      [1.999968760917, 0.833333333333],
      [2, 1],
      [1.833333333333, 0.999982674906],
      [1.666666666667, 0.999933854717],
      [1.5, 1.000008290375],
      [1.333333333333, 1.000021722755],
      [1.166666666667, 1.000003438663],
      [1, 1],
      [1.000037758122, 0.947368421053],
      [1.00007754137, 0.894736842105],
      [0.999960715439, 0.842105263158],
      [0.999944285394, 0.789473684211],
      [1.000012788506, 0.736842105263],
      [1.000028635583, 0.684210526316],
      [1.000053104188, 0.631578947368],
      [0.999918766892, 0.578947368421],
      [1.000024294445, 0.526315789474],
      [0.999974075216, 0.473684210526],
      [0.999995721718, 0.421052631579],
      [0.999934761636, 0.368421052632],
      [0.999949813793, 0.315789473684],
      [1.000042387335, 0.263157894737],
      [1.000053366026, 0.210526315789],
      [1.000056971449, 0.157894736842],
      [0.999938380004, 0.105263157895],
      [1.000049998989, 0.052631578947],
      [1, 0]
    ])
  ]);
}

function multipolygonNarrowNotchDataset(): TerritoryDataset {
  return territoryDataset("multipolygon-narrow-notch", [
    multiPolygonZone("notched", [
      [
        [
          [0, 0],
          [0.01, 0],
          [0.01, 0.004],
          [0.009, 0.004],
          [0.009, 0.006],
          [0.01, 0.006],
          [0.01, 0.01],
          [0, 0.01],
          [0, 0]
        ]
      ],
      [
        [
          [0.0092, 0.0044],
          [0.0098, 0.0044],
          [0.0098, 0.0056],
          [0.0092, 0.0056],
          [0.0092, 0.0044]
        ]
      ]
    ])
  ]);
}

function territoryDataset(datasetId: string, zones: TerritoryZone[]): TerritoryDataset {
  const dataset: TerritoryDataset = {
    manifest: {
      datasetId,
      datasetVersion: "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-01-01",
      geometryHash: "fixture",
      adminLevels: ["ADM1"],
      artifactChecksum: "fixture",
      attribution: "Synthetic topology simplification regression fixtures",
      boundaryPolicy: "fixture",
      buildDate: "2026-01-01T00:00:00.000Z",
      countryCodes: ["TR"],
      crs: "EPSG:4326",
      disputedAreaPolicy: "fixture",
      geometryDetail: "source",
      license: "Apache-2.0",
      name: datasetId,
      sourceProvider: "fixture",
      worldview: "fixture"
    },
    zones: zones.map((zone) => ({ ...zone, datasetId }))
  };

  return {
    ...dataset,
    manifest: {
      ...dataset.manifest,
      geometryHash: createDatasetGeometryHash(dataset)
    }
  };
}

function polygonZone(
  id: string,
  rings: LngLat[] | LngLat[][],
  overrides: Partial<TerritoryZone> = {}
): TerritoryZone {
  const coordinates = isCoordinate(rings[0]) ? [rings as LngLat[]] : (rings as LngLat[][]);
  const geometry: TerritoryGeometry = { type: "Polygon", coordinates };

  return zone(id, geometry, overrides);
}

function multiPolygonZone(
  id: string,
  coordinates: LngLat[][][],
  overrides: Partial<TerritoryZone> = {}
): TerritoryZone {
  return zone(id, { type: "MultiPolygon", coordinates }, overrides);
}

function zone(
  id: string,
  geometry: TerritoryGeometry,
  overrides: Partial<TerritoryZone>
): TerritoryZone {
  const bbox = computeGeometryBBox(geometry);

  return {
    id,
    datasetId: "fixture",
    countryCode: overrides.countryCode ?? "TR",
    level: overrides.level ?? 1,
    sourceAdminLevel: overrides.sourceAdminLevel ?? "ADM1",
    semanticType: overrides.semanticType ?? "province",
    name: overrides.name ?? id,
    neighborIds: [],
    geometry,
    center: computeGeometryCenter(geometry),
    bbox,
    properties: {
      name: overrides.name ?? id,
      territory: {
        adminLevel: overrides.sourceAdminLevel ?? "ADM1",
        sourceAdminLevel: overrides.sourceAdminLevel ?? "ADM1",
        semanticType: overrides.semanticType ?? "province",
        coverageStatus: "verified"
      }
    }
  };
}

function isCoordinate(value: unknown): value is LngLat {
  return Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number";
}

function rectangleWithSharedMidpoint(
  west: number,
  south: number,
  east: number,
  north: number,
  side: "left" | "right"
): LngLat[] {
  if (side === "left") {
    return [
      [west, south],
      [(west + east) / 2, south],
      [east, south],
      [east, (south + north) / 2],
      [east, north],
      [(west + east) / 2, north],
      [west, north],
      [west, (south + north) / 2],
      [west, south]
    ];
  }

  return [
    [west, south],
    [(west + east) / 2, south],
    [east, south],
    [east, (south + north) / 2],
    [east, north],
    [(west + east) / 2, north],
    [west, north],
    [west, (south + north) / 2],
    [west, south]
  ];
}

function simpleRectangle(west: number, south: number, east: number, north: number): LngLat[] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ];
}

function bowTieRing(): LngLat[] {
  return [
    [0, 0],
    [1, 1],
    [1, 0],
    [0, 1],
    [0, 0]
  ];
}

function wavySharedBoundary(
  x: number,
  yStart: number,
  yEnd: number,
  steps: number,
  amplitude: number
): LngLat[] {
  return Array.from({ length: steps + 1 }, (_, index): LngLat => {
    const ratio = index / steps;
    const y = yStart + (yEnd - yStart) * ratio;
    const offset = index === 0 || index === steps ? 0 : index % 2 === 0 ? -amplitude : amplitude;
    return [x + offset, y];
  });
}

function leftOfShared(shared: readonly LngLat[], west: number): LngLat[] {
  const south = shared[0]![1];
  const north = shared.at(-1)![1];

  return [[west, south], ...shared, [west, north], [west, south]];
}

function rightOfShared(shared: readonly LngLat[], east: number): LngLat[] {
  const south = shared[0]![1];
  const north = shared.at(-1)![1];

  return [shared[0]!, [east, south], [east, north], ...[...shared].reverse()];
}

function zoneGeometry(dataset: TerritoryDataset, zoneId: string): TerritoryGeometry {
  const zone = dataset.zones.find((candidate) => candidate.id === zoneId);
  expect(zone).toBeDefined();
  return zone!.geometry;
}

function geometriesByZoneId(dataset: TerritoryDataset): Record<string, TerritoryGeometry> {
  return Object.fromEntries(
    [...dataset.zones]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((zone) => [zone.id, zone.geometry])
  );
}

function expectGeometryRingsValid(dataset: TerritoryDataset): void {
  for (const zone of dataset.zones) {
    for (const ring of geometryRings(zone.geometry)) {
      expectRingValid(ring);
    }
  }
}

function expectRingValid(ring: LngLat[]): void {
  expect(ring.length).toBeGreaterThanOrEqual(4);
  expect(coordinateKey(ring[0]!)).toBe(coordinateKey(ring.at(-1)!));
  expect(Math.abs(ringArea(ring))).toBeGreaterThan(0);
  expect(hasRingSelfIntersection(ring)).toBe(false);
}

function expectSharedBoundarySynchronized(left: TerritoryGeometry, right: TerritoryGeometry): void {
  const shared = onlySharedChain(left, right);
  expect(shared.left).toEqual([...shared.right].reverse());
}

function onlySharedChain(
  left: TerritoryGeometry,
  right: TerritoryGeometry
): { left: string[]; right: string[] } {
  const sharedSegments = sharedSegmentKeys(left, right);
  const leftChains = sharedChains(left, sharedSegments);
  const rightChains = sharedChains(right, sharedSegments);

  expect(leftChains).toHaveLength(1);
  expect(rightChains).toHaveLength(1);

  return { left: leftChains[0]!, right: rightChains[0]! };
}

function sharedSegmentKeys(left: TerritoryGeometry, right: TerritoryGeometry): Set<string> {
  const leftSegments = new Set(geometrySegments(left));
  return new Set(geometrySegments(right).filter((segment) => leftSegments.has(segment)));
}

function geometrySegments(geometry: TerritoryGeometry): string[] {
  return geometryRings(geometry).flatMap((ring) => {
    const segments: string[] = [];

    for (let index = 0; index < ring.length - 1; index += 1) {
      segments.push(segmentKey(ring[index]!, ring[index + 1]!));
    }

    return segments;
  });
}

function sharedChains(
  geometry: TerritoryGeometry,
  sharedSegments: ReadonlySet<string>
): string[][] {
  const chains: string[][] = [];

  for (const ring of geometryRings(geometry)) {
    const keys = ring.map(coordinateKey);
    const segmentShared = keys
      .slice(0, -1)
      .map((key, index) => sharedSegments.has(segmentKeyFromKeys(key, keys[index + 1]!)));

    if (!segmentShared.some(Boolean)) {
      continue;
    }

    if (segmentShared.every(Boolean)) {
      chains.push(keys);
      continue;
    }

    for (let index = 0; index < segmentShared.length; index += 1) {
      const previous = segmentShared[(index - 1 + segmentShared.length) % segmentShared.length]!;

      if (!segmentShared[index] || previous) {
        continue;
      }

      const chain = [keys[index]!];
      let cursor = index;

      while (segmentShared[cursor]) {
        cursor = (cursor + 1) % segmentShared.length;
        chain.push(keys[cursor]!);
      }

      chains.push(chain);
    }
  }

  return chains;
}

function geometryContainsCoordinate(geometry: TerritoryGeometry, coordinate: LngLat): boolean {
  const key = coordinateKey(coordinate);
  return geometryRings(geometry).some((ring) => ring.some((point) => coordinateKey(point) === key));
}

function countDatasetVertices(dataset: TerritoryDataset): number {
  return dataset.zones.reduce((sum, zone) => sum + countGeometryVertices(zone.geometry), 0);
}

function countGeometryVertices(geometry: TerritoryGeometry): number {
  return geometryRings(geometry).reduce((sum, ring) => sum + ring.length, 0);
}

function legacySimplifyGeometry(geometry: TerritoryGeometry, tolerance: number): TerritoryGeometry {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: (geometry.coordinates as LngLat[][]).map((ring) =>
        legacySimplifyRing(ring, tolerance)
      )
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: (geometry.coordinates as LngLat[][][]).map((polygon) =>
      polygon.map((ring) => legacySimplifyRing(ring, tolerance))
    )
  };
}

function legacySimplifyRing(ring: readonly LngLat[], tolerance: number): LngLat[] {
  if (ring.length <= 4) {
    return [...ring];
  }

  const openRing = ring.slice(0, -1);
  const simplified = legacyRamerDouglasPeucker(openRing, tolerance);
  const closed = closeRing(simplified.length >= 3 ? simplified : openRing);

  return Math.abs(ringArea(closed)) > 0 ? closed : [...ring];
}

function legacyRamerDouglasPeucker(points: readonly LngLat[], tolerance: number): LngLat[] {
  if (points.length <= 2) {
    return [...points];
  }

  let maxDistance = 0;
  let splitIndex = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index]!, points[0]!, points.at(-1)!);

    if (distance > maxDistance) {
      splitIndex = index;
      maxDistance = distance;
    }
  }

  if (maxDistance <= tolerance) {
    return [points[0]!, points.at(-1)!];
  }

  return [
    ...legacyRamerDouglasPeucker(points.slice(0, splitIndex + 1), tolerance).slice(0, -1),
    ...legacyRamerDouglasPeucker(points.slice(splitIndex), tolerance)
  ];
}

function perpendicularDistance(point: LngLat, start: LngLat, end: LngLat): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];

  if (dx === 0 && dy === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }

  return (
    Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) /
    Math.hypot(dx, dy)
  );
}

function closeRing(ring: readonly LngLat[]): LngLat[] {
  const first = ring[0];
  const last = ring.at(-1);

  if (!first || !last || coordinateKey(first) === coordinateKey(last)) {
    return [...ring];
  }

  return [...ring, first];
}

function geometryRings(geometry: TerritoryGeometry): LngLat[][] {
  return geometry.type === "Polygon"
    ? (geometry.coordinates as LngLat[][])
    : (geometry.coordinates.flat(1) as LngLat[][]);
}

function geometryArea(geometry: TerritoryGeometry): number {
  return geometryRings(geometry).reduce((sum, ring, index) => {
    const area = Math.abs(ringArea(ring));
    return index === 0 ? sum + area : sum - area;
  }, 0);
}

function ringArea(ring: readonly LngLat[]): number {
  let area = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index]!;
    const next = ring[index + 1]!;
    area += current[0] * next[1] - next[0] * current[1];
  }

  return area / 2;
}

function segmentKey(left: LngLat, right: LngLat): string {
  return segmentKeyFromKeys(coordinateKey(left), coordinateKey(right));
}

function segmentKeyFromKeys(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function coordinateKey(coordinate: LngLat): string {
  return `${coordinate[0].toFixed(9)},${coordinate[1].toFixed(9)}`;
}
