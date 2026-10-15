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

export type TurkeyV17AnchoredWatershedMergeStats = {
  crossSeedWeakMergeCount: number;
  strongBlockedAdjacencyCount: number;
  maxAreaBlockedMergeCount: number;
};

/**
 * Replicate v1.7 area-target face merges on a parallel leader array (same face graph).
 */
export function buildTurkeyNetworkFaceV17MergeLeader(input: {
  faceCount: number;
  faceAreaKm2: readonly number[];
  neighbours: ReadonlyMap<number, ReadonlyMap<number, TurkeyBarrierGraphNeighbourEdge>>;
  targetAreaKm2: number;
  targetGeometryAreaKm2: number;
  seedCount: number;
  maxAreaKm2: number;
  areaToleranceKm2: number;
}): number[] {
  const area = [...input.faceAreaKm2];
  const leader = input.faceCount > 0 ? Array.from({ length: input.faceCount }, (_, i) => i) : [];
  const members = new Map<number, number[]>(leader.map((index) => [index, [index]]));
  const find = (index: number): number => {
    while (leader[index] !== index) {
      index = leader[index]!;
    }
    return index;
  };
  const union = (left: number, right: number): void => {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft === rootRight) {
      return;
    }
    leader[rootRight] = rootLeft;
    area[rootLeft]! += area[rootRight]!;
    members.set(rootLeft, [...(members.get(rootLeft) ?? []), ...(members.get(rootRight) ?? [])]);
    members.delete(rootRight);
  };
  const target = Math.max(
    input.targetAreaKm2,
    input.targetGeometryAreaKm2 / Math.max(1, input.seedCount)
  );
  const processed = new Set<number>();
  for (const index of leader
    .map((_, faceIndex) => faceIndex)
    .sort((a, b) => area[a]! - area[b]! || a - b)) {
    const root = find(index);
    if (processed.has(root)) {
      continue;
    }
    while (area[root]! < target * 0.6) {
      const choices = new Map<number, { strength: number; length: number }>();
      for (const member of members.get(root) ?? []) {
        for (const [other, edge] of input.neighbours.get(member) ?? []) {
          const peer = find(other);
          if (peer === root || area[root]! + area[peer]! > input.maxAreaKm2) {
            continue;
          }
          const prior = choices.get(peer);
          choices.set(peer, {
            strength: Math.max(prior?.strength ?? 0, edge.strength),
            length: (prior?.length ?? 0) + edge.length
          });
        }
      }
      const selected = [...choices.entries()].sort(
        (a, b) =>
          a[1].strength - b[1].strength ||
          b[1].length - a[1].length ||
          Math.abs(area[root]! + area[a[0]]! - target) -
            Math.abs(area[root]! + area[b[0]]! - target) ||
          a[0] - b[0]
      )[0];
      if (!selected) {
        break;
      }
      union(root, selected[0]);
    }
    processed.add(root);
  }
  return leader;
}

/**
 * impl-rev4: within each v1.7 merge group, union watershed components that differ only
 * across weak inter-seed barriers; keep splits when a strong barrier separates seeds.
 */
