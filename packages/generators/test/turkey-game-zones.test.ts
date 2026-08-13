import fc from "fast-check";
import { computeGeometryBBox, computeGeometryCenter } from "@territory-kit/dataset";
import { validateTurkeyV2Dataset } from "@territory-kit/dataset/turkey-v2";
import type { LngLat, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
  buildTurkeyGameZones,
  buildTurkeyGameZonesWithAdjacency,
  createTurkeyGameZoneDataset,
  resolveTurkeyGameZoneConfiguration
} from "../src/turkey-adm3.js";

describe("Turkey V2 game-zone generator", () => {
  it("resolves deterministic profile configurations", () => {
    const district = createDistrictFixture("urban-configuration", rectangle(29, 41, 29.08, 41.06));
    const auto = resolveTurkeyGameZoneConfiguration({
      district,
      provinceCode: "34",
      districtCode: "001",
      profile: "auto",
      populationDensityPerKm2: 4_000,
      seed: "kaprota-v2"
    });
    const invalid = resolveTurkeyGameZoneConfiguration({
      district,
      provinceCode: "34",
      districtCode: "001",
      profile: "custom",
      targetAreaKm2: 1,
      minAreaKm2: 2,
      maxAreaKm2: 3,
      seed: ""
    });

    expect(auto.ok).toBe(true);
    expect(auto.configuration?.selectedProfile).toBe("urban");
    expect(auto.configuration?.profileDecision?.reasons).toContain("density>=3000");
    expect(invalid.ok).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toEqual([
      "EMPTY_SEED",
      "INVALID_AREA_ORDERING"
    ]);
  });

  it("produces different urban and rural game-zone densities", () => {
    const district = createDistrictFixture("profile-density", rectangle(32, 39, 32.45, 39.35));
    const urban = buildTurkeyGameZones({
      district,
      provinceCode: "06",
      districtCode: "002",
      profile: "urban",
      seed: "kaprota-v2"
    });
    const rural = buildTurkeyGameZones({
      district,
      provinceCode: "06",
      districtCode: "002",
      profile: "rural",
      seed: "kaprota-v2"
    });

    expect(urban.zones.length).toBeGreaterThan(rural.zones.length);
    expect(urban.quality.finalCoveragePercent).toBeGreaterThanOrEqual(99.99);
    expect(rural.quality.finalCoveragePercent).toBeGreaterThanOrEqual(99.99);
    expect(urban.quality.overlapCount).toBe(0);
    expect(rural.quality.parentContainmentErrorCount).toBe(0);
  });

  it("keeps stable IDs and hashes deterministic across equivalent ring ordering", () => {
    const coordinates = rectangleRing(29, 41, 29.12, 41.08);
    const forward = createDistrictFixture("ring-forward", {
      type: "Polygon",
      coordinates: [coordinates]
    });
    const reversed = createDistrictFixture("ring-forward", {
      type: "Polygon",
      coordinates: [[...coordinates].reverse()]
    });
    const first = buildTurkeyGameZones({
      district: forward,
      provinceCode: "34",
      districtCode: "003",
      profile: "suburban",
      seed: "kaprota-v2"
    });
    const second = buildTurkeyGameZones({
      district: reversed,
      provinceCode: "34",
      districtCode: "003",
      profile: "suburban",
      seed: "kaprota-v2"
    });

    expect(first.deterministicHash).toBe(second.deterministicHash);
    expect(first.zones.map((zone) => zone.id)).toEqual(second.zones.map((zone) => zone.id));
  });

  it("preserves holes and supports MultiPolygon island districts", () => {
    const district = createDistrictFixture("hole-island", {
      type: "MultiPolygon",
      coordinates: [
        [rectangleRing(27, 38, 27.25, 38.2), rectangleRing(27.08, 38.06, 27.13, 38.11)],
        [rectangleRing(27.35, 38.05, 27.4, 38.1)]
      ]
    });
    const result = buildTurkeyGameZones({
      district,
      provinceCode: "35",
      districtCode: "004",
      profile: "suburban",
      seed: "kaprota-v2",
      minFragmentAreaKm2: 0.01
    });

    expect(result.quality.ok).toBe(true);
    expect(result.quality.finalCoveragePercent).toBeGreaterThanOrEqual(99.99);
    expect(
      result.quality.multiPolygonZoneCount + result.quality.disconnectedZoneCount
    ).toBeGreaterThanOrEqual(0);
    expect(result.quality.parentContainmentErrorCount).toBe(0);
  });

  it("builds TR V2-compatible metadata and symmetric adjacency", async () => {
    const district = createDistrictFixture("005", rectangle(30, 40, 30.18, 40.12));
    const result = await buildTurkeyGameZonesWithAdjacency({
      district,
      provinceCode: "34",
      districtCode: "005",
      profile: "urban",
      seed: "kaprota-v2",
      targetZoneCount: 8
    });
    const dataset = createTurkeyGameZoneDataset({
      district,
      zones: result.zones,
      datasetId: "test-tr-game-zones",
      includeParent: true
    });
    const validation = validateTurkeyV2Dataset(dataset);
    const ids = new Set(result.zones.map((zone) => zone.id));

    expect(result.quality.ok).toBe(true);
    expect(validation.ok).toBe(true);
    expect(result.zones.every((zone) => zone.semanticType === "generated-zone")).toBe(true);
    expect(
      result.zones.every((zone) => {
        const territory = zone.properties.territory as Record<string, unknown>;
        return (
          territory.sourceClass === "generated" &&
          territory.official === false &&
          territory.generated === true &&
          territory.algorithmVersion === TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION
        );
      })
    ).toBe(true);

    for (const zone of result.zones) {
      expect(zone.neighborIds).toEqual([...zone.neighborIds].sort());
      expect(zone.neighborIds).not.toContain(zone.id);
      for (const neighborId of zone.neighborIds) {
        expect(ids.has(neighborId)).toBe(true);
        expect(
          result.zones.find((candidate) => candidate.id === neighborId)?.neighborIds
        ).toContain(zone.id);
      }
    }
  });

  it("keeps coverage, overlap, zone count, and ID uniqueness invariants for random rectangles", () => {
    fc.assert(
      fc.property(
        fc.record({
          west: fc.double({ min: 26, max: 42, noNaN: true, noDefaultInfinity: true }),
          south: fc.double({ min: 36, max: 41, noNaN: true, noDefaultInfinity: true }),
          width: fc.double({ min: 0.03, max: 0.18, noNaN: true, noDefaultInfinity: true }),
          height: fc.double({ min: 0.03, max: 0.18, noNaN: true, noDefaultInfinity: true })
        }),
        ({ west, south, width, height }) => {
          const district = createDistrictFixture(
            `property-${west.toFixed(3)}-${south.toFixed(3)}`,
            rectangle(west, south, west + width, south + height)
          );
          const result = buildTurkeyGameZones({
            district,
            provinceCode: "01",
            districtCode: "006",
            profile: "custom",
            seed: "kaprota-v2",
            targetAreaKm2: 4,
            minAreaKm2: 0.02,
            maxAreaKm2: 16,
            maxZonesPerDistrict: 128,
            minFragmentAreaKm2: 0.005
          });
          const ids = new Set(result.zones.map((zone) => zone.id));

          expect(result.coverage.finalCoveragePercent).toBeGreaterThanOrEqual(99.99);
          expect(result.quality.overlapCount).toBe(0);
          expect(result.quality.parentContainmentErrorCount).toBe(0);
          expect(result.zones.length).toBeLessThanOrEqual(result.configuration.maxZonesPerDistrict);
          expect(ids.size).toBe(result.zones.length);
        }
      ),
      { numRuns: 20 }
    );
  });
});

function createDistrictFixture(idSuffix: string, geometry: TerritoryGeometry): TerritoryZone {
  return {
    id: `tr:adm2:${idSuffix}`,
    datasetId: "test-tr-adm2",
    countryCode: "TR",
    level: 2,
    sourceAdminLevel: "ADM2",
    semanticType: "district",
    name: idSuffix,
    neighborIds: [],
    geometry,
    center: computeGeometryCenter(geometry),
    bbox: computeGeometryBBox(geometry),
    properties: {
      territory: {
        adminLevel: "ADM2",
        sourceAdminLevel: "ADM2",
        semanticType: "district",
        countryCode: "TR",
        provinceCode: "34",
        districtCode: idSuffix
      }
    }
  };
}

function rectangle(west: number, south: number, east: number, north: number): TerritoryGeometry {
  return {
    type: "Polygon",
    coordinates: [rectangleRing(west, south, east, north)]
  };
}

function rectangleRing(west: number, south: number, east: number, north: number): LngLat[] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ];
}
