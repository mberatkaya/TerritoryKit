import type { TerritoryBBox, TerritoryGeometry, LngLat } from "./types.js";

export type TerritoryPolygonCoordinates = LngLat[][][];

interface RingSegment {
  index: number;
  start: LngLat;
  end: LngLat;
  bbox: TerritoryBBox;
}

export function geometryToPolygons(geometry: TerritoryGeometry): TerritoryPolygonCoordinates {
  if (geometry.type === "Polygon") {
    return [geometry.coordinates as LngLat[][]];
  }

  return geometry.coordinates as TerritoryPolygonCoordinates;
}

export function computeGeometryBBox(geometry: TerritoryGeometry): TerritoryBBox {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let hasCoordinate = false;

  for (const polygon of geometryToPolygons(geometry)) {
    for (const ring of polygon) {
      for (const coordinate of ring) {
        const longitude = coordinate[0];
        const latitude = coordinate[1];

        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
          continue;
        }

        hasCoordinate = true;
        west = Math.min(west, longitude);
        south = Math.min(south, latitude);
        east = Math.max(east, longitude);
        north = Math.max(north, latitude);
      }
    }
  }

  if (!hasCoordinate) {
    return [0, 0, 0, 0];
  }

  return [west, south, east, north];
}

export function computeGeometryCenter(geometry: TerritoryGeometry): LngLat {
  let weightedLongitude = 0;
  let weightedLatitude = 0;
  let totalWeight = 0;

  for (const polygon of geometryToPolygons(geometry)) {
    const outerRing = polygon[0];

    if (!outerRing || outerRing.length < 4) {
      continue;
    }

    const centroid = computeRingCentroid(outerRing);
    const weight = Math.abs(computeRingSignedArea(outerRing));
    weightedLongitude += centroid[0] * weight;
    weightedLatitude += centroid[1] * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    const [west, south, east, north] = computeGeometryBBox(geometry);
    return [(west + east) / 2, (south + north) / 2];
  }

  return [weightedLongitude / totalWeight, weightedLatitude / totalWeight];
}

export function hasRingSelfIntersection(ring: LngLat[]): boolean {
  const segments = ringSegments(ring).sort(
    (left, right) => left.bbox[0] - right.bbox[0] || left.index - right.index
  );
  const lastSegmentIndex = ring.length - 2;

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

      if (right.bbox[0] > left.bbox[2]) {
        break;
      }

      if (areAdjacentRingSegments(left.index, right.index, lastSegmentIndex)) {
        continue;
      }

      if (!bboxesIntersect(left.bbox, right.bbox)) {
        continue;
      }

      if (segmentsCrossOrOverlap(left.start, left.end, right.start, right.end)) {
        return true;
      }
    }
  }

  return false;
}

function ringSegments(ring: LngLat[]): RingSegment[] {
  const segments: RingSegment[] = [];

  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];

    if (!start || !end || pointsEqual(start, end)) {
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

function bboxesIntersect(left: TerritoryBBox, right: TerritoryBBox): boolean {
  return !(left[2] < right[0] || right[2] < left[0] || left[3] < right[1] || right[3] < left[1]);
}

function pointsEqual(left: LngLat, right: LngLat): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function computeRingCentroid(ring: LngLat[]): LngLat {
  let areaFactor = 0;
  let longitude = 0;
  let latitude = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];

    if (!current || !next) {
      continue;
    }

    const cross = current[0] * next[1] - next[0] * current[1];
    areaFactor += cross;
    longitude += (current[0] + next[0]) * cross;
    latitude += (current[1] + next[1]) * cross;
  }

  const area = areaFactor / 2;

  if (area === 0) {
    return ring[0] ?? [0, 0];
  }

  return [longitude / (6 * area), latitude / (6 * area)];
}

function computeRingSignedArea(ring: LngLat[]): number {
  let area = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];

    if (current && next) {
      area += current[0] * next[1] - next[0] * current[1];
    }
  }

  return area / 2;
}

function segmentsCrossOrOverlap(a1: LngLat, a2: LngLat, b1: LngLat, b2: LngLat): boolean {
  const d1 = direction(b1, b2, a1);
  const d2 = direction(b1, b2, a2);
  const d3 = direction(a1, a2, b1);
  const d4 = direction(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0
    ? collinearSegmentsOverlapPositive(a1, a2, b1, b2)
    : false;
}

function collinearSegmentsOverlapPositive(a1: LngLat, a2: LngLat, b1: LngLat, b2: LngLat): boolean {
  const axis = Math.abs(a1[0] - a2[0]) >= Math.abs(a1[1] - a2[1]) ? 0 : 1;
  const leftMin = Math.min(a1[axis], a2[axis]);
  const leftMax = Math.max(a1[axis], a2[axis]);
  const rightMin = Math.min(b1[axis], b2[axis]);
  const rightMax = Math.max(b1[axis], b2[axis]);

  return Math.min(leftMax, rightMax) - Math.max(leftMin, rightMin) > 0;
}

function direction(a: LngLat, b: LngLat, c: LngLat): number {
  return (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
}
