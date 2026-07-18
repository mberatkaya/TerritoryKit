import { computeGeometryBBox, geometryToPolygons } from "./geometry.js";
import type { LngLat, TerritoryBBox, TerritoryDataset, TerritoryGeometry } from "./types.js";
import type { GeometryQualityChecks } from "./quality.js";

export type TerritoryAdjacencyType = "shared-border" | "point-touch" | "maritime" | "logical";
export type TerritoryAdjacencySource = "computed" | "manual";
export type TerritoryGeometryRelation =
  | "disjoint"
  | "point-touch"
  | "shared-border"
  | "overlap"
  | "contains"
  | "within"
  | "equal"
  | "ambiguous";

export interface TerritoryAdjacencyPair {
  a: string;
  b: string;
}

export interface TerritoryAdjacencyEdge {
  from: string;
  to: string;
  type: TerritoryAdjacencyType;
  source: TerritoryAdjacencySource;
  sharedBoundaryMeters?: number;
  confidence?: number;
  properties?: Record<string, unknown>;
}

export interface TerritoryManualAdjacencyAdd {
  a: string;
  b: string;
  type: TerritoryAdjacencyType;
  reason?: string;
  sourceReference?: string;
  properties?: Record<string, unknown>;
}

export interface TerritoryManualAdjacencyRemove {
  a: string;
  b: string;
  reason?: string;
}

export interface TerritoryAdjacencyOverrides {
  add?: TerritoryManualAdjacencyAdd[];
  remove?: TerritoryManualAdjacencyRemove[];
}

export interface TerritoryAdjacencyTolerance {
  coordinateEpsilon: number;
  collinearityEpsilon: number;
  lengthEpsilonMeters: number;
}

export interface TerritoryBoundarySegment {
  featureId: string;
  polygonIndex: number;
  ringIndex: number;
  segmentIndex: number;
  start: LngLat;
  end: LngLat;
  bbox: TerritoryBBox;
}

export interface TerritoryGeometryRelationOptions {
  epsilon?: number;
  tolerance?: Partial<TerritoryAdjacencyTolerance>;
  includeHoleBoundaries?: boolean;
  minimumSharedBoundaryMeters?: number;
}

export interface TerritoryGeometryRelationResult {
  relation: TerritoryGeometryRelation;
  sharedBoundaryMeters: number;
  touchPointCount: number;
  confidence: number;
  measurementMethod: "geodesic-haversine";
}

export interface TerritoryAdjacencyBuildOptions {
  relationMode?: "shared-border" | "all";
  sameParentOnly?: boolean;
  sameAdminLevelOnly?: boolean;
  includePointTouches?: boolean;
  minimumSharedBoundaryMeters?: number;
  epsilon?: number;
  qualityChecks?: GeometryQualityChecks;
  batchSize?: number;
  strict?: boolean;
  overrides?: TerritoryAdjacencyOverrides;
  onProgress?: (progress: TerritoryAdjacencyProgress) => void;
  signal?: AbortSignal;
}

export interface TerritoryAdjacencyProgress {
  phase: "quality" | "candidates" | "exact-relations" | "overrides" | "artifact";
  processedPairs?: number;
  totalPairs?: number;
}

export interface TerritoryAdjacencyBuildStatistics {
  zoneCount: number;
  eligibleZoneCount: number;
  skippedZoneCount: number;
  candidatePairCount: number;
  exactComparisonCount: number;
  disjointPairCount: number;
  sharedBorderCount: number;
  pointTouchCount: number;
  overlapRejectedCount: number;
  ambiguousCount: number;
  manualAddCount: number;
  manualRemoveCount: number;
  finalEdgeCount: number;
  totalSharedBoundaryMeters: number;
  durationMs?: number;
}

export interface TerritoryAdjacencyArtifact {
  artifactVersion: "1";
  dataset: {
    id: string;
    version: string;
    contentHash: string;
  };
  generatedBy: {
    package: string;
    version: string;
  };
  generatedAt: string;
  measurement: {
    sharedBoundary: "geodesic-haversine";
    holeBoundaryPolicy: "outer-rings-only" | "outer-and-hole-rings";
  };
  options: {
    sameParentOnly: boolean;
    sameAdminLevelOnly: boolean;
    includePointTouches: boolean;
    minimumSharedBoundaryMeters: number;
    epsilon: number;
  };
  tolerance: TerritoryAdjacencyTolerance;
  statistics: TerritoryAdjacencyBuildStatistics;
  overrides: {
    addCount: number;
    removeCount: number;
  };
  edges: TerritoryAdjacencyEdge[];
  contentHash: string;
}

