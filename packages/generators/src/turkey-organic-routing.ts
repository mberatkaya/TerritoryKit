import FlatbushDefault from "flatbush";
import { hasRingSelfIntersection } from "@territory-kit/dataset";
import type { LngLat } from "@territory-kit/dataset";
import * as clipping from "polygon-clipping";
import type { MultiPolygon } from "polygon-clipping";
import type { TurkeySmartFallbackBarrier } from "./turkey-smart-fallback.js";

const clip = ("default" in clipping ? clipping.default : clipping) as typeof clipping;
const Flatbush =
  typeof FlatbushDefault === "function"
    ? FlatbushDefault
    : (FlatbushDefault as unknown as { default: typeof FlatbushDefault }).default;
type Segment = { a: LngLat; b: LngLat; barrier: TurkeySmartFallbackBarrier };
type Piece = { geometry: MultiPolygon; barrierIds: string[] };
export interface TurkeyOrganicRoutingDiagnostics {
  attemptedLongEdges: number;
  routeFound: number;
  routeSupportImproved: number;
  routeGeometryRejected: number;
  routeTopologyRejected: number;
  routeApplied: number;
  longestUnroutedMeters: number;
  longestSharedEdgeMeters?: number;
  longestSkippedForSupportMeters?: number;
  unmatchedLongEdges?: Array<{ owner: number; a: LngLat; b: LngLat; meters: number }>;
  sharedBoundaryNodedVertexCount?: number;
  longestUnroutedReason?:
    "NO_ROUTE" | "SUPPORT_NOT_IMPROVED" | "GEOMETRY_REJECTED" | "TOPOLOGY_REJECTED";
}
const key = (p: readonly number[]) => `${p[0]!.toFixed(8)},${p[1]!.toFixed(8)}`;
const COLLINEAR_TOLERANCE_METERS = 0.00001;
const length = (a: readonly number[], b: readonly number[], cos: number) =>
  Math.hypot((a[0]! - b[0]!) * cos, a[1]! - b[1]!) * 111320;

/** One district index; no national graph. Junctions remain fixed. A replacement is
 * committed to both owners only after proving that their union is unchanged. */
