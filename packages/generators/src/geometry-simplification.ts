import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  computeGeometryBBox,
  computeGeometryCenter,
  hasRingSelfIntersection,
  loadTerritoryDataset
} from "@territory-kit/dataset";
import type {
  LngLat,
  TerritoryDataset,
  TerritoryGeometry,
  TerritoryGeometryDetailLevel,
  TerritoryZone
} from "@territory-kit/dataset";
import {
  createDatasetGeometryHash,
  serializeJsonStable,
  sha256Hex,
  writeFilesAtomically
} from "./sources/utils.js";

export type TerritorySimplificationDetail = "high" | "medium" | "low";
export type TerritorySimplificationStrategy = "topology-safe";

export interface TerritorySimplificationOptions {
  strategy: TerritorySimplificationStrategy;
  details: readonly TerritorySimplificationDetail[];
  buildDate?: string;
  force?: boolean;
}

export interface TerritorySimplificationTierReport {
  detail: TerritorySimplificationDetail;
  status: "generated" | "omitted";
  reason?: string;
  datasetPath?: string;
  geojsonPath?: string;
  geometryHash?: string;
  featureCount: number;
  vertexCount: number;
  byteSize: number;
  areaDeltaRatio: number;
  topologyAudit: {
    sharedSegmentCountBefore: number;
    sharedSegmentCountAfter: number;
    sharedBoundaryMismatchCount: number;
  };
}

export interface TerritorySimplificationReport {
  reportVersion: "1";
  strategy: TerritorySimplificationStrategy;
  source: {
    datasetId: string;
    datasetVersion: string;
    geometryHash: string;
    featureCount: number;
    vertexCount: number;
    sharedSegmentCount: number;
  };
  tiers: TerritorySimplificationTierReport[];
}

export interface TerritorySimplificationPathResult {
  inputPath: string;
  outputPath: string;
  report: TerritorySimplificationReport;
}

const DETAIL_TOLERANCE: Record<TerritorySimplificationDetail, number> = {
  high: 0.00005,
  medium: 0.0005,
  low: 0.0025
};

type RingId = string;
type ArcId = string;
type Direction = 1 | -1;

interface IndexedRing {
  id: RingId;
  zoneId: string;
  zoneIndex: number;
  polygonIndex: number;
  ringIndex: number;
  sourceRing: LngLat[];
  pointKeys: string[];
}

interface SegmentUse {
  ringId: RingId;
  zoneId: string;
  segmentIndex: number;
}

interface TopologyArc {
  id: ArcId;
  pointKeys: string[];
  simplified: LngLat[];
  forceSource: boolean;
}

interface RingArcRef {
  arcId: ArcId;
  direction: Direction;
}

interface TopologyModel {
  rings: IndexedRing[];
  ringById: Map<RingId, IndexedRing>;
  arcs: Map<ArcId, TopologyArc>;
  ringRefs: Map<RingId, RingArcRef[]>;
  coordinates: Map<string, LngLat>;
}

export async function simplifyTerritoryDatasetPath(
  inputPath: string,
  outputPath: string,
  options: TerritorySimplificationOptions
): Promise<TerritorySimplificationPathResult> {
  const dataset = loadTerritoryDataset(JSON.parse(await readFile(resolve(inputPath), "utf8")));
  const result = simplifyTerritoryDataset(dataset, options);
  const files = new Map<string, string>();

  for (const tier of result.tiers) {
    if (tier.status !== "generated" || !tier.datasetPath || !tier.geojsonPath) {
      continue;
    }

    const tierDataset = simplifyDataset(dataset, tier.detail, options.buildDate);
    files.set(tier.datasetPath, serializeJsonStable(tierDataset));
    files.set(tier.geojsonPath, serializeJsonStable(datasetToFeatureCollection(tierDataset)));
  }

  files.set("simplification-report.json", serializeJsonStable(result));
  await writeFilesAtomically(resolve(outputPath), files, { force: options.force ?? false });

  return {
    inputPath: resolve(inputPath),
    outputPath: resolve(outputPath),
    report: result
  };
}

