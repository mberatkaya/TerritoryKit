import { computeGeometryBBox, geometryToPolygons } from "@territory-kit/dataset";
import type { LngLat, TerritoryGeometry } from "@territory-kit/dataset";
import type { BoundaryMode, TerritoryBounds } from "./types.js";

type RingPointRelation = "outside" | "inside" | "boundary";

const POINT_ON_SEGMENT_EPSILON = 1e-12;

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
