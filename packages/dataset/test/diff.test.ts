import { describe, expect, it } from "vitest";
import {
  TERRITORY_MIGRATION_PLAN_SCHEMA_VERSION,
  createMigrationPlan,
  diffDatasets,
  diffIdentities,
  validateMigrationPlan
} from "../src/index.js";
import type { TerritoryDataset, TerritoryDiffCategory, TerritoryZone } from "../src/index.js";

describe("dataset diff and migration planning", () => {
  it("returns an empty change list for the same dataset with deterministic output", () => {
    const oldDataset = createDataset([
      squareZone({ id: "country", level: 0, west: 0, south: 0, east: 4, north: 4 }),
      squareZone({
        id: "country:adm1:a",
        level: 1,
        parentId: "country",
        west: 0,
        south: 0,
        east: 2,
        north: 2
      })
    ]);
    const report = diffDatasets(oldDataset, clone(oldDataset));
    const repeated = diffDatasets(oldDataset, clone(oldDataset));

    expect(report.changes).toEqual([]);
    expect(report.summary.countsByCategory.unchanged).toBe(2);
    expect(JSON.stringify(report)).toBe(JSON.stringify(repeated));
  });

  it("detects name-only changes and Turkish normalized-name identity matches", () => {
    const oldDataset = createDataset([
      squareZone({ id: "country", level: 0, west: 0, south: 0, east: 4, north: 4 }),
      squareZone({
        id: "old:uskudar",
        level: 1,
        name: "Üsküdar",
        parentId: "country",
        west: 0,
        south: 0,
        east: 1,
        north: 1
      }),
      squareZone({
        id: "same:fatih",
        level: 1,
        name: "Fatih",
        parentId: "country",
        west: 1,
        south: 0,
        east: 2,
        north: 1
      })
    ]);
    const newDataset = createDataset(
      [
        squareZone({ id: "country", level: 0, west: 0, south: 0, east: 4, north: 4 }),
        squareZone({
          id: "new:uskudar",
          level: 1,
          name: "Uskudar",
          parentId: "country",
          west: 0,
          south: 0,
          east: 1,
          north: 1
        }),
        squareZone({
          id: "same:fatih",
          level: 1,
          name: "Historic Fatih",
          parentId: "country",
          west: 1,
          south: 0,
          east: 2,
          north: 1
        })
      ],
      { datasetVersion: "2.0.0", geometryHash: "fixture-v2" }
    );
    const report = diffDatasets(oldDataset, newDataset);

    expect(changeCategories(report)).toContain("renamed");
    expect(report.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          oldId: "old:uskudar",
          newId: "new:uskudar",
          strategy: "parent-normalized-name"
        }),
        expect.objectContaining({
          oldId: "same:fatih",
          newId: "same:fatih",
          categories: expect.arrayContaining(["renamed"])
        })
      ])
    );
  });

  it("detects parent changes and ADM level metadata changes", () => {
    const oldDataset = createDataset([
      squareZone({ id: "root", level: 0, west: 0, south: 0, east: 4, north: 4 }),
      squareZone({
        id: "parent:a",
        level: 1,
        parentId: "root",
        west: 0,
        south: 0,
        east: 2,
        north: 2
      }),
      squareZone({
        id: "parent:b",
        level: 1,
        parentId: "root",
        west: 2,
        south: 0,
        east: 4,
        north: 2
      }),
      squareZone({
        id: "child",
        level: 2,
        parentId: "parent:a",
        west: 0,
        south: 0,
        east: 1,
        north: 1
      })
    ]);
    const newDataset = createDataset(
      [
        squareZone({ id: "root", level: 0, west: 0, south: 0, east: 4, north: 4 }),
        squareZone({
          id: "parent:a",
          level: 1,
          parentId: "root",
          west: 0,
          south: 0,
          east: 2,
          north: 2
        }),
        squareZone({
          id: "parent:b",
          level: 1,
          parentId: "root",
          west: 2,
          south: 0,
          east: 4,
          north: 2
        }),
        squareZone({
          id: "child",
          level: 3,
          parentId: "parent:b",
          west: 2,
          south: 0,
          east: 3,
          north: 1
        })
      ],
      { datasetVersion: "2.0.0", geometryHash: "fixture-v2" }
    );
    const report = diffDatasets(oldDataset, newDataset);

    expect(changeCategories(report)).toEqual(
      expect.arrayContaining(["reparented", "metadata-changed", "geometry-changed"])
    );
    expect(report.breakingChanges).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "ADM_LEVEL_CHANGED" })])
    );
  });

  it("separates small geometry corrections from major geometry changes", () => {
    const oldDataset = createDataset([
      squareZone({ id: "zone:small", level: 0, west: 0, south: 0, east: 1, north: 1 }),
      squareZone({ id: "zone:large", level: 0, west: 2, south: 0, east: 3, north: 1 })
    ]);
    const newDataset = createDataset(
      [
        squareZone({ id: "zone:small", level: 0, west: 0, south: 0, east: 1.002, north: 1 }),
        squareZone({ id: "zone:large", level: 0, west: 2, south: 0, east: 4.5, north: 1.5 })
      ],
      { datasetVersion: "2.0.0", geometryHash: "fixture-v2" }
    );
    const report = diffDatasets(oldDataset, newDataset);
    const geometryChanges = report.changes.filter(
      (change) => change.category === "geometry-changed"
    );

    expect(geometryChanges).toHaveLength(2);
    expect(geometryChanges.find((change) => change.oldId === "zone:small")?.requiresReview).toBe(
      false
    );
    expect(geometryChanges.find((change) => change.oldId === "zone:large")?.requiresReview).toBe(
      true
    );
  });

  it("marks split and merge candidates without automatic one-to-one mappings", () => {
    const splitOld = createDataset([
      squareZone({ id: "old:whole", level: 0, west: 0, south: 0, east: 2, north: 1 })
    ]);
    const splitNew = createDataset(
      [
        squareZone({ id: "new:left", level: 0, west: 0, south: 0, east: 1, north: 1 }),
        squareZone({ id: "new:right", level: 0, west: 1, south: 0, east: 2, north: 1 })
      ],
      { datasetVersion: "2.0.0", geometryHash: "fixture-v2" }
    );
    const splitReport = diffDatasets(splitOld, splitNew);
    const splitPlan = createMigrationPlan(splitOld, splitNew);

    expect(changeCategories(splitReport)).toContain("split-candidate");
    expect(splitPlan.mappings.some((mapping) => mapping.oldId === "old:whole")).toBe(false);
    expect(splitPlan.reviewItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: "split-candidate" })])
    );

    const mergeOld = createDataset([
      squareZone({ id: "old:left", level: 0, west: 0, south: 0, east: 1, north: 1 }),
      squareZone({ id: "old:right", level: 0, west: 1, south: 0, east: 2, north: 1 })
    ]);
    const mergeNew = createDataset(
      [squareZone({ id: "new:whole", level: 0, west: 0, south: 0, east: 2, north: 1 })],
      { datasetVersion: "2.0.0", geometryHash: "fixture-v2" }
    );
    const mergeReport = diffDatasets(mergeOld, mergeNew);
    const mergePlan = createMigrationPlan(mergeOld, mergeNew);

    expect(changeCategories(mergeReport)).toContain("merge-candidate");
    expect(mergePlan.mappings.some((mapping) => mapping.newId === "new:whole")).toBe(false);
  });

  it("detects duplicate stable IDs, source changes, and license changes", () => {
    const oldDataset = createDataset(
      [squareZone({ id: "zone:a", level: 0, west: 0, south: 0, east: 1, north: 1 })],
      { license: "Apache-2.0", sourceProvider: "provider-a" }
    );
    const newDataset = createDataset(
      [
        squareZone({ id: "zone:a", level: 0, west: 0, south: 0, east: 1, north: 1 }),
        squareZone({ id: "zone:a", level: 0, west: 1, south: 0, east: 2, north: 1 })
      ],
      {
        datasetVersion: "2.0.0",
        geometryHash: "fixture-v2",
        license: "ODbL-1.0",
        sourceProvider: "provider-b"
      }
    );
    const report = diffDatasets(oldDataset, newDataset);

    expect(changeCategories(report)).toEqual(
      expect.arrayContaining(["stable-id-conflict", "license-changed", "source-changed"])
    );
  });

  it("keeps ambiguous name matches out of automatic migration mappings", () => {
    const oldDataset = createDataset([
      squareZone({ id: "root", level: 0, west: 0, south: 0, east: 3, north: 3 }),
      squareZone({
        id: "old:koy",
        level: 1,
        name: "Köy",
        parentId: "root",
        west: 0,
        south: 0,
        east: 1,
        north: 1
      })
    ]);
    const newDataset = createDataset(
      [
        squareZone({ id: "root", level: 0, west: 0, south: 0, east: 3, north: 3 }),
        squareZone({
          id: "new:koy-1",
          level: 1,
          name: "Koy",
          parentId: "root",
          west: 0,
          south: 0,
          east: 1,
          north: 1
        }),
        squareZone({
          id: "new:koy-2",
          level: 1,
          name: "Köy",
          parentId: "root",
          west: 1,
          south: 0,
          east: 2,
          north: 1
        })
      ],
      { datasetVersion: "2.0.0", geometryHash: "fixture-v2" }
    );
    const report = diffDatasets(oldDataset, newDataset);
    const identityReport = diffIdentities(oldDataset, newDataset);
    const plan = createMigrationPlan(oldDataset, newDataset);
    const validation = validateMigrationPlan(plan);

    expect(changeCategories(report)).toContain("ambiguous-match");
    expect(identityReport.changes.some((change) => change.category === "geometry-changed")).toBe(
      false
    );
    expect(plan.mappings.some((mapping) => mapping.oldId === "old:koy")).toBe(false);
    expect(validation).toMatchObject({ ok: true });
    expect(plan.schemaVersion).toBe(TERRITORY_MIGRATION_PLAN_SCHEMA_VERSION);
  });

  it("uses spatial candidate filtering for large geometry-only fixtures", () => {
    const size = 25;
    const oldDataset = createDataset(createGridZones(size, "old"));
    const newDataset = createDataset(createGridZones(size, "new"), {
      datasetVersion: "2.0.0",
      geometryHash: "fixture-v2"
    });
    const report = diffDatasets(oldDataset, newDataset);
    const bruteForcePairs = size ** 4;

    expect(report.matches).toHaveLength(size * size);
    expect(report.performance.candidatePairCount).toBeLessThan(bruteForcePairs / 2);
    expect(report.performance.spatialCandidateCount).toBeLessThan(bruteForcePairs / 20);
    expect(report.performance.spatialQueryCount).toBe(size * size * 2);
  });
});

