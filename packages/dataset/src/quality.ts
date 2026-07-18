import { computeGeometryBBox, computeGeometryCenter, geometryToPolygons } from "./geometry.js";
import type {
  LngLat,
  TerritoryBBox,
  TerritoryDataset,
  TerritoryGeometry,
  TerritoryZone
} from "./types.js";

export type GeometryQualityMode = "validate-only" | "repair";
export type GeometryQualityBackendId = "typescript" | "postgis";
export type GeometryQualityCheckPreset = "basic" | "full";
export type GeometryQualityCheckName =
  | "coordinates"
  | "rings"
  | "selfIntersections"
  | "holes"
  | "bbox"
  | "center"
  | "antimeridian"
  | "parentContainment"
  | "siblingOverlaps";
export type GeometryQualitySeverity = "error" | "warning" | "info";
export type GeometryRepairStrategy = "safe" | "postgis-make-valid";

export type GeometryQualityIssueCode =
  | "GEOMETRY_TYPE_INVALID"
  | "GEOMETRY_COORDINATES_INVALID"
  | "COORDINATE_NOT_FINITE"
  | "COORDINATE_OUT_OF_RANGE"
  | "CONSECUTIVE_DUPLICATE_COORDINATE"
  | "RING_TOO_SHORT"
  | "RING_NOT_CLOSED"
  | "RING_ZERO_AREA"
  | "RING_ORIENTATION"
  | "SELF_INTERSECTION"
  | "HOLE_OUTSIDE_SHELL"
  | "HOLE_SHELL_INTERSECTION"
  | "HOLE_OVERLAP"
  | "DUPLICATE_HOLE"
  | "MULTIPOLYGON_COMPONENT_OVERLAP"
  | "DUPLICATE_MULTIPOLYGON_COMPONENT"
  | "BBOX_INVALID"
  | "BBOX_MISMATCH"
  | "CENTER_INVALID"
  | "CENTER_OUTSIDE_BBOX"
  | "CENTER_OUTSIDE_GEOMETRY"
  | "ANTIMERIDIAN_CROSSING"
  | "ANTIMERIDIAN_BBOX_POLICY"
  | "PARENT_DOES_NOT_COVER_CHILD"
  | "SIBLING_GEOMETRY_OVERLAP";

export interface GeometryQualityChecks {
  coordinates?: boolean;
  rings?: boolean;
  selfIntersections?: boolean;
  holes?: boolean;
  bbox?: boolean;
  center?: boolean;
  antimeridian?: boolean;
  parentContainment?: boolean;
  siblingOverlaps?: boolean;
}

export interface NormalizedGeometryQualityChecks {
  coordinates: boolean;
  rings: boolean;
  selfIntersections: boolean;
  holes: boolean;
  bbox: boolean;
  center: boolean;
  antimeridian: boolean;
  parentContainment: boolean;
  siblingOverlaps: boolean;
}

export interface GeometryQualityOptions {
  mode?: GeometryQualityMode;
  checks?: GeometryQualityCheckPreset | GeometryQualityChecks;
  strict?: boolean;
  backend?: GeometryQualityBackend;
  epsilon?: number;
  batchSize?: number;
  allowHoleBoundaryTouch?: boolean;
}

export interface GeometryRepairOptions extends GeometryQualityOptions {
  repairStrategy?: GeometryRepairStrategy;
  maximumAreaDeltaRatio?: number;
  normalizeRingOrientation?: boolean;
}

export interface GeometryQualityIssue {
  code: GeometryQualityIssueCode;
  severity: GeometryQualitySeverity;
  check: GeometryQualityCheckName;
  message: string;
  path: string;
  zoneId?: string;
  featureId?: string;
  otherZoneId?: string;
  parentId?: string;
  polygonIndex?: number;
  ringIndex?: number;
  coordinateIndex?: number;
  repairable: boolean;
  repairSuggestion?: string;
  details?: Record<string, unknown>;
}

export interface GeometryQualityPerformance {
  candidatePairCount: number;
  exactComparisonCount: number;
  durationMs: number;
}

export interface GeometryQualitySummary {
  zoneCount: number;
  validFeatureCount: number;
  invalidFeatureCount: number;
  polygonCount: number;
  multiPolygonCount: number;
  ringCount: number;
  coordinateCount: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  repairedFeatureCount: number;
  backend: GeometryQualityBackendId;
  checks: NormalizedGeometryQualityChecks;
  performance: GeometryQualityPerformance;
}

export interface GeometryQualityReport {
  ok: boolean;
  mode: GeometryQualityMode;
  strict: boolean;
  backend: GeometryQualityBackendId;
  checks: NormalizedGeometryQualityChecks;
  summary: GeometryQualitySummary;
  issues: GeometryQualityIssue[];
  repairs?: GeometryRepairRecord[];
  repairSummary?: GeometryRepairSummary;
  revalidation?: GeometryQualityReport;
}

export type GeometryRepairOperationType =
  | "close-ring"
  | "remove-consecutive-duplicate-coordinate"
  | "recompute-bbox"
  | "recompute-center"
  | "normalize-ring-orientation";

export interface GeometryRepairOperation {
  type: GeometryRepairOperationType;
  path: string;
  before?: unknown;
  after?: unknown;
  details?: Record<string, unknown>;
}

export interface GeometryRepairRecord {
  zoneId: string;
  geometryType: TerritoryGeometry["type"];
  originalGeometryHash: string;
  repairedGeometryHash: string;
  operations: GeometryRepairOperation[];
  areaBefore: number;
  areaAfter: number;
  areaDelta: number;
  areaDeltaRatio: number;
  accepted: boolean;
  rejectionReason?: string;
}

export interface GeometryRepairSummary {
  attemptedFeatureCount: number;
  repairedFeatureCount: number;
  rejectedFeatureCount: number;
  operationCount: number;
  maximumAreaDeltaRatio: number;
  revalidationOk: boolean;
}

export interface GeometryRepairDatasetResult {
  ok: boolean;
  dataset: TerritoryDataset;
  report: GeometryQualityReport;
  repairs: GeometryRepairRecord[];
  repairSummary: GeometryRepairSummary;
  revalidation: GeometryQualityReport;
}

export interface GeometryQualityBackend {
  readonly id: GeometryQualityBackendId;
  validate(dataset: TerritoryDataset, options?: GeometryQualityOptions): GeometryQualityReport;
  repair?(dataset: TerritoryDataset, options?: GeometryRepairOptions): GeometryRepairDatasetResult;
}