export type TerritoryAdjacencyValidationSeverity = "error" | "warning";
export type TerritoryAdjacencyValidationCode =
  | "ARTIFACT_VERSION"
  | "DATASET_ID_MISMATCH"
  | "DATASET_VERSION_MISMATCH"
  | "DATASET_HASH_MISMATCH"
  | "UNKNOWN_ZONE"
  | "SELF_ADJACENCY"
  | "DUPLICATE_EDGE"
  | "REVERSE_DUPLICATE"
  | "INVALID_TYPE"
  | "INVALID_SOURCE"
  | "INVALID_SHARED_BOUNDARY"
  | "COMPUTED_MARITIME"
  | "MISSING_MANUAL_REASON"
  | "INVALID_CONFIDENCE"
  | "UNSORTED_EDGES"
  | "CHECKSUM_MISMATCH";

export interface TerritoryAdjacencyValidationIssue {
  code: TerritoryAdjacencyValidationCode;
  severity: TerritoryAdjacencyValidationSeverity;
  message: string;
  path: string;
  edgeIndex?: number;
  zoneId?: string;
}

export interface TerritoryAdjacencyValidationReport {
  ok: boolean;
  issues: TerritoryAdjacencyValidationIssue[];
}

export interface TerritoryAdjacencyQueryOptions {
  types?: TerritoryAdjacencyType[];
}

export interface TerritoryAdjacencyIndex {
  getNeighbors(zoneId: string, options?: TerritoryAdjacencyQueryOptions): string[];
  areAdjacent(a: string, b: string, options?: TerritoryAdjacencyQueryOptions): boolean;
  getRelation(
    a: string,
    b: string,
    options?: TerritoryAdjacencyQueryOptions
  ): TerritoryAdjacencyEdge[];
}

const DEFAULT_COORDINATE_EPSILON = 1e-9;
const DEFAULT_LENGTH_EPSILON_METERS = 0.001;
const EARTH_RADIUS_METERS = 6_371_008.8;
const ADJACENCY_TYPES: readonly TerritoryAdjacencyType[] = [
  "shared-border",
  "point-touch",
  "maritime",
  "logical"
];
const ADJACENCY_SOURCES: readonly TerritoryAdjacencySource[] = ["computed", "manual"];

export function createTerritoryAdjacencyTolerance(
  input: Partial<TerritoryAdjacencyTolerance> & { epsilon?: number } = {}
): TerritoryAdjacencyTolerance {
  const coordinateEpsilon = readNonNegativeNumber(
    input.coordinateEpsilon ?? input.epsilon,
    DEFAULT_COORDINATE_EPSILON
  );

  return {
    coordinateEpsilon,
    collinearityEpsilon: readNonNegativeNumber(input.collinearityEpsilon, coordinateEpsilon),
    lengthEpsilonMeters: readNonNegativeNumber(
      input.lengthEpsilonMeters,
      DEFAULT_LENGTH_EPSILON_METERS
    )
  };
}

export function canonicalTerritoryAdjacencyPair(a: string, b: string): TerritoryAdjacencyPair {
  return a <= b ? { a, b } : { a: b, b: a };
}

export function compareTerritoryAdjacencyEdges(
  left: TerritoryAdjacencyEdge,
  right: TerritoryAdjacencyEdge
): number {
  return (
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to) ||
    left.type.localeCompare(right.type) ||
    left.source.localeCompare(right.source)
  );
}

export function normalizeTerritoryAdjacencyEdge(
  edge: TerritoryAdjacencyEdge
): TerritoryAdjacencyEdge {
  const pair = canonicalTerritoryAdjacencyPair(edge.from, edge.to);
  const normalized: TerritoryAdjacencyEdge = {
    from: pair.a,
    to: pair.b,
    type: edge.type,
    source: edge.source
  };

  if (edge.sharedBoundaryMeters !== undefined) {
    normalized.sharedBoundaryMeters = roundMeters(edge.sharedBoundaryMeters);
  }

  if (edge.confidence !== undefined) {
    normalized.confidence = edge.confidence;
  }

  if (edge.properties !== undefined) {
    normalized.properties = sortJson(edge.properties) as Record<string, unknown>;
  }

  return normalized;
}

export function normalizeTerritoryAdjacencyEdges(
  edges: readonly TerritoryAdjacencyEdge[]
): TerritoryAdjacencyEdge[] {
  const byKey = new Map<string, TerritoryAdjacencyEdge>();

  for (const edge of edges) {
    const normalized = normalizeTerritoryAdjacencyEdge(edge);
    const key = edgeKey(normalized);
    const existing = byKey.get(key);

    if (!existing || (existing.source === "computed" && normalized.source === "manual")) {
      byKey.set(key, normalized);
    }
  }

  return [...byKey.values()].sort(compareTerritoryAdjacencyEdges);
}