export function routeOrganicSharedBoundaries<T extends Piece>(
  input: readonly T[],
  barriers: readonly TurkeySmartFallbackBarrier[],
  roadDensity: number,
  measureSupport?: (a: LngLat, b: LngLat) => number,
  acceptsGeometry?: (geometry: MultiPolygon) => boolean,
  options: {
    minChordMeters?: number;
    maxExistingSupportRatio?: number;
    diagnostics?: TurkeyOrganicRoutingDiagnostics;
  } = {}
): T[] {
  const pieces = input.map((p) => ({
    ...p,
    geometry: options.diagnostics
      ? p.geometry.map((polygon) => polygon.map(simplifyCollinearRing))
      : structuredClone(p.geometry),
    barrierIds: [...p.barrierIds]
  }));
  if (options.diagnostics) {
    const noded = nodeSharedBoundaryVertices(pieces.map((piece) => piece.geometry));
    for (const [index, geometry] of noded.geometries.entries()) pieces[index]!.geometry = geometry;
    options.diagnostics.sharedBoundaryNodedVertexCount = noded.insertedCount;
  }
  const segments: Segment[] = [];
  for (const barrier of [...barriers].sort((a, b) => a.id.localeCompare(b.id))) {
    if (barrier.strength <= 0 || barrier.barrierClass === "coastline") continue;
    for (let i = 1; i < barrier.coordinates.length; i++) {
      const a = barrier.coordinates[i - 1]!,
        b = barrier.coordinates[i]!;
      if (key(a) !== key(b)) segments.push({ a, b, barrier });
    }
  }
  if (!segments.length) return pieces;
  // Move each interior partition junction once, as an atomic transaction across
  // all incident owners. Outer/component/mask boundary vertices stay fixed.
  const vertices = new Map<string, { p: LngLat; owners: Set<number>; spacing: number }>();
  for (const [owner, piece] of pieces.entries())
    for (const polygon of piece.geometry)
      for (const ring of polygon) {
        for (let i = 0; i < ring.length - 1; i++) {
          const p = ring[i]! as LngLat,
            k = key(p),
            cos = Math.cos((p[1] * Math.PI) / 180);
          const v = vertices.get(k) ?? { p, owners: new Set<number>(), spacing: Infinity };
          v.owners.add(owner);
          v.spacing = Math.min(
            v.spacing,
            length(p, ring[(i + 1) % (ring.length - 1)]!, cos),
            length(p, ring[(i + ring.length - 2) % (ring.length - 1)]!, cos)
          );
          vertices.set(k, v);
        }
      }
  const networkVertices = new Map<string, { p: LngLat; strength: number; degree: number }>();
  for (const s of segments)
    for (const p of [s.a, s.b]) {
      const k = key(p),
        v = networkVertices.get(k) ?? { p, strength: 0, degree: 0 };
      v.strength = Math.max(v.strength, s.barrier.strength);
      v.degree++;
      networkVertices.set(k, v);
    }
  const network = [...networkVertices.values()].filter((v) => v.degree >= 3 && v.strength >= 0.15);
  const junctionIndex = network.length ? new Flatbush(network.length) : undefined;
  if (junctionIndex) {
    for (const v of network) junctionIndex.add(v.p[0], v.p[1], v.p[0], v.p[1]);
    junctionIndex.finish();
    for (const [, v] of [...vertices].sort(([a], [b]) => a.localeCompare(b))) {
      if (v.owners.size < 3) continue;
      const cos = Math.cos((v.p[1] * Math.PI) / 180),
        radius = Math.min(
          v.spacing * 0.4,
          roadDensity >= 15 ? 400 : roadDensity >= 3 ? 2000 : 5000
        );
      const dx = radius / (111320 * cos),
        dy = radius / 111320;
      const targets = junctionIndex
        .search(v.p[0] - dx, v.p[1] - dy, v.p[0] + dx, v.p[1] + dy)
        .map((i) => network[i]!)
        .filter((n) => length(v.p, n.p, cos) <= radius)
        .sort(
          (a, b) =>
            length(v.p, a.p, cos) * (2 - a.strength) - length(v.p, b.p, cos) * (2 - b.strength) ||
            key(a.p).localeCompare(key(b.p))
        );
      const target = targets[0];
      if (!target) continue;
      const owners = [...v.owners].sort((a, b) => a - b);
      const before = owners.map((i) => pieces[i]!.geometry);
      const after = before.map((g) =>
        g.map((p) => p.map((r) => r.map((p) => (key(p) === key(v.p) ? target.p : p))))
      );
      if (acceptsGeometry && after.some((g) => !acceptsGeometry(g))) continue;
      if (!safePartitionReplacement(before, after)) continue;
      for (const [j, owner] of owners.entries()) pieces[owner]!.geometry = after[j]!;
    }
  }
  const index = new Flatbush(segments.length);
  for (const s of segments)
    index.add(
      Math.min(s.a[0], s.b[0]),
      Math.min(s.a[1], s.b[1]),
      Math.max(s.a[0], s.b[0]),
      Math.max(s.a[1], s.b[1])
    );
  index.finish();
  const shared = new Map<string, { owner: number; a: LngLat; b: LngLat }[]>();
  for (const [owner, piece] of pieces.entries())
    for (const polygon of piece.geometry)
      for (const ring of polygon) {
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1]! as LngLat,
            b = ring[i]! as LngLat;
          const k = [key(a), key(b)].sort().join("|");
          const owners = shared.get(k) ?? [];
          owners.push({ owner, a, b });
          shared.set(k, owners);
        }
      }
  if (options.diagnostics)
    options.diagnostics.unmatchedLongEdges = [...shared.values()]
      .filter((owners) => owners.length === 1)
      .map((owners) => {
        const edge = owners[0]!;
        const cos = Math.cos((((edge.a[1] + edge.b[1]) / 2) * Math.PI) / 180);
        return { ...edge, meters: length(edge.a, edge.b, cos) };
      })
      .filter((edge) => edge.meters >= 2_000)
      .sort((a, b) => b.meters - a.meters || a.owner - b.owner)
      .slice(0, 8);
  for (const [, owners] of [...shared].sort(([a], [b]) => a.localeCompare(b))) {
    if (owners.length !== 2 || owners[0]!.owner === owners[1]!.owner) continue;
    const first = owners[0]!,
      second = owners[1]!,
      a = first.a,
      b = first.b;
    const cos = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180),
      chord = length(a, b, cos);
    if (chord < (options.minChordMeters ?? 100)) continue;
    if (options.diagnostics)
      options.diagnostics.longestSharedEdgeMeters = Math.max(
        options.diagnostics.longestSharedEdgeMeters ?? 0,
        chord
      );
    const existingSupport = measureSupport?.(a, b) ?? 0;
    if (existingSupport >= chord * (options.maxExistingSupportRatio ?? 0.95)) {
      if (options.diagnostics)
        options.diagnostics.longestSkippedForSupportMeters = Math.max(
          options.diagnostics.longestSkippedForSupportMeters ?? 0,
          chord
        );
      continue;
    }
    const diagnostics = options.diagnostics;
    if (diagnostics) diagnostics.attemptedLongEdges++;
    const corridor = Math.min(
      chord * 0.4,
      roadDensity >= 15 ? 400 : roadDensity >= 3 ? 2000 : 5000
    );
    const dx = corridor / (111320 * cos),
      dy = corridor / 111320;
    const candidates = index
      .search(
        Math.min(a[0], b[0]) - dx,
        Math.min(a[1], b[1]) - dy,
        Math.max(a[0], b[0]) + dx,
        Math.max(a[1], b[1]) + dy
      )
      .sort((a, b) => a - b)
      .map((i) => segments[i]!);
    const localJunctions = junctionIndex
      ? junctionIndex
          .search(
            Math.min(a[0], b[0]) - dx,
            Math.min(a[1], b[1]) - dy,
            Math.max(a[0], b[0]) + dx,
            Math.max(a[1], b[1]) + dy
          )
          .map((i) => network[i]!)
      : [];
    const recordUnrouted = (
      reason: NonNullable<TurkeyOrganicRoutingDiagnostics["longestUnroutedReason"]>
    ) => {
      if (diagnostics && chord > diagnostics.longestUnroutedMeters) {
        diagnostics.longestUnroutedMeters = chord;
        diagnostics.longestUnroutedReason = reason;
      }
    };
    // The shortest graph route may cross another territory or a water hole.
    // Try the piecewise and partial real-barrier routes before retaining the
    // synthetic chord; every candidate still has to preserve the partition.
    const alternatives = [
      () => findOrganicBarrierRoute(a, b, candidates, corridor),
      () =>
        chord >= 1_000
          ? findPiecewiseBarrierRoute(a, b, candidates, localJunctions, corridor)
          : undefined,
      () =>
        chord >= 2_000 && roadDensity < 6
          ? findInteriorBarrierRoute(a, b, candidates, localJunctions, corridor)
          : undefined,
      () => findPartialBarrierRoute(a, b, candidates, corridor)
    ];
    let applied = false;
    let failure: NonNullable<TurkeyOrganicRoutingDiagnostics["longestUnroutedReason"]> = "NO_ROUTE";
    for (const buildRoute of alternatives) {
      const route = buildRoute();
      if (!route || route.path.length < 3) continue;
      if (diagnostics) diagnostics.routeFound++;
      if (
        measureSupport &&
        route.path.slice(1).reduce((sum, p, i) => sum + measureSupport(route.path[i]!, p), 0) <=
          existingSupport + 1
      ) {
        failure = "SUPPORT_NOT_IMPROVED";
        continue;
      }
      if (diagnostics) diagnostics.routeSupportImproved++;
      const left = replace(pieces[first.owner]!.geometry, a, b, route.path);
      const right = replace(
        pieces[second.owner]!.geometry,
        second.a,
        second.b,
        key(second.a) === key(a) ? route.path : [...route.path].reverse()
      );
      if (
        !left ||
        !right ||
        (acceptsGeometry && (!acceptsGeometry(left) || !acceptsGeometry(right)))
      ) {
        if (diagnostics) diagnostics.routeGeometryRejected++;
        failure = "GEOMETRY_REJECTED";
        continue;
      }
      if (
        !safeReplacement(pieces[first.owner]!.geometry, pieces[second.owner]!.geometry, left, right)
      ) {
        if (diagnostics) diagnostics.routeTopologyRejected++;
        failure = "TOPOLOGY_REJECTED";
        continue;
      }
      if (diagnostics) diagnostics.routeApplied++;
      pieces[first.owner]!.geometry = left;
      pieces[second.owner]!.geometry = right;
      for (const owner of [first.owner, second.owner])
        pieces[owner]!.barrierIds = [
          ...new Set([...pieces[owner]!.barrierIds, ...route.barrierIds])
        ].sort();
      applied = true;
      break;
    }
    if (!applied) recordUnrouted(failure);
  }
  return pieces;
}

