import { describe, expect, it } from "vitest";
import { createSquareZone } from "@territory-kit/shared-testkit";
import {
  TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
  TURKEY_SMART_FALLBACK_V2_PILOT_ALGORITHM_VERSION,
  buildTurkeyNetworkFirstSmartFallbackWithAdjacency,
  buildTurkeySmartFallbackV2PilotWithAdjacency,
  resolveTurkeySmartFallbackConfiguration
} from "../src/turkey-adm3.js";

const parent = createSquareZone({
  id: "v2-pilot-parent",
  datasetId: "v2-pilot-test",
  level: 2,
  west: 29,
  south: 40,
  east: 29.06,
  north: 40.06
});

const seeds = [
  { name: "North-West", coordinate: [29.01, 40.045] as [number, number] },
  { name: "North-East", coordinate: [29.05, 40.045] as [number, number] },
  { name: "South-West", coordinate: [29.01, 40.015] as [number, number] },
  { name: "South-East", coordinate: [29.05, 40.015] as [number, number] }
];

const roads = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      properties: { highway: "primary", "@id": "way:ns" },
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [29, 40.03],
          [29.06, 40.03]
        ]
      }
    },
    {
      type: "Feature" as const,
      properties: { highway: "primary", "@id": "way:ew" },
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [29.03, 40],
          [29.03, 40.06]
        ]
      }
    }
  ]
};

const baseInput = {
  parent,
  provinceCode: "34",
  districtCode: "v2-pilot",
  profile: "dense-urban" as const,
  localitySeeds: seeds,
  roads,
  options: {
    targetAreaKm2: 0.5,
    minAreaKm2: 0.01,
    maxAreaKm2: 5,
    minFragmentAreaKm2: 0.001,
    targetTerritoryCount: 4
  }
};

describe("smart-derived-v2.0-pilot", () => {
  it("remains opt-in and does not change default v1.7 resolution", () => {
    const resolution = resolveTurkeySmartFallbackConfiguration(baseInput);
    expect(resolution.configuration.algorithmVersion).toBe(TURKEY_SMART_FALLBACK_ALGORITHM_VERSION);
    expect(resolution.configuration.seedWatershedPartition).toBeUndefined();
  });

  it("enables seed-watershed network partition only for v2 algorithm version", () => {
    const resolution = resolveTurkeySmartFallbackConfiguration({
      ...baseInput,
      options: {
        ...baseInput.options,
        algorithmVersion: TURKEY_SMART_FALLBACK_V2_PILOT_ALGORITHM_VERSION
      }
    });
    expect(resolution.configuration.algorithmVersion).toBe(
      TURKEY_SMART_FALLBACK_V2_PILOT_ALGORITHM_VERSION
    );
    expect(resolution.configuration.seedWatershedPartition).toBe(true);
    expect(resolution.configuration.networkFirst).toBe(true);
  });

  it("rejects unsupported algorithm versions", () => {
    const resolution = resolveTurkeySmartFallbackConfiguration({
      ...baseInput,
      options: { ...baseInput.options, algorithmVersion: "smart-derived-v9" }
    });
    expect(resolution.ok).toBe(false);
    expect(
      resolution.issues.some((issue) => issue.code === "SMART_FALLBACK_UNSUPPORTED_ALGORITHM")
    ).toBe(true);
  });

  it("produces a different partition than v1.7 network-first on the same seeds and barriers", async () => {
    const v17 = await buildTurkeyNetworkFirstSmartFallbackWithAdjacency(baseInput);
    const v2 = await buildTurkeySmartFallbackV2PilotWithAdjacency(baseInput);
    expect(v2.configuration.algorithmVersion).toBe(
      TURKEY_SMART_FALLBACK_V2_PILOT_ALGORITHM_VERSION
    );
    expect(v2.deterministicHash).not.toBe(v17.deterministicHash);
    expect(v2.zones.length).toBeGreaterThan(0);
    for (const zone of v2.zones) {
      expect(zone.properties.territory).toMatchObject({
        boundarySourceClass: "smart-derived",
        administrative: false,
        authoritative: false,
        algorithmVersion: TURKEY_SMART_FALLBACK_V2_PILOT_ALGORITHM_VERSION
      });
    }
  });

  it("is deterministic for identical v2 inputs", async () => {
    const first = await buildTurkeySmartFallbackV2PilotWithAdjacency(baseInput);
    const second = await buildTurkeySmartFallbackV2PilotWithAdjacency(baseInput);
    expect(second.deterministicHash).toBe(first.deterministicHash);
  });
});