export function applyTerritoryAdjacencyOverrides(
  edges: readonly TerritoryAdjacencyEdge[],
  overrides: TerritoryAdjacencyOverrides = {}
): TerritoryAdjacencyEdge[] {
  const removedPairs = new Set(
    (overrides.remove ?? []).map((remove) =>
      pairKey(canonicalTerritoryAdjacencyPair(remove.a, remove.b))
    )
  );
  const next = normalizeTerritoryAdjacencyEdges(edges).filter(
    (edge) => !removedPairs.has(pairKey({ a: edge.from, b: edge.to }))
  );

  for (const add of overrides.add ?? []) {
    const pair = canonicalTerritoryAdjacencyPair(add.a, add.b);
    const edge: TerritoryAdjacencyEdge = {
      from: pair.a,
      to: pair.b,
      type: add.type,
      source: "manual",
      properties: sortJson({
        ...(add.properties ?? {}),
        ...(add.reason ? { reason: add.reason } : {}),
        ...(add.sourceReference ? { sourceReference: add.sourceReference } : {})
      }) as Record<string, unknown>
    };
    next.push(edge);
  }

  return normalizeTerritoryAdjacencyEdges(next);
}

export function getTerritoryBoundarySegments(
  featureId: string,
  geometry: TerritoryGeometry,
  options: { includeHoles?: boolean } = {}
): TerritoryBoundarySegment[] {
  const segments: TerritoryBoundarySegment[] = [];

  for (const [polygonIndex, polygon] of geometryToPolygons(geometry).entries()) {
    const rings = options.includeHoles ? polygon : polygon.slice(0, 1);

    for (const [ringIndex, ring] of rings.entries()) {
      for (let segmentIndex = 0; segmentIndex < ring.length - 1; segmentIndex += 1) {
        const start = ring[segmentIndex];
        const end = ring[segmentIndex + 1];

        if (!start || !end || pointsEqual(start, end, 0)) {
          continue;
        }

        segments.push({
          featureId,
          polygonIndex,
          ringIndex,
          segmentIndex,
          start,
          end,
          bbox: segmentBBox(start, end)
        });
      }
    }
  }

  return segments.sort(
    (left, right) =>
      left.bbox[0] - right.bbox[0] ||
      left.bbox[1] - right.bbox[1] ||
      left.polygonIndex - right.polygonIndex ||
      left.ringIndex - right.ringIndex ||
      left.segmentIndex - right.segmentIndex
  );
}

export function classifyTerritoryGeometryRelation(
  left: TerritoryGeometry,
  right: TerritoryGeometry,
  options: TerritoryGeometryRelationOptions = {}
): TerritoryGeometryRelationResult {
  const tolerance = createTerritoryAdjacencyTolerance({
    ...(options.tolerance ?? {}),
    ...(options.epsilon === undefined ? {} : { epsilon: options.epsilon })
  });
  const minimumSharedBoundaryMeters = readNonNegativeNumber(options.minimumSharedBoundaryMeters, 0);
  const leftBBox = computeGeometryBBox(left);
  const rightBBox = computeGeometryBBox(right);

  if (!bboxesIntersect(leftBBox, rightBBox, tolerance.coordinateEpsilon)) {
    return relationResult("disjoint");
  }

  const leftCoversRight = geometryCoversGeometry(left, right, tolerance.coordinateEpsilon);
  const rightCoversLeft = geometryCoversGeometry(right, left, tolerance.coordinateEpsilon);

  if (leftCoversRight && rightCoversLeft) {
    return relationResult("equal");
  }

  if (leftCoversRight) {
    return relationResult("contains");
  }

  if (rightCoversLeft) {
    return relationResult("within");
  }

  if (geometriesOverlapPositive(left, right, tolerance.coordinateEpsilon)) {
    return relationResult("overlap");
  }

  const sharedBoundaryMeters = computeSharedBoundaryMeters(left, right, {
    includeHoles: options.includeHoleBoundaries ?? false,
    tolerance
  });

  if (
    sharedBoundaryMeters > tolerance.lengthEpsilonMeters &&
    sharedBoundaryMeters + tolerance.lengthEpsilonMeters >= minimumSharedBoundaryMeters
  ) {
    return {
      relation: "shared-border",
      sharedBoundaryMeters: roundMeters(sharedBoundaryMeters),
      touchPointCount: 0,
      confidence: 1,
      measurementMethod: "geodesic-haversine"
    };
  }

  const touchPointCount = countBoundaryTouchPoints(left, right, {
    includeHoles: options.includeHoleBoundaries ?? false,
    tolerance
  });

  if (touchPointCount > 0) {
    return {
      relation: "point-touch",
      sharedBoundaryMeters: 0,
      touchPointCount,
      confidence: 0.95,
      measurementMethod: "geodesic-haversine"
    };
  }

  return relationResult("disjoint");
}