/** Split a long edge at an existing vertex of another owner. This restores
 * pairwise ownership at T-junctions; the inserted point lies on the same line
 * to sub-millimetre precision and introduces no gameplay boundary. */
function nodeSharedBoundaryVertices(geometries: readonly MultiPolygon[]): {
  geometries: MultiPolygon[];
  insertedCount: number;
} {
  const vertices = new Map<string, LngLat>();
  for (const geometry of geometries)
    for (const polygon of geometry)
      for (const ring of polygon)
        for (const point of ring.slice(0, -1)) vertices.set(key(point), point as LngLat);
  const points = [...vertices.values()];
  if (points.length === 0 || points.length > 250_000)
    return {
      geometries: geometries.map((geometry) => structuredClone(geometry)),
      insertedCount: 0
    };
  const index = new Flatbush(points.length);
  for (const p of points) index.add(p[0], p[1], p[0], p[1]);
  index.finish();
  let insertedCount = 0;
  const noded = geometries.map((geometry) =>
    geometry.map((polygon) =>
      polygon.map((ring) => {
        const output: LngLat[] = [];
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1]! as LngLat,
            b = ring[i]! as LngLat;
          output.push(a);
          const latitude = (a[1] + b[1]) / 2,
            cos = Math.cos((latitude * Math.PI) / 180),
            vx = (b[0] - a[0]) * cos,
            vy = b[1] - a[1],
            vv = vx * vx + vy * vy;
          if (vv <= 0 || Math.sqrt(vv) * 111320 < 500) continue;
          const marginX = COLLINEAR_TOLERANCE_METERS / (111320 * cos),
            marginY = COLLINEAR_TOLERANCE_METERS / 111320;
          const candidates = index
            .search(
              Math.min(a[0], b[0]) - marginX,
              Math.min(a[1], b[1]) - marginY,
              Math.max(a[0], b[0]) + marginX,
              Math.max(a[1], b[1]) + marginY
            )
            .map((position) => points[position]!)
            .map((p) => {
              const wx = (p[0] - a[0]) * cos,
                wy = p[1] - a[1];
              return {
                p,
                t: (wx * vx + wy * vy) / vv,
                offsetMeters: (Math.abs(vx * wy - vy * wx) / Math.sqrt(vv)) * 111320
              };
            })
            .filter(
              ({ t, offsetMeters }) =>
                t > 1e-8 && t < 1 - 1e-8 && offsetMeters <= COLLINEAR_TOLERANCE_METERS
            )
            .sort((x, y) => x.t - y.t || key(x.p).localeCompare(key(y.p)));
          const used = new Set<string>();
          for (const candidate of candidates) {
            const k = key(candidate.p);
            if (used.has(k)) continue;
            used.add(k);
            output.push(candidate.p);
            insertedCount++;
          }
        }
        output.push(output[0]!);
        return output;
      })
    )
  );
  return { geometries: noded, insertedCount };
}

