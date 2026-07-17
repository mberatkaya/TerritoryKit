import { classifyTerritoryGeometryRelation, getParentAdminLevel } from "@territory-kit/dataset";
import type {
  LngLat,
  TerritoryAdminLevel,
  TerritoryBBox,
  TerritoryGeometry
} from "@territory-kit/dataset";
import type {
  BuiltCountryZone,
  TerritoryHierarchyReport,
  TerritoryHierarchyResolution
} from "./types.js";

export function resolveTerritoryCountryHierarchy(input: {
  parentsByLevel: Partial<Record<TerritoryAdminLevel, readonly BuiltCountryZone[]>>;
  childrenByLevel: Partial<Record<TerritoryAdminLevel, readonly BuiltCountryZone[]>>;
  tolerance?: number;
}): TerritoryHierarchyReport {
  const resolutions: TerritoryHierarchyResolution[] = [];

  for (const [level, children] of Object.entries(input.childrenByLevel) as Array<
    [TerritoryAdminLevel, readonly BuiltCountryZone[]]
  >) {
    if (level === "ADM0") {
      continue;
    }

    const parentLevel = getParentAdminLevel(level);

    if (!parentLevel) {
      continue;
    }

    const parents = input.parentsByLevel[parentLevel] ?? [];

    for (const child of children) {
      resolutions.push(resolveParent(child, parents, input.tolerance ?? 1e-9));
    }
  }

  return {
    hierarchyVersion: "1",
    resolutions: resolutions.sort((left, right) => left.childId.localeCompare(right.childId)),
    summary: {
      explicitParentCount: resolutions.filter(
        (resolution) => resolution.method === "explicit-source-parent"
      ).length,
      officialCodeParentCount: resolutions.filter(
        (resolution) => resolution.method === "official-code"
      ).length,
      spatialParentCount: resolutions.filter(
        (resolution) => resolution.method === "spatial-containment"
      ).length,
      unresolvedCount: resolutions.filter((resolution) => resolution.method === "unresolved")
        .length,
      ambiguousCount: resolutions.filter((resolution) => resolution.method === "ambiguous").length,
      containmentFailureCount: resolutions
        .flatMap((resolution) => resolution.issues)
        .filter((issue) => issue.code === "PARENT_CONTAINMENT_FAILED").length
    }
  };
}

export function applyHierarchyResolutions<T extends BuiltCountryZone>(
  zones: readonly T[],
  report: TerritoryHierarchyReport
): T[] {
  const parentByChildId = new Map(
    report.resolutions.flatMap((resolution) =>
      resolution.parentId
        ? ([[resolution.childId, resolution.parentId]] as Array<[string, string]>)
        : []
    )
  );

  return zones.map((built) => {
    const parentId = parentByChildId.get(built.zone.id);

    if (!parentId) {
      return built;
    }

    return {
      ...built,
      identity: {
        ...built.identity,
        parentId
      },
      zone: {
        ...built.zone,
        parentId,
        properties: {
          ...built.zone.properties,
          territory: {
            ...(isRecord(built.zone.properties.territory) ? built.zone.properties.territory : {}),
            parentId
          }
        }
      }
    };
  });
}

export function attachChildIds(zones: readonly BuiltCountryZone[]): BuiltCountryZone[] {
  const childrenByParent = new Map<string, string[]>();

  for (const built of zones) {
    if (built.zone.parentId) {
      childrenByParent.set(built.zone.parentId, [
        ...(childrenByParent.get(built.zone.parentId) ?? []),
        built.zone.id
      ]);
    }
  }

  return zones.map((built) => {
    const childIds = childrenByParent.get(built.zone.id)?.sort();

    if (!childIds || childIds.length === 0) {
      return built;
    }

    return {
      ...built,
      zone: {
        ...built.zone,
        childIds
      }
    };
  });
}

function resolveParent(
  child: BuiltCountryZone,
  parents: readonly BuiltCountryZone[],
  tolerance: number
): TerritoryHierarchyResolution {
  if (parents.length === 0) {
    return {
      childId: child.zone.id,
      method: "unresolved",
      issues: [
        {
          code: "PARENT_LEVEL_EMPTY",
          severity: "error",
          message: "No parent level features are available."
        }
      ]
    };
  }

  const explicitParent = findExplicitParent(child, parents);

  if (explicitParent) {
    const containmentIssue = verifyParentContainsChild(explicitParent, child, tolerance);

    return {
      childId: child.zone.id,
      parentId: explicitParent.zone.id,
      method: child.sourceParentId ? "explicit-source-parent" : "official-code",
      confidence: containmentIssue ? 0.8 : 1,
      candidateParentIds: [explicitParent.zone.id],
      issues: containmentIssue ? [containmentIssue] : []
    };
  }

  const centerCandidates = parents
    .filter((parent) => bboxContainsPoint(parent.zone.bbox, child.zone.center, tolerance))
    .filter((parent) => pointIntersectsGeometry(child.zone.center, parent.zone.geometry))
    .sort(compareParentSpecificity);

  const centerResolution = resolveSpatialCandidates(child, centerCandidates, 0.95, "center");

  if (centerResolution) {
    return centerResolution;
  }

  const candidates = parents
    .filter((parent) => bboxesIntersect(parent.zone.bbox, child.zone.bbox, tolerance))
    .filter((parent) => parentGeometryContainsChild(parent, child, tolerance))
    .sort(compareParentSpecificity);

  const containmentResolution = resolveSpatialCandidates(child, candidates, 0.9, "geometry");

  if (containmentResolution) {
    return containmentResolution;
  }

  if (candidates.length > 1) {
    return {
      childId: child.zone.id,
      method: "ambiguous",
      candidateParentIds: candidates.map((candidate) => candidate.zone.id),
      issues: [
        {
          code: "PARENT_AMBIGUOUS",
          severity: "error",
          message: "Multiple spatial parent candidates cover this child."
        }
      ]
    };
  }

  if (centerCandidates.length > 1) {
    return {
      childId: child.zone.id,
      method: "ambiguous",
      candidateParentIds: centerCandidates.map((candidate) => candidate.zone.id),
      issues: [
        {
          code: "PARENT_AMBIGUOUS",
          severity: "error",
          message: "Multiple spatial parent candidates cover this child center."
        }
      ]
    };
  }

  return {
    childId: child.zone.id,
    method: "unresolved",
    candidateParentIds: parents
      .filter((parent) => bboxesIntersect(parent.zone.bbox, child.zone.bbox, tolerance))
      .map((parent) => parent.zone.id)
      .sort(),
    issues: [
      {
        code: "PARENT_UNRESOLVED",
        severity: "error",
        message: "No parent candidate covers this child geometry."
      }
    ]
  };
}

