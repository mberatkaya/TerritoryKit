import { performance } from "node:perf_hooks";
import Flatbush from "flatbush";
import type { LngLat, TerritoryGeometry } from "@territory-kit/dataset";
import { polygonizeTurkeyBarrierNetwork } from "./turkey-network-faces.js";
import type { TurkeyNetworkFace } from "./turkey-network-faces.js";
import type {
  TurkeySmartFallbackBarrier,
  TurkeyNetworkFailureReason
} from "./turkey-smart-fallback.js";

type Box = [number, number, number, number];
const MAX_CHUNK_SEGMENTS = 8_000;
const MAX_CHUNK_FACES = 3_500;
const MAX_SPLIT_DEPTH = 10;

function segmentCount(barriers: readonly TurkeySmartFallbackBarrier[]): number {
  return barriers.reduce((sum, barrier) => sum + Math.max(0, barrier.coordinates.length - 1), 0);
}

function coordinateKey(point: LngLat): string {
  return `${Math.round(point[0] * 1e7)}:${Math.round(point[1] * 1e7)}`;
}

/** Source endpoint connectivity is determined before any computational split. */
function connectedBarrierComponents(
  barriers: readonly TurkeySmartFallbackBarrier[]
): TurkeySmartFallbackBarrier[][] {
  // Match the polygonizer's grade rule. A crossing is a connection only when
  // both source lines are on the ground; an overpass cannot close a face.
  barriers = barriers.filter(
    (barrier) =>
      !(barrier.sourceLayer === "roads" && barrier.tags.highway === "service") &&
      (barrier.tags.layer ?? "0") === "0" &&
      barrier.tags.bridge !== "yes" &&
      barrier.tags.tunnel !== "yes"
  );
  const roots = barriers.map((_, index) => index);
  const find = (index: number): number => {
    while (roots[index] !== index) {
      roots[index] = roots[roots[index]!]!;
      index = roots[index]!;
    }
    return index;
  };
  const owner = new Map<string, number>();
  for (let index = 0; index < barriers.length; index++)
    for (const point of barriers[index]!.coordinates) {
      const key = coordinateKey(point);
      const prior = owner.get(key);
      if (prior === undefined) owner.set(key, index);
      else {
        const a = find(index);
        const b = find(prior);
        if (a !== b) roots[Math.max(a, b)] = Math.min(a, b);
      }
    }
  // OSM ways often cross at an interior point without sharing a listed
  // vertex. Split on the same geometric connectivity that face polygonization
  // uses, before deciding which components need chunks.
  const segments: Array<{ a: LngLat; b: LngLat; owner: number }> = [];
  for (let ownerIndex = 0; ownerIndex < barriers.length; ownerIndex++) {
    const line = barriers[ownerIndex]!.coordinates;
    for (let i = 1; i < line.length; i++)
      if (coordinateKey(line[i - 1]!) !== coordinateKey(line[i]!))
        segments.push({ a: line[i - 1]!, b: line[i]!, owner: ownerIndex });
  }
  if (segments.length) {
    const index = new Flatbush(segments.length);
    for (const segment of segments)
      index.add(
        Math.min(segment.a[0], segment.b[0]),
        Math.min(segment.a[1], segment.b[1]),
        Math.max(segment.a[0], segment.b[0]),
        Math.max(segment.a[1], segment.b[1])
      );
    index.finish();
    for (let i = 0; i < segments.length; i++) {
      const a = segments[i]!;
      for (const j of index.search(
        Math.min(a.a[0], a.b[0]),
        Math.min(a.a[1], a.b[1]),
        Math.max(a.a[0], a.b[0]),
        Math.max(a.a[1], a.b[1])
      )) {
        if (j <= i) continue;
        const b = segments[j]!;
        if (find(a.owner) === find(b.owner)) continue;
        const ax = a.b[0] - a.a[0],
          ay = a.b[1] - a.a[1];
        const bx = b.b[0] - b.a[0],
          by = b.b[1] - b.a[1];
        const cross = ax * by - ay * bx;
        if (Math.abs(cross) < 1e-10 * Math.max(Math.hypot(ax, ay), Math.hypot(bx, by))) continue;
        const dx = b.a[0] - a.a[0],
          dy = b.a[1] - a.a[1];
        const t = (dx * by - dy * bx) / cross;
        const u = (dx * ay - dy * ax) / cross;
        if (t < -1e-10 || t > 1 + 1e-10 || u < -1e-10 || u > 1 + 1e-10) continue;
        const first = find(a.owner),
          second = find(b.owner);
        roots[Math.max(first, second)] = Math.min(first, second);
      }
    }
  }
  const groups = new Map<number, TurkeySmartFallbackBarrier[]>();
  for (let index = 0; index < barriers.length; index++) {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(barriers[index]!);
    groups.set(root, group);
  }
  return [...groups.values()].map((group) => group.sort((a, b) => a.id.localeCompare(b.id)));
}