export function simplifyTerritoryDataset(
  dataset: TerritoryDataset,
  options: TerritorySimplificationOptions
): TerritorySimplificationReport {
  const sourceHash = createDatasetGeometryHash(dataset);
  const sourceSharedSegments = collectSharedSegments(dataset);
  const sourceArea = sumDatasetArea(dataset);
  const sourceVertexCount = countDatasetVertices(dataset);

  return {
    reportVersion: "1",
    strategy: options.strategy,
    source: {
      datasetId: dataset.manifest.datasetId,
      datasetVersion: dataset.manifest.datasetVersion,
      geometryHash: sourceHash,
      featureCount: dataset.zones.length,
      vertexCount: sourceVertexCount,
      sharedSegmentCount: sourceSharedSegments
    },
    tiers: options.details.map((detail) => {
      const simplified = simplifyDataset(dataset, detail, options.buildDate);
      const geometryHash = createDatasetGeometryHash(simplified);
      const serialized = serializeJsonStable(simplified);
      const sharedSegmentCountAfter = collectSharedSegments(simplified);

      if (geometryHash === sourceHash) {
        return {
          detail,
          status: "omitted",
          reason: "tier-hash-matches-source",
          featureCount: simplified.zones.length,
          vertexCount: countDatasetVertices(simplified),
          byteSize: Buffer.byteLength(serialized),
          areaDeltaRatio: 0,
          topologyAudit: {
            sharedSegmentCountBefore: sourceSharedSegments,
            sharedSegmentCountAfter,
            sharedBoundaryMismatchCount: 0
          }
        };
      }

      return {
        detail,
        status: "generated",
        datasetPath: `${detail}/dataset.json`,
        geojsonPath: `${detail}/features.geojson`,
        geometryHash,
        featureCount: simplified.zones.length,
        vertexCount: countDatasetVertices(simplified),
        byteSize: Buffer.byteLength(serialized),
        areaDeltaRatio:
          sourceArea === 0 ? 0 : Math.abs(sumDatasetArea(simplified) - sourceArea) / sourceArea,
        topologyAudit: {
          sharedSegmentCountBefore: sourceSharedSegments,
          sharedSegmentCountAfter,
          sharedBoundaryMismatchCount: Math.max(0, sourceSharedSegments - sharedSegmentCountAfter)
        }
      };
    })
  };
}

function simplifyDataset(
  dataset: TerritoryDataset,
  detail: TerritorySimplificationDetail,
  buildDate: string | undefined
): TerritoryDataset {
  const tolerance = DETAIL_TOLERANCE[detail];
  const geometries = simplifyDatasetGeometriesTopologySafe(dataset, tolerance);
  const zones = dataset.zones.map((zone): TerritoryZone => {
    const geometry = geometries.get(zone.id) ?? zone.geometry;

    return {
      ...zone,
      geometry,
      bbox: computeGeometryBBox(geometry),
      center: computeGeometryCenter(geometry)
    };
  });
  const simplified: TerritoryDataset = {
    manifest: {
      ...dataset.manifest,
      geometryDetail: detail as TerritoryGeometryDetailLevel,
      ...(buildDate ? { buildDate } : {})
    },
    zones
  };
  const geometryHash = createDatasetGeometryHash(simplified);

  return {
    ...simplified,
    manifest: {
      ...simplified.manifest,
      geometryHash,
      artifactChecksum: sha256Hex(serializeJsonStable(simplified.zones))
    }
  };
}

function simplifyDatasetGeometriesTopologySafe(
  dataset: TerritoryDataset,
  tolerance: number
): Map<string, TerritoryGeometry> {
  const model = buildTopologyModel(dataset, tolerance);
  settleInvalidRingsOnSourceArcs(model);
  return reconstructDatasetGeometries(dataset, model);
}

function buildTopologyModel(dataset: TerritoryDataset, tolerance: number): TopologyModel {
  const coordinates = new Map<string, LngLat>();
  const rings = indexDatasetRings(dataset, coordinates);
  const ringById = new Map(rings.map((ring) => [ring.id, ring]));
  const segmentUses = collectTopologySegmentUses(rings);
  const segmentTopology = buildSegmentTopologyKeys(segmentUses);
  const protectedVertices = collectProtectedVertexKeys(rings, segmentUses, segmentTopology);
  const arcs = new Map<ArcId, TopologyArc>();
  const ringRefs = new Map<RingId, RingArcRef[]>();

  for (const ring of [...rings].sort((left, right) => left.id.localeCompare(right.id))) {
    ringRefs.set(ring.id, buildRingArcRefs(ring, protectedVertices, arcs, coordinates, tolerance));
  }

  return { rings, ringById, arcs, ringRefs, coordinates };
}