export function computeSharedBoundaryMeters(
  left: TerritoryGeometry,
  right: TerritoryGeometry,
  options: {
    includeHoles?: boolean;
    tolerance?: TerritoryAdjacencyTolerance;
  } = {}
): number {
  const tolerance = options.tolerance ?? createTerritoryAdjacencyTolerance();
  const leftSegments = getTerritoryBoundarySegments("left", left, {
    includeHoles: options.includeHoles ?? false
  });
  const rightSegments = getTerritoryBoundarySegments("right", right, {
    includeHoles: options.includeHoles ?? false
  });
  const overlaps = new Map<string, [LngLat, LngLat]>();

  for (const leftSegment of leftSegments) {
    for (const rightSegment of rightSegments) {
      if (!bboxesIntersect(leftSegment.bbox, rightSegment.bbox, tolerance.coordinateEpsilon)) {
        continue;
      }

      const overlap = collinearOverlap(leftSegment, rightSegment, tolerance);

      if (!overlap) {
        continue;
      }

      overlaps.set(segmentKey(overlap[0], overlap[1], tolerance.coordinateEpsilon), overlap);
    }
  }

  let total = 0;

  for (const [start, end] of overlaps.values()) {
    total += haversineMeters(start, end);
  }

  return roundMeters(total);
}

export function computeTerritoryAdjacencyContentHash(
  artifact: Omit<TerritoryAdjacencyArtifact, "contentHash"> & { contentHash?: string }
): string {
  const stableArtifact = stripRuntimeArtifactFields(artifact);
  return `fnv1a32:${fnv1a32(stableStringify(stableArtifact))}`;
}