function resolveSpatialCandidates(
  child: BuiltCountryZone,
  candidates: readonly BuiltCountryZone[],
  confidence: number,
  mode: "center" | "geometry"
): TerritoryHierarchyResolution | undefined {
  if (candidates.length === 1) {
    const candidate = candidates[0];

    if (!candidate) {
      throw new Error("Expected one parent candidate.");
    }

    return {
      childId: child.zone.id,
      parentId: candidate.zone.id,
      method: "spatial-containment",
      confidence,
      candidateParentIds: candidates.map((candidate) => candidate.zone.id),
      issues: []
    };
  }

  if (candidates.length > 1) {
    return {
      childId: child.zone.id,
      method: "ambiguous",
      candidateParentIds: candidates.map((candidate) => candidate.zone.id),
      issues: [
        {
          code: "PARENT_AMBIGUOUS",
          severity: "error",
          message:
            mode === "center"
              ? "Multiple spatial parent candidates cover this child center."
              : "Multiple spatial parent candidates cover this child geometry."
        }
      ]
    };
  }

  return undefined;
}

function compareParentSpecificity(left: BuiltCountryZone, right: BuiltCountryZone): number {
  return (
    bboxArea(left.zone.bbox) - bboxArea(right.zone.bbox) ||
    left.zone.id.localeCompare(right.zone.id)
  );
}

function findExplicitParent(
  child: BuiltCountryZone,
  parents: readonly BuiltCountryZone[]
): BuiltCountryZone | undefined {
  if (child.sourceParentId) {
    const bySourceId = parents.find(
      (parent) =>
        parent.sourceId === child.sourceParentId || parent.officialCode === child.sourceParentId
    );

    if (bySourceId) {
      return bySourceId;
    }
  }

  return undefined;
}

function verifyParentContainsChild(
  parent: BuiltCountryZone,
  child: BuiltCountryZone,
  tolerance: number
) {
  if (parentContainsChild(parent, child, tolerance)) {
    return undefined;
  }

  return {
    code: "PARENT_CONTAINMENT_FAILED",
    severity: "error" as const,
    message: "Explicit parent does not cover child geometry."
  };
}

function parentContainsChild(
  parent: BuiltCountryZone,
  child: BuiltCountryZone,
  tolerance: number
): boolean {
  if (
    bboxContainsPoint(parent.zone.bbox, child.zone.center, tolerance) &&
    pointIntersectsGeometry(child.zone.center, parent.zone.geometry)
  ) {
    return true;
  }

  return parentGeometryContainsChild(parent, child, tolerance);
}

function parentGeometryContainsChild(
  parent: BuiltCountryZone,
  child: BuiltCountryZone,
  tolerance: number
): boolean {
  const relation = classifyTerritoryGeometryRelation(parent.zone.geometry, child.zone.geometry, {
    epsilon: tolerance
  }).relation;

  return relation === "contains" || relation === "equal";
}

function pointIntersectsGeometry(point: LngLat, geometry: TerritoryGeometry): boolean {
  if (geometry.type === "Polygon") {
    return pointIntersectsPolygon(point, geometry.coordinates as LngLat[][]);
  }

  return geometry.coordinates.some((polygon) =>
    pointIntersectsPolygon(point, polygon as LngLat[][])
  );
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function pointIntersectsPolygon(point: LngLat, polygon: LngLat[][]): boolean {
  const [outer, ...holes] = polygon;

  if (!outer || !pointInRing(point, outer)) {
    return false;
  }

  return !holes.some((hole) => pointInRing(point, hole));
}

function pointInRing(point: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  const [x, y] = point;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index] ?? [0, 0];
    const [xj, yj] = ring[previous] ?? [0, 0];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function bboxesIntersect(left: TerritoryBBox, right: TerritoryBBox, epsilon: number): boolean {
  return !(
    left[2] < right[0] - epsilon ||
    right[2] < left[0] - epsilon ||
    left[3] < right[1] - epsilon ||
    right[3] < left[1] - epsilon
  );
}

function bboxContainsPoint(bbox: TerritoryBBox, point: LngLat, epsilon: number): boolean {
  return (
    point[0] >= bbox[0] - epsilon &&
    point[0] <= bbox[2] + epsilon &&
    point[1] >= bbox[1] - epsilon &&
    point[1] <= bbox[3] + epsilon
  );
}

function bboxArea(bbox: TerritoryBBox): number {
  return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
}