function indexDatasetRings(
  dataset: TerritoryDataset,
  coordinates: Map<string, LngLat>
): IndexedRing[] {
  const rawRings: Array<Omit<IndexedRing, "sourceRing">> = [];

  for (const [zoneIndex, zone] of dataset.zones.entries()) {
    const polygons =
      zone.geometry.type === "Polygon"
        ? [zone.geometry.coordinates as LngLat[][]]
        : (zone.geometry.coordinates as LngLat[][][]);

    for (const [polygonIndex, polygon] of polygons.entries()) {
      for (const [ringIndex, ring] of polygon.entries()) {
        for (const coordinate of ring) {
          rememberCanonicalCoordinate(coordinates, coordinate);
        }

        const pointKeys = normalizeRingPointKeys(ring as LngLat[]);

        rawRings.push({
          id: ringId(zone.id, polygonIndex, ringIndex),
          zoneId: zone.id,
          zoneIndex,
          polygonIndex,
          ringIndex,
          pointKeys
        });
      }
    }
  }

  return rawRings.map((ring) => ({
    ...ring,
    sourceRing: ring.pointKeys.map((key) => coordinateForKey(coordinates, key))
  }));
}

function rememberCanonicalCoordinate(coordinates: Map<string, LngLat>, coordinate: LngLat): void {
  const key = coordinateKey(coordinate);
  const previous = coordinates.get(key);

  if (!previous || compareCoordinates(coordinate, previous) < 0) {
    coordinates.set(key, [coordinate[0], coordinate[1]]);
  }
}

function compareCoordinates(left: LngLat, right: LngLat): number {
  return left[0] - right[0] || left[1] - right[1];
}

function normalizeRingPointKeys(ring: readonly LngLat[]): string[] {
  const closed = closeRing(ring);
  const keys: string[] = [];

  for (const coordinate of closed) {
    const key = coordinateKey(coordinate);

    if (key !== keys.at(-1)) {
      keys.push(key);
    }
  }

  const first = keys[0];

  if (first && keys.at(-1) !== first) {
    keys.push(first);
  }

  return keys;
}

function collectTopologySegmentUses(rings: readonly IndexedRing[]): Map<string, SegmentUse[]> {
  const uses = new Map<string, SegmentUse[]>();

  for (const ring of rings) {
    for (let segmentIndex = 0; segmentIndex < ring.pointKeys.length - 1; segmentIndex += 1) {
      const start = ring.pointKeys[segmentIndex]!;
      const end = ring.pointKeys[segmentIndex + 1]!;

      if (start === end) {
        continue;
      }

      const key = segmentKeyFromCoordinateKeys(start, end);
      const segmentUses = uses.get(key) ?? [];
      segmentUses.push({ ringId: ring.id, zoneId: ring.zoneId, segmentIndex });
      uses.set(key, segmentUses);
    }
  }

  return uses;
}

function buildSegmentTopologyKeys(segmentUses: Map<string, SegmentUse[]>): Map<string, string> {
  const topology = new Map<string, string>();

  for (const [segment, uses] of segmentUses) {
    const zoneIds = [...new Set(uses.map((use) => use.zoneId))].sort();

    if (zoneIds.length > 1) {
      topology.set(segment, `shared:${zoneIds.join(",")}`);
      continue;
    }

    if (uses.length > 1) {
      topology.set(
        segment,
        `shared-rings:${uses
          .map((use) => use.ringId)
          .sort()
          .join(",")}`
      );
      continue;
    }

    topology.set(segment, "exterior");
  }

  return topology;
}