export function validateTerritoryAdjacencyArtifact(
  dataset: TerritoryDataset,
  artifact: TerritoryAdjacencyArtifact
): TerritoryAdjacencyValidationReport {
  const issues: TerritoryAdjacencyValidationIssue[] = [];
  const zoneIds = new Set(dataset.zones.map((zone) => zone.id));

  if (artifact.artifactVersion !== "1") {
    issues.push({
      code: "ARTIFACT_VERSION",
      severity: "error",
      message: "Adjacency artifact version must be '1'.",
      path: "$.artifactVersion"
    });
  }

  if (artifact.dataset.id !== dataset.manifest.datasetId) {
    issues.push({
      code: "DATASET_ID_MISMATCH",
      severity: "error",
      message: "Adjacency artifact dataset id does not match the dataset manifest.",
      path: "$.dataset.id"
    });
  }

  if (artifact.dataset.version !== dataset.manifest.datasetVersion) {
    issues.push({
      code: "DATASET_VERSION_MISMATCH",
      severity: "error",
      message: "Adjacency artifact dataset version does not match the dataset manifest.",
      path: "$.dataset.version"
    });
  }

  if (artifact.dataset.contentHash !== dataset.manifest.geometryHash) {
    issues.push({
      code: "DATASET_HASH_MISMATCH",
      severity: "error",
      message: "Adjacency artifact dataset content hash does not match the dataset geometry hash.",
      path: "$.dataset.contentHash"
    });
  }

  const expectedHash = computeTerritoryAdjacencyContentHash(artifact);

  if (artifact.contentHash !== expectedHash) {
    issues.push({
      code: "CHECKSUM_MISMATCH",
      severity: "error",
      message: "Adjacency artifact content hash does not match its normalized payload.",
      path: "$.contentHash"
    });
  }

  const seen = new Set<string>();
  let previous: TerritoryAdjacencyEdge | undefined;

  artifact.edges.forEach((edge, edgeIndex) => {
    const path = `$.edges[${edgeIndex}]`;
    const typeValid = (ADJACENCY_TYPES as readonly string[]).includes(edge.type);
    const sourceValid = (ADJACENCY_SOURCES as readonly string[]).includes(edge.source);

    if (!typeValid) {
      issues.push({
        code: "INVALID_TYPE",
        severity: "error",
        message: `Invalid adjacency type '${String(edge.type)}'.`,
        path: `${path}.type`,
        edgeIndex
      });
    }

    if (!sourceValid) {
      issues.push({
        code: "INVALID_SOURCE",
        severity: "error",
        message: `Invalid adjacency source '${String(edge.source)}'.`,
        path: `${path}.source`,
        edgeIndex
      });
    }

    if (!zoneIds.has(edge.from)) {
      issues.push({
        code: "UNKNOWN_ZONE",
        severity: "error",
        message: `Unknown adjacency zone '${edge.from}'.`,
        path: `${path}.from`,
        edgeIndex,
        zoneId: edge.from
      });
    }

    if (!zoneIds.has(edge.to)) {
      issues.push({
        code: "UNKNOWN_ZONE",
        severity: "error",
        message: `Unknown adjacency zone '${edge.to}'.`,
        path: `${path}.to`,
        edgeIndex,
        zoneId: edge.to
      });
    }

    if (edge.from === edge.to) {
      issues.push({
        code: "SELF_ADJACENCY",
        severity: "error",
        message: "Adjacency edge cannot connect a zone to itself.",
        path,
        edgeIndex,
        zoneId: edge.from
      });
    }

    if (edge.from > edge.to) {
      issues.push({
        code: "REVERSE_DUPLICATE",
        severity: "error",
        message: "Adjacency edges must use canonical lexical pair order.",
        path,
        edgeIndex
      });
    }

    if (previous && compareTerritoryAdjacencyEdges(previous, edge) > 0) {
      issues.push({
        code: "UNSORTED_EDGES",
        severity: "error",
        message: "Adjacency edges must be sorted deterministically.",
        path,
        edgeIndex
      });
    }

    const key = edgeKey(edge);

    if (seen.has(key)) {
      issues.push({
        code: "DUPLICATE_EDGE",
        severity: "error",
        message: "Duplicate adjacency edge for the same pair and type.",
        path,
        edgeIndex
      });
    }

    seen.add(key);

    if (edge.sharedBoundaryMeters !== undefined) {
      if (!Number.isFinite(edge.sharedBoundaryMeters) || edge.sharedBoundaryMeters < 0) {
        issues.push({
          code: "INVALID_SHARED_BOUNDARY",
          severity: "error",
          message: "Shared boundary length must be a non-negative finite number.",
          path: `${path}.sharedBoundaryMeters`,
          edgeIndex
        });
      }
    }

    if (edge.type === "maritime" && edge.source === "computed") {
      issues.push({
        code: "COMPUTED_MARITIME",
        severity: "error",
        message: "Maritime adjacency must not be produced by computed polygon contact.",
        path,
        edgeIndex
      });
    }

    if (
      edge.source === "manual" &&
      (!edge.properties ||
        typeof edge.properties.reason !== "string" ||
        edge.properties.reason.length === 0)
    ) {
      issues.push({
        code: "MISSING_MANUAL_REASON",
        severity: "warning",
        message: "Manual adjacency should include a reason in properties.reason.",
        path,
        edgeIndex
      });
    }

    if (
      edge.confidence !== undefined &&
      (!Number.isFinite(edge.confidence) || edge.confidence < 0 || edge.confidence > 1)
    ) {
      issues.push({
        code: "INVALID_CONFIDENCE",
        severity: "error",
        message: "Adjacency confidence must be between 0 and 1.",
        path: `${path}.confidence`,
        edgeIndex
      });
    }

    previous = edge;
  });

  const sortedIssues = issues.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code) ||
      (left.edgeIndex ?? -1) - (right.edgeIndex ?? -1)
  );

  return {
    ok: sortedIssues.every((issue) => issue.severity !== "error"),
    issues: sortedIssues
  };
}