export function mergeV17AnchoredWatershedFaceGroups(input: {
  faceCount: number;
  seedLabels: readonly number[];
  neighbours: ReadonlyMap<number, ReadonlyMap<number, TurkeyBarrierGraphNeighbourEdge>>;
  leaderV17: readonly number[];
  leader: number[];
  faceAreaKm2: readonly number[];
  maxAreaKm2: number;
  areaToleranceKm2: number;
  strongStrengthThreshold?: number;
}): TurkeyV17AnchoredWatershedMergeStats {
  const strongThreshold = input.strongStrengthThreshold ?? 0.75;
  const area = [...input.faceAreaKm2];
  const findV17 = (faceIndex: number): number => {
    let current = faceIndex;
    while (input.leaderV17[current] !== current) {
      current = input.leaderV17[current]!;
    }
    return current;
  };
  const find = (faceIndex: number): number => {
    let current = faceIndex;
    while (input.leader[current] !== current) {
      current = input.leader[current]!;
    }
    return current;
  };
  const union = (left: number, right: number): void => {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft === rootRight) {
      return;
    }
    if (area[rootLeft]! + area[rootRight]! > input.maxAreaKm2 + input.areaToleranceKm2) {
      return;
    }
    input.leader[rootRight] = rootLeft;
    area[rootLeft]! += area[rootRight]!;
  };

  let crossSeedWeakMergeCount = 0;
  let strongBlockedAdjacencyCount = 0;
  let maxAreaBlockedMergeCount = 0;

  const v17Roots = new Set<number>();
  for (let faceIndex = 0; faceIndex < input.faceCount; faceIndex++) {
    v17Roots.add(findV17(faceIndex));
  }

  for (const v17Root of [...v17Roots].sort((a, b) => a - b)) {
    const componentRoots = new Set<number>();
    for (let faceIndex = 0; faceIndex < input.faceCount; faceIndex++) {
      if (findV17(faceIndex) !== v17Root) {
        continue;
      }
      componentRoots.add(find(faceIndex));
    }
    const sortedComponents = [...componentRoots].sort((a, b) => a - b);
    const componentSeedLabel = new Map<number, number>();
    for (const component of sortedComponents) {
      for (let faceIndex = 0; faceIndex < input.faceCount; faceIndex++) {
        if (find(faceIndex) !== component) {
          continue;
        }
        const label = input.seedLabels[faceIndex] ?? -1;
        if (label !== -1) {
          componentSeedLabel.set(component, label);
          break;
        }
      }
    }

    const blocked = new Set<string>();
    for (let faceIndex = 0; faceIndex < input.faceCount; faceIndex++) {
      if (findV17(faceIndex) !== v17Root) {
        continue;
      }
      const componentA = find(faceIndex);
      const labelA = componentSeedLabel.get(componentA) ?? input.seedLabels[faceIndex] ?? -1;
      for (const [neighbor, edge] of input.neighbours.get(faceIndex) ?? []) {
        if (findV17(neighbor) !== v17Root) {
          continue;
        }
        const componentB = find(neighbor);
        if (componentA === componentB) {
          continue;
        }
        const labelB = componentSeedLabel.get(componentB) ?? input.seedLabels[neighbor] ?? -1;
        if (labelA === -1 || labelB === -1 || labelA === labelB) {
          continue;
        }
        if (edge.strength >= strongThreshold) {
          const key =
            componentA < componentB ? `${componentA}:${componentB}` : `${componentB}:${componentA}`;
          blocked.add(key);
          strongBlockedAdjacencyCount++;
        }
      }
    }

    const componentLeader = new Map<number, number>();
    for (const component of sortedComponents) {
      componentLeader.set(component, component);
    }
    const findComponent = (component: number): number => {
      let current = component;
      while (componentLeader.get(current) !== current) {
        current = componentLeader.get(current)!;
      }
      return current;
    };
    const unionComponents = (left: number, right: number): void => {
      const rootLeft = findComponent(left);
      const rootRight = findComponent(right);
      if (rootLeft === rootRight) {
        return;
      }
      componentLeader.set(rootRight, rootLeft);
    };

    const componentAdjacency = new Map<number, Set<number>>();
    for (const component of sortedComponents) {
      componentAdjacency.set(component, new Set());
    }
    for (let faceIndex = 0; faceIndex < input.faceCount; faceIndex++) {
      if (findV17(faceIndex) !== v17Root) {
        continue;
      }
      const componentA = find(faceIndex);
      for (const [neighbor] of input.neighbours.get(faceIndex) ?? []) {
        if (findV17(neighbor) !== v17Root) {
          continue;
        }
        const componentB = find(neighbor);
        if (componentA === componentB) {
          continue;
        }
        componentAdjacency.get(componentA)?.add(componentB);
        componentAdjacency.get(componentB)?.add(componentA);
      }
    }
    const visitQueue = [...sortedComponents];
    const seenComponents = new Set<number>();
    while (visitQueue.length) {
      const start = visitQueue.shift()!;
      if (seenComponents.has(start)) {
        continue;
      }
      seenComponents.add(start);
      const stack = [start];
      while (stack.length) {
        const current = stack.pop()!;
        for (const neighbor of componentAdjacency.get(current) ?? []) {
          const key = current < neighbor ? `${current}:${neighbor}` : `${neighbor}:${current}`;
          if (blocked.has(key)) {
            continue;
          }
          unionComponents(current, neighbor);
          if (!seenComponents.has(neighbor)) {
            seenComponents.add(neighbor);
            stack.push(neighbor);
          }
        }
      }
    }

    const mergedGroups = new Map<number, number[]>();
    for (const component of sortedComponents) {
      const root = findComponent(component);
      const group = mergedGroups.get(root) ?? [];
      group.push(component);
      mergedGroups.set(root, group);
    }

    for (const components of mergedGroups.values()) {
      if (components.length <= 1) {
        continue;
      }
      const labels = new Set(
        components
          .map((component) => componentSeedLabel.get(component) ?? -1)
          .filter((label) => label !== -1)
      );
      if (labels.size <= 1) {
        continue;
      }
      const anchorComponent = components[0]!;
      let anchorFace = -1;
      for (let faceIndex = 0; faceIndex < input.faceCount; faceIndex++) {
        if (find(faceIndex) === anchorComponent) {
          anchorFace = faceIndex;
          break;
        }
      }
      if (anchorFace < 0) {
        continue;
      }
      for (let index = 1; index < components.length; index++) {
        let otherFace = -1;
        const otherComponent = components[index]!;
        for (let faceIndex = 0; faceIndex < input.faceCount; faceIndex++) {
          if (find(faceIndex) === otherComponent) {
            otherFace = faceIndex;
            break;
          }
        }
        if (otherFace < 0) {
          continue;
        }
        const beforeLeft = find(anchorFace);
        const beforeRight = find(otherFace);
        if (beforeLeft === beforeRight) {
          continue;
        }
        if (area[beforeLeft]! + area[beforeRight]! > input.maxAreaKm2 + input.areaToleranceKm2) {
          maxAreaBlockedMergeCount++;
          continue;
        }
        union(anchorFace, otherFace);
        crossSeedWeakMergeCount++;
      }
    }
  }

  return {
    crossSeedWeakMergeCount,
    strongBlockedAdjacencyCount,
    maxAreaBlockedMergeCount
  };
}