/** Polygon clipping can leave a vertex on one side of a shared straight seam
 * but not the other. Remove only sub-millimetre collinear vertices so the
 * common edge is recognized and routed as one topology transaction. */
function simplifyCollinearRing(ring: MultiPolygon[number][number]): LngLat[] {
  const points: LngLat[] = [];
  for (const point of ring.slice(0, -1)) {
    while (points.length >= 2) {
      const a = points[points.length - 2]!,
        b = points[points.length - 1]!,
        c = point;
      const cos = Math.cos((b[1] * Math.PI) / 180);
      const vx = (c[0] - a[0]) * cos,
        vy = c[1] - a[1],
        wx = (b[0] - a[0]) * cos,
        wy = b[1] - a[1],
        vv = vx * vx + vy * vy;
      if (vv <= 0) break;
      const t = (wx * vx + wy * vy) / vv;
      const offsetMeters = (Math.abs(vx * wy - vy * wx) / Math.sqrt(vv)) * 111320;
      if (t <= 0 || t >= 1 || offsetMeters > COLLINEAR_TOLERANCE_METERS) break;
      points.pop();
    }
    points.push(point as LngLat);
  }
  return points.length >= 3 ? [...points, points[0]!] : ([...ring] as LngLat[]);
}

/** Use a connected real corridor across the middle of a coarse seam when
 * neither endpoint reaches that corridor. The two exposed connectors remain
 * synthetic, and the caller still checks the complete replacement topology. */