function bounds(barriers: readonly TurkeySmartFallbackBarrier[]): Box {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  for (const barrier of barriers)
    for (const [x, y] of barrier.coordinates) {
      west = Math.min(west, x);
      south = Math.min(south, y);
      east = Math.max(east, x);
      north = Math.max(north, y);
    }
  return [west, south, east, north];
}

function halo(core: Box): Box {
  const padX = Math.max(0.002, (core[2] - core[0]) * 0.15);
  const padY = Math.max(0.002, (core[3] - core[1]) * 0.15);
  return [core[0] - padX, core[1] - padY, core[2] + padX, core[3] + padY];
}

/** Liang–Barsky clipping supplies graph context; its rectangle is never polygonized. */
function clipSegment(a: LngLat, b: LngLat, box: Box): [LngLat, LngLat] | null {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  let low = 0,
    high = 1;
  for (const [p, q] of [
    [-dx, a[0] - box[0]],
    [dx, box[2] - a[0]],
    [-dy, a[1] - box[1]],
    [dy, box[3] - a[1]]
  ] as Array<[number, number]>) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) low = Math.max(low, t);
      else high = Math.min(high, t);
      if (low > high) return null;
    }
  }
  if (high - low < 1e-12) return null;
  return [
    [a[0] + dx * low, a[1] + dy * low],
    [a[0] + dx * high, a[1] + dy * high]
  ];
}

function clipBarriers(
  barriers: readonly TurkeySmartFallbackBarrier[],
  box: Box
): TurkeySmartFallbackBarrier[] {
  const result: TurkeySmartFallbackBarrier[] = [];
  for (const barrier of barriers) {
    let path: LngLat[] = [];
    const flush = () => {
      if (path.length > 1) result.push({ ...barrier, coordinates: path });
      path = [];
    };
    for (let i = 1; i < barrier.coordinates.length; i++) {
      const clipped = clipSegment(barrier.coordinates[i - 1]!, barrier.coordinates[i]!, box);
      if (!clipped) {
        flush();
        continue;
      }
      if (path.length && coordinateKey(path[path.length - 1]!) !== coordinateKey(clipped[0]))
        flush();
      if (!path.length) path.push(clipped[0]);
      path.push(clipped[1]);
    }
    flush();
  }
  return result;
}

function representative(face: TurkeyNetworkFace): LngLat {
  const ring =
    face.geometry.type === "Polygon"
      ? face.geometry.coordinates[0]!
      : face.geometry.coordinates[0]![0]!;
  const count = Math.max(1, ring.length - 1);
  let x = 0,
    y = 0;
  for (let i = 0; i < count; i++) {
    const vertex = ring[i] as LngLat;
    x += vertex[0];
    y += vertex[1];
  }
  return [x / count, y / count];
}

export interface BoundedNetworkFacesResult {
  faces: TurkeyNetworkFace[];
  rawFaceCount: number;
  rejectedFaceAreaKm2: number;
  componentCount: number;
  largestComponentSegments: number;
  chunkCount: number;
  largestChunkSegments: number;
  largestChunkFaces: number;
  chunkOnlyBoundaryCount: number;
  parentClosedComponentCount: number;
  polygonizationDurationMs: number;
  failureReason?: TurkeyNetworkFailureReason;
}

