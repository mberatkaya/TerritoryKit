import { computeGeometryBBox, geometryToPolygons } from "@territory-kit/dataset";
import type { LngLat, TerritoryGeometry } from "@territory-kit/dataset";
import type { BoundaryMode, TerritoryBounds } from "./types.js";

type RingPointRelation = "outside" | "inside" | "boundary";

const POINT_ON_SEGMENT_EPSILON = 1e-12;
const ROUTE_INTERSECTION_EPSILON = 1e-10;
const EARTH_RADIUS_METERS = 6_371_008.8;

export interface RouteGeometryIntersectionSegment {
  startCoordinate: LngLat;
  endCoordinate: LngLat;
  startDistanceM: number;
  endDistanceM: number;
  startFraction: number;
  endFraction: number;
  lengthM: number;
}

export interface RouteGeometryIntersectionPoint {
  coordinate: LngLat;
  distanceM: number;
  fraction: number;
}

export interface RouteGeometryIntersection {
  routeLengthM: number;
  segments: RouteGeometryIntersectionSegment[];
  touchPoints: RouteGeometryIntersectionPoint[];
}

export function pointIntersectsGeometry(
  coordinate: LngLat,
  geometry: TerritoryGeometry,
  boundaryMode: BoundaryMode
): boolean {
  const normalizedCoordinate: LngLat = [normalizeLongitude(coordinate[0]), coordinate[1]];

  for (const polygon of geometryToPolygons(geometry)) {
    const outerRing = polygon[0];

    if (!outerRing) {
      continue;
    }

    const outer = pointInRing(normalizedCoordinate, outerRing);
    const coveredByOuter =
      outer === "inside" || (outer === "boundary" && boundaryMode === "covers");

    if (!coveredByOuter) {
      continue;
    }

    const isExcludedByHole = polygon.slice(1).some((hole) => {
      const relation = pointInRing(normalizedCoordinate, hole);

      return relation === "inside" || (relation === "boundary" && boundaryMode === "contains");
    });

    if (!isExcludedByHole) {
      return true;
    }
  }

  return false;
}

export function normalizeLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) {
    return longitude;
  }

  if (longitude >= -180 && longitude <= 180) {
    return longitude;
  }

  const wrapped = ((((longitude + 180) % 360) + 360) % 360) - 180;

  return wrapped === -180 && longitude > 0 ? 180 : wrapped;
}

export function bboxIntersectsBounds(
  bbox: [west: number, south: number, east: number, north: number],
  bounds: TerritoryBounds
): boolean {
  return (
    bbox[0] <= bounds.east &&
    bbox[2] >= bounds.west &&
    bbox[1] <= bounds.north &&
    bbox[3] >= bounds.south
  );
}

