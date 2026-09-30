import { computeGeometryBBox, computeGeometryCenter } from "@territory-kit/dataset";
import { validateTurkeyV2Dataset } from "@territory-kit/dataset/turkey-v2";
import type { LngLat, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { describe, expect, it } from "vitest";
import {
  TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
  buildTurkeySmartFallback,
  buildTurkeySmartFallbackWithAdjacency,
  createTurkeySmartFallbackDataset,
  normalizeTurkeySmartFallbackBarriers,
  resolveTurkeySmartFallbackConfiguration
} from "../src/turkey-adm3.js";
import {
  assessTurkeySmartPartitionAdequacy,
  inspectTurkeySmartBoundaryAlignment,
  isTurkeyResidualSeamMergeEligible,
  normalizeTurkeySmartFallbackCoveragePercent,
  passesTurkeySmartGridLikeness
} from "../src/turkey-smart-fallback.js";

describe("unsupported seam diagnostics", () => {
  it("keeps a source-verified inland lake residual unsplit and estimated", () => {
    const parent = districtZone("lake-residual", rectangle(29, 40, 29.2, 40.2));
    const water: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            "@id": "osm:relation:lake",
            natural: "water",
            water: "lake",
            source: "openstreetmap"
          },
          geometry: rectangle(29.005, 40.005, 29.195, 40.195)
        }
      ]
    };
    const input = {
      parent,
      provinceCode: "01",
      districtCode: "lake-residual",
      profile: "rural" as const,
      water,
      options: { organic: true, seed: "lake-residual-test" }
    };
    const first = buildTurkeySmartFallback(input);
    const second = buildTurkeySmartFallback(input);

    expect(first.quality.ok).toBe(true);
    expect(first.quality.confidenceTier).toBe("low");
    expect(first.quality.waterDominantResidual?.sourceId).toBe("osm:relation:lake");
    expect(first.quality.waterDominantResidual?.waterOverlapPercent).toBeGreaterThan(85);
    expect(first.zones).toHaveLength(1);
    expect(first.zones[0]?.properties.territory).toMatchObject({
      boundarySourceClass: "smart-derived",
      administrative: false,
      authoritative: false,
      confidence: "low"
    });
    expect(second.deterministicHash).toBe(first.deterministicHash);
  });

  it("keeps a single residual connector distinct from a rotated ruler lattice", () => {
    expect(
      passesTurkeySmartGridLikeness(
        {
          axisAlignedInternalBoundaryRatio: 0,
          longUnsupportedStraightBoundaryRatio: 0.7,
          unsupportedStraightChainCountAbove500m: 12
        },
        500,
        16
      )
    ).toBe(false);
    expect(
      passesTurkeySmartGridLikeness(
        {
          axisAlignedInternalBoundaryRatio: 0,
          longUnsupportedStraightBoundaryRatio: 0.08,
          unsupportedStraightChainCountAbove500m: 1
        },
        500,
        16
      )
    ).toBe(true);
    expect(
      passesTurkeySmartGridLikeness(
        {
          axisAlignedInternalBoundaryRatio: 0.02,
          longUnsupportedStraightBoundaryRatio: 0.95,
          unsupportedStraightChainCountAbove500m: 20
        },
        180,
        45,
        66
      )
    ).toBe(true);
    expect(
      passesTurkeySmartGridLikeness(
        {
          axisAlignedInternalBoundaryRatio: 0.16,
          longUnsupportedStraightBoundaryRatio: 0.95,
          unsupportedStraightChainCountAbove500m: 20
        },
        180,
        45,
        66
      )
    ).toBe(false);
    const nonAxisRulers = {
      axisAlignedInternalBoundaryRatio: 0.02,
      longUnsupportedStraightBoundaryRatio: 0.82,
      unsupportedStraightChainCountAbove500m: 30
    };
    expect(
      passesTurkeySmartGridLikeness(
        { ...nonAxisRulers, dominantTwoUnsupportedDirectionRatio: 0.61 },
        153,
        20
      )
    ).toBe(false);
    expect(
      passesTurkeySmartGridLikeness(
        { ...nonAxisRulers, dominantTwoUnsupportedDirectionRatio: 0.47 },
        153,
        20
      )
    ).toBe(true);
  });
  it("locates the actual straight chain and its owning zone", () => {
    const parent = districtZone("seam-parent", rectangle(0, 0, 0.1, 0.1));
    const configuration = resolveTurkeySmartFallbackConfiguration({
      parent,
      provinceCode: "01",
      districtCode: "seam-parent",
      profile: "auto"
    }).configuration;
    const west = districtZone("seam-west", rectangle(0, 0, 0.05, 0.1));
    const east = districtZone("seam-east", rectangle(0.05, 0, 0.1, 0.1));
    const alignment = inspectTurkeySmartBoundaryAlignment({
      zones: [west, east],
      parentGeometry: [[rectangleRing(0, 0, 0.1, 0.1)]],
      barriers: [],
      configuration
    });
    expect(alignment.longestUnsupportedStraightChainMeters).toBeGreaterThan(10_000);
    expect(alignment.longestUnsupportedStraightChain?.ownerZoneId).toBe(west.id);
    expect(alignment.longestUnsupportedStraightChain?.start[0]).toBe(0.05);
    expect(alignment.longestUnsupportedStraightChain?.end[0]).toBe(0.05);
  });

  it("can remove a weak residual chord without erasing a strong barrier or oversized zone", () => {
    const weakChord = {
      lengthMeters: 3_100,
      supportedMeters: 70,
      protectedMeters: 0,
      residualInvolved: true,
      combinedAreaKm2: 16,
      maxAreaKm2: 76
    };
    expect(isTurkeyResidualSeamMergeEligible(weakChord)).toBe(true);
    expect(isTurkeyResidualSeamMergeEligible({ ...weakChord, protectedMeters: 10 })).toBe(false);
    expect(isTurkeyResidualSeamMergeEligible({ ...weakChord, supportedMeters: 200 })).toBe(false);
    expect(isTurkeyResidualSeamMergeEligible({ ...weakChord, combinedAreaKm2: 80 })).toBe(false);
  });
});

