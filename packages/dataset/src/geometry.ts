import type { TerritoryBBox, TerritoryGeometry, LngLat } from "./types.js";

export type TerritoryPolygonCoordinates = LngLat[][][];

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

  for (const polygon of geometryToPolygons(geometry)) {
    for (const ring of polygon) {
      for (const [longitude, latitude] of ring) {
        west = Math.min(west, longitude);
        south = Math.min(south, latitude);
        east = Math.max(east, longitude);
        north = Math.max(north, latitude);
      }
    }
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
  const lastSegmentIndex = ring.length - 2;

  for (let a = 0; a <= lastSegmentIndex; a += 1) {
    const a1 = ring[a];
    const a2 = ring[a + 1];

    if (!a1 || !a2) {
      continue;
    }

    for (let b = a + 1; b <= lastSegmentIndex; b += 1) {
      if (Math.abs(a - b) <= 1) {
        continue;
      }

      if (a === 0 && b === lastSegmentIndex) {
        continue;
      }

      const b1 = ring[b];
      const b2 = ring[b + 1];

      if (b1 && b2 && segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }

  return false;
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

function segmentsIntersect(a1: LngLat, a2: LngLat, b1: LngLat, b2: LngLat): boolean {
  const d1 = direction(b1, b2, a1);
  const d2 = direction(b1, b2, a2);
  const d3 = direction(a1, a2, b1);
  const d4 = direction(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return (
    (d1 === 0 && isOnSegment(b1, b2, a1)) ||
    (d2 === 0 && isOnSegment(b1, b2, a2)) ||
    (d3 === 0 && isOnSegment(a1, a2, b1)) ||
    (d4 === 0 && isOnSegment(a1, a2, b2))
  );
}

function direction(a: LngLat, b: LngLat, c: LngLat): number {
  return (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
}

function isOnSegment(a: LngLat, b: LngLat, point: LngLat): boolean {
  return (
    point[0] >= Math.min(a[0], b[0]) &&
    point[0] <= Math.max(a[0], b[0]) &&
    point[1] >= Math.min(a[1], b[1]) &&
    point[1] <= Math.max(a[1], b[1])
  );
}