interface ValidationContext {
  checks: NormalizedGeometryQualityChecks;
  strict: boolean;
  epsilon: number;
  allowHoleBoundaryTouch: boolean;
  issues: GeometryQualityIssue[];
  invalidZoneIds: Set<string>;
  performance: GeometryQualityPerformance;
}

interface GeometryPart {
  polygons: LngLat[][][];
  polygonCount: number;
  ringCount: number;
  coordinateCount: number;
}

interface IndexedBBox {
  index: number;
  bbox: TerritoryBBox;
}

interface Segment {
  index: number;
  start: LngLat;
  end: LngLat;
  bbox: TerritoryBBox;
}

const DEFAULT_EPSILON = 1e-9;
const DEFAULT_MAXIMUM_AREA_DELTA_RATIO = 0.000001;

export const BASIC_GEOMETRY_QUALITY_CHECKS: NormalizedGeometryQualityChecks = {
  coordinates: true,
  rings: true,
  selfIntersections: false,
  holes: false,
  bbox: true,
  center: false,
  antimeridian: false,
  parentContainment: false,
  siblingOverlaps: false
};

export const FULL_GEOMETRY_QUALITY_CHECKS: NormalizedGeometryQualityChecks = {
  coordinates: true,
  rings: true,
  selfIntersections: true,
  holes: true,
  bbox: true,
  center: true,
  antimeridian: true,
  parentContainment: true,
  siblingOverlaps: true
};

export const typescriptGeometryQualityBackend: GeometryQualityBackend = {
  id: "typescript",
  validate(dataset, options) {
    return validateGeometryDatasetWithTypescript(dataset, options);
  },
  repair(dataset, options) {
    return repairGeometryDatasetWithTypescript(dataset, options);
  }
};

export function normalizeGeometryQualityChecks(
  checks: GeometryQualityCheckPreset | GeometryQualityChecks | undefined
): NormalizedGeometryQualityChecks {
  if (!checks) {
    return { ...FULL_GEOMETRY_QUALITY_CHECKS };
  }

  if (checks === "basic") {
    return { ...BASIC_GEOMETRY_QUALITY_CHECKS };
  }

  if (checks === "full") {
    return { ...FULL_GEOMETRY_QUALITY_CHECKS };
  }

  return {
    coordinates: checks.coordinates ?? false,
    rings: checks.rings ?? false,
    selfIntersections: checks.selfIntersections ?? false,
    holes: checks.holes ?? false,
    bbox: checks.bbox ?? false,
    center: checks.center ?? false,
    antimeridian: checks.antimeridian ?? false,
    parentContainment: checks.parentContainment ?? false,
    siblingOverlaps: checks.siblingOverlaps ?? false
  };
}

export function validateGeometryDataset(
  dataset: TerritoryDataset,
  options: GeometryQualityOptions = {}
): GeometryQualityReport {
  const backend = options.backend ?? typescriptGeometryQualityBackend;
  return backend.validate(dataset, options);
}

export function repairGeometryDataset(
  dataset: TerritoryDataset,
  options: GeometryRepairOptions = {}
): GeometryRepairDatasetResult {
  const backend = options.backend ?? typescriptGeometryQualityBackend;

  if (!backend.repair) {
    throw new Error(`Geometry quality backend '${backend.id}' does not implement repair.`);
  }

  return backend.repair(dataset, options);
}

export function hashTerritoryGeometry(geometry: TerritoryGeometry): string {
  return `fnv1a32:${fnv1a32(stableStringify(geometry))}`;
}

function validateGeometryDatasetWithTypescript(
  dataset: TerritoryDataset,
  options: GeometryQualityOptions = {}
): GeometryQualityReport {
  const startedAt = performance.now();
  const context: ValidationContext = {
    checks: normalizeGeometryQualityChecks(options.checks),
    strict: options.strict ?? false,
    epsilon: readPositiveNumber(options.epsilon, DEFAULT_EPSILON),
    allowHoleBoundaryTouch: options.allowHoleBoundaryTouch ?? true,
    issues: [],
    invalidZoneIds: new Set<string>(),
    performance: {
      candidatePairCount: 0,
      exactComparisonCount: 0,
      durationMs: 0
    }
  };
  let polygonCount = 0;
  let multiPolygonCount = 0;
  let ringCount = 0;
  let coordinateCount = 0;

  dataset.zones.forEach((zone, zoneIndex) => {
    const path = `$.zones[${zoneIndex}]`;
    const part = readGeometryPart(zone, zoneIndex, context);

    if (!part) {
      return;
    }

    polygonCount += part.polygonCount;
    ringCount += part.ringCount;
    coordinateCount += part.coordinateCount;

    if (zone.geometry.type === "MultiPolygon") {
      multiPolygonCount += 1;
    }

    validateZoneGeometry(zone, zoneIndex, part.polygons, context);
    validateZoneBBox(zone, path, context);
    validateZoneCenter(zone, path, context);
  });

  validateParentContainment(dataset.zones, context);
  validateSiblingOverlaps(dataset.zones, context);

  context.performance.durationMs = Math.round(performance.now() - startedAt);

  const issues = sortGeometryIssues(context.issues);
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const infoCount = issues.filter((issue) => issue.severity === "info").length;
  const summary: GeometryQualitySummary = {
    zoneCount: dataset.zones.length,
    validFeatureCount: dataset.zones.length - context.invalidZoneIds.size,
    invalidFeatureCount: context.invalidZoneIds.size,
    polygonCount,
    multiPolygonCount,
    ringCount,
    coordinateCount,
    issueCount: issues.length,
    errorCount,
    warningCount,
    infoCount,
    repairedFeatureCount: 0,
    backend: "typescript",
    checks: context.checks,
    performance: context.performance
  };

  return {
    ok: errorCount === 0,
    mode: options.mode ?? "validate-only",
    strict: context.strict,
    backend: "typescript",
    checks: context.checks,
    summary,
    issues
  };
}