describe("gameplay partition adequacy", () => {
  it("rejects a giant rural zone padded with tiny enclaves", () => {
    const result = assessTurkeySmartPartitionAdequacy({
      parentAreaKm2: 1_000,
      territoryAreasKm2: [900, 25, 25, 25, 25],
      localitySeedCount: 40,
      barrierCount: 120
    });
    expect(result.minimumUsefulTerritoryCount).toBe(5);
    expect(result.largestTerritoryAreaShare).toBe(0.9);
    expect(result.effectivePartitionCount).toBeLessThan(1.3);
    expect(result.adequate).toBe(false);
  });

  it("accepts a useful rural partition while allowing a tiny island as one zone", () => {
    expect(
      assessTurkeySmartPartitionAdequacy({
        parentAreaKm2: 800,
        territoryAreasKm2: [400, 150, 100, 80, 70],
        localitySeedCount: 30,
        barrierCount: 80
      }).adequate
    ).toBe(true);
    expect(
      assessTurkeySmartPartitionAdequacy({
        parentAreaKm2: 2,
        territoryAreasKm2: [2],
        localitySeedCount: 1,
        barrierCount: 0
      }).adequate
    ).toBe(true);
  });

  it("rejects a dominant zone in a large district with many localities", () => {
    const result = assessTurkeySmartPartitionAdequacy({
      parentAreaKm2: 900,
      territoryAreasKm2: [560, 85, 75, 65, 55, 40, 20],
      localitySeedCount: 80,
      barrierCount: 100
    });
    expect(result.minimumUsefulTerritoryCount).toBe(5);
    expect(result.largestTerritoryAreaShare).toBeGreaterThan(0.6);
    expect(result.adequate).toBe(false);
  });
});