function findInteriorBarrierRoute(
  a: LngLat,
  b: LngLat,
  segments: readonly Segment[],
  junctions: readonly { p: LngLat; strength: number; degree: number }[],
  corridor: number
) {
  const cos = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const chord = length(a, b, cos);
  const vx = (b[0] - a[0]) * cos,
    vy = b[1] - a[1],
    vv = vx * vx + vy * vy;
  if (vv <= 0) return;
  const progress = (p: LngLat) => ((p[0] - a[0]) * cos * vx + (p[1] - a[1]) * vy) / vv;
  const point = (t: number): LngLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const anchors = new Map<string, { p: LngLat; strength: number; degree: number }>();
  for (const junction of junctions) anchors.set(key(junction.p), junction);
  for (const segment of segments) {
    if (segment.barrier.strength < 0.15) continue;
    for (const p of [segment.a, segment.b]) {
      const k = key(p);
      if (!anchors.has(k)) anchors.set(k, { p, strength: segment.barrier.strength, degree: 1 });
    }
  }
  for (const anchorSet of [junctions, [...anchors.values()]]) {
    const eligible = anchorSet
      .map((j) => ({ ...j, t: progress(j.p) }))
      .filter(
        (j) =>
          j.t >= 0.1 && j.t <= 0.9 && length(j.p, point(j.t), cos) <= Math.min(corridor * 0.5, 700)
      );
    const starts = eligible
      .filter((j) => j.t <= 0.4)
      .sort(
        (x, y) =>
          Math.abs(x.t - 0.2) - Math.abs(y.t - 0.2) ||
          y.strength - x.strength ||
          key(x.p).localeCompare(key(y.p))
      )
      .slice(0, 2);
    const ends = eligible
      .filter((j) => j.t >= 0.6)
      .sort(
        (x, y) =>
          Math.abs(x.t - 0.8) - Math.abs(y.t - 0.8) ||
          y.strength - x.strength ||
          key(x.p).localeCompare(key(y.p))
      )
      .slice(0, 2);
    for (const start of starts)
      for (const end of ends) {
        const from = point(start.t),
          to = point(end.t);
        const inner = findOrganicBarrierRoute(from, to, segments, corridor);
        if (!inner) continue;
        const connectorMeters = inner.connectorMeters + start.t * chord + (1 - end.t) * chord;
        if (connectorMeters > chord * 0.55 || inner.supportedMeters < chord * 0.35) continue;
        return {
          path: [a, ...inner.path, b],
          barrierIds: inner.barrierIds,
          supportedMeters: inner.supportedMeters,
          connectorMeters
        };
      }
  }
  return;
}

/** Break a long chord at nearby real network junctions. Each interval uses its
 * own local graph search, so disconnected roads, water and rail can each guide
 * a part of one shared boundary. Unrouted intervals stay measured as synthetic.
 * The caller commits the complete path to both owners in one topology transaction. */
function findPiecewiseBarrierRoute(
  a: LngLat,
  b: LngLat,
  segments: readonly Segment[],
  junctions: readonly { p: LngLat; strength: number; degree: number }[],
  corridor: number
) {
  const cos = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180),
    chord = length(a, b, cos);
  const vx = (b[0] - a[0]) * cos,
    vy = b[1] - a[1],
    vv = vx * vx + vy * vy;
  if (vv <= 0) return;
  const project = (p: LngLat) => ((p[0] - a[0]) * cos * vx + (p[1] - a[1]) * vy) / vv;
  const point = (t: number): LngLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const anchors = junctions
    .map((j) => ({ ...j, t: project(j.p) }))
    .filter(
      (j) =>
        j.t > 250 / chord &&
        j.t < 1 - 250 / chord &&
        length(j.p, point(j.t), cos) <= Math.min(corridor * 0.5, 300)
    )
    .sort(
      (x, y) =>
        y.strength - x.strength ||
        y.degree - x.degree ||
        x.t - y.t ||
        key(x.p).localeCompare(key(y.p))
    );
  const chosen: typeof anchors = [];
  for (const anchor of anchors) {
    if (chosen.length >= 7) break;
    if (chosen.every((other) => Math.abs(anchor.t - other.t) * chord >= 250)) chosen.push(anchor);
  }
  if (!chosen.length) return;
  const points = [a, ...chosen.sort((x, y) => x.t - y.t).map((j) => point(j.t)), b];
  const path: LngLat[] = [a];
  const ids = new Set<string>();
  let supported = 0,
    connector = 0,
    routed = 0;
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1]!,
      end = points[i]!,
      span = length(start, end, cos);
    const local = segments.filter(
      (s) =>
        Math.min(project(s.a), project(s.b)) <= project(end) + corridor / chord &&
        Math.max(project(s.a), project(s.b)) >= project(start) - corridor / chord
    );
    const route = findOrganicBarrierRoute(start, end, local, Math.min(corridor, span * 0.4));
    if (route) {
      path.push(...route.path.slice(1));
      route.barrierIds.forEach((id) => ids.add(id));
      supported += route.supportedMeters;
      connector += route.connectorMeters;
      routed++;
    } else {
      path.push(end);
      connector += span;
    }
  }
  if (routed < 2 || supported < chord * 0.5 || connector > chord * 0.4) return;
  return {
    path,
    barrierIds: [...ids].sort(),
    supportedMeters: supported,
    connectorMeters: connector
  };
}