function repairGeometryDatasetWithTypescript(
  dataset: TerritoryDataset,
  options: GeometryRepairOptions = {}
): GeometryRepairDatasetResult {
  if (options.repairStrategy && options.repairStrategy !== "safe") {
    throw new Error(
      `Repair strategy '${options.repairStrategy}' is not implemented by the TypeScript backend.`
    );
  }

  const maximumAreaDeltaRatio = readPositiveNumber(
    options.maximumAreaDeltaRatio,
    DEFAULT_MAXIMUM_AREA_DELTA_RATIO
  );
  const repairedDataset = cloneDataset(dataset);
  const repairs: GeometryRepairRecord[] = [];

  repairedDataset.zones = repairedDataset.zones.map((zone, zoneIndex) => {
    const originalZone = dataset.zones[zoneIndex] ?? zone;
    const operations: GeometryRepairOperation[] = [];
    const originalGeometry = originalZone.geometry;
    const repairedGeometry = repairGeometry(originalGeometry, zoneIndex, operations, {
      epsilon: readPositiveNumber(options.epsilon, DEFAULT_EPSILON),
      normalizeRingOrientation: options.normalizeRingOrientation ?? false
    });
    const computedBBox = computeGeometryBBox(repairedGeometry);
    const computedCenter = computeGeometryCenter(repairedGeometry);

    if (
      !bboxesEqual(zone.bbox, computedBBox, readPositiveNumber(options.epsilon, DEFAULT_EPSILON))
    ) {
      operations.push({
        type: "recompute-bbox",
        path: `$.zones[${zoneIndex}].bbox`,
        before: zone.bbox,
        after: computedBBox
      });
    }

    if (
      !pointsEqual(
        zone.center,
        computedCenter,
        readPositiveNumber(options.epsilon, DEFAULT_EPSILON)
      )
    ) {
      operations.push({
        type: "recompute-center",
        path: `$.zones[${zoneIndex}].center`,
        before: zone.center,
        after: computedCenter
      });
    }

    if (operations.length === 0) {
      return zone;
    }

    const areaBefore = geometryArea(originalGeometry);
    const areaAfter = geometryArea(repairedGeometry);
    const areaDelta = Math.abs(areaAfter - areaBefore);
    const areaDeltaRatio = areaDelta / Math.max(Math.abs(areaBefore), 1);
    const accepted = areaDeltaRatio <= maximumAreaDeltaRatio;
    const record: GeometryRepairRecord = {
      zoneId: zone.id,
      geometryType: zone.geometry.type,
      originalGeometryHash: hashTerritoryGeometry(originalGeometry),
      repairedGeometryHash: hashTerritoryGeometry(repairedGeometry),
      operations,
      areaBefore,
      areaAfter,
      areaDelta,
      areaDeltaRatio,
      accepted,
      ...(accepted
        ? {}
        : {
            rejectionReason: `Area delta ratio ${areaDeltaRatio} exceeds maximum ${maximumAreaDeltaRatio}.`
          })
    };
    repairs.push(record);

    if (!accepted) {
      return zone;
    }

    return {
      ...zone,
      geometry: repairedGeometry,
      bbox: computedBBox,
      center: computedCenter
    };
  });

  const revalidation = validateGeometryDatasetWithTypescript(repairedDataset, {
    ...options,
    mode: "validate-only",
    checks: options.checks ?? "full"
  });
  const rejectedFeatureCount = repairs.filter((record) => !record.accepted).length;
  const repairedFeatureCount = repairs.filter((record) => record.accepted).length;
  const repairSummary: GeometryRepairSummary = {
    attemptedFeatureCount: repairs.length,
    repairedFeatureCount,
    rejectedFeatureCount,
    operationCount: repairs.reduce((sum, record) => sum + record.operations.length, 0),
    maximumAreaDeltaRatio,
    revalidationOk: revalidation.ok
  };
  const validationReport = validateGeometryDatasetWithTypescript(dataset, {
    ...options,
    mode: "validate-only",
    checks: options.checks ?? "full"
  });
  const report: GeometryQualityReport = {
    ...validationReport,
    ok: rejectedFeatureCount === 0 && revalidation.ok,
    mode: "repair",
    repairs,
    repairSummary,
    revalidation,
    summary: {
      ...validationReport.summary,
      repairedFeatureCount
    }
  };

  return {
    ok: report.ok,
    dataset: repairedDataset,
    report,
    repairs,
    repairSummary,
    revalidation
  };
}

function validateZoneGeometry(
  zone: TerritoryZone,
  zoneIndex: number,
  polygons: LngLat[][][],
  context: ValidationContext
): void {
  for (const [polygonIndex, polygon] of polygons.entries()) {
    validatePolygon(zone, zoneIndex, polygonIndex, polygon, context);
  }

  if (context.checks.holes && polygons.length > 1) {
    validateMultiPolygonComponents(zone, zoneIndex, polygons, context);
  }
}

function validatePolygon(
  zone: TerritoryZone,
  zoneIndex: number,
  polygonIndex: number,
  polygon: LngLat[][],
  context: ValidationContext
): void {
  const shell = polygon[0];

  if (!shell) {
    addIssue(context, {
      code: "GEOMETRY_COORDINATES_INVALID",
      severity: "error",
      check: "coordinates",
      message: "Polygon must contain an outer ring.",
      path: `$.zones[${zoneIndex}].geometry.coordinates[${polygonIndex}]`,
      zoneId: zone.id,
      featureId: zone.id,
      polygonIndex,
      repairable: false
    });
    return;
  }

  for (const [ringIndex, ring] of polygon.entries()) {
    validateRingCoordinates(zone, zoneIndex, polygonIndex, ringIndex, ring, context);
    validateRingStructure(zone, zoneIndex, polygonIndex, ringIndex, ring, context);

    if (context.checks.selfIntersections) {
      validateRingSelfIntersection(zone, zoneIndex, polygonIndex, ringIndex, ring, context);
    }
  }

  if (context.checks.holes && polygon.length > 1) {
    validatePolygonHoles(zone, zoneIndex, polygonIndex, polygon, context);
  }
}