export function createTerritoryAdjacencyIndex(
  artifact: Pick<TerritoryAdjacencyArtifact, "edges">
): TerritoryAdjacencyIndex {
  const edgesByZoneId = new Map<string, TerritoryAdjacencyEdge[]>();
  const edgesByPair = new Map<string, TerritoryAdjacencyEdge[]>();

  for (const edge of artifact.edges.map(normalizeTerritoryAdjacencyEdge)) {
    const fromEdges = edgesByZoneId.get(edge.from) ?? [];
    fromEdges.push(edge);
    edgesByZoneId.set(edge.from, fromEdges);

    const toEdges = edgesByZoneId.get(edge.to) ?? [];
    toEdges.push(edge);
    edgesByZoneId.set(edge.to, toEdges);

    const key = pairKey({ a: edge.from, b: edge.to });
    const pairEdges = edgesByPair.get(key) ?? [];
    pairEdges.push(edge);
    edgesByPair.set(key, pairEdges);
  }

  for (const [zoneId, edges] of edgesByZoneId.entries()) {
    edgesByZoneId.set(zoneId, edges.sort(compareTerritoryAdjacencyEdges));
  }

  for (const [key, edges] of edgesByPair.entries()) {
    edgesByPair.set(key, edges.sort(compareTerritoryAdjacencyEdges));
  }

  function filterEdges(
    edges: readonly TerritoryAdjacencyEdge[],
    options: TerritoryAdjacencyQueryOptions = {}
  ): TerritoryAdjacencyEdge[] {
    if (!options.types || options.types.length === 0) {
      return [...edges];
    }

    const allowed = new Set(options.types);
    return edges.filter((edge) => allowed.has(edge.type));
  }

  return {
    getNeighbors(zoneId, options = {}) {
      const neighbors = new Set<string>();

      for (const edge of filterEdges(edgesByZoneId.get(zoneId) ?? [], options)) {
        neighbors.add(edge.from === zoneId ? edge.to : edge.from);
      }

      return [...neighbors].sort();
    },

    areAdjacent(a, b, options = {}) {
      return this.getRelation(a, b, options).length > 0;
    },

    getRelation(a, b, options = {}) {
      const pair = canonicalTerritoryAdjacencyPair(a, b);
      return filterEdges(edgesByPair.get(pairKey(pair)) ?? [], options);
    }
  };
}

function relationResult(relation: TerritoryGeometryRelation): TerritoryGeometryRelationResult {
  return {
    relation,
    sharedBoundaryMeters: 0,
    touchPointCount: 0,
    confidence: relation === "disjoint" ? 1 : 0.9,
    measurementMethod: "geodesic-haversine"
  };
}

function countBoundaryTouchPoints(
  left: TerritoryGeometry,
  right: TerritoryGeometry,
  options: { includeHoles: boolean; tolerance: TerritoryAdjacencyTolerance }
): number {
  const leftSegments = getTerritoryBoundarySegments("left", left, {
    includeHoles: options.includeHoles
  });
  const rightSegments = getTerritoryBoundarySegments("right", right, {
    includeHoles: options.includeHoles
  });
  const points = new Set<string>();

  for (const leftSegment of leftSegments) {
    for (const rightSegment of rightSegments) {
      if (
        !bboxesIntersect(leftSegment.bbox, rightSegment.bbox, options.tolerance.coordinateEpsilon)
      ) {
        continue;
      }

      for (const point of segmentTouchPoints(leftSegment, rightSegment, options.tolerance)) {
        points.add(pointKey(point, options.tolerance.coordinateEpsilon));
      }
    }
  }

  return points.size;
}

function segmentTouchPoints(
  left: TerritoryBoundarySegment,
  right: TerritoryBoundarySegment,
  tolerance: TerritoryAdjacencyTolerance
): LngLat[] {
  const candidates = [left.start, left.end, right.start, right.end];

  return candidates.filter(
    (point, index) =>
      candidates.findIndex((candidate) =>
        pointsEqual(candidate, point, tolerance.coordinateEpsilon)
      ) === index &&
      pointOnSegment(left.start, left.end, point, tolerance.coordinateEpsilon) &&
      pointOnSegment(right.start, right.end, point, tolerance.coordinateEpsilon)
  );
}

function collinearOverlap(
  left: TerritoryBoundarySegment,
  right: TerritoryBoundarySegment,
  tolerance: TerritoryAdjacencyTolerance
): [LngLat, LngLat] | undefined {
  if (
    Math.abs(direction(left.start, left.end, right.start)) > tolerance.collinearityEpsilon ||
    Math.abs(direction(left.start, left.end, right.end)) > tolerance.collinearityEpsilon
  ) {
    return undefined;
  }

  const axis = chooseProjectionAxis(left.start, left.end, right.start, right.end);
  const leftStart = left.start[axis];
  const leftEnd = left.end[axis];
  const rightStart = right.start[axis];
  const rightEnd = right.end[axis];
  const overlapStart = Math.max(Math.min(leftStart, leftEnd), Math.min(rightStart, rightEnd));
  const overlapEnd = Math.min(Math.max(leftStart, leftEnd), Math.max(rightStart, rightEnd));

  if (overlapEnd - overlapStart <= tolerance.coordinateEpsilon) {
    return undefined;
  }

  const start = pointAtAxisValue(left.start, left.end, axis, overlapStart);
  const end = pointAtAxisValue(left.start, left.end, axis, overlapEnd);

  if (haversineMeters(start, end) <= tolerance.lengthEpsilonMeters) {
    return undefined;
  }

  return canonicalSegment(start, end);
}