function changeCategories(report: ReturnType<typeof diffDatasets>): TerritoryDiffCategory[] {
  return [...new Set(report.changes.map((change) => change.category))].sort();
}

function createDataset(
  zones: TerritoryZone[],
  manifest: Partial<TerritoryDataset["manifest"]> = {}
): TerritoryDataset {
  return {
    manifest: {
      datasetId: "fixture",
      datasetVersion: "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-01-01",
      geometryHash: "fixture-v1",
      license: "Apache-2.0",
      sourceProvider: "fixture",
      ...manifest
    },
    zones: zones.map((zone) => ({
      ...zone,
      datasetId: "fixture"
    }))
  };
}

function squareZone(input: {
  id: string;
  level: number;
  west: number;
  south: number;
  east: number;
  north: number;
  name?: string;
  parentId?: string;
  properties?: Record<string, unknown>;
}): TerritoryZone {
  return {
    id: input.id,
    datasetId: "fixture",
    level: input.level,
    ...(input.name ? { name: input.name } : {}),
    ...(input.parentId ? { parentId: input.parentId } : {}),
    neighborIds: [],
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [input.west, input.south],
          [input.east, input.south],
          [input.east, input.north],
          [input.west, input.north],
          [input.west, input.south]
        ]
      ]
    },
    center: [(input.west + input.east) / 2, (input.south + input.north) / 2],
    bbox: [input.west, input.south, input.east, input.north],
    properties: input.properties ?? {}
  };
}

function createGridZones(size: number, prefix: string): TerritoryZone[] {
  const zones: TerritoryZone[] = [];

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      zones.push(
        squareZone({
          id: `${prefix}:${row}:${column}`,
          level: 0,
          west: column,
          south: row,
          east: column + 1,
          north: row + 1
        })
      );
    }
  }

  return zones;
}

function clone<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}