function collectProtectedVertexKeys(
  rings: readonly IndexedRing[],
  segmentUses: Map<string, SegmentUse[]>,
  segmentTopology: Map<string, string>
): Set<string> {
  const protectedVertices = new Set<string>();
  const incidentSegments = new Map<string, Set<string>>();

  for (const segment of segmentUses.keys()) {
    const [left, right] = segment.split("|") as [string, string];
    addIncidentSegment(incidentSegments, left, segment);
    addIncidentSegment(incidentSegments, right, segment);
  }

  for (const ring of rings) {
    const first = ring.pointKeys[0];

    if (first) {
      protectedVertices.add(first);
    }
  }

  for (const [vertex, segments] of incidentSegments) {
    if (segments.size !== 2) {
      protectedVertices.add(vertex);
    }
  }

  for (const ring of rings) {
    const openVertexCount = ring.pointKeys.length - 1;

    if (openVertexCount < 3) {
      continue;
    }

    for (let vertexIndex = 0; vertexIndex < openVertexCount; vertexIndex += 1) {
      const previousIndex = (vertexIndex - 1 + openVertexCount) % openVertexCount;
      const nextIndex = (vertexIndex + 1) % openVertexCount;
      const previous = segmentTopology.get(
        segmentKeyFromCoordinateKeys(ring.pointKeys[previousIndex]!, ring.pointKeys[vertexIndex]!)
      );
      const next = segmentTopology.get(
        segmentKeyFromCoordinateKeys(ring.pointKeys[vertexIndex]!, ring.pointKeys[nextIndex]!)
      );

      if (previous !== next) {
        protectedVertices.add(ring.pointKeys[vertexIndex]!);
      }
    }
  }

  return protectedVertices;
}

function addIncidentSegment(
  incidentSegments: Map<string, Set<string>>,
  vertex: string,
  segment: string
): void {
  const current = incidentSegments.get(vertex) ?? new Set<string>();
  current.add(segment);
  incidentSegments.set(vertex, current);
}

function buildRingArcRefs(
  ring: IndexedRing,
  protectedVertices: ReadonlySet<string>,
  arcs: Map<ArcId, TopologyArc>,
  coordinates: Map<string, LngLat>,
  tolerance: number
): RingArcRef[] {
  const openVertexCount = ring.pointKeys.length - 1;

  if (openVertexCount < 3) {
    return [];
  }

  const protectedIndices = ring.pointKeys
    .slice(0, -1)
    .flatMap((key, index) => (protectedVertices.has(key) ? [index] : []));

  if (protectedIndices.length === 0) {
    protectedIndices.push(0);
  }

  const refs: RingArcRef[] = [];

  for (const [index, start] of protectedIndices.entries()) {
    const end = protectedIndices[(index + 1) % protectedIndices.length]!;
    const pointKeys = collectArcPointKeys(ring.pointKeys, start, end);
    refs.push(getOrCreateArcRef(pointKeys, arcs, coordinates, tolerance));
  }

  return refs;
}

function collectArcPointKeys(
  ringPointKeys: readonly string[],
  start: number,
  end: number
): string[] {
  const openVertexCount = ringPointKeys.length - 1;
  const pointKeys = [ringPointKeys[start]!];
  let cursor = start;

  do {
    cursor = (cursor + 1) % openVertexCount;
    pointKeys.push(ringPointKeys[cursor]!);
  } while (cursor !== end);

  return pointKeys;
}

function getOrCreateArcRef(
  pointKeys: readonly string[],
  arcs: Map<ArcId, TopologyArc>,
  coordinates: Map<string, LngLat>,
  tolerance: number
): RingArcRef {
  const forward = arcSequenceKey(pointKeys);
  const reversedPointKeys = [...pointKeys].reverse();
  const reversed = arcSequenceKey(reversedPointKeys);
  const direction: Direction = forward <= reversed ? 1 : -1;
  const canonicalPointKeys = direction === 1 ? [...pointKeys] : reversedPointKeys;
  const arcId = direction === 1 ? forward : reversed;

  if (!arcs.has(arcId)) {
    const source = canonicalPointKeys.map((key) => coordinateForKey(coordinates, key));
    arcs.set(arcId, {
      id: arcId,
      pointKeys: canonicalPointKeys,
      simplified: simplifyArc(source, tolerance),
      forceSource: false
    });
  }

  return { arcId, direction };
}

function simplifyArc(points: readonly LngLat[], tolerance: number): LngLat[] {
  if (points.length <= 2) {
    return points.map(cloneCoordinate);
  }

  const first = points[0]!;
  const last = points.at(-1)!;

  if (pointsEqual(first, last)) {
    return simplifyRing(points, tolerance);
  }

  const simplified = ramerDouglasPeucker(points, tolerance);

  return simplified.length >= 2 ? simplified.map(cloneCoordinate) : points.map(cloneCoordinate);
}