function validateRingCoordinates(
  zone: TerritoryZone,
  zoneIndex: number,
  polygonIndex: number,
  ringIndex: number,
  ring: LngLat[],
  context: ValidationContext
): void {
  if (!context.checks.coordinates && !context.checks.antimeridian) {
    return;
  }

  for (const [coordinateIndex, point] of ring.entries()) {
    const [longitude, latitude] = point;

    if (context.checks.coordinates && (!Number.isFinite(longitude) || !Number.isFinite(latitude))) {
      addIssue(context, {
        code: "COORDINATE_NOT_FINITE",
        severity: "error",
        check: "coordinates",
        message: "Coordinate values must be finite numbers.",
        path: coordinatePath(zoneIndex, polygonIndex, ringIndex, coordinateIndex),
        zoneId: zone.id,
        featureId: zone.id,
        polygonIndex,
        ringIndex,
        coordinateIndex,
        repairable: false
      });
    }

    if (
      context.checks.coordinates &&
      (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90)
    ) {
      addIssue(context, {
        code: "COORDINATE_OUT_OF_RANGE",
        severity: "error",
        check: "coordinates",
        message: "Coordinate must be in WGS84 longitude/latitude range.",
        path: coordinatePath(zoneIndex, polygonIndex, ringIndex, coordinateIndex),
        zoneId: zone.id,
        featureId: zone.id,
        polygonIndex,
        ringIndex,
        coordinateIndex,
        repairable: false
      });
    }

    const next = ring[coordinateIndex + 1];

    if (context.checks.coordinates && next && pointsEqual(point, next, context.epsilon)) {
      addIssue(context, {
        code: "CONSECUTIVE_DUPLICATE_COORDINATE",
        severity: "error",
        check: "coordinates",
        message: "Ring contains consecutive duplicate coordinates.",
        path: coordinatePath(zoneIndex, polygonIndex, ringIndex, coordinateIndex + 1),
        zoneId: zone.id,
        featureId: zone.id,
        polygonIndex,
        ringIndex,
        coordinateIndex: coordinateIndex + 1,
        repairable: true,
        repairSuggestion: "Run safe geometry repair to remove consecutive duplicate coordinates."
      });
    }

    if (
      context.checks.antimeridian &&
      next &&
      Number.isFinite(longitude) &&
      Number.isFinite(next[0]) &&
      Math.abs(next[0] - longitude) > 180 + context.epsilon
    ) {
      addIssue(context, {
        code: "ANTIMERIDIAN_CROSSING",
        severity: "warning",
        check: "antimeridian",
        message: "Segment appears to cross the antimeridian; split/unwrap policy must be explicit.",
        path: coordinatePath(zoneIndex, polygonIndex, ringIndex, coordinateIndex),
        zoneId: zone.id,
        featureId: zone.id,
        polygonIndex,
        ringIndex,
        coordinateIndex,
        repairable: false
      });
    }
  }
}

function validateRingStructure(
  zone: TerritoryZone,
  zoneIndex: number,
  polygonIndex: number,
  ringIndex: number,
  ring: LngLat[],
  context: ValidationContext
): void {
  if (!context.checks.rings) {
    return;
  }

  const path = ringPath(zoneIndex, polygonIndex, ringIndex);

  if (ring.length < 4) {
    addIssue(context, {
      code: "RING_TOO_SHORT",
      severity: "error",
      check: "rings",
      message: "Linear ring must contain at least four coordinates.",
      path,
      zoneId: zone.id,
      featureId: zone.id,
      polygonIndex,
      ringIndex,
      repairable: false
    });
  }

  const first = ring[0];
  const last = ring[ring.length - 1];

  if (!first || !last || !pointsEqual(first, last, context.epsilon)) {
    addIssue(context, {
      code: "RING_NOT_CLOSED",
      severity: "error",
      check: "rings",
      message: "Linear ring must be closed.",
      path,
      zoneId: zone.id,
      featureId: zone.id,
      polygonIndex,
      ringIndex,
      repairable: true,
      repairSuggestion: "Run safe geometry repair to append the first coordinate to the ring."
    });
  }

  const signedArea = ringSignedArea(ring);

  if (Math.abs(signedArea) <= context.epsilon) {
    addIssue(context, {
      code: "RING_ZERO_AREA",
      severity: "error",
      check: "rings",
      message: "Linear ring area is zero or below epsilon.",
      path,
      zoneId: zone.id,
      featureId: zone.id,
      polygonIndex,
      ringIndex,
      repairable: false
    });
    return;
  }

  if ((ringIndex === 0 && signedArea < 0) || (ringIndex > 0 && signedArea > 0)) {
    addIssue(context, {
      code: "RING_ORIENTATION",
      severity: "info",
      check: "rings",
      message:
        ringIndex === 0
          ? "Outer ring is clockwise; GeoJSON-compatible datasets usually prefer counter-clockwise shells."
          : "Hole ring is counter-clockwise; GeoJSON-compatible datasets usually prefer clockwise holes.",
      path,
      zoneId: zone.id,
      featureId: zone.id,
      polygonIndex,
      ringIndex,
      repairable: true,
      repairSuggestion:
        "Pass normalizeRingOrientation to safe repair if orientation normalization is desired."
    });
  }
}

function validateRingSelfIntersection(
  zone: TerritoryZone,
  zoneIndex: number,
  polygonIndex: number,
  ringIndex: number,
  ring: LngLat[],
  context: ValidationContext
): void {
  const result = findRingSelfIntersection(ring, context.epsilon);
  context.performance.candidatePairCount += result.candidatePairCount;
  context.performance.exactComparisonCount += result.exactComparisonCount;

  if (!result.intersection) {
    return;
  }

  addIssue(context, {
    code: "SELF_INTERSECTION",
    severity: "error",
    check: "selfIntersections",
    message: "Linear ring self-intersects.",
    path: ringPath(zoneIndex, polygonIndex, ringIndex),
    zoneId: zone.id,
    featureId: zone.id,
    polygonIndex,
    ringIndex,
    repairable: false,
    details: result.intersection
  });
}

function validatePolygonHoles(
  zone: TerritoryZone,
  zoneIndex: number,
  polygonIndex: number,
  polygon: LngLat[][],
  context: ValidationContext
): void {
  const shell = polygon[0];

  if (!shell) {
    return;
  }

  const seenHoleHashes = new Map<string, number>();
  const holes = polygon.slice(1).map((ring, index) => ({
    index: index + 1,
    ring,
    bbox: ringBBox(ring)
  }));

  for (const hole of holes) {
    const hash = hashRing(hole.ring);
    const duplicateIndex = seenHoleHashes.get(hash);

    if (duplicateIndex !== undefined) {
      addIssue(context, {
        code: "DUPLICATE_HOLE",
        severity: "error",
        check: "holes",
        message: `Hole ring duplicates hole ${duplicateIndex}.`,
        path: ringPath(zoneIndex, polygonIndex, hole.index),
        zoneId: zone.id,
        featureId: zone.id,
        polygonIndex,
        ringIndex: hole.index,
        repairable: false
      });
    } else {
      seenHoleHashes.set(hash, hole.index);
    }

    if (!ringCoveredByRing(hole.ring, shell, context.epsilon, true)) {
      addIssue(context, {
        code: "HOLE_OUTSIDE_SHELL",
        severity: "error",
        check: "holes",
        message: "Hole ring is not fully covered by its polygon shell.",
        path: ringPath(zoneIndex, polygonIndex, hole.index),
        zoneId: zone.id,
        featureId: zone.id,
        polygonIndex,
        ringIndex: hole.index,
        repairable: false
      });
    }

    if (ringsIntersect(hole.ring, shell, context.epsilon, !context.allowHoleBoundaryTouch)) {
      addIssue(context, {
        code: "HOLE_SHELL_INTERSECTION",
        severity: "error",
        check: "holes",
        message: "Hole boundary intersects the polygon shell boundary.",
        path: ringPath(zoneIndex, polygonIndex, hole.index),
        zoneId: zone.id,
        featureId: zone.id,
        polygonIndex,
        ringIndex: hole.index,
        repairable: false,
        details: { allowHoleBoundaryTouch: context.allowHoleBoundaryTouch }
      });
    }
  }

  for (const [leftIndex, rightIndex] of bboxCandidatePairs(holes, context.epsilon)) {
    const left = holes[leftIndex];
    const right = holes[rightIndex];

    if (!left || !right) {
      continue;
    }

    context.performance.candidatePairCount += 1;
    context.performance.exactComparisonCount += 1;

    if (ringsOverlapPositive(left.ring, right.ring, context.epsilon)) {
      addIssue(context, {
        code: "HOLE_OVERLAP",
        severity: "error",
        check: "holes",
        message: `Hole ${left.index} overlaps hole ${right.index}.`,
        path: ringPath(zoneIndex, polygonIndex, left.index),
        zoneId: zone.id,
        featureId: zone.id,
        polygonIndex,
        ringIndex: left.index,
        repairable: false,
        details: { otherRingIndex: right.index }
      });
    }
  }
}