function chooseProjectionAxis(...points: LngLat[]): 0 | 1 {
  const longitudes = points.map((point) => point[0]);
  const latitudes = points.map((point) => point[1]);
  return Math.max(...longitudes) - Math.min(...longitudes) >=
    Math.max(...latitudes) - Math.min(...latitudes)
    ? 0
    : 1;
}

function pointAtAxisValue(start: LngLat, end: LngLat, axis: 0 | 1, value: number): LngLat {
  const delta = end[axis] - start[axis];

  if (Math.abs(delta) <= Number.EPSILON) {
    return [...start] as LngLat;
  }

  const ratio = (value - start[axis]) / delta;
  return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
}

function canonicalSegment(start: LngLat, end: LngLat): [LngLat, LngLat] {
  return comparePoints(start, end) <= 0 ? [start, end] : [end, start];
}

function segmentKey(start: LngLat, end: LngLat, epsilon: number): string {
  const [a, b] = canonicalSegment(start, end);
  return `${pointKey(a, epsilon)}|${pointKey(b, epsilon)}`;
}

function edgeKey(edge: Pick<TerritoryAdjacencyEdge, "from" | "to" | "type">): string {
  const pair = canonicalTerritoryAdjacencyPair(edge.from, edge.to);
  return `${pair.a}\0${pair.b}\0${edge.type}`;
}

function pairKey(pair: TerritoryAdjacencyPair): string {
  return `${pair.a}\0${pair.b}`;
}

function geometriesOverlapPositive(
  left: TerritoryGeometry,
  right: TerritoryGeometry,
  epsilon: number
): boolean {
  for (const leftPolygon of geometryToPolygons(left)) {
    for (const rightPolygon of geometryToPolygons(right)) {
      if (polygonsOverlapPositive(leftPolygon, rightPolygon, epsilon)) {
        return true;
      }
    }
  }

  return false;
}

function polygonsOverlapPositive(left: LngLat[][], right: LngLat[][], epsilon: number): boolean {
  const leftShell = left[0];
  const rightShell = right[0];

  if (!leftShell || !rightShell) {
    return false;
  }

  return (
    ringHasStrictPointInPolygon(leftShell, right, epsilon) ||
    ringHasStrictPointInPolygon(rightShell, left, epsilon) ||
    polygonBoundariesProperlyIntersect(left, right, epsilon)
  );
}

function ringHasStrictPointInPolygon(
  ring: LngLat[],
  polygon: LngLat[][],
  epsilon: number
): boolean {
  return ring
    .slice(0, -1)
    .some(
      (point) =>
        polygonCoversPoint(polygon, point, epsilon) &&
        classifyPointInRing(point, polygon[0] ?? [], epsilon) === "inside"
    );
}

