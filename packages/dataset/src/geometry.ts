import type { TerritoryBBox, TerritoryGeometry, LngLat } from "./types.js";

export type TerritoryPolygonCoordinates = LngLat[][][];

type BoundaryMode = "covers" | "contains";
type RingPointRelation = "outside" | "inside" | "boundary";

interface RingSegment {
  index: number;
  start: LngLat;
  end: LngLat;
  bbox: TerritoryBBox;
}

const EARTH_RADIUS_METERS = 6_371_008.8;
const POINT_ON_SEGMENT_EPSILON = 1e-12;

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

export function computeTerritoryAreaM2(geometry: TerritoryGeometry): number {
  let totalArea = 0;

  for (const polygon of geometryToPolygons(geometry)) {
    const outerRing = polygon[0];

    if (!outerRing) {
      continue;
    }

    const outerArea = Math.abs(computeSphericalRingAreaM2(outerRing));
    const holeArea = polygon
      .slice(1)
      .reduce((sum, hole) => sum + Math.abs(computeSphericalRingAreaM2(hole)), 0);

    totalArea += Math.max(0, outerArea - holeArea);
  }

  return totalArea;
}

export function computeTerritoryRepresentativePoint(geometry: TerritoryGeometry): LngLat {
  const bbox = computeGeometryBBox(geometry);
  const bboxCenter: LngLat = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  const candidates: LngLat[] = [];

  for (const polygon of geometryToPolygons(geometry)) {
    const outerRing = polygon[0];

    if (!outerRing || outerRing.length === 0) {
      continue;
    }

    candidates.push(computeRingCentroid(outerRing));
    candidates.push(computeRingAverage(outerRing));
  }

  candidates.push(bboxCenter);

  for (const candidate of candidates) {
    if (pointIntersectsGeometry(candidate, geometry, "covers")) {
      return candidate;
    }
  }

  const sampled = findSampledRepresentativePoint(geometry, bbox, bboxCenter);

  if (sampled) {
    return sampled;
  }

  return firstGeometryCoordinate(geometry) ?? bboxCenter;
}

export function canonicalizeTerritoryGeometry(geometry: TerritoryGeometry): TerritoryGeometry {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: canonicalizePolygonCoordinates(geometry.coordinates as LngLat[][])
    };
  }

  const polygons = (geometry.coordinates as LngLat[][][])
    .map((polygon) => canonicalizePolygonCoordinates(polygon))
    .sort(compareStableJson);

  return {
    type: "MultiPolygon",
    coordinates: polygons
  };
}

export function createTerritoryGeometryVersion(geometry: TerritoryGeometry): string {
  return `fnv1a32:${fnv1a32(stableStringify(canonicalizeTerritoryGeometry(geometry)))}`;
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

function pointIntersectsGeometry(
  coordinate: LngLat,
  geometry: TerritoryGeometry,
  boundaryMode: BoundaryMode
): boolean {
  for (const polygon of geometryToPolygons(geometry)) {
    const outerRing = polygon[0];

    if (!outerRing) {
      continue;
    }

    const outer = pointInRing(coordinate, outerRing);
    const coveredByOuter =
      outer === "inside" || (outer === "boundary" && boundaryMode === "covers");

    if (!coveredByOuter) {
      continue;
    }

    const isExcludedByHole = polygon.slice(1).some((hole) => {
      const relation = pointInRing(coordinate, hole);

      return relation === "inside" || (relation === "boundary" && boundaryMode === "contains");
    });

    if (!isExcludedByHole) {
      return true;
    }
  }

  return false;
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

    if (pointOnSegment(coordinate, previous, current)) {
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

function pointOnSegment(point: LngLat, start: LngLat, end: LngLat): boolean {
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

function computeSphericalRingAreaM2(ring: LngLat[]): number {
  let area = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];

    if (!current || !next) {
      continue;
    }

    const longitudeDelta = normalizeRadians(toRadians(next[0]) - toRadians(current[0]));
    const currentLatitude = toRadians(current[1]);
    const nextLatitude = toRadians(next[1]);
    area += longitudeDelta * (2 + Math.sin(currentLatitude) + Math.sin(nextLatitude));
  }

  return (area * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2;
}

function findSampledRepresentativePoint(
  geometry: TerritoryGeometry,
  bbox: TerritoryBBox,
  target: LngLat
): LngLat | undefined {
  let best: LngLat | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const steps of [4, 8, 16, 32]) {
    for (let x = 0; x < steps; x += 1) {
      for (let y = 0; y < steps; y += 1) {
        const candidate: LngLat = [
          bbox[0] + ((x + 0.5) / steps) * (bbox[2] - bbox[0]),
          bbox[1] + ((y + 0.5) / steps) * (bbox[3] - bbox[1])
        ];

        if (!pointIntersectsGeometry(candidate, geometry, "covers")) {
          continue;
        }

        const distance = squaredDistance(candidate, target);

        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
    }

    if (best) {
      return best;
    }
  }

  return undefined;
}

function firstGeometryCoordinate(geometry: TerritoryGeometry): LngLat | undefined {
  for (const polygon of geometryToPolygons(geometry)) {
    for (const ring of polygon) {
      const coordinate = ring[0];

      if (coordinate) {
        return coordinate;
      }
    }
  }

  return undefined;
}

function computeRingAverage(ring: LngLat[]): LngLat {
  const openRing = openRingCoordinates(ring);

  if (openRing.length === 0) {
    return [0, 0];
  }

  const [longitude, latitude] = openRing.reduce(
    (sum, coordinate) => [sum[0] + coordinate[0], sum[1] + coordinate[1]] as LngLat,
    [0, 0] as LngLat
  );

  return [longitude / openRing.length, latitude / openRing.length];
}

function canonicalizePolygonCoordinates(polygon: LngLat[][]): LngLat[][] {
  const outerRing = polygon[0];

  if (!outerRing) {
    return [];
  }

  const holes = polygon
    .slice(1)
    .map((ring) => canonicalizeRing(ring))
    .sort(compareStableJson);

  return [canonicalizeRing(outerRing), ...holes];
}

function canonicalizeRing(ring: LngLat[]): LngLat[] {
  const openRing = openRingCoordinates(ring);

  if (openRing.length === 0) {
    return [];
  }

  const forward = rotateRingToSmallestCoordinate(openRing);
  const reverse = rotateRingToSmallestCoordinate([...openRing].reverse());
  const canonical = compareStableJson(forward, reverse) <= 0 ? forward : reverse;
  const first = canonical[0];

  return first ? [...canonical, first] : canonical;
}

function openRingCoordinates(ring: LngLat[]): LngLat[] {
  const coordinates = [...ring];
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];

  if (first && last && first[0] === last[0] && first[1] === last[1]) {
    coordinates.pop();
  }

  return coordinates;
}

function rotateRingToSmallestCoordinate(ring: LngLat[]): LngLat[] {
  let best: LngLat[] | undefined;

  for (let start = 0; start < ring.length; start += 1) {
    const rotated = [...ring.slice(start), ...ring.slice(0, start)];

    if (!best || compareStableJson(rotated, best) < 0) {
      best = rotated;
    }
  }

  return best ?? [];
}

function compareStableJson(left: unknown, right: unknown): number {
  return stableStringify(left).localeCompare(stableStringify(right));
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

function squaredDistance(left: LngLat, right: LngLat): number {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2;
}

function normalizeRadians(value: number): number {
  let normalized = value;

  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }

  while (normalized < -Math.PI) {
    normalized += Math.PI * 2;
  }

  return normalized;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}