/** Disconnected real corridors can guide only the portions they actually span.
 * Remaining coarse geometry and every connector remain synthetic in measurement. */
function findPartialBarrierRoute(
  a: LngLat,
  b: LngLat,
  segments: readonly Segment[],
  corridor: number
) {
  const cos = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180),
    chord = length(a, b, cos);
  const vx = (b[0] - a[0]) * cos,
    vy = b[1] - a[1],
    vv = vx * vx + vy * vy;
  const progress = (p: LngLat) => ((p[0] - a[0]) * cos * vx + (p[1] - a[1]) * vy) / vv;
  const projected = (t: number): LngLat => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  const fragments: { start: number; end: number; path: LngLat[]; id: string; score: number }[] = [];
  const paths: { coordinates: LngLat[]; barrier: TurkeySmartFallbackBarrier }[] = [];
  let chain: { coordinates: LngLat[]; barrier: TurkeySmartFallbackBarrier } | undefined;
  const flush = () => {
    if (chain && chain.coordinates.length > 2) paths.push(chain);
    chain = undefined;
  };
  for (const segment of segments) {
    if (segment.barrier.strength < 0.15) continue;
    paths.push({ coordinates: [segment.a, segment.b], barrier: segment.barrier });
    const valid = [segment.a, segment.b].every(
      (p) =>
        progress(p) > 0.001 &&
        progress(p) < 0.999 &&
        length(p, projected(progress(p)), cos) <= corridor
    );
    if (!valid) {
      flush();
      continue;
    }
    if (
      chain &&
      (chain.barrier.id !== segment.barrier.id ||
        key(chain.coordinates.at(-1)!) !== key(segment.a) ||
        Math.sign(progress(segment.b) - progress(segment.a)) !==
          Math.sign(progress(chain.coordinates.at(-1)!) - progress(chain.coordinates[0]!)))
    )
      flush();
    if (!chain) chain = { coordinates: [segment.a, segment.b], barrier: segment.barrier };
    else chain.coordinates.push(segment.b);
  }
  flush();
  for (const candidate of paths) {
    let coordinates = candidate.coordinates;
    let p = coordinates[0]!,
      q = coordinates.at(-1)!,
      start = progress(p),
      end = progress(q);
    if (start > end) {
      [p, q] = [q, p];
      [start, end] = [end, start];
      coordinates = [...coordinates].reverse();
    }
    if (start < 0.001 || end > 0.999 || (end - start) * chord < 100) continue;
    const first = projected(start),
      last = projected(end),
      physical = coordinates
        .slice(1)
        .reduce((sum, p, i) => sum + length(coordinates[i]!, p, cos), 0);
    if (physical > (end - start) * chord * 1.8) continue;
    const connectors = length(first, p, cos) + length(last, q, cos);
    if (candidate.barrier.strength < 0.45 && (physical < 250 || connectors > physical * 0.2))
      continue;
    if (
      connectors > physical * 0.5 ||
      Math.max(length(first, p, cos), length(last, q, cos)) > corridor
    )
      continue;
    const path = [first, ...coordinates, last];
    fragments.push({
      start,
      end,
      path,
      id: candidate.barrier.id,
      score: physical * candidate.barrier.strength - connectors * 2
    });
  }
  const chosen: typeof fragments = [];
  for (const fragment of fragments.sort(
    (a, b) => b.score - a.score || a.id.localeCompare(b.id) || a.start - b.start
  )) {
    if (
      fragment.score <= 0 ||
      chosen.some((f) => fragment.start < f.end + 0.00001 && fragment.end > f.start - 0.00001)
    )
      continue;
    chosen.push(fragment);
  }
  if (!chosen.length) return;
  chosen.sort((a, b) => a.start - b.start);
  return {
    path: [a, ...chosen.flatMap((f) => f.path), b],
    barrierIds: [...new Set(chosen.map((f) => f.id))].sort()
  };
}