function validateMultiPolygonComponents(
  zone: TerritoryZone,
  zoneIndex: number,
  polygons: LngLat[][][],
  context: ValidationContext
): void {
  const components = polygons.map((polygon, index) => ({
    index,
    polygon,
    bbox: polygonBBox(polygon)
  }));
  const seenHashes = new Map<string, number>();

  for (const component of components) {
    const hash = hashPolygon(component.polygon);
    const duplicateIndex = seenHashes.get(hash);

    if (duplicateIndex !== undefined) {
      addIssue(context, {
        code: "DUPLICATE_MULTIPOLYGON_COMPONENT",
        severity: "error",
        check: "holes",
        message: `MultiPolygon component duplicates component ${duplicateIndex}.`,
        path: `$.zones[${zoneIndex}].geometry.coordinates[${component.index}]`,
        zoneId: zone.id,
        featureId: zone.id,
        polygonIndex: component.index,
        repairable: false
      });
    } else {
      seenHashes.set(hash, component.index);
    }
  }

  for (const [leftIndex, rightIndex] of bboxCandidatePairs(components, context.epsilon)) {
    const left = components[leftIndex];
    const right = components[rightIndex];

    if (!left || !right) {
      continue;
    }

    context.performance.candidatePairCount += 1;
    context.performance.exactComparisonCount += 1;

    if (polygonsOverlapPositive(left.polygon, right.polygon, context.epsilon)) {
      addIssue(context, {
        code: "MULTIPOLYGON_COMPONENT_OVERLAP",
        severity: "error",
        check: "holes",
        message: `MultiPolygon components ${left.index} and ${right.index} overlap.`,
        path: `$.zones[${zoneIndex}].geometry.coordinates[${left.index}]`,
        zoneId: zone.id,
        featureId: zone.id,
        polygonIndex: left.index,
        repairable: false,
        details: { otherPolygonIndex: right.index }
      });
    }
  }
}

function validateZoneBBox(zone: TerritoryZone, path: string, context: ValidationContext): void {
  if (!context.checks.bbox) {
    return;
  }

  const [west, south, east, north] = zone.bbox;
  const valid =
    zone.bbox.length === 4 &&
    zone.bbox.every((value) => Number.isFinite(value)) &&
    west >= -180 &&
    east <= 180 &&
    south >= -90 &&
    north <= 90 &&
    west <= east &&
    south <= north;

  if (!valid) {
    addIssue(context, {
      code: "BBOX_INVALID",
      severity: "error",
      check: "bbox",
      message: "Zone bbox must be a finite ordered WGS84 extent.",
      path: `${path}.bbox`,
      zoneId: zone.id,
      featureId: zone.id,
      repairable: true,
      repairSuggestion: "Run safe geometry repair to recompute bbox from coordinates."
    });
  }

  const computed = computeGeometryBBox(zone.geometry);

  if (!bboxesEqual(zone.bbox, computed, context.epsilon)) {
    addIssue(context, {
      code: "BBOX_MISMATCH",
      severity: "error",
      check: "bbox",
      message: "Zone bbox does not match geometry extent.",
      path: `${path}.bbox`,
      zoneId: zone.id,
      featureId: zone.id,
      repairable: true,
      repairSuggestion: `Run safe geometry repair to recompute bbox as [${computed.join(", ")}].`,
      details: { expected: computed, actual: zone.bbox }
    });
  }

  if (context.checks.antimeridian && east - west > 350) {
    addIssue(context, {
      code: "ANTIMERIDIAN_BBOX_POLICY",
      severity: "warning",
      check: "antimeridian",
      message: "Bbox spans most longitudes; antimeridian handling policy should be explicit.",
      path: `${path}.bbox`,
      zoneId: zone.id,
      featureId: zone.id,
      repairable: false
    });
  }
}

function validateZoneCenter(zone: TerritoryZone, path: string, context: ValidationContext): void {
  if (!context.checks.center) {
    return;
  }

  const [longitude, latitude] = zone.center;

  if (
    zone.center.length !== 2 ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    addIssue(context, {
      code: "CENTER_INVALID",
      severity: "error",
      check: "center",
      message: "Zone center must be a finite WGS84 coordinate.",
      path: `${path}.center`,
      zoneId: zone.id,
      featureId: zone.id,
      repairable: true,
      repairSuggestion: "Run safe geometry repair to recompute center."
    });
    return;
  }

  if (!pointInBBox(zone.center, zone.bbox, context.epsilon)) {
    addIssue(context, {
      code: "CENTER_OUTSIDE_BBOX",
      severity: "error",
      check: "center",
      message: "Zone center must fall inside the zone bbox.",
      path: `${path}.center`,
      zoneId: zone.id,
      featureId: zone.id,
      repairable: true,
      repairSuggestion: "Run safe geometry repair to recompute center."
    });
  }

  if (!geometryCoversPoint(zone.geometry, zone.center, context.epsilon)) {
    addIssue(context, {
      code: "CENTER_OUTSIDE_GEOMETRY",
      severity: "warning",
      check: "center",
      message: "Zone center falls outside the polygon area.",
      path: `${path}.center`,
      zoneId: zone.id,
      featureId: zone.id,
      repairable: true,
      repairSuggestion: "Run safe geometry repair to recompute center using the dataset policy."
    });
  }
}