describe("Turkey ADM3 smart fallback boundary engine", () => {
  it("normalizes provider-neutral barriers with road hierarchy weighting", () => {
    const parent = districtZone("barrier-normalization", rectangle(0, 0, 1, 1));
    const barriers = normalizeTurkeySmartFallbackBarriers({
      parent,
      provinceCode: "01",
      districtCode: "barrier-normalization",
      profile: "custom",
      roads: lineCollection([
        lineFeature(
          "primary",
          [
            [0.25, 0],
            [0.25, 1]
          ],
          { highway: "primary", source: "openstreetmap" }
        ),
        lineFeature(
          "residential",
          [
            [0.5, 0],
            [0.5, 1]
          ],
          { highway: "residential" }
        ),
        lineFeature(
          "service",
          [
            [0.75, 0],
            [0.75, 1]
          ],
          { highway: "service" }
        )
      ]),
      railways: lineCollection([
        lineFeature(
          "rail",
          [
            [0, 0.6],
            [1, 0.6]
          ],
          { railway: "rail" }
        )
      ]),
      water: lineCollection([
        lineFeature(
          "river",
          [
            [0, 0.4],
            [1, 0.4]
          ],
          { waterway: "river" }
        )
      ])
    });

    expect(barriers.map((barrier) => barrier.sourceNativeId)).toEqual([
      "river",
      "primary",
      "rail",
      "residential"
    ]);
    expect(barriers.find((barrier) => barrier.sourceNativeId === "primary")).toMatchObject({
      barrierClass: "road",
      strengthClass: "strong",
      strength: 0.9
    });
    expect(barriers.find((barrier) => barrier.sourceNativeId === "residential")).toMatchObject({
      barrierClass: "road",
      strengthClass: "weak",
      strength: 0.15
    });
    expect(barriers.some((barrier) => barrier.sourceNativeId === "service")).toBe(false);
  });

  it("merges connected same-name OSM way fragments before scoring alignment", () => {
    const parent = districtZone("barrier-merge", rectangle(0, 0, 1, 1));
    const barriers = normalizeTurkeySmartFallbackBarriers({
      parent,
      provinceCode: "01",
      districtCode: "barrier-merge",
      profile: "custom",
      roads: lineCollection([
        lineFeature(
          "segment-a",
          [
            [0.5, 0],
            [0.5, 0.5]
          ],
          { highway: "primary", name: "Millet Caddesi", source: "openstreetmap" }
        ),
        lineFeature(
          "segment-b",
          [
            [0.5, 0.5],
            [0.5, 1]
          ],
          { highway: "primary", name: "Millet Caddesi", source: "openstreetmap" }
        )
      ])
    });

    expect(barriers).toHaveLength(1);
    expect(barriers[0]).toMatchObject({
      sourceNativeId: expect.stringMatching(/^merged:2:/),
      barrierClass: "road",
      strengthClass: "strong",
      coordinates: [
        [0.5, 0],
        [0.5, 0.5],
        [0.5, 1]
      ]
    });
  });

  it("rejects Turkey-shaped latitude-longitude parent geometries", () => {
    const parent = districtZone("swapped-coordinate-order", rectangle(40, 28, 41, 29));
    const result = buildTurkeySmartFallback({
      parent,
      provinceCode: "01",
      districtCode: "swapped-coordinate-order",
      profile: "custom",
      roads: lineCollection([
        lineFeature(
          "primary",
          [
            [40.5, 28],
            [40.5, 29]
          ],
          { highway: "primary", source: "openstreetmap" }
        )
      ]),
      options: twoZoneOptions()
    });

    expect(result.quality.ok).toBe(false);
    expect(result.quality.acceptanceStatus).toBe("HARD_REJECT");
    expect(result.status).toBe("rejected");
    expect(result.zones).toHaveLength(0);
    expect(result.reasonCodes).toContain("SMART_FALLBACK_COORDINATE_ORDER_INVALID");
  });

  it("does not infer dense-urban profile for large districts from seed count alone", () => {
    const parent = districtZone("large-rural-seeds", rectangle(36, 39, 36.25, 39.25));
    const seeds = Array.from({ length: 40 }, (_, index) => ({
      name: `Seed ${index + 1}`,
      coordinate: [36.02 + (index % 8) * 0.025, 39.02 + Math.floor(index / 8) * 0.04] as LngLat
    }));
    const resolution = resolveTurkeySmartFallbackConfiguration({
      parent,
      provinceCode: "01",
      districtCode: "large-rural-seeds",
      profile: "auto",
      localitySeeds: seeds,
      roads: lineCollection([
        lineFeature(
          "primary",
          [
            [36, 39.125],
            [36.25, 39.125]
          ],
          { highway: "primary", source: "openstreetmap" }
        )
      ])
    });

    expect(resolution.configuration.selectedProfile).toBe("rural");
    expect(resolution.configuration.targetTerritoryCount).toBeLessThan(100);
  });

  it("ignores ADM2 outer-edge barriers and reports smart input diagnostics", () => {
    const parent = districtZone("parent-edge-diagnostics", rectangle(0, 0, 1, 1));
    const result = buildTurkeySmartFallback({
      parent,
      provinceCode: "01",
      districtCode: "parent-edge-diagnostics",
      profile: "custom",
      roads: lineCollection([
        lineFeature(
          "outer-edge",
          [
            [0, 0],
            [1, 0]
          ],
          { highway: "primary", source: "openstreetmap" }
        ),
        lineFeature(
          "internal",
          [
            [0.5, 0],
            [0.5, 1]
          ],
          { highway: "primary", source: "openstreetmap" }
        )
      ]),
      options: twoZoneOptions()
    });

    expect(result.quality.ok).toBe(true);
    expect(result.quality.acceptanceStatus).toMatch(/^USABLE_(HIGH|MEDIUM)_CONFIDENCE$/);
    expect(result.quality.inputDiagnostics).toMatchObject({
      roadsRaw: 2,
      roadsNormalized: 1,
      majorRoadsRaw: 2,
      majorRoadsNormalized: 1,
      parentEdgeBarrierCount: 1,
      internalBarrierCount: 1
    });
    expect(result.quality.meanBarrierAlignment).toBe(1);
    expect(result.quality.axisAlignedInternalBoundaryRatio).toBe(0);
    expect(result.reasonCodes).toContain("SMART_FALLBACK_BARRIER_IGNORED");
  });

  it("generates TR V2-compatible derived territories on an urban road grid", async () => {
    const parent = districtZone("smart-grid", rectangle(0, 0, 1, 1));
    const result = await buildTurkeySmartFallbackWithAdjacency({
      parent,
      provinceCode: "01",
      districtCode: "smart-grid",
      profile: "custom",
      roads: lineCollection([
        lineFeature(
          "primary-v",
          [
            [0.5, 0],
            [0.5, 1]
          ],
          { highway: "primary", source: "openstreetmap" }
        ),
        lineFeature(
          "secondary-h",
          [
            [0, 0.5],
            [1, 0.5]
          ],
          { highway: "secondary", source: "openstreetmap" }
        )
      ]),
      localitySeeds: [
        { name: "Southwest", coordinate: [0.25, 0.25] },
        { name: "Southeast", coordinate: [0.75, 0.25] },
        { name: "Northwest", coordinate: [0.25, 0.75] },
        { name: "Northeast", coordinate: [0.75, 0.75] }
      ],
      options: permissiveFourZoneOptions()
    });
    const dataset = createTurkeySmartFallbackDataset({
      parent,
      zones: result.zones,
      datasetId: "test-tr-smart-grid",
      includeParent: true
    });
    const validation = validateTurkeyV2Dataset(dataset);

    expect(result.quality.ok).toBe(true);
    expect(result.zones).toHaveLength(4);
    expect(result.quality.coveragePercent).toBe(100);
    expect(result.quality.meanBarrierAlignment).toBe(1);
    expect(result.quality.meanRealBarrierRatio).toBe(1);
    expect(result.quality.meanSyntheticBoundaryRatio).toBe(0);
    expect(result.quality.coverageComputation).toMatchObject({
      mode: "union",
      unionFailed: false,
      rawCoveragePercent: 100,
      rawOverlapAreaKm2: 0,
      rawOutsideSpillKm2: 0,
      rawUncoveredInsideParentKm2: 0
    });
    expect(result.quality.coverageComputation.topologyToleranceKm2).toBeGreaterThan(0);
    expect(result.quality.inputDiagnostics).toMatchObject({
      roadsRaw: 2,
      roadsNormalized: 2,
      seedsRaw: 4,
      seedsNormalized: 4
    });
    expect(result.adjacency?.edges).toHaveLength(4);
    expect(validation.ok).toBe(true);
    expect(result.zones.map((zone) => zone.bbox)).toEqual([
      [0, 0, 0.5, 0.5],
      [0.5, 0, 1, 0.5],
      [0, 0.5, 0.5, 1],
      [0.5, 0.5, 1, 1]
    ]);

    for (const zone of result.zones) {
      const territory = zone.properties.territory as Record<string, unknown>;
      const generatedZone = territory.generatedZone as Record<string, unknown>;
      const smartFallback = territory.smartFallback as Record<string, unknown>;

      expect(territory.sourceClass).toBe("generated");
      expect(territory.boundaryKind).toBe("estimated");
      expect(territory.boundarySourceClass).toBe("smart-derived");
      expect(territory.administrative).toBe(false);
      expect(territory.official).toBe(false);
      expect(territory.generated).toBe(true);
      expect(territory.algorithmVersion).toBe(TURKEY_SMART_FALLBACK_ALGORITHM_VERSION);
      expect(territory.localTypeName).toBe("Smart derived territory");
      expect(generatedZone.algorithm).toBe("barrier-guided-smart-fallback");
      expect(smartFallback.administrative).toBe(false);
      expect(smartFallback.authoritative).toBe(false);
    }
  });

  it("normalizes public coverage percentages without hiding raw topology overshoot", () => {
    expect(normalizeTurkeySmartFallbackCoveragePercent(0)).toBe(0);
    expect(normalizeTurkeySmartFallbackCoveragePercent(76.123456)).toBe(76.123456);
    expect(normalizeTurkeySmartFallbackCoveragePercent(100)).toBe(100);
    expect(normalizeTurkeySmartFallbackCoveragePercent(100.000247)).toBe(100);
    expect(normalizeTurkeySmartFallbackCoveragePercent(-0.000247)).toBe(0);
  });

  it("retains a real clipping overshoot in diagnostics while reporting public coverage of 100", () => {
    const parent = districtZone("coverage-overshoot", {
      type: "Polygon",
      coordinates: [
        [
          [28, 40],
          [28.01, 40.001],
          [28.008, 40.01],
          [28, 40.01],
          [28, 40]
        ]
      ]
    });
    const result = buildTurkeySmartFallback({
      parent,
      provinceCode: "34",
      districtCode: "coverage-overshoot",
      profile: "custom",
      roads: lineCollection([
        lineFeature(
          "road",
          [
            [28, 40.005],
            [28.01, 40.005]
          ],
          { highway: "primary" }
        )
      ]),
      options: {
        targetTerritoryCount: 4,
        targetAreaKm2: 4000,
        minAreaKm2: 0.0001,
        maxAreaKm2: 20000,
        minMeanQualityScore: 0,
        minMeanBarrierAlignment: 0,
        minCoveragePercent: 0,
        maxSyntheticSplits: 8,
        requireBarrierForMultiTerritory: false
      }
    });
    expect(result.quality.coverageComputation.rawCoveragePercent).toBeGreaterThan(100);
    expect(result.quality.coverageComputation.rawIntersectionAreaKm2).toBeGreaterThan(
      result.quality.parentAreaKm2
    );
    expect(result.quality.coveragePercent).toBe(100);
    expect(result.quality.uncoveredInsideParentKm2).toBeGreaterThanOrEqual(0);
    expect(result.quality.outsideSpillKm2).toBeGreaterThanOrEqual(0);
    expect(result.quality.overlapAreaKm2).toBeGreaterThanOrEqual(0);
  });

  it("uses river corridors as strong physical split barriers", () => {
    const parent = districtZone("river-split", rectangle(0, 0, 1, 1));
    const result = buildTurkeySmartFallback({
      parent,
      provinceCode: "01",
      districtCode: "river-split",
      profile: "custom",
      water: lineCollection([
        lineFeature(
          "river",
          [
            [0.5, 0],
            [0.5, 1]
          ],
          { waterway: "river", source: "openstreetmap" }
        )
      ]),
      options: twoZoneOptions()
    });

    expect(result.quality.ok).toBe(true);
    expect(result.zones).toHaveLength(2);
    expect(result.zones.every((zone) => zone.bbox[2] <= 0.5 || zone.bbox[0] >= 0.5)).toBe(true);
    expect(result.quality.meanBarrierAlignment).toBe(1);
  });

  it("combines motorway and railway barriers without creating authoritative boundaries", () => {
    const parent = districtZone("motorway-rail", rectangle(0, 0, 1, 1));
    const result = buildTurkeySmartFallback({
      parent,
      provinceCode: "01",
      districtCode: "motorway-rail",
      profile: "custom",
      roads: lineCollection([
        lineFeature(
          "motorway",
          [
            [0.5, 0],
            [0.5, 1]
          ],
          { highway: "motorway", source: "openstreetmap" }
        )
      ]),
      railways: lineCollection([
        lineFeature(
          "rail",
          [
            [0, 0.5],
            [1, 0.5]
          ],
          { railway: "rail", source: "openstreetmap" }
        )
      ]),
      options: permissiveFourZoneOptions()
    });

    expect(result.quality.ok).toBe(true);
    expect(result.zones).toHaveLength(4);
    expect(
      result.zones.every((zone) => {
        const territory = zone.properties.territory as Record<string, unknown>;
        return territory.official === false && territory.administrative === false;
      })
    ).toBe(true);
  });

  it("supports sparse rural districts with a lower-density profile", () => {
    const parent = districtZone("sparse-rural", rectangle(0, 0, 2, 1));
    const result = buildTurkeySmartFallback({
      parent,
      provinceCode: "01",
      districtCode: "sparse-rural",
      profile: "rural",
      roads: lineCollection([
        lineFeature(
          "primary-rural",
          [
            [0, 0.5],
            [2, 0.5]
          ],
          { highway: "primary", source: "openstreetmap" }
        )
      ]),
      options: {
        seed: "smart-test",
        targetTerritoryCount: 2,
        targetAreaKm2: 12000,
        minAreaKm2: 1,
        maxAreaKm2: 15000,
        minFragmentAreaKm2: 1,
        minMeanQualityScore: 0.3,
        minMeanBarrierAlignment: 0.1
      }
    });

    expect(result.selectedProfile).toBe("rural");
    expect(result.quality.ok).toBe(true);
    expect(result.zones).toHaveLength(2);
    expect(result.quality.meanBarrierAlignment).toBe(1);
  });

  it("rejects incomplete networks instead of silently publishing synthetic grids", () => {
    const parent = districtZone("insufficient", rectangle(0, 0, 1, 1));
    const result = buildTurkeySmartFallback({
      parent,
      provinceCode: "01",
      districtCode: "insufficient",
      profile: "custom",
      roads: lineCollection([
        lineFeature(
          "service",
          [
            [0.5, 0],
            [0.5, 1]
          ],
          { highway: "service", source: "openstreetmap" }
        )
      ]),
      options: permissiveFourZoneOptions()
    });
    const codes = result.issues.map((issue) => issue.code);

    expect(result.quality.ok).toBe(false);
    expect(result.quality.acceptanceStatus).toBe("HARD_REJECT");
    expect(result.status).toBe("rejected");
    expect(codes).toContain("SMART_FALLBACK_INSUFFICIENT_BARRIERS");
    expect(codes).toContain("SMART_FALLBACK_SYNTHETIC_SPLIT_USED");
    expect(codes).not.toContain("SMART_FALLBACK_GENERATED");
  });

  it("keeps IDs, manifest hashes, and output hashes deterministic", () => {
    const parent = districtZone("deterministic", rectangle(0, 0, 1, 1));
    const input = {
      parent,
      provinceCode: "01",
      districtCode: "deterministic",
      profile: "custom" as const,
      roads: lineCollection([
        lineFeature(
          "primary-v",
          [
            [0.5, 0],
            [0.5, 1]
          ],
          { highway: "primary", source: "openstreetmap" }
        ),
        lineFeature(
          "secondary-h",
          [
            [0, 0.5],
            [1, 0.5]
          ],
          { highway: "secondary", source: "openstreetmap" }
        )
      ]),
      options: permissiveFourZoneOptions()
    };
    const first = buildTurkeySmartFallback(input);
    const second = buildTurkeySmartFallback(input);

    expect(first.deterministicHash).toBe(second.deterministicHash);
    expect(first.manifest.contentHash).toBe(second.manifest.contentHash);
    expect(first.zones.map((zone) => zone.id)).toEqual(second.zones.map((zone) => zone.id));
  });
});