function settleInvalidRingsOnSourceArcs(model: TopologyModel): void {
  let changed = true;

  while (changed) {
    changed = false;

    for (const ring of [...model.rings].sort((left, right) => left.id.localeCompare(right.id))) {
      const refs = model.ringRefs.get(ring.id) ?? [];

      if (refs.length === 0 || isValidSimplifiedRing(reconstructRingFromRefs(model, refs))) {
        continue;
      }

      for (const ref of refs) {
        const arc = model.arcs.get(ref.arcId);

        if (arc && !arc.forceSource) {
          arc.forceSource = true;
          changed = true;
        }
      }
    }
  }
}

function reconstructDatasetGeometries(
  dataset: TerritoryDataset,
  model: TopologyModel
): Map<string, TerritoryGeometry> {
  const geometries = new Map<string, TerritoryGeometry>();

  for (const zone of dataset.zones) {
    if (zone.geometry.type === "Polygon") {
      geometries.set(zone.id, {
        type: "Polygon",
        coordinates: (zone.geometry.coordinates as LngLat[][]).map((_, ringIndex) =>
          reconstructIndexedRing(model, ringId(zone.id, 0, ringIndex))
        )
      });
      continue;
    }

    geometries.set(zone.id, {
      type: "MultiPolygon",
      coordinates: (zone.geometry.coordinates as LngLat[][][]).map((polygon, polygonIndex) =>
        polygon.map((_, ringIndex) =>
          reconstructIndexedRing(model, ringId(zone.id, polygonIndex, ringIndex))
        )
      )
    });
  }

  return geometries;
}

function reconstructIndexedRing(model: TopologyModel, id: RingId): LngLat[] {
  const ring = model.ringById.get(id);
  const refs = model.ringRefs.get(id) ?? [];
  const reconstructed = reconstructRingFromRefs(model, refs);

  if (isValidSimplifiedRing(reconstructed)) {
    return reconstructed;
  }

  return ring?.sourceRing.map(cloneCoordinate) ?? reconstructed;
}

function reconstructRingFromRefs(model: TopologyModel, refs: readonly RingArcRef[]): LngLat[] {
  const points: LngLat[] = [];

  for (const [index, ref] of refs.entries()) {
    const arc = model.arcs.get(ref.arcId);

    if (!arc) {
      continue;
    }

    const arcPoints = orientedArcCoordinates(model, arc, ref.direction);
    points.push(...(index === 0 ? arcPoints : arcPoints.slice(1)));
  }

  return normalizeClosedRing(points);
}

function orientedArcCoordinates(
  model: TopologyModel,
  arc: TopologyArc,
  direction: Direction
): LngLat[] {
  const source = arc.pointKeys.map((key) => coordinateForKey(model.coordinates, key));
  const points = arc.forceSource ? source : arc.simplified;
  const oriented = direction === 1 ? points : [...points].reverse();

  return oriented.map(cloneCoordinate);
}

function normalizeClosedRing(points: readonly LngLat[]): LngLat[] {
  const deduped: LngLat[] = [];

  for (const point of points) {
    if (!pointsEqual(point, deduped.at(-1))) {
      deduped.push(cloneCoordinate(point));
    }
  }

  return closeRing(deduped);
}

function isValidSimplifiedRing(ring: readonly LngLat[]): boolean {
  if (ring.length < 4) {
    return false;
  }

  const first = ring[0];
  const last = ring.at(-1);

  if (!first || !last || !pointsEqual(first, last)) {
    return false;
  }

  if (
    ring.some((coordinate) => !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1]))
  ) {
    return false;
  }

  if (new Set(ring.slice(0, -1).map(coordinateKey)).size < 3) {
    return false;
  }

  if (Math.abs(ringArea(ring)) === 0) {
    return false;
  }

  return !hasRingSelfIntersection(ring.map(cloneCoordinate));
}

function coordinateForKey(coordinates: Map<string, LngLat>, key: string): LngLat {
  const coordinate = coordinates.get(key);

  if (!coordinate) {
    const [longitude = "0", latitude = "0"] = key.split(",");
    return [Number(longitude), Number(latitude)];
  }

  return cloneCoordinate(coordinate);
}

function cloneCoordinate(coordinate: LngLat): LngLat {
  return [coordinate[0], coordinate[1]];
}

function pointsEqual(left: LngLat | undefined, right: LngLat | undefined): boolean {
  return Boolean(left && right && left[0] === right[0] && left[1] === right[1]);
}

function ringId(zoneId: string, polygonIndex: number, ringIndex: number): RingId {
  return `${zoneId}#${polygonIndex}#${ringIndex}`;
}