function validateParentContainment(zones: TerritoryZone[], context: ValidationContext): void {
  if (!context.checks.parentContainment) {
    return;
  }

  const zonesById = new Map(zones.map((zone) => [zone.id, zone]));

  for (const [zoneIndex, zone] of zones.entries()) {
    if (!zone.parentId) {
      continue;
    }

    const parent = zonesById.get(zone.parentId);

    if (!parent) {
      continue;
    }

    context.performance.candidatePairCount += 1;

    if (!bboxContains(parent.bbox, zone.bbox, context.epsilon)) {
      addIssue(context, {
        code: "PARENT_DOES_NOT_COVER_CHILD",
        severity: "error",
        check: "parentContainment",
        message: `Parent '${parent.id}' bbox does not cover child '${zone.id}' bbox.`,
        path: `$.zones[${zoneIndex}].parentId`,
        zoneId: zone.id,
        featureId: zone.id,
        parentId: parent.id,
        repairable: false
      });
      continue;
    }

    context.performance.exactComparisonCount += 1;

    if (!geometryCoversGeometry(parent.geometry, zone.geometry, context.epsilon)) {
      addIssue(context, {
        code: "PARENT_DOES_NOT_COVER_CHILD",
        severity: "error",
        check: "parentContainment",
        message: `Parent '${parent.id}' geometry does not cover child '${zone.id}' geometry.`,
        path: `$.zones[${zoneIndex}].parentId`,
        zoneId: zone.id,
        featureId: zone.id,
        parentId: parent.id,
        repairable: false
      });
    }
  }
}

function validateSiblingOverlaps(zones: TerritoryZone[], context: ValidationContext): void {
  if (!context.checks.siblingOverlaps) {
    return;
  }

  const groups = new Map<string, TerritoryZone[]>();

  for (const zone of zones) {
    const key = `${zone.parentId ?? "__root__"}:${zone.level}`;
    groups.set(key, [...(groups.get(key) ?? []), zone]);
  }

  for (const siblings of groups.values()) {
    const indexed = siblings.map((zone, index) => ({
      index,
      zone,
      bbox: zone.bbox
    }));

    for (const [leftIndex, rightIndex] of bboxCandidatePairs(indexed, context.epsilon)) {
      const left = indexed[leftIndex];
      const right = indexed[rightIndex];

      if (!left || !right) {
        continue;
      }

      context.performance.candidatePairCount += 1;
      context.performance.exactComparisonCount += 1;

      if (geometriesOverlapPositive(left.zone.geometry, right.zone.geometry, context.epsilon)) {
        addIssue(context, {
          code: "SIBLING_GEOMETRY_OVERLAP",
          severity: "error",
          check: "siblingOverlaps",
          message: `Sibling zones '${left.zone.id}' and '${right.zone.id}' overlap.`,
          path: `$.zones[?(@.id=="${left.zone.id}")].geometry`,
          zoneId: left.zone.id,
          featureId: left.zone.id,
          otherZoneId: right.zone.id,
          repairable: false
        });
      }
    }
  }
}

function readGeometryPart(
  zone: TerritoryZone,
  zoneIndex: number,
  context: ValidationContext
): GeometryPart | undefined {
  if (zone.geometry.type !== "Polygon" && zone.geometry.type !== "MultiPolygon") {
    addIssue(context, {
      code: "GEOMETRY_TYPE_INVALID",
      severity: "error",
      check: "coordinates",
      message: "Geometry type must be Polygon or MultiPolygon.",
      path: `$.zones[${zoneIndex}].geometry.type`,
      zoneId: zone.id,
      featureId: zone.id,
      repairable: false
    });
    return undefined;
  }

  try {
    const polygons = geometryToPolygons(zone.geometry);
    let ringCount = 0;
    let coordinateCount = 0;

    for (const polygon of polygons) {
      ringCount += polygon.length;

      for (const ring of polygon) {
        coordinateCount += ring.length;
      }
    }

    return {
      polygons,
      polygonCount: polygons.length,
      ringCount,
      coordinateCount
    };
  } catch {
    addIssue(context, {
      code: "GEOMETRY_COORDINATES_INVALID",
      severity: "error",
      check: "coordinates",
      message: "Geometry coordinates must be valid Polygon or MultiPolygon arrays.",
      path: `$.zones[${zoneIndex}].geometry.coordinates`,
      zoneId: zone.id,
      featureId: zone.id,
      repairable: false
    });
    return undefined;
  }
}

function repairGeometry(
  geometry: TerritoryGeometry,
  zoneIndex: number,
  operations: GeometryRepairOperation[],
  options: { epsilon: number; normalizeRingOrientation: boolean }
): TerritoryGeometry {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: repairPolygon(
        geometry.coordinates as LngLat[][],
        zoneIndex,
        0,
        operations,
        options
      )
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: (geometry.coordinates as LngLat[][][]).map((polygon, polygonIndex) =>
      repairPolygon(polygon, zoneIndex, polygonIndex, operations, options)
    )
  };
}

function repairPolygon(
  polygon: LngLat[][],
  zoneIndex: number,
  polygonIndex: number,
  operations: GeometryRepairOperation[],
  options: { epsilon: number; normalizeRingOrientation: boolean }
): LngLat[][] {
  return polygon.map((ring, ringIndex) =>
    repairRing(ring, zoneIndex, polygonIndex, ringIndex, operations, options)
  );
}

function repairRing(
  ring: LngLat[],
  zoneIndex: number,
  polygonIndex: number,
  ringIndex: number,
  operations: GeometryRepairOperation[],
  options: { epsilon: number; normalizeRingOrientation: boolean }
): LngLat[] {
  const repaired: LngLat[] = [];

  for (const [coordinateIndex, point] of ring.entries()) {
    const previous = repaired[repaired.length - 1];

    if (previous && pointsEqual(previous, point, options.epsilon)) {
      operations.push({
        type: "remove-consecutive-duplicate-coordinate",
        path: coordinatePath(zoneIndex, polygonIndex, ringIndex, coordinateIndex),
        before: point,
        details: { keptCoordinateIndex: coordinateIndex - 1 }
      });
      continue;
    }

    repaired.push([...point] as LngLat);
  }

  const first = repaired[0];
  const last = repaired[repaired.length - 1];

  if (first && (!last || !pointsEqual(first, last, options.epsilon))) {
    repaired.push([...first] as LngLat);
    operations.push({
      type: "close-ring",
      path: ringPath(zoneIndex, polygonIndex, ringIndex),
      before: last,
      after: first
    });
  }

  if (options.normalizeRingOrientation && repaired.length >= 4) {
    const signedArea = ringSignedArea(repaired);
    const shouldReverse = (ringIndex === 0 && signedArea < 0) || (ringIndex > 0 && signedArea > 0);

    if (shouldReverse) {
      const firstPoint = repaired[0];
      const lastPoint = repaired[repaired.length - 1];
      const isClosed =
        firstPoint !== undefined &&
        lastPoint !== undefined &&
        pointsEqual(firstPoint, lastPoint, options.epsilon);
      const reversed =
        isClosed && firstPoint
          ? [...repaired.slice(0, -1).reverse(), firstPoint]
          : [...repaired].reverse();
      operations.push({
        type: "normalize-ring-orientation",
        path: ringPath(zoneIndex, polygonIndex, ringIndex),
        details: { ringIndex, signedArea }
      });
      return reversed as LngLat[];
    }
  }

  return repaired;
}