function permissiveFourZoneOptions() {
  return {
    seed: "smart-test",
    targetTerritoryCount: 4,
    targetAreaKm2: 3000,
    minAreaKm2: 1,
    maxAreaKm2: 5000,
    minFragmentAreaKm2: 1,
    minMeanQualityScore: 0.35,
    minMeanBarrierAlignment: 0.2
  };
}

function twoZoneOptions() {
  return {
    seed: "smart-test",
    targetTerritoryCount: 2,
    targetAreaKm2: 6000,
    minAreaKm2: 1,
    maxAreaKm2: 7000,
    minFragmentAreaKm2: 1,
    minMeanQualityScore: 0.3,
    minMeanBarrierAlignment: 0.1
  };
}

function districtZone(idSuffix: string, geometry: TerritoryGeometry): TerritoryZone {
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
        provinceCode: "01",
        districtCode: idSuffix,
        semanticReviewStatus: "reviewed",
        coverageStatus: "verified"
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

function lineCollection(features: Feature<LineString>[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features
  };
}

function lineFeature(
  id: string,
  coordinates: LngLat[],
  properties: Record<string, string>
): Feature<LineString> {
  return {
    type: "Feature",
    id,
    properties,
    geometry: {
      type: "LineString",
      coordinates
    }
  };
}
