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
  /** Faces assigned to a seed label that also owns other faces (expected; not a conflict). */
  multiFacePerSeedLabelFaceCount: number;
  distinctLabeledSeedCount: number;
  weakDifferentSeedBoundaryLengthMeters: number;
  strongDifferentSeedBoundaryLengthMeters: number;
  weakBarrierReassignedFaceCount?: number;
  weakBarrierReassignmentBlockedBySeedAnchor?: number;
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
  let multiFacePerSeedLabelFaceCount = 0;
  for (const count of labelCounts.values()) {
    if (count > 1) {
      multiFacePerSeedLabelFaceCount += count;
    }
  }

  let weakDifferentSeedBoundaryLengthMeters = 0;
  let strongDifferentSeedBoundaryLengthMeters = 0;
  const diffSeen = new Set<string>();
  for (const [faceIndex, row] of input.neighbours.entries()) {
    const labelA = input.seedLabels[faceIndex] ?? -1;
    for (const [neighbor, edge] of row.entries()) {
      const labelB = input.seedLabels[neighbor] ?? -1;
      if (labelA === -1 || labelB === -1 || labelA === labelB) {
        continue;
      }
      const key = faceIndex < neighbor ? `${faceIndex}:${neighbor}` : `${neighbor}:${faceIndex}`;
      if (diffSeen.has(key)) {
        continue;
      }
      diffSeen.add(key);
      if (edge.strength >= strongThreshold) {
        strongDifferentSeedBoundaryLengthMeters += edge.length;
      } else if (edge.strength < mediumThreshold) {
        weakDifferentSeedBoundaryLengthMeters += edge.length;
      }
    }
  }

  return {
    watershedBoundaryEdgeCount,
    watershedBoundaryLengthMeters,
    strongBarrierWatershedLengthMeters,
    mediumBarrierWatershedLengthMeters,
    weakBarrierWatershedLengthMeters,
    unseededFaceCount,
    multiFacePerSeedLabelFaceCount,
    distinctLabeledSeedCount: labelCounts.size,
    weakDifferentSeedBoundaryLengthMeters,
    strongDifferentSeedBoundaryLengthMeters
  };
}

/**
 * Hypothesis A (impl-rev3): flip small faces across weak inter-seed edges when the
 * neighbor seed already dominates weak adjacency, without relabeling seed anchor faces.
 */
export function refineSeedWatershedFaceLabelsWeakBarrier(input: {
  seedLabels: number[];
  neighbours: ReadonlyMap<number, ReadonlyMap<number, TurkeyBarrierGraphNeighbourEdge>>;
  /** Face index containing each seed coordinate (from initial watershed). */
  anchorFaceIndexBySeed: readonly number[];
  weakStrengthThreshold?: number;
  maxPasses?: number;
}): { reassignedFaceCount: number; blockedBySeedAnchorCount: number } {
  const weakThreshold = input.weakStrengthThreshold ?? 0.45;
  const maxPasses = input.maxPasses ?? 6;
  const labels = input.seedLabels;
  const anchorFaces = new Set(input.anchorFaceIndexBySeed.filter((faceIndex) => faceIndex >= 0));
  let reassignedFaceCount = 0;
  let blockedBySeedAnchorCount = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    const order = labels
      .map((label, faceIndex) => ({ faceIndex, label }))
      .filter((row) => row.label !== -1)
      .sort((a, b) => a.faceIndex - b.faceIndex);

    for (const { faceIndex } of order) {
      if (anchorFaces.has(faceIndex)) {
        continue;
      }
      const current = labels[faceIndex]!;
      const votes = new Map<number, number>();
      for (const [neighbor, edge] of input.neighbours.get(faceIndex) ?? []) {
        if (edge.strength >= weakThreshold) {
          continue;
        }
        const neighborLabel = labels[neighbor] ?? -1;
        if (neighborLabel === -1 || neighborLabel === current) {
          continue;
        }
        votes.set(neighborLabel, (votes.get(neighborLabel) ?? 0) + edge.length);
      }
      if (!votes.size) {
        continue;
      }
      const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!;
      const currentWeakSupport = [...(input.neighbours.get(faceIndex) ?? [])]
        .filter(([neighbor, edge]) => edge.strength < weakThreshold && labels[neighbor] === current)
        .reduce((sum, [, edge]) => sum + edge.length, 0);
      if (best[1] <= currentWeakSupport) {
        continue;
      }
      if (anchorFaces.has(faceIndex)) {
        blockedBySeedAnchorCount++;
        continue;
      }
      labels[faceIndex] = best[0];
      reassignedFaceCount++;
      changed = true;
    }
    if (!changed) {
      break;
    }
  }

  return { reassignedFaceCount, blockedBySeedAnchorCount };
}