function findRingSelfIntersection(
  ring: LngLat[],
  epsilon: number
): {
  candidatePairCount: number;
  exactComparisonCount: number;
  intersection?: { segmentA: number; segmentB: number };
} {
  const segments = ringSegments(ring).sort(
    (left, right) => left.bbox[0] - right.bbox[0] || left.index - right.index
  );
  let candidatePairCount = 0;
  let exactComparisonCount = 0;

  for (const [leftSortedIndex, left] of segments.entries()) {
    for (
      let rightSortedIndex = leftSortedIndex + 1;
      rightSortedIndex < segments.length;
      rightSortedIndex += 1
    ) {
      const right = segments[rightSortedIndex];

      if (!right) {
        continue;
      }

      if (right.bbox[0] > left.bbox[2] + epsilon) {
        break;
      }

      if (areAdjacentRingSegments(left.index, right.index, ring.length - 2)) {
        continue;
      }

      if (!bboxesIntersect(left.bbox, right.bbox, epsilon)) {
        continue;
      }

      candidatePairCount += 1;
      exactComparisonCount += 1;

      if (segmentsIntersect(left.start, left.end, right.start, right.end, epsilon)) {
        return {
          candidatePairCount,
          exactComparisonCount,
          intersection: { segmentA: left.index, segmentB: right.index }
        };
      }
    }
  }

  return { candidatePairCount, exactComparisonCount };
}

function ringSegments(ring: LngLat[]): Segment[] {
  const segments: Segment[] = [];

  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];

    if (!start || !end || pointsEqual(start, end, 0)) {
      continue;
    }

    segments.push({
      index,
      start,
      end,
      bbox: [
        Math.min(start[0], end[0]),
        Math.min(start[1], end[1]),
        Math.max(start[0], end[0]),
        Math.max(start[1], end[1])
      ]
    });
  }

  return segments;
}

function areAdjacentRingSegments(left: number, right: number, lastSegmentIndex: number): boolean {
  return (
    Math.abs(left - right) <= 1 ||
    (left === 0 && right === lastSegmentIndex) ||
    (right === 0 && left === lastSegmentIndex)
  );
}

function bboxCandidatePairs<T extends IndexedBBox>(
  items: readonly T[],
  epsilon: number
): Array<[number, number]> {
  const sorted = items
    .map((item, position) => ({ item, position }))
    .sort(
      (left, right) =>
        left.item.bbox[0] - right.item.bbox[0] ||
        left.item.bbox[1] - right.item.bbox[1] ||
        left.position - right.position
    );
  const pairs: Array<[number, number]> = [];

  for (const [leftSortedIndex, left] of sorted.entries()) {
    for (
      let rightSortedIndex = leftSortedIndex + 1;
      rightSortedIndex < sorted.length;
      rightSortedIndex += 1
    ) {
      const right = sorted[rightSortedIndex];

      if (!right) {
        continue;
      }

      if (right.item.bbox[0] > left.item.bbox[2] + epsilon) {
        break;
      }

      if (bboxesIntersect(left.item.bbox, right.item.bbox, epsilon)) {
        pairs.push([left.position, right.position]);
      }
    }
  }

  return pairs;
}

function ringsOverlapPositive(left: LngLat[], right: LngLat[], epsilon: number): boolean {
  return (
    hashRing(left) === hashRing(right) ||
    ringHasStrictPointInRing(left, right, epsilon) ||
    ringHasStrictPointInRing(right, left, epsilon) ||
    ringsIntersect(left, right, epsilon, true)
  );
}

function polygonsOverlapPositive(left: LngLat[][], right: LngLat[][], epsilon: number): boolean {
  const leftShell = left[0];
  const rightShell = right[0];

  if (!leftShell || !rightShell) {
    return false;
  }

  return (
    hashPolygon(left) === hashPolygon(right) ||
    ringHasStrictPointInPolygon(leftShell, right, epsilon) ||
    ringHasStrictPointInPolygon(rightShell, left, epsilon) ||
    polygonBoundariesProperlyIntersect(left, right, epsilon)
  );
}

function geometriesOverlapPositive(
  left: TerritoryGeometry,
  right: TerritoryGeometry,
  epsilon: number
): boolean {
  if (!bboxesIntersect(computeGeometryBBox(left), computeGeometryBBox(right), epsilon)) {
    return false;
  }

  for (const leftPolygon of geometryToPolygons(left)) {
    for (const rightPolygon of geometryToPolygons(right)) {
      if (polygonsOverlapPositive(leftPolygon, rightPolygon, epsilon)) {
        return true;
      }
    }
  }

  return false;
}

function ringCoveredByRing(
  subject: LngLat[],
  container: LngLat[],
  epsilon: number,
  boundaryAllowed: boolean
): boolean {
  return subject.every((point, index) => {
    if (index === subject.length - 1 && pointsEqual(point, subject[0] as LngLat, epsilon)) {
      return true;
    }

    const position = classifyPointInRing(point, container, epsilon);
    return position === "inside" || (boundaryAllowed && position === "boundary");
  });
}

function geometryCoversGeometry(
  container: TerritoryGeometry,
  subject: TerritoryGeometry,
  epsilon: number
): boolean {
  const containerBBox = computeGeometryBBox(container);

  if (!bboxContains(containerBBox, computeGeometryBBox(subject), epsilon)) {
    return false;
  }

  for (const polygon of geometryToPolygons(subject)) {
    const shell = polygon[0];

    if (!shell) {
      return false;
    }

    for (const point of shell.slice(0, -1)) {
      if (!geometryCoversPoint(container, point, epsilon)) {
        return false;
      }
    }
  }

  return true;
}

function geometryCoversPoint(geometry: TerritoryGeometry, point: LngLat, epsilon: number): boolean {
  return geometryToPolygons(geometry).some((polygon) =>
    polygonCoversPoint(polygon, point, epsilon)
  );
}