function arcSequenceKey(pointKeys: readonly string[]): ArcId {
  return pointKeys.join(">");
}

function segmentKeyFromCoordinateKeys(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function simplifyRing(ring: readonly LngLat[], tolerance: number): LngLat[] {
  if (ring.length <= 4) {
    return ring.map(cloneCoordinate);
  }

  const openRing = ring.slice(0, -1);
  const simplified = ramerDouglasPeucker(openRing, tolerance);
  const closed = closeRing(simplified.length >= 3 ? simplified : openRing);

  return Math.abs(ringArea(closed)) > 0 ? closed : ring.map(cloneCoordinate);
}

function ramerDouglasPeucker(points: readonly LngLat[], tolerance: number): LngLat[] {
  if (points.length <= 2) {
    return [...points];
  }

  let maxDistance = 0;
  let index = 0;

  for (let pointIndex = 1; pointIndex < points.length - 1; pointIndex += 1) {
    const distance = perpendicularDistance(points[pointIndex]!, points[0]!, points.at(-1)!);

    if (distance > maxDistance) {
      index = pointIndex;
      maxDistance = distance;
    }
  }

  if (maxDistance <= tolerance) {
    return [points[0]!, points.at(-1)!];
  }

  return [
    ...ramerDouglasPeucker(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...ramerDouglasPeucker(points.slice(index), tolerance)
  ];
}

function perpendicularDistance(point: LngLat, start: LngLat, end: LngLat): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];

  if (dx === 0 && dy === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }

  return (
    Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) /
    Math.hypot(dx, dy)
  );
}

function closeRing(ring: readonly LngLat[]): LngLat[] {
  const first = ring[0];
  const last = ring.at(-1);

  if (!first || !last) {
    return [...ring];
  }

  if (first[0] === last[0] && first[1] === last[1]) {
    return [...ring];
  }

  return [...ring, first];
}

function collectSharedSegments(dataset: TerritoryDataset): number {
  const counts = new Map<string, number>();

  for (const zone of dataset.zones) {
    for (const ring of geometryRings(zone.geometry)) {
      for (let index = 1; index < ring.length; index += 1) {
        const key = segmentKey(ring[index - 1]!, ring[index]!);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  return [...counts.values()].filter((count) => count > 1).length;
}

function geometryRings(geometry: TerritoryGeometry): LngLat[][] {
  return geometry.type === "Polygon"
    ? (geometry.coordinates as LngLat[][])
    : (geometry.coordinates.flat(1) as LngLat[][]);
}

function segmentKey(left: LngLat, right: LngLat): string {
  const first = coordinateKey(left);
  const second = coordinateKey(right);

  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function coordinateKey(coordinate: LngLat): string {
  return `${coordinate[0].toFixed(9)},${coordinate[1].toFixed(9)}`;
}

function countDatasetVertices(dataset: TerritoryDataset): number {
  return dataset.zones.reduce(
    (sum, zone) =>
      sum + geometryRings(zone.geometry).reduce((ringSum, ring) => ringSum + ring.length, 0),
    0
  );
}

function sumDatasetArea(dataset: TerritoryDataset): number {
  return dataset.zones.reduce((sum, zone) => sum + geometryArea(zone.geometry), 0);
}

function geometryArea(geometry: TerritoryGeometry): number {
  return geometryRings(geometry).reduce((sum, ring, index) => {
    const area = Math.abs(ringArea(ring));
    return index === 0 ? sum + area : sum - area;
  }, 0);
}

function ringArea(ring: readonly LngLat[]): number {
  let area = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index]!;
    const next = ring[index + 1]!;
    area += current[0] * next[1] - next[0] * current[1];
  }

  return area / 2;
}

function datasetToFeatureCollection(dataset: TerritoryDataset): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    features: dataset.zones.map((zone) => ({
      type: "Feature",
      id: zone.id,
      properties: {
        ...zone.properties,
        id: zone.id,
        countryCode: zone.countryCode,
        level: zone.level,
        sourceAdminLevel: zone.sourceAdminLevel,
        semanticType: zone.semanticType,
        name: zone.name,
        localName: zone.localName,
        parentId: zone.parentId,
        childIds: zone.childIds ?? [],
        neighborIds: zone.neighborIds
      },
      geometry: zone.geometry
    }))
  };
}