function polygonBoundariesProperlyIntersect(
  left: LngLat[][],
  right: LngLat[][],
  epsilon: number
): boolean {
  for (const leftRing of left) {
    for (const rightRing of right) {
      for (const leftSegment of ringSegments(leftRing)) {
        for (const rightSegment of ringSegments(rightRing)) {
          if (
            bboxesIntersect(leftSegment.bbox, rightSegment.bbox, epsilon) &&
            segmentsProperlyCross(
              leftSegment.start,
              leftSegment.end,
              rightSegment.start,
              rightSegment.end,
              epsilon
            )
          ) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

function geometryCoversGeometry(
  container: TerritoryGeometry,
  subject: TerritoryGeometry,
  epsilon: number
): boolean {
  if (!bboxContains(computeGeometryBBox(container), computeGeometryBBox(subject), epsilon)) {
    return false;
  }

  return geometryToPolygons(subject).every((polygon) =>
    (polygon[0] ?? []).slice(0, -1).every((point) => geometryCoversPoint(container, point, epsilon))
  );
}

function geometryCoversPoint(geometry: TerritoryGeometry, point: LngLat, epsilon: number): boolean {
  return geometryToPolygons(geometry).some((polygon) =>
    polygonCoversPoint(polygon, point, epsilon)
  );
}

function polygonCoversPoint(polygon: LngLat[][], point: LngLat, epsilon: number): boolean {
  const shell = polygon[0];

  if (!shell || classifyPointInRing(point, shell, epsilon) === "outside") {
    return false;
  }

  return polygon.slice(1).every((hole) => classifyPointInRing(point, hole, epsilon) !== "inside");
}

function classifyPointInRing(
  point: LngLat,
  ring: LngLat[],
  epsilon: number
): "inside" | "outside" | "boundary" {
  let inside = false;

  for (
    let index = 0, previousIndex = ring.length - 1;
    index < ring.length;
    previousIndex = index, index += 1
  ) {
    const current = ring[index];
    const previous = ring[previousIndex];

    if (!current || !previous) {
      continue;
    }

    if (pointOnSegment(previous, current, point, epsilon)) {
      return "boundary";
    }

    const intersects =
      current[1] > point[1] !== previous[1] > point[1] &&
      point[0] <
        ((previous[0] - current[0]) * (point[1] - current[1])) / (previous[1] - current[1]) +
          current[0];

    if (intersects) {
      inside = !inside;
    }
  }

  return inside ? "inside" : "outside";
}

function ringSegments(ring: LngLat[]): Array<{ start: LngLat; end: LngLat; bbox: TerritoryBBox }> {
  const segments: Array<{ start: LngLat; end: LngLat; bbox: TerritoryBBox }> = [];

  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];

    if (start && end && !pointsEqual(start, end, 0)) {
      segments.push({ start, end, bbox: segmentBBox(start, end) });
    }
  }

  return segments;
}

function segmentsProperlyCross(
  a1: LngLat,
  a2: LngLat,
  b1: LngLat,
  b2: LngLat,
  epsilon: number
): boolean {
  const d1 = direction(a1, a2, b1);
  const d2 = direction(a1, a2, b2);
  const d3 = direction(b1, b2, a1);
  const d4 = direction(b1, b2, a2);

  return (
    ((d1 > epsilon && d2 < -epsilon) || (d1 < -epsilon && d2 > epsilon)) &&
    ((d3 > epsilon && d4 < -epsilon) || (d3 < -epsilon && d4 > epsilon))
  );
}

function pointOnSegment(a: LngLat, b: LngLat, point: LngLat, epsilon: number): boolean {
  return (
    Math.abs(direction(a, b, point)) <= epsilon &&
    point[0] >= Math.min(a[0], b[0]) - epsilon &&
    point[0] <= Math.max(a[0], b[0]) + epsilon &&
    point[1] >= Math.min(a[1], b[1]) - epsilon &&
    point[1] <= Math.max(a[1], b[1]) + epsilon
  );
}

function direction(a: LngLat, b: LngLat, c: LngLat): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentBBox(start: LngLat, end: LngLat): TerritoryBBox {
  return [
    Math.min(start[0], end[0]),
    Math.min(start[1], end[1]),
    Math.max(start[0], end[0]),
    Math.max(start[1], end[1])
  ];
}

function bboxesIntersect(left: TerritoryBBox, right: TerritoryBBox, epsilon: number): boolean {
  return !(
    left[2] < right[0] - epsilon ||
    right[2] < left[0] - epsilon ||
    left[3] < right[1] - epsilon ||
    right[3] < left[1] - epsilon
  );
}

function bboxContains(container: TerritoryBBox, subject: TerritoryBBox, epsilon: number): boolean {
  return (
    subject[0] >= container[0] - epsilon &&
    subject[1] >= container[1] - epsilon &&
    subject[2] <= container[2] + epsilon &&
    subject[3] <= container[3] + epsilon
  );
}

function pointsEqual(left: LngLat, right: LngLat, epsilon: number): boolean {
  return Math.abs(left[0] - right[0]) <= epsilon && Math.abs(left[1] - right[1]) <= epsilon;
}

function comparePoints(left: LngLat, right: LngLat): number {
  return left[0] - right[0] || left[1] - right[1];
}

function pointKey(point: LngLat, epsilon: number): string {
  const scale = epsilon > 0 ? 1 / epsilon : 1_000_000_000_000;
  return `${Math.round(point[0] * scale) / scale},${Math.round(point[1] * scale) / scale}`;
}

function haversineMeters(start: LngLat, end: LngLat): number {
  const startLatitude = toRadians(start[1]);
  const endLatitude = toRadians(end[1]);
  const deltaLatitude = toRadians(end[1] - start[1]);
  const deltaLongitude = toRadians(end[0] - start[0]);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(deltaLongitude / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function roundMeters(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function readNonNegativeNumber(input: number | undefined, fallback: number): number {
  return Number.isFinite(input) && input !== undefined && input >= 0 ? input : fallback;
}

function stripRuntimeArtifactFields(
  artifact: Omit<TerritoryAdjacencyArtifact, "contentHash"> & { contentHash?: string }
): unknown {
  const {
    contentHash: _contentHash,
    generatedAt: _generatedAt,
    statistics,
    ...stableArtifact
  } = artifact;
  const { durationMs: _durationMs, ...stableStatistics } = statistics;

  return {
    ...stableArtifact,
    statistics: stableStatistics
  };
}

function stableStringify(input: unknown): string {
  return JSON.stringify(sortJson(input));
}

function sortJson(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((value) => sortJson(value));
  }

  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, sortJson(value)])
    );
  }

  return input;
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