function polygonCoversPoint(polygon: LngLat[][], point: LngLat, epsilon: number): boolean {
  const shell = polygon[0];

  if (!shell) {
    return false;
  }

  const shellPosition = classifyPointInRing(point, shell, epsilon);

  if (shellPosition === "outside") {
    return false;
  }

  for (const hole of polygon.slice(1)) {
    const holePosition = classifyPointInRing(point, hole, epsilon);

    if (holePosition === "inside") {
      return false;
    }
  }

  return true;
}

function ringHasStrictPointInRing(
  subject: LngLat[],
  container: LngLat[],
  epsilon: number
): boolean {
  return subject
    .slice(0, -1)
    .some((point) => classifyPointInRing(point, container, epsilon) === "inside");
}

function ringHasStrictPointInPolygon(
  subject: LngLat[],
  polygon: LngLat[][],
  epsilon: number
): boolean {
  return subject.slice(0, -1).some((point) => {
    if (!polygonCoversPoint(polygon, point, epsilon)) {
      return false;
    }

    const shell = polygon[0];

    if (!shell) {
      return false;
    }

    return classifyPointInRing(point, shell, epsilon) === "inside";
  });
}

function polygonBoundariesProperlyIntersect(
  left: LngLat[][],
  right: LngLat[][],
  epsilon: number
): boolean {
  for (const leftRing of left) {
    for (const rightRing of right) {
      if (ringsIntersect(leftRing, rightRing, epsilon, true)) {
        return true;
      }
    }
  }

  return false;
}

function ringsIntersect(
  left: LngLat[],
  right: LngLat[],
  epsilon: number,
  requireProperCrossing: boolean
): boolean {
  for (const leftSegment of ringSegments(left)) {
    for (const rightSegment of ringSegments(right)) {
      if (!bboxesIntersect(leftSegment.bbox, rightSegment.bbox, epsilon)) {
        continue;
      }

      if (
        requireProperCrossing
          ? segmentsProperlyCross(
              leftSegment.start,
              leftSegment.end,
              rightSegment.start,
              rightSegment.end,
              epsilon
            )
          : segmentsIntersect(
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

  return false;
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

function segmentsIntersect(
  a1: LngLat,
  a2: LngLat,
  b1: LngLat,
  b2: LngLat,
  epsilon: number
): boolean {
  return (
    segmentsProperlyCross(a1, a2, b1, b2, epsilon) ||
    pointOnSegment(a1, a2, b1, epsilon) ||
    pointOnSegment(a1, a2, b2, epsilon) ||
    pointOnSegment(b1, b2, a1, epsilon) ||
    pointOnSegment(b1, b2, a2, epsilon)
  );
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

function ringSignedArea(ring: LngLat[]): number {
  if (ring.length < 3) {
    return 0;
  }

  let area = 0;

  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];

    if (current && next) {
      area += current[0] * next[1] - next[0] * current[1];
    }
  }

  return area / 2;
}

function geometryArea(geometry: TerritoryGeometry): number {
  return geometryToPolygons(geometry).reduce((geometryTotal, polygon) => {
    const shell = polygon[0];
    const shellArea = shell ? Math.abs(ringSignedArea(shell)) : 0;
    const holeArea = polygon
      .slice(1)
      .reduce((holeTotal, hole) => holeTotal + Math.abs(ringSignedArea(hole)), 0);
    return geometryTotal + Math.max(shellArea - holeArea, 0);
  }, 0);
}

function ringBBox(ring: LngLat[]): TerritoryBBox {
  return ring.reduce<TerritoryBBox>(
    (bbox, point) => [
      Math.min(bbox[0], point[0]),
      Math.min(bbox[1], point[1]),
      Math.max(bbox[2], point[0]),
      Math.max(bbox[3], point[1])
    ],
    [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY
    ]
  );
}

function polygonBBox(polygon: LngLat[][]): TerritoryBBox {
  return polygon.reduce<TerritoryBBox>(
    (bbox, ring) => bboxUnion(bbox, ringBBox(ring)),
    [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY
    ]
  );
}

function bboxUnion(left: TerritoryBBox, right: TerritoryBBox): TerritoryBBox {
  return [
    Math.min(left[0], right[0]),
    Math.min(left[1], right[1]),
    Math.max(left[2], right[2]),
    Math.max(left[3], right[3])
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

function bboxesEqual(left: TerritoryBBox, right: TerritoryBBox, epsilon: number): boolean {
  return left.every((value, index) => Math.abs(value - (right[index] ?? Number.NaN)) <= epsilon);
}

function pointInBBox(point: LngLat, bbox: TerritoryBBox, epsilon: number): boolean {
  return (
    point[0] >= bbox[0] - epsilon &&
    point[0] <= bbox[2] + epsilon &&
    point[1] >= bbox[1] - epsilon &&
    point[1] <= bbox[3] + epsilon
  );
}

function pointsEqual(left: LngLat, right: LngLat, epsilon: number): boolean {
  return Math.abs(left[0] - right[0]) <= epsilon && Math.abs(left[1] - right[1]) <= epsilon;
}

function hashRing(ring: LngLat[]): string {
  return fnv1a32(stableStringify(ring));
}

function hashPolygon(polygon: LngLat[][]): string {
  return fnv1a32(stableStringify(polygon));
}

function addIssue(
  context: ValidationContext,
  issue: Omit<GeometryQualityIssue, "severity"> & { severity: GeometryQualitySeverity }
): void {
  const severity = context.strict && issue.severity === "warning" ? "error" : issue.severity;
  const next: GeometryQualityIssue = { ...issue, severity };
  context.issues.push(next);

  if (severity === "error" && issue.zoneId) {
    context.invalidZoneIds.add(issue.zoneId);
  }
}

function sortGeometryIssues(issues: GeometryQualityIssue[]): GeometryQualityIssue[] {
  return [...issues].sort(
    (left, right) =>
      (left.zoneId ?? "").localeCompare(right.zoneId ?? "") ||
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code) ||
      (left.otherZoneId ?? "").localeCompare(right.otherZoneId ?? "")
  );
}

function coordinatePath(
  zoneIndex: number,
  polygonIndex: number,
  ringIndex: number,
  coordinateIndex: number
): string {
  return `${ringPath(zoneIndex, polygonIndex, ringIndex)}[${coordinateIndex}]`;
}

function ringPath(zoneIndex: number, polygonIndex: number, ringIndex: number): string {
  return `$.zones[${zoneIndex}].geometry.coordinates[${polygonIndex}][${ringIndex}]`;
}

function cloneDataset(dataset: TerritoryDataset): TerritoryDataset {
  return JSON.parse(JSON.stringify(dataset)) as TerritoryDataset;
}

function readPositiveNumber(input: number | undefined, fallback: number): number {
  return Number.isFinite(input) && input !== undefined && input >= 0 ? input : fallback;
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