/** Weighted deterministic Dijkstra. Actual OSM vertices connect only at compatible
 * layer/bridge/tunnel metadata; geometric crossings never invent junctions. */
export function findOrganicBarrierRoute(
  a: LngLat,
  b: LngLat,
  segments: readonly Segment[],
  corridor: number
):
  | { path: LngLat[]; barrierIds: string[]; supportedMeters: number; connectorMeters: number }
  | undefined {
  const cos = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180),
    chord = length(a, b, cos);
  if (chord <= 0) return;
  const ax = a[0] * cos,
    ay = a[1],
    vx = b[0] * cos - ax,
    vy = b[1] - ay,
    vv = vx * vx + vy * vy;
  const progress = (p: LngLat) => ((p[0] * cos - ax) * vx + (p[1] - ay) * vy) / vv;
  const distance = (p: LngLat) =>
    (Math.abs(vx * (p[1] - ay) - vy * (p[0] * cos - ax)) / Math.sqrt(vv)) * 111320;
  const points: LngLat[] = [a, b];
  const nodes = new Map<string, number>();
  const edges: { to: number; cost: number; meters: number; id?: string }[][] = [[], []];
  const node = (p: LngLat, grade: string) => {
    const k = `${key(p)}|${grade}`;
    let n = nodes.get(k);
    if (n === undefined) {
      n = points.length;
      points.push(p);
      edges.push([]);
      nodes.set(k, n);
    }
    return n;
  };
  const add = (from: number, to: number, strength: number, id?: string) => {
    const meters = length(points[from]!, points[to]!, cos);
    if (from === to) return;
    const cost =
      meters *
      (id
        ? 1 +
          2 * (1 - strength) +
          (0.7 * (distance(points[from]!) + distance(points[to]!))) / (2 * corridor)
        : 4);
    edges[from]!.push({ to, cost, meters, ...(id ? { id } : {}) });
    edges[to]!.push({ to: from, cost, meters, ...(id ? { id } : {}) });
  };
  const projections: { anchor: number; node: number; distance: number }[] = [];
  for (const s of segments) {
    if (
      Math.min(progress(s.a), progress(s.b)) > 1.05 ||
      Math.max(progress(s.a), progress(s.b)) < -0.05
    )
      continue;
    // Long segments are retained when they cross the corridor; endpoint projection
    // splits them at anchors without moving the actual barrier geometry.
    const grade = [
      s.barrier.tags.layer ?? "0",
      s.barrier.tags.bridge ?? "no",
      s.barrier.tags.tunnel ?? "no"
    ].join(":");
    const cuts: { t: number; p: LngLat; n: number }[] = [
      { t: 0, p: s.a, n: node(s.a, grade) },
      { t: 1, p: s.b, n: node(s.b, grade) }
    ];
    for (const [anchor, p] of [a, b].entries()) {
      const x = (s.b[0] - s.a[0]) * cos,
        y = s.b[1] - s.a[1];
      const t = Math.max(
        0,
        Math.min(1, ((p[0] - s.a[0]) * cos * x + (p[1] - s.a[1]) * y) / (x * x + y * y))
      );
      if (!Number.isFinite(t)) continue;
      const q: LngLat = [s.a[0] + t * (s.b[0] - s.a[0]), s.a[1] + t * (s.b[1] - s.a[1])];
      const d = length(p, q, cos);
      if (d > corridor) continue;
      const n = node(q, grade);
      cuts.push({ t, p: q, n });
      projections.push({ anchor, node: n, distance: d });
    }
    cuts.sort((a, b) => a.t - b.t || a.n - b.n);
    for (let i = 1; i < cuts.length; i++) {
      const p = cuts[i - 1]!,
        q = cuts[i]!;
      if (distance(p.p) > corridor || distance(q.p) > corridor) continue;
      add(p.n, q.n, s.barrier.strength, s.barrier.id);
    }
  }
  for (const anchor of [0, 1])
    for (const p of projections
      .filter((p) => p.anchor === anchor && p.distance <= chord * 0.2)
      .sort((a, b) => a.distance - b.distance || a.node - b.node)
      .slice(0, 24))
      add(anchor, p.node, 0);
  const costs = points.map(() => Infinity),
    previous = points.map(() => -1);
  const previousEdges: Array<(typeof edges)[number][number] | undefined> = points.map(
    () => undefined
  );
  const heap: { n: number; cost: number }[] = [];
  const less = (x: { n: number; cost: number }, y: { n: number; cost: number }) =>
    x.cost < y.cost || (x.cost === y.cost && x.n < y.n);
  const push = (item: { n: number; cost: number }) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const pop = () => {
    const first = heap[0]!,
      last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1]!, heap[c]!)) c++;
        if (!less(heap[c]!, heap[i]!)) break;
        [heap[c], heap[i]] = [heap[i]!, heap[c]!];
        i = c;
      }
    }
    return first;
  };
  costs[0] = 0;
  push({ n: 0, cost: 0 });
  while (heap.length) {
    const current = pop();
    if (current.cost !== costs[current.n]) continue;
    if (current.n === 1) break;
    for (const edge of edges[current.n]!) {
      if (progress(points[edge.to]!) < progress(points[current.n]!) - 0.08) continue;
      const cost = current.cost + edge.cost;
      if (cost < costs[edge.to]!) {
        costs[edge.to] = cost;
        previous[edge.to] = current.n;
        previousEdges[edge.to] = edge;
        push({ n: edge.to, cost });
      }
    }
  }
  if (!Number.isFinite(costs[1]!)) return;
  const path: LngLat[] = [];
  const ids = new Set<string>();
  let connector = 0,
    supported = 0;
  for (let n = 1; n !== -1; n = previous[n]!) {
    path.push(points[n]!);
    const p = previous[n]!;
    if (p >= 0) {
      const edge = previousEdges[n]!;
      if (edge.id) {
        ids.add(edge.id);
        supported += edge.meters;
      } else connector += edge.meters;
    }
  }
  path.reverse();
  if (supported + connector > chord * 1.8 || connector > chord * 0.4 || supported < chord * 0.5)
    return;
  return {
    path,
    barrierIds: [...ids].sort(),
    supportedMeters: supported,
    connectorMeters: connector
  };
}

