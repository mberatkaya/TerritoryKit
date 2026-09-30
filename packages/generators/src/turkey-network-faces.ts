import Flatbush from "flatbush";
import type { LngLat, TerritoryGeometry } from "@territory-kit/dataset";
import type { TurkeySmartFallbackBarrier } from "./turkey-smart-fallback.js";

/** A bounded face whose internal edges are backed by actual source features. */
export interface TurkeyNetworkFace {
  geometry: TerritoryGeometry;
  barrierIds: string[];
  barrierClasses: string[];
  realBoundaryLengthMeters: number;
  parentBoundaryLengthMeters: number;
  areaKm2: number;
  edges: Array<{
    key: string;
    strength: number;
    lengthMeters: number;
    a: LngLat;
    b: LngLat;
    barrierId?: string;
  }>;
}

interface Segment {
  a: LngLat;
  b: LngLat;
  barrier?: TurkeySmartFallbackBarrier;
  grade: string;
}
interface Edge {
  from: number;
  to: number;
  twin: number;
  segment: Segment;
  visited: boolean;
}

const EPS = 1e-10;
const SNAP = 1e7; // ~1 cm in Istanbul; this does not join distinct nearby roads.

function key(p: LngLat): string {
  return `${Math.round(p[0] * SNAP)}:${Math.round(p[1] * SNAP)}`;
}

function point(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function lengthMeters(a: LngLat, b: LngLat): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * Math.cos(lat), b[1] - a[1]) * 111_195;
}

function signedArea(ring: LngLat[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length - 1; i++)
    twice += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  return twice / 2;
}

function grade(barrier: TurkeySmartFallbackBarrier): string {
  const tags = barrier.tags;
  // At-grade line crossings may be noded. A bridge, tunnel or explicit layer
  // is only noded against features with the same grade signature.
  return `${tags.layer ?? "0"}:${tags.bridge === "yes" ? "bridge" : tags.tunnel === "yes" ? "tunnel" : "ground"}`;
}

function intersection(a: Segment, b: Segment): [number, number] | undefined {
  const ax = a.b[0] - a.a[0],
    ay = a.b[1] - a.a[1];
  const bx = b.b[0] - b.a[0],
    by = b.b[1] - b.a[1];
  const cross = ax * by - ay * bx;
  if (Math.abs(cross) < EPS * Math.max(Math.hypot(ax, ay), Math.hypot(bx, by))) return;
  const dx = b.a[0] - a.a[0],
    dy = b.a[1] - a.a[1];
  const t = (dx * by - dy * bx) / cross;
  const u = (dx * ay - dy * ax) / cross;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return;
  return [Math.max(0, Math.min(1, t)), Math.max(0, Math.min(1, u))];
}

function ringsOf(geometry: TerritoryGeometry): LngLat[][] {
  return geometry.type === "Polygon"
    ? (geometry.coordinates as LngLat[][])
    : geometry.coordinates.flatMap((polygon) => polygon as LngLat[][]);
}

/** Polygonize real, clipped linework together with the missing-region boundary.
 * Open dead ends produce no face. The caller still has to cluster and validate
 * faces; parent-boundary closure is recorded separately from real support.
 */
