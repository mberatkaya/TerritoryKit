/** Matches graph edge strength floor used in barrier classification. */
export const TURKEY_BARRIER_GRAPH_STRENGTH_FLOOR = 0.15;

export type TurkeyBarrierGraphNeighbourEdge = { strength: number; length: number };

export type TurkeySeedWatershedBarrierAudit = {
  watershedBoundaryEdgeCount: number;
  watershedBoundaryLengthMeters: number;
  strongBarrierWatershedLengthMeters: number;
  mediumBarrierWatershedLengthMeters: number;
  weakBarrierWatershedLengthMeters: number;
  unseededFaceCount: number;
  seedCollisionFaceCount: number;
};

/**
 * Dimensionless crossing resistance: higher barrier strength ⇒ higher factor.
 * Scale-independent (multiply by edge length in meters for Dijkstra cost).
 *
 * impl-rev1 incorrectly used `length / strength`, making strong barriers cheap to cross.
 */
export function turkeyBarrierGraphCrossingCostFactor(strength: number): number {
  const floor = TURKEY_BARRIER_GRAPH_STRENGTH_FLOOR;
  const s = Math.min(1, Math.max(floor, strength));
  const normalized = (s - floor) / (1 - floor);
  return 1 + normalized * normalized * 24;
}

export function turkeyBarrierGraphEdgeCrossingCostMeters(
  lengthMeters: number,
  strength: number
): number {
  if (lengthMeters <= 0) {
    return 0;
  }
  return lengthMeters * turkeyBarrierGraphCrossingCostFactor(strength);
}

/** Legacy impl-rev1 formula (inverted semantics); retained for regression tests only. */
export function turkeyBarrierGraphEdgeCrossingCostMetersImplRev1(
  lengthMeters: number,
  strength: number
): number {
  return lengthMeters / Math.max(strength, TURKEY_BARRIER_GRAPH_STRENGTH_FLOOR);
}

export function auditSeedWatershedBarrierAssignments(input: {
  seedLabels: readonly number[];
  neighbours: ReadonlyMap<number, ReadonlyMap<number, TurkeyBarrierGraphNeighbourEdge>>;
  strongStrengthThreshold?: number;
  mediumStrengthThreshold?: number;
}): TurkeySeedWatershedBarrierAudit {
  const strongThreshold = input.strongStrengthThreshold ?? 0.75;
  const mediumThreshold = input.mediumStrengthThreshold ?? 0.45;
  let watershedBoundaryEdgeCount = 0;
  let watershedBoundaryLengthMeters = 0;
  let strongBarrierWatershedLengthMeters = 0;
  let mediumBarrierWatershedLengthMeters = 0;
  let weakBarrierWatershedLengthMeters = 0;
  const seen = new Set<string>();

  for (const [faceIndex, row] of input.neighbours.entries()) {
    const labelA = input.seedLabels[faceIndex] ?? -1;
    for (const [neighbor, edge] of row.entries()) {
      const labelB = input.seedLabels[neighbor] ?? -1;
      if (labelA === -1 || labelB === -1 || labelA === labelB) {
        continue;
      }
      const key = faceIndex < neighbor ? `${faceIndex}:${neighbor}` : `${neighbor}:${faceIndex}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      watershedBoundaryEdgeCount++;
      watershedBoundaryLengthMeters += edge.length;
      if (edge.strength >= strongThreshold) {
        strongBarrierWatershedLengthMeters += edge.length;
      } else if (edge.strength >= mediumThreshold) {
        mediumBarrierWatershedLengthMeters += edge.length;
      } else {
        weakBarrierWatershedLengthMeters += edge.length;
      }
    }
  }

  const labelCounts = new Map<number, number>();
  let unseededFaceCount = 0;
  for (const label of input.seedLabels) {
    if (label === -1) {
      unseededFaceCount++;
      continue;
    }
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  let seedCollisionFaceCount = 0;
  for (const count of labelCounts.values()) {
    if (count > 1) {
      seedCollisionFaceCount += count;
    }
  }

  return {
    watershedBoundaryEdgeCount,
    watershedBoundaryLengthMeters,
    strongBarrierWatershedLengthMeters,
    mediumBarrierWatershedLengthMeters,
    weakBarrierWatershedLengthMeters,
    unseededFaceCount,
    seedCollisionFaceCount
  };
}