function replace(
  geometry: MultiPolygon,
  a: LngLat,
  b: LngLat,
  path: readonly LngLat[]
): MultiPolygon | undefined {
  let found = false;
  const result = geometry.map((polygon) =>
    polygon.map((ring) => {
      const next: [number, number][] = [];
      for (let i = 0; i < ring.length - 1; i++) {
        next.push(ring[i]!);
        if (key(ring[i]!) === key(a) && key(ring[i + 1]!) === key(b)) {
          next.push(...path.slice(1, -1));
          found = true;
        }
      }
      next.push(next[0]!);
      return next;
    })
  );
  return found ? result : undefined;
}
function area(g: MultiPolygon) {
  return g.reduce(
    (sum, p) =>
      sum +
      p.reduce((s, r, i) => {
        let a = 0;
        const origin = r[0]!;
        for (let j = 1; j < r.length; j++)
          a +=
            (r[j - 1]![0]! - origin[0]) * (r[j]![1]! - origin[1]) -
            (r[j]![0]! - origin[0]) * (r[j - 1]![1]! - origin[1]);
        return s + ((i === 0 ? 1 : -1) * Math.abs(a)) / 2;
      }, 0),
    0
  );
}
function safeReplacement(
  a: MultiPolygon,
  b: MultiPolygon,
  left: MultiPolygon,
  right: MultiPolygon
) {
  if (
    [left, right].some((g) => g.some((p) => p.some((r) => hasRingSelfIntersection(r as LngLat[]))))
  )
    return false;
  try {
    const before = clip.union(a, b),
      after = clip.union(left, right);
    const tolerance = Math.max(1e-12, area(before) * 1e-9);
    return (
      area(clip.intersection(left, right)) <= tolerance &&
      area(clip.difference(before, after)) <= tolerance &&
      area(clip.difference(after, before)) <= tolerance
    );
  } catch {
    return false;
  }
}
function safePartitionReplacement(before: MultiPolygon[], after: MultiPolygon[]) {
  if (after.some((g) => g.some((p) => p.some((r) => hasRingSelfIntersection(r as LngLat[])))))
    return false;
  try {
    const original = clip.union(before[0]!, ...before.slice(1)),
      updated = clip.union(after[0]!, ...after.slice(1)),
      tolerance = Math.max(1e-12, area(original) * 1e-9);
    if (
      area(clip.difference(original, updated)) + area(clip.difference(updated, original)) >
      tolerance
    )
      return false;
    for (let i = 0; i < after.length; i++)
      for (let j = i + 1; j < after.length; j++)
        if (area(clip.intersection(after[i]!, after[j]!)) > tolerance) return false;
    return true;
  } catch {
    return false;
  }
}
