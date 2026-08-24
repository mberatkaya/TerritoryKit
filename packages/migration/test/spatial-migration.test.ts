import { describe, expect, it } from "vitest";
import { createSquareZone } from "@territory-kit/shared-testkit";
import type { TerritoryDataset, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import {
  aggregateSpatialMigrationScores,
  createSpatialMigrationPlan,
  mapSourceSpatialRecord
} from "../src/index.js";

describe("@territory-kit/migration spatial migration", () => {
  it("maps legacy zones by centroid without requiring overlap geometry", () => {
    const dataset = createTargetDataset();
    const mapping = mapSourceSpatialRecord(
      {
        sourceSpatialId: "h3-center-a",
        center: [2, 2],
        score: 10,
        ownerId: "user-1"
      },
      {
        sourceSystem: "rushandclaim-h3",
        targetDataset: dataset,
        targetLevel: 3,
        strategy: "centroid",
        generatedAt: "2026-08-24T00:00:00.000Z"
      }
    );

    expect(mapping).toMatchObject({
      sourceSpatialId: "h3-center-a",
      targetTerritoryId: "target:a",
      confidence: "HIGH",
      score: 10,
      ownerId: "user-1"
    });
  });

  it("maps legacy polygons to the target territory with maximum overlap", () => {
    const dataset = createTargetDataset();
    const mapping = mapSourceSpatialRecord(
      {
        sourceSpatialId: "h3-overlap-60-40",
        geometry: rectangle(0, 0, 10, 10)
      },
      {
        sourceSystem: "rushandclaim-h3",
        targetDataset: dataset,
        targetLevel: 3,
        strategy: "max-overlap",
        generatedAt: "2026-08-24T00:00:00.000Z",
        ambiguityDeltaRatio: 0.05
      }
    );

    expect(mapping.targetTerritoryId).toBe("target:a");
    expect(mapping.confidence).toBe("AMBIGUOUS");
    expect(mapping.targets.map((target) => target.targetTerritoryId)).toEqual([
      "target:a",
      "target:b"
    ]);
    expect(mapping.targets[0]?.overlapRatio).toBeCloseTo(0.6, 1);
    expect(mapping.targets[1]?.overlapRatio).toBeCloseTo(0.4, 1);
  });

  it("reports no-match and ambiguous mappings deterministically", () => {
    const dataset = createTargetDataset();
    const plan = createSpatialMigrationPlan(
      [
        {
          sourceSpatialId: "h3-split-even",
          geometry: rectangle(0, 0, 12, 10)
        },
        {
          sourceSpatialId: "h3-no-match",
          geometry: rectangle(30, 30, 31, 31)
        }
      ],
      {
        sourceSystem: "rushandclaim-h3",
        sourceVersion: "h3-resolution-8",
        targetDataset: dataset,
        targetLevel: 3,
        strategy: "max-overlap",
        generatedAt: "2026-08-24T00:00:00.000Z",
        toolVersion: "test-tool@1"
      }
    );

    expect(plan.manifest).toMatchObject({
      schemaVersion: "territorykit-spatial-migration@1",
      sourceSystem: "rushandclaim-h3",
      sourceVersion: "h3-resolution-8",
      targetDatasetId: "migration-target",
      targetDatasetVersion: "2.0.0",
      mappingStrategy: "max-overlap",
      generatedAt: "2026-08-24T00:00:00.000Z",
      dryRun: true,
      summary: {
        sourceCount: 2,
        mappedCount: 1,
        ambiguousCount: 1,
        noMatchCount: 1,
        multiTargetCount: 1
      }
    });
    expect(plan.mappings[0]?.confidence).toBe("AMBIGUOUS");
    expect(plan.mappings[1]).toMatchObject({
      sourceSpatialId: "h3-no-match",
      targetTerritoryId: null,
      confidence: "NO_MATCH"
    });
  });

  it("reports ownership conflicts and leaves score aggregation as a generic helper", () => {
    const dataset = createTargetDataset();
    const plan = createSpatialMigrationPlan(
      [
        {
          sourceSpatialId: "h3-owner-a",
          geometry: rectangle(0, 0, 4, 4),
          score: 10,
          ownerId: "user-1"
        },
        {
          sourceSpatialId: "h3-owner-b",
          geometry: rectangle(1, 1, 5, 5),
          score: 20,
          ownerId: "user-2"
        }
      ],
      {
        sourceSystem: "rushandclaim-h3",
        targetDataset: dataset,
        targetLevel: 3,
        strategy: "max-overlap",
        generatedAt: "2026-08-24T00:00:00.000Z"
      }
    );

    expect(plan.conflicts).toEqual([
      {
        targetTerritoryId: "target:a",
        sourceSpatialIds: ["h3-owner-a", "h3-owner-b"],
        ownerIds: ["user-1", "user-2"]
      }
    ]);
    expect(aggregateSpatialMigrationScores(plan.mappings).get("target:a")).toBe(30);
  });
});

function createTargetDataset(): TerritoryDataset {
  const zones: TerritoryZone[] = [
    createSquareZone({
      id: "target:a",
      datasetId: "migration-target",
      level: 3,
      west: 0,
      south: 0,
      east: 6,
      north: 10,
      neighborIds: ["target:b"]
    }),
    createSquareZone({
      id: "target:b",
      datasetId: "migration-target",
      level: 3,
      west: 6,
      south: 0,
      east: 12,
      north: 10,
      neighborIds: ["target:a"]
    })
  ];

  return {
    manifest: {
      datasetId: "migration-target",
      datasetVersion: "2.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-08-24",
      geometryHash: "migration-target-v1",
      adminLevels: ["ADM3"],
      license: "Apache-2.0"
    },
    zones
  };
}

function rectangle(west: number, south: number, east: number, north: number): TerritoryGeometry {
  return {
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
}