export function computeLngLatDistanceM(left: LngLat, right: LngLat): number {
  const leftLatitude = toRadians(left[1]);
  const rightLatitude = toRadians(right[1]);
  const latitudeDelta = toRadians(right[1] - left[1]);
  const longitudeDelta = toRadians(right[0] - left[0]);
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const a =
    sinLatitude * sinLatitude +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * sinLongitude * sinLongitude;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function computeLineStringBounds(route: readonly LngLat[]): TerritoryBounds | undefined {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let hasCoordinate = false;

  for (const coordinate of route) {
    if (!isFiniteLngLat(coordinate)) {
      continue;
    }

    hasCoordinate = true;
    west = Math.min(west, coordinate[0]);
    south = Math.min(south, coordinate[1]);
    east = Math.max(east, coordinate[0]);
    north = Math.max(north, coordinate[1]);
  }

  return hasCoordinate ? { west, south, east, north } : undefined;
}

export function intersectLineStringWithGeometry(
  route: readonly LngLat[],
  geometry: TerritoryGeometry,
  boundaryMode: BoundaryMode
): RouteGeometryIntersection {
  const segmentLengths = computeRouteSegmentLengths(route);
  const routeLengthM = segmentLengths.reduce((sum, length) => sum + length, 0);
  const segments: RouteGeometryIntersectionSegment[] = [];
  const touchPoints: RouteGeometryIntersectionPoint[] = [];
  let distanceBeforeSegment = 0;

  if (routeLengthM <= 0) {
    return { routeLengthM, segments, touchPoints };
  }

  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    const segmentLengthM = segmentLengths[index] ?? 0;

    if (!start || !end || segmentLengthM <= 0) {
      continue;
    }

    const cuts = collectRouteSegmentCuts(start, end, geometry);

    for (const cut of cuts) {
      const coordinate = interpolateSegment(start, end, cut);

      if (pointIntersectsGeometry(coordinate, geometry, "covers")) {
        touchPoints.push({
          coordinate,
          distanceM: distanceBeforeSegment + segmentLengthM * cut,
          fraction: (distanceBeforeSegment + segmentLengthM * cut) / routeLengthM
        });
      }
    }

    for (let cutIndex = 0; cutIndex < cuts.length - 1; cutIndex += 1) {
      const intervalStart = cuts[cutIndex];
      const intervalEnd = cuts[cutIndex + 1];

      if (intervalStart === undefined || intervalEnd === undefined) {
        continue;
      }

      const intervalWidth = intervalEnd - intervalStart;

      if (intervalWidth <= ROUTE_INTERSECTION_EPSILON) {
        continue;
      }

      const midpoint = interpolateSegment(start, end, intervalStart + intervalWidth / 2);

      if (!pointIntersectsGeometry(midpoint, geometry, boundaryMode)) {
        continue;
      }

      const startDistanceM = distanceBeforeSegment + segmentLengthM * intervalStart;
      const endDistanceM = distanceBeforeSegment + segmentLengthM * intervalEnd;
      appendRouteGeometrySegment(segments, {
        startCoordinate: interpolateSegment(start, end, intervalStart),
        endCoordinate: interpolateSegment(start, end, intervalEnd),
        startDistanceM,
        endDistanceM,
        startFraction: startDistanceM / routeLengthM,
        endFraction: endDistanceM / routeLengthM,
        lengthM: endDistanceM - startDistanceM
      });
    }

    distanceBeforeSegment += segmentLengthM;
  }

  return {
    routeLengthM,
    segments,
    touchPoints: uniqueIntersectionPoints(touchPoints)
  };
}

export function geometryIntersectsGeometry(
  left: TerritoryGeometry,
  right: TerritoryGeometry,
  boundaryMode: BoundaryMode
): boolean {
  const leftBounds = bboxToBounds(computeGeometryBBox(left));
  const rightBounds = bboxToBounds(computeGeometryBBox(right));

  if (!boundsIntersectBounds(leftBounds, rightBounds)) {
    return false;
  }

  if (geometryHasVertexInside(left, right, boundaryMode)) {
    return true;
  }

  if (geometryHasVertexInside(right, left, boundaryMode)) {
    return true;
  }

  return geometrySegmentsIntersect(left, right);
}

export function boundsIntersectBounds(left: TerritoryBounds, right: TerritoryBounds): boolean {
  return (
    left.west <= right.east &&
    left.east >= right.west &&
    left.south <= right.north &&
    left.north >= right.south
  );
}

function bboxToBounds(
  bbox: [west: number, south: number, east: number, north: number]
): TerritoryBounds {
  return {
    west: bbox[0],
    south: bbox[1],
    east: bbox[2],
    north: bbox[3]
  };
}

function geometryHasVertexInside(
  source: TerritoryGeometry,
  target: TerritoryGeometry,
  boundaryMode: BoundaryMode
): boolean {
  for (const polygon of geometryToPolygons(source)) {
    for (const ring of polygon) {
      for (const coordinate of ring) {
        if (pointIntersectsGeometry(coordinate, target, boundaryMode)) {
          return true;
        }
      }
    }
  }

  return false;
}