export function polygonizeTurkeyBarrierNetwork(
  parent: TerritoryGeometry | null,
  barriers: readonly TurkeySmartFallbackBarrier[],
  minimumAreaKm2 = 0.001,
  statistics?: {
    rawFaceCount: number;
    inputSegmentCount?: number;
    viableSegmentCount?: number;
    graphComponentCount?: number;
    largestComponentSegments?: number;
    rejectedFaceAreaKm2?: number;
    rejectedFaces?: Array<{ key: string; areaKm2: number; representative: LngLat }>;
  }
): TurkeyNetworkFace[] {
  const segments: Segment[] = [];
  if (parent)
    for (const ring of ringsOf(parent))
      for (let i = 1; i < ring.length; i++)
        segments.push({ a: ring[i - 1]!, b: ring[i]!, grade: "parent" });
  for (const barrier of barriers) {
    if (barrier.sourceLayer === "roads" && barrier.tags.highway === "service") continue;
    // A planar face graph cannot represent an overpass crossing at another
    // elevation. Keep it available to downstream routing, not polygonization.
    if (grade(barrier) !== "0:ground") continue;
    for (let i = 1; i < barrier.coordinates.length; i++)
      segments.push({
        a: barrier.coordinates[i - 1]!,
        b: barrier.coordinates[i]!,
        barrier,
        grade: grade(barrier)
      });
  }
  const viable = segments.filter((s) => lengthMeters(s.a, s.b) > 0.05);
  if (statistics) {
    statistics.inputSegmentCount = segments.length;
    statistics.viableSegmentCount = viable.length;
    statistics.rejectedFaceAreaKm2 = 0;
  }
  if (!viable.length) return [];
  const index = new Flatbush(viable.length);
  for (const s of viable)
    index.add(
      Math.min(s.a[0], s.b[0]),
      Math.min(s.a[1], s.b[1]),
      Math.max(s.a[0], s.b[0]),
      Math.max(s.a[1], s.b[1])
    );
  index.finish();
  const cuts = viable.map(() => [0, 1]);
  for (let i = 0; i < viable.length; i++) {
    const a = viable[i]!;
    const hits = index.search(
      Math.min(a.a[0], a.b[0]),
      Math.min(a.a[1], a.b[1]),
      Math.max(a.a[0], a.b[0]),
      Math.max(a.a[1], a.b[1])
    );
    for (const j of hits) {
      if (j <= i) continue;
      const b = viable[j]!;
      if (a.grade !== "parent" && b.grade !== "parent" && a.grade !== b.grade) continue;
      const crossing = intersection(a, b);
      if (!crossing) continue;
      cuts[i]!.push(crossing[0]);
      cuts[j]!.push(crossing[1]);
    }
  }
  const vertices: LngLat[] = [];
  const vertexIds = new Map<string, number>();
  const outgoing: number[][] = [];
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const vertex = (p: LngLat): number => {
    const k = key(p);
    const existing = vertexIds.get(k);
    if (existing !== undefined) return existing;
    const id = vertices.length;
    vertices.push(p);
    outgoing.push([]);
    vertexIds.set(k, id);
    return id;
  };
  for (let i = 0; i < viable.length; i++) {
    const s = viable[i]!;
    const ts = [...new Set(cuts[i]!.map((t) => Math.round(t * 1e12) / 1e12))].sort((a, b) => a - b);
    for (let j = 1; j < ts.length; j++) {
      const from = vertex(point(s.a, s.b, ts[j - 1]!));
      const to = vertex(point(s.a, s.b, ts[j]!));
      if (from === to) continue;
      const identity = `${Math.min(from, to)}:${Math.max(from, to)}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const id = edges.length;
      edges.push({ from, to, twin: id + 1, segment: s, visited: false });
      edges.push({ from: to, to: from, twin: id, segment: s, visited: false });
      outgoing[from]!.push(id);
      outgoing[to]!.push(id + 1);
    }
  }
  for (let i = 0; i < outgoing.length; i++)
    outgoing[i]!.sort((x, y) => {
      const a = vertices[edges[x]!.to]!,
        b = vertices[edges[y]!.to]!,
        origin = vertices[i]!;
      return (
        Math.atan2(a[1] - origin[1], a[0] - origin[0]) -
        Math.atan2(b[1] - origin[1], b[0] - origin[0])
      );
    });
  if (statistics) {
    const roots = vertices.map((_, index) => index);
    const find = (index: number): number => {
      while (roots[index] !== index) {
        roots[index] = roots[roots[index]!]!;
        index = roots[index]!;
      }
      return index;
    };
    for (let i = 0; i < edges.length; i += 2) roots[find(edges[i]!.from)] = find(edges[i]!.to);
    const componentEdges = new Map<number, number>();
    for (let i = 0; i < edges.length; i += 2) {
      const root = find(edges[i]!.from);
      componentEdges.set(root, (componentEdges.get(root) ?? 0) + 1);
    }
    statistics.graphComponentCount = componentEdges.size;
    statistics.largestComponentSegments = 0;
    for (const count of componentEdges.values())
      statistics.largestComponentSegments = Math.max(statistics.largestComponentSegments, count);
  }
  const faces: TurkeyNetworkFace[] = [];
  for (let start = 0; start < edges.length; start++) {
    if (edges[start]!.visited) continue;
    const boundary: number[] = [];
    let current = start;
    while (!edges[current]!.visited && boundary.length <= edges.length) {
      const edge = edges[current]!;
      edge.visited = true;
      boundary.push(current);
      const around = outgoing[edge.to]!;
      const reverse = around.indexOf(edge.twin);
      current = around[(reverse - 1 + around.length) % around.length]!;
    }
    if (current !== start || boundary.length < 3) continue;
    const ring = boundary.map((id) => vertices[edges[id]!.from]!);
    ring.push(ring[0]!);
    const area = signedArea(ring);
    if (area <= 0) continue;
    const midLat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
    const areaKm2 = area * 111.195 ** 2 * Math.cos((midLat * Math.PI) / 180);
    const recordRejected = () => {
      if (!statistics) return;
      statistics.rejectedFaceAreaKm2! += areaKm2;
      if (statistics.rejectedFaces) {
        const count = ring.length - 1;
        const representative: LngLat = [
          ring.slice(0, count).reduce((sum, p) => sum + p[0], 0) / count,
          ring.slice(0, count).reduce((sum, p) => sum + p[1], 0) / count
        ];
        statistics.rejectedFaces.push({
          key: ring.slice(0, count).map(key).sort().join(";"),
          areaKm2,
          representative
        });
      }
    };
    // A dangling road can be traversed in both directions around the same
    // face. It encloses no territory and must not turn the whole ADM2 ring
    // into a purported Network face.
    const edgeVisits = new Map<number, number>();
    for (const id of boundary) {
      const undirected = Math.min(id, edges[id]!.twin);
      edgeVisits.set(undirected, (edgeVisits.get(undirected) ?? 0) + 1);
    }
    const sourceEdges = boundary
      .filter((id) => edgeVisits.get(Math.min(id, edges[id]!.twin)) === 1)
      .map((id) => edges[id]!)
      .filter((edge) => edge.segment.barrier);
    const realBoundaryLengthMeters = sourceEdges.reduce(
      (sum, edge) => sum + lengthMeters(vertices[edge.from]!, vertices[edge.to]!),
      0
    );
    if (realBoundaryLengthMeters <= 0) {
      // The parent ring is processing context, not a rejected Network face.
      // Counting it once per component/chunk inflates rejected area far beyond ADM2.
      continue;
    }
    if (statistics) statistics.rawFaceCount++;
    if (areaKm2 < minimumAreaKm2) {
      recordRejected();
      continue;
    }
    const parentBoundaryLengthMeters = boundary.reduce((sum, id) => {
      const edge = edges[id]!;
      return (
        sum + (edge.segment.barrier ? 0 : lengthMeters(vertices[edge.from]!, vertices[edge.to]!))
      );
    }, 0);
    faces.push({
      geometry: { type: "Polygon", coordinates: [ring] },
      barrierIds: [...new Set(sourceEdges.map((edge) => edge.segment.barrier!.id))].sort(),
      barrierClasses: [
        ...new Set(sourceEdges.map((edge) => edge.segment.barrier!.barrierClass))
      ].sort(),
      realBoundaryLengthMeters,
      parentBoundaryLengthMeters,
      areaKm2,
      edges: boundary.map((id) => {
        const edge = edges[id]!;
        return {
          key: [key(vertices[edge.from]!), key(vertices[edge.to]!)].sort().join("|"),
          strength: edge.segment.barrier?.strength ?? 1,
          lengthMeters: lengthMeters(vertices[edge.from]!, vertices[edge.to]!),
          a: vertices[edge.from]!,
          b: vertices[edge.to]!,
          ...(edge.segment.barrier ? { barrierId: edge.segment.barrier.id } : {})
        };
      })
    });
  }
  return faces.sort(
    (a, b) => a.areaKm2 - b.areaKm2 || a.barrierIds.join().localeCompare(b.barrierIds.join())
  );
}
