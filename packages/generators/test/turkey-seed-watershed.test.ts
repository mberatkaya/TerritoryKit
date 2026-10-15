import { describe, expect, it } from "vitest";
import { assignSeedWatershedFaceLabels } from "../src/turkey-smart-fallback.js";
import {
  auditSeedWatershedBarrierAssignments,
  turkeyBarrierGraphCrossingCostFactor,
  turkeyBarrierGraphEdgeCrossingCostMeters,
  turkeyBarrierGraphEdgeCrossingCostMetersImplRev1
} from "../src/turkey-seed-watershed.js";

describe("turkey seed watershed barrier crossing cost", () => {
  it("increases crossing cost as barrier strength increases", () => {
    const lengthMeters = 100;
    const weak = turkeyBarrierGraphEdgeCrossingCostMeters(lengthMeters, 0.2);
    const strong = turkeyBarrierGraphEdgeCrossingCostMeters(lengthMeters, 0.85);
    expect(strong).toBeGreaterThan(weak);
    expect(turkeyBarrierGraphCrossingCostFactor(0.85)).toBeGreaterThan(
      turkeyBarrierGraphCrossingCostFactor(0.2)
    );
  });

  it("documents impl-rev1 inversion and impl-rev2 correction on equal-length edges", () => {
    const lengthMeters = 100;
    expect(
      turkeyBarrierGraphEdgeCrossingCostMetersImplRev1(lengthMeters, 0.9)
    ).toBeLessThan(turkeyBarrierGraphEdgeCrossingCostMetersImplRev1(lengthMeters, 0.2));
    expect(turkeyBarrierGraphEdgeCrossingCostMeters(lengthMeters, 0.9)).toBeGreaterThan(
      turkeyBarrierGraphEdgeCrossingCostMeters(lengthMeters, 0.2)
    );

    const viaStrongShortcut =
      turkeyBarrierGraphEdgeCrossingCostMeters(50, 0.9) +
      turkeyBarrierGraphEdgeCrossingCostMeters(200, 0.2);
    const viaWeakDetour =
      turkeyBarrierGraphEdgeCrossingCostMeters(150, 0.2) +
      turkeyBarrierGraphEdgeCrossingCostMeters(150, 0.2);
    expect(viaWeakDetour).toBeLessThan(viaStrongShortcut);
  });
});

describe("assignSeedWatershedFaceLabels synthetic graph", () => {
  it("assigns both seeds on a 2x2 weak-grid graph", () => {
    const neighbours = new Map<number, Map<number, { strength: number; length: number }>>([
      [0, new Map([[1, { strength: 0.2, length: 100 }], [2, { strength: 0.2, length: 100 }]])],
      [1, new Map([[0, { strength: 0.2, length: 100 }], [3, { strength: 0.2, length: 100 }]])],
      [2, new Map([[0, { strength: 0.2, length: 100 }], [3, { strength: 0.2, length: 100 }]])],
      [3, new Map([[1, { strength: 0.2, length: 100 }], [2, { strength: 0.2, length: 100 }]])]
    ]);
    const faces = [0, 1, 2, 3].map((index) => ({
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [29 + (index % 2) * 0.01, 41 + Math.floor(index / 2) * 0.01],
            [29 + (index % 2) * 0.01 + 0.005, 41 + Math.floor(index / 2) * 0.01],
            [29 + (index % 2) * 0.01 + 0.005, 41 + Math.floor(index / 2) * 0.01 + 0.005],
            [29 + (index % 2) * 0.01, 41 + Math.floor(index / 2) * 0.01 + 0.005],
            [29 + (index % 2) * 0.01, 41 + Math.floor(index / 2) * 0.01]
          ]
        ]
      },
      areaKm2: 0.01,
      edges: [],
      barrierIds: []
    }));
    const seeds = [
      { name: "A", coordinate: [29.0025, 41.0025] as [number, number] },
      { name: "B", coordinate: [29.0125, 41.0125] as [number, number] }
    ];
    const labels = assignSeedWatershedFaceLabels({ faces, neighbours, seeds });
    expect(labels[0]).toBe(0);
    expect(labels[3]).toBe(1);
    expect(auditSeedWatershedBarrierAssignments({ seedLabels: labels, neighbours }).unseededFaceCount).toBe(
      0
    );
  });
});