function geometrySegmentsIntersect(left: TerritoryGeometry, right: TerritoryGeometry): boolean {
  const leftSegments = geometryToSegments(left);
  const rightSegments = geometryToSegments(right);

  for (const leftSegment of leftSegments) {
    for (const rightSegment of rightSegments) {
      if (segmentsIntersect(leftSegment[0], leftSegment[1], rightSegment[0], rightSegment[1])) {
        return true;
      }
    }
  }

  return false;
}

function geometryToSegments(geometry: TerritoryGeometry): Array<[LngLat, LngLat]> {
  const segments: Array<[LngLat, LngLat]> = [];

  for (const polygon of geometryToPolygons(geometry)) {
    for (const ring of polygon) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        const current = ring[index];
        const next = ring[index + 1];

        if (current && next) {
          segments.push([current, next]);
        }
      }
    }
  }

  return segments;
}

function collectRouteSegmentCuts(
  start: LngLat,
  end: LngLat,
  geometry: TerritoryGeometry
): number[] {
  const cuts = [0, 1];

  for (const [ringStart, ringEnd] of geometryToSegments(geometry)) {
    cuts.push(...segmentIntersectionParameters(start, end, ringStart, ringEnd));
  }

  return uniqueSortedCuts(cuts);
}

function segmentIntersectionParameters(a1: LngLat, a2: LngLat, b1: LngLat, b2: LngLat): number[] {
  const route = subtract(a2, a1);
  const edge = subtract(b2, b1);
  const denominator = cross(route, edge);
  const delta = subtract(b1, a1);

  if (Math.abs(denominator) <= ROUTE_INTERSECTION_EPSILON) {
    if (Math.abs(cross(delta, route)) > ROUTE_INTERSECTION_EPSILON) {
      return [];
    }

    const start = projectSegmentParameter(a1, a2, b1);
    const end = projectSegmentParameter(a1, a2, b2);
    const overlapStart = Math.max(0, Math.min(start, end));
    const overlapEnd = Math.min(1, Math.max(start, end));

    if (overlapEnd < -ROUTE_INTERSECTION_EPSILON || overlapStart > 1 + ROUTE_INTERSECTION_EPSILON) {
      return [];
    }

    if (overlapEnd + ROUTE_INTERSECTION_EPSILON < overlapStart) {
      return [];
    }

    return [clampUnit(overlapStart), clampUnit(overlapEnd)];
  }

  const t = cross(delta, edge) / denominator;
  const u = cross(delta, route) / denominator;

  if (
    t < -ROUTE_INTERSECTION_EPSILON ||
    t > 1 + ROUTE_INTERSECTION_EPSILON ||
    u < -ROUTE_INTERSECTION_EPSILON ||
    u > 1 + ROUTE_INTERSECTION_EPSILON
  ) {
    return [];
  }

  return [clampUnit(t)];
}

function appendRouteGeometrySegment(
  segments: RouteGeometryIntersectionSegment[],
  segment: RouteGeometryIntersectionSegment
): void {
  const previous = segments.at(-1);

  if (
    previous &&
    Math.abs(previous.endDistanceM - segment.startDistanceM) <= 1e-6 &&
    sameCoordinate(previous.endCoordinate, segment.startCoordinate)
  ) {
    previous.endCoordinate = segment.endCoordinate;
    previous.endDistanceM = segment.endDistanceM;
    previous.endFraction = segment.endFraction;
    previous.lengthM += segment.lengthM;
    return;
  }

  segments.push(segment);
}

function uniqueIntersectionPoints(
  points: RouteGeometryIntersectionPoint[]
): RouteGeometryIntersectionPoint[] {
  const sorted = [...points].sort(
    (left, right) =>
      left.distanceM - right.distanceM ||
      left.coordinate[0] - right.coordinate[0] ||
      left.coordinate[1] - right.coordinate[1]
  );
  const unique: RouteGeometryIntersectionPoint[] = [];

  for (const point of sorted) {
    const previous = unique.at(-1);

    if (
      previous &&
      Math.abs(previous.distanceM - point.distanceM) <= 1e-6 &&
      sameCoordinate(previous.coordinate, point.coordinate)
    ) {
      continue;
    }

    unique.push(point);
  }

  return unique;
}