/** Closed source-barrier faces only. Halo and core edges can never close a face. */
export function polygonizeTurkeyBarrierNetworkBounded(
  barriers: readonly TurkeySmartFallbackBarrier[],
  minimumAreaKm2: number,
  parent?: TerritoryGeometry
): BoundedNetworkFacesResult {
  const parentSegmentCount = parent
    ? (parent.type === "Polygon" ? parent.coordinates : parent.coordinates.flat()).reduce(
        (sum, ring) => sum + Math.max(0, ring.length - 1),
        0
      )
    : 0;
  const parentRings = parent
    ? parent.type === "Polygon"
      ? parent.coordinates
      : parent.coordinates.flat()
    : [];
  const parentEdges = parentRings.flatMap((ring) =>
    ring.slice(1).map((point, index) => [ring[index]!, point] as [LngLat, LngLat])
  );
  const touchesParent = (component: readonly TurkeySmartFallbackBarrier[]): boolean => {
    const epsilon = 2e-7;
    for (const barrier of component)
      for (const point of [barrier.coordinates[0], barrier.coordinates.at(-1)]) {
        if (!point) continue;
        for (const [a, b] of parentEdges) {
          if (
            point[0] < Math.min(a[0], b[0]) - epsilon ||
            point[0] > Math.max(a[0], b[0]) + epsilon ||
            point[1] < Math.min(a[1], b[1]) - epsilon ||
            point[1] > Math.max(a[1], b[1]) + epsilon
          )
            continue;
          const cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
          if (Math.abs(cross) <= epsilon * Math.hypot(b[0] - a[0], b[1] - a[1])) return true;
        }
      }
    return false;
  };
  let parentContext: TerritoryGeometry | null = null;
  let segmentBudget = MAX_CHUNK_SEGMENTS;
  const components = connectedBarrierComponents(barriers);
  const result: BoundedNetworkFacesResult = {
    faces: [],
    rawFaceCount: 0,
    rejectedFaceAreaKm2: 0,
    componentCount: components.length,
    largestComponentSegments: 0,
    chunkCount: 0,
    largestChunkSegments: 0,
    largestChunkFaces: 0,
    chunkOnlyBoundaryCount: 0,
    parentClosedComponentCount: 0,
    polygonizationDurationMs: 0
  };
  const uniqueFaces = new Set<string>();
  const uniqueRejectedFaces = new Set<string>();
  const accept = (faces: TurkeyNetworkFace[], core?: Box) => {
    for (const face of faces) {
      // Only the actual ADM2 ring is passed to polygonization. Chunk rectangles
      // never enter the graph, so an unbacked processing edge cannot be emitted.
      if (core) {
        const [x, y] = representative(face);
        if (x < core[0] || x >= core[2] || y < core[1] || y >= core[3]) continue;
      }
      const signature = face.edges
        .map((edge) => edge.key)
        .sort()
        .join(";");
      if (uniqueFaces.has(signature)) continue;
      uniqueFaces.add(signature);
      result.faces.push(face);
    }
  };
  const polygonize = (part: TurkeySmartFallbackBarrier[], core?: Box): boolean => {
    const count = segmentCount(part) + (parentContext ? parentSegmentCount : 0);
    result.largestChunkSegments = Math.max(result.largestChunkSegments, count);
    const stats = {
      rawFaceCount: 0,
      rejectedFaceAreaKm2: 0,
      rejectedFaces: [] as Array<{ key: string; areaKm2: number; representative: LngLat }>
    };
    const started = performance.now();
    let faces: TurkeyNetworkFace[];
    try {
      faces = polygonizeTurkeyBarrierNetwork(parentContext, part, minimumAreaKm2, stats);
    } catch {
      result.failureReason = "NETWORK_POLYGONIZATION_FAILED";
      return false;
    }
    result.polygonizationDurationMs += Math.round(performance.now() - started);
    result.rawFaceCount += stats.rawFaceCount;
    for (const rejected of stats.rejectedFaces) {
      if (core) {
        const [x, y] = rejected.representative;
        if (x < core[0] || x >= core[2] || y < core[1] || y >= core[3]) continue;
      }
      if (uniqueRejectedFaces.has(rejected.key)) continue;
      uniqueRejectedFaces.add(rejected.key);
      result.rejectedFaceAreaKm2 += rejected.areaKm2;
    }
    result.largestChunkFaces = Math.max(result.largestChunkFaces, faces.length);
    if (faces.length > MAX_CHUNK_FACES) return false;
    result.chunkCount++;
    accept(faces, core);
    return true;
  };
  const process = (component: TurkeySmartFallbackBarrier[], core: Box, depth: number): void => {
    if (result.failureReason) return;
    const clipped = clipBarriers(component, halo(core));
    const count = segmentCount(clipped);
    if (count < 3 && !parentContext) return;
    if (count <= segmentBudget && polygonize(clipped, core)) return;
    if (result.failureReason) return;
    if (depth >= MAX_SPLIT_DEPTH) {
      result.failureReason =
        count > segmentBudget
          ? "NETWORK_COMPONENT_LIMIT_EXCEEDED"
          : "NETWORK_GRAPH_FACE_LIMIT_EXCEEDED";
      return;
    }
    const xMeters = (core[2] - core[0]) * Math.cos((((core[1] + core[3]) / 2) * Math.PI) / 180);
    const yMeters = core[3] - core[1];
    if (xMeters >= yMeters) {
      const middle = (core[0] + core[2]) / 2;
      process(component, [core[0], core[1], middle, core[3]], depth + 1);
      process(component, [middle, core[1], core[2], core[3]], depth + 1);
    } else {
      const middle = (core[1] + core[3]) / 2;
      process(component, [core[0], core[1], core[2], middle], depth + 1);
      process(component, [core[0], middle, core[2], core[3]], depth + 1);
    }
  };
  for (const component of components) {
    if (result.failureReason) break;
    const count = segmentCount(component);
    result.largestComponentSegments = Math.max(result.largestComponentSegments, count);
    parentContext =
      parent && parentSegmentCount <= 4_000 && touchesParent(component) ? parent : null;
    if (count < 3 && !parentContext) continue;
    segmentBudget = MAX_CHUNK_SEGMENTS - (parentContext ? parentSegmentCount : 0);
    if (parentContext) result.parentClosedComponentCount++;
    if (count <= segmentBudget) {
      if (!polygonize(component)) process(component, bounds(component), 0);
    } else process(component, bounds(component), 0);
  }
  result.faces.sort(
    (a, b) => a.areaKm2 - b.areaKm2 || a.barrierIds.join().localeCompare(b.barrierIds.join())
  );
  return result;
}