function uniqueSortedCuts(cuts: number[]): number[] {
  const sorted = cuts.map(clampUnit).sort((left, right) => left - right);
  const unique: number[] = [];

  for (const cut of sorted) {
    const previous = unique.at(-1);

    if (previous !== undefined && Math.abs(previous - cut) <= ROUTE_INTERSECTION_EPSILON) {
      continue;
    }

    unique.push(cut);
  }

  return unique;
}

function computeRouteSegmentLengths(route: readonly LngLat[]): number[] {
  const lengths: number[] = [];

  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];

    lengths.push(start && end ? computeLngLatDistanceM(start, end) : 0);
  }

  return lengths;
}

function interpolateSegment(start: LngLat, end: LngLat, t: number): LngLat {
  return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
}

function projectSegmentParameter(start: LngLat, end: LngLat, point: LngLat): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const denominator = dx * dx + dy * dy;

  if (denominator <= ROUTE_INTERSECTION_EPSILON) {
    return 0;
  }

  return ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / denominator;
}

function subtract(left: LngLat, right: LngLat): LngLat {
  return [left[0] - right[0], left[1] - right[1]];
}

function cross(left: LngLat, right: LngLat): number {
  return left[0] * right[1] - left[1] * right[0];
}

function clampUnit(value: number): number {
  if (value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}

function sameCoordinate(left: LngLat, right: LngLat): boolean {
  return (
    Math.abs(left[0] - right[0]) <= ROUTE_INTERSECTION_EPSILON &&
    Math.abs(left[1] - right[1]) <= ROUTE_INTERSECTION_EPSILON
  );
}

function isFiniteLngLat(coordinate: LngLat): boolean {
  return (
    Number.isFinite(coordinate[0]) &&
    Number.isFinite(coordinate[1]) &&
    coordinate[1] >= -90 &&
    coordinate[1] <= 90
  );
}

function pointInRing(coordinate: LngLat, ring: LngLat[]): RingPointRelation {
  let inside = false;
  const [longitude, latitude] = coordinate;

  for (
    let currentIndex = 0, previousIndex = ring.length - 1;
    currentIndex < ring.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = ring[currentIndex];
    const previous = ring[previousIndex];

    if (!current || !previous) {
      continue;
    }

    if (isPointOnSegment(coordinate, previous, current)) {
      return "boundary";
    }

    const intersects =
      current[1] > latitude !== previous[1] > latitude &&
      longitude <
        ((previous[0] - current[0]) * (latitude - current[1])) / (previous[1] - current[1]) +
          current[0];

    if (intersects) {
      inside = !inside;
    }
  }

  return inside ? "inside" : "outside";
}

function isPointOnSegment(point: LngLat, start: LngLat, end: LngLat): boolean {
  const cross =
    (point[1] - start[1]) * (end[0] - start[0]) - (point[0] - start[0]) * (end[1] - start[1]);

  if (Math.abs(cross) > POINT_ON_SEGMENT_EPSILON) {
    return false;
  }

  return (
    point[0] >= Math.min(start[0], end[0]) &&
    point[0] <= Math.max(start[0], end[0]) &&
    point[1] >= Math.min(start[1], end[1]) &&
    point[1] <= Math.max(start[1], end[1])
  );
}

function segmentsIntersect(a1: LngLat, a2: LngLat, b1: LngLat, b2: LngLat): boolean {
  const d1 = direction(b1, b2, a1);
  const d2 = direction(b1, b2, a2);
  const d3 = direction(a1, a2, b1);
  const d4 = direction(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return (
    (d1 === 0 && isPointOnSegment(a1, b1, b2)) ||
    (d2 === 0 && isPointOnSegment(a2, b1, b2)) ||
    (d3 === 0 && isPointOnSegment(b1, a1, a2)) ||
    (d4 === 0 && isPointOnSegment(b2, a1, a2))
  );
}

function direction(a: LngLat, b: LngLat, c: LngLat): number {
  return (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}
