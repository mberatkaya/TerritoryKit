import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  computeGeometryBBox,
  computeGeometryCenter,
  createTerritoryGlobalId,
  slugifyTerritoryIdPart
} from "@territory-kit/dataset";
import type { LngLat, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import { readOsmPbf } from "@osmix/pbf";
import type { OsmPbfBlock, OsmPbfGroup } from "@osmix/pbf";
import { createTurkeyAdm3GeometryHash } from "./turkey-adm3-full-coverage.js";
import { sha256Hex, serializeJsonStable } from "./sources/utils.js";

export const TURKEY_ADM3_OSM_SOURCE_URL = "https://download.geofabrik.de/europe/turkey.html";
export const TURKEY_ADM3_OSM_DOWNLOAD_URL =
  "https://download.geofabrik.de/europe/turkey-latest.osm.pbf";
export const TURKEY_ADM3_OSM_LICENSE = "ODbL-1.0";
export const TURKEY_ADM3_OSM_ATTRIBUTION = "OpenStreetMap contributors, ODbL 1.0";

export type TurkeyAdm3OsmSemanticType =
  "neighbourhood" | "village" | "locality" | "administrative-unit" | "semantic-review-required";

export type TurkeyAdm3OsmParentConfidence = "exact" | "high" | "medium" | "low" | "unresolved";

export interface TurkeyAdm3OsmExtractOptions {
  pbfPath: string;
  generatedAt: string;
  providerId?: string;
  districtZones?: readonly TerritoryZone[];
  provinceCode?: string;
  maxPrimitiveBlocks?: number;
}

export interface TurkeyAdm3OsmExtractResult {
  zones: TerritoryZone[];
  sourceLock: Record<string, unknown>;
  coverage: Record<string, unknown>;
  quality: Record<string, unknown>;
  unresolved: Array<Record<string, unknown>>;
  duplicates: Array<Record<string, unknown>>;
}

interface OsmNode {
  id: number;
  coordinate: LngLat;
  tags: Record<string, string>;
}

interface OsmWay {
  id: number;
  refs: number[];
  tags: Record<string, string>;
}

interface OsmRelation {
  id: number;
  members: Array<{ type: "node" | "way" | "relation"; ref: number; role: string }>;
  tags: Record<string, string>;
}

interface OsmCandidate {
  osmType: "way" | "relation";
  osmId: number;
  tags: Record<string, string>;
  geometry?: TerritoryGeometry;
  rejectionReason?: string;
}

const textDecoder = new TextDecoder();
const ACCEPTED_ADMIN_LEVELS = new Set(["9", "10", "11"]);

export async function extractTurkeyAdm3OsmPbf(
  options: TurkeyAdm3OsmExtractOptions
): Promise<TurkeyAdm3OsmExtractResult> {
  const startedAt = Date.now();
  const nodes = new Map<number, OsmNode>();
  const ways = new Map<number, OsmWay>();
  const relations: OsmRelation[] = [];
  const pbfStats = await stat(options.pbfPath);
  const pbfSha256 = await sha256File(options.pbfPath);
  const stream = Readable.toWeb(createReadStream(options.pbfPath)) as ReadableStream<Uint8Array>;
  const { header, blocks } = await readOsmPbf(stream);
  let blockCount = 0;

  for await (const block of blocks) {
    readPrimitiveBlock(block, { nodes, ways, relations });
    blockCount += 1;

    if (options.maxPrimitiveBlocks !== undefined && blockCount >= options.maxPrimitiveBlocks) {
      break;
    }
  }

  const candidates = [
    ...[...ways.values()].map((way): OsmCandidate => {
      const geometry = closedWayGeometry(way, nodes);

      return {
        osmType: "way",
        osmId: way.id,
        tags: way.tags,
        ...(geometry ? { geometry } : {})
      };
    }),
    ...relations.map((relation): OsmCandidate => {
      const geometry = relationGeometry(relation, ways, nodes);

      return {
        osmType: "relation",
        osmId: relation.id,
        tags: relation.tags,
        ...(geometry ? { geometry } : {})
      };
    })
  ].filter(isAdm3BoundaryCandidate);
  const unresolved: Array<Record<string, unknown>> = [];
  const duplicates: Array<Record<string, unknown>> = [];
  const seen = new Map<string, TerritoryZone>();
  const zones: TerritoryZone[] = [];

  for (const candidate of candidates.sort(compareOsmCandidates)) {
    if (!candidate.geometry) {
      unresolved.push({
        osmType: candidate.osmType,
        osmId: candidate.osmId,
        reason: candidate.rejectionReason ?? "geometry-unavailable",
        tags: candidate.tags
      });
      continue;
    }

    const semanticType = classifyTurkeyAdm3OsmSemanticType(candidate.tags);
    const parent = resolveTurkeyAdm3OsmParent(candidate.geometry, options.districtZones ?? []);

    if (
      semanticType === "semantic-review-required" ||
      parent.confidence === "low" ||
      parent.confidence === "unresolved"
    ) {
      unresolved.push({
        osmType: candidate.osmType,
        osmId: candidate.osmId,
        semanticType,
        parentConfidence: parent.confidence,
        parentId: parent.parentId,
        tags: candidate.tags
      });
      continue;
    }

    const name = candidate.tags.name ?? candidate.tags["name:tr"] ?? `OSM ${candidate.osmId}`;
    const geometryHash = createTurkeyAdm3GeometryHash(candidate.geometry);
    const duplicateKey = [
      parent.parentId,
      normalizeOsmIdentityName(name),
      geometryHash.slice(0, 24)
    ].join(":");

    if (seen.has(duplicateKey)) {
      duplicates.push({
        duplicateOf: seen.get(duplicateKey)?.id,
        osmType: candidate.osmType,
        osmId: candidate.osmId,
        parentId: parent.parentId,
        name,
        geometryHash
      });
      continue;
    }

    const zone = createOsmZone({
      candidate,
      providerId: options.providerId ?? "tr-adm3-osm",
      ...(options.provinceCode ? { provinceCode: options.provinceCode } : {}),
      ...(parent.parentId ? { parentId: parent.parentId } : {}),
      parentConfidence: parent.confidence,
      name,
      semanticType,
      geometryHash,
      geometry: candidate.geometry,
      generatedAt: options.generatedAt
    });
    seen.set(duplicateKey, zone);
    zones.push(zone);
  }

  const sourceLock = {
    schemaVersion: "territorykit-tr-adm3-osm-source-lock@1",
    country: "TR",
    generatedAt: options.generatedAt,
    sourceUrl: TURKEY_ADM3_OSM_SOURCE_URL,
    downloadUrl: TURKEY_ADM3_OSM_DOWNLOAD_URL,
    upstreamTimestamp: header.osmosis_replication_timestamp
      ? new Date(header.osmosis_replication_timestamp * 1000).toISOString()
      : null,
    sha256: pbfSha256,
    byteSize: pbfStats.size,
    license: TURKEY_ADM3_OSM_LICENSE,
    attribution: TURKEY_ADM3_OSM_ATTRIBUTION,
    parser: {
      package: "@osmix/pbf",
      reason:
        "Modern MIT-licensed TypeScript OSM PBF reader with streaming Web Streams support for large extracts."
    }
  };
  const coverage = {
    schemaVersion: "territorykit-tr-adm3-osm-coverage@1",
    country: "TR",
    generatedAt: options.generatedAt,
    candidateCount: candidates.length,
    builtPolygonCount: zones.length,
    unresolvedCount: unresolved.length,
    duplicateCount: duplicates.length
  };
  const quality = {
    schemaVersion: "territorykit-tr-adm3-osm-quality@1",
    country: "TR",
    generatedAt: options.generatedAt,
    ok: unresolved.length === 0,
    summary: {
      parsedPrimitiveBlocks: blockCount,
      parsedNodeCount: nodes.size,
      parsedWayCount: ways.size,
      parsedRelationCount: relations.length,
      candidateCount: candidates.length,
      builtPolygonCount: zones.length,
      unresolvedCount: unresolved.length,
      duplicateCount: duplicates.length,
      durationMs: Date.now() - startedAt
    }
  };

  return {
    zones: zones.sort((left, right) => left.id.localeCompare(right.id)),
    sourceLock,
    coverage,
    quality,
    unresolved,
    duplicates
  };
}

function readPrimitiveBlock(
  block: OsmPbfBlock,
  output: {
    nodes: Map<number, OsmNode>;
    ways: Map<number, OsmWay>;
    relations: OsmRelation[];
  }
): void {
  for (const group of block.primitivegroup) {
    readPrimitiveGroup(block, group, output);
  }
}

function readPrimitiveGroup(
  block: OsmPbfBlock,
  group: OsmPbfGroup,
  output: {
    nodes: Map<number, OsmNode>;
    ways: Map<number, OsmWay>;
    relations: OsmRelation[];
  }
): void {
  const granularity = block.granularity ?? 100;
  const latOffset = block.lat_offset ?? 0;
  const lonOffset = block.lon_offset ?? 0;

  for (const node of group.nodes) {
    output.nodes.set(node.id, {
      id: node.id,
      coordinate: [
        decodeCoordinate(node.lon, granularity, lonOffset),
        decodeCoordinate(node.lat, granularity, latOffset)
      ],
      tags: readTags(block, node.keys, node.vals)
    });
  }

  if (group.dense) {
    let id = 0;
    let lat = 0;
    let lon = 0;
    let keyValueIndex = 0;

    for (let index = 0; index < group.dense.id.length; index += 1) {
      id += group.dense.id[index] ?? 0;
      lat += group.dense.lat[index] ?? 0;
      lon += group.dense.lon[index] ?? 0;
      const tags: Record<string, string> = {};

      while (keyValueIndex < group.dense.keys_vals.length) {
        const key = group.dense.keys_vals[keyValueIndex++] ?? 0;

        if (key === 0) {
          break;
        }

        const value = group.dense.keys_vals[keyValueIndex++] ?? 0;
        tags[stringAt(block, key)] = stringAt(block, value);
      }

      output.nodes.set(id, {
        id,
        coordinate: [
          decodeCoordinate(lon, granularity, lonOffset),
          decodeCoordinate(lat, granularity, latOffset)
        ],
        tags
      });
    }
  }

  for (const way of group.ways) {
    output.ways.set(way.id, {
      id: way.id,
      refs: decodeDeltas(way.refs),
      tags: readTags(block, way.keys, way.vals)
    });
  }

  for (const relation of group.relations) {
    const refs = decodeDeltas(relation.memids);
    output.relations.push({
      id: relation.id,
      tags: readTags(block, relation.keys, relation.vals),
      members: refs.map((ref, index) => ({
        ref,
        type: relationMemberType(relation.types[index] ?? 0),
        role: stringAt(block, relation.roles_sid[index] ?? 0)
      }))
    });
  }
}

function readTags(
  block: OsmPbfBlock,
  keys: readonly number[],
  vals: readonly number[]
): Record<string, string> {
  const tags: Record<string, string> = {};

  for (let index = 0; index < keys.length; index += 1) {
    tags[stringAt(block, keys[index] ?? 0)] = stringAt(block, vals[index] ?? 0);
  }

  return tags;
}

function stringAt(block: OsmPbfBlock, index: number): string {
  return textDecoder.decode(block.stringtable[index] ?? new Uint8Array());
}

function decodeDeltas(values: readonly number[]): number[] {
  let current = 0;

  return values.map((value) => {
    current += value;
    return current;
  });
}

function decodeCoordinate(value: number, granularity: number, offset: number): number {
  return (offset + granularity * value) / 1_000_000_000;
}

function relationMemberType(value: number): "node" | "way" | "relation" {
  if (value === 1) {
    return "way";
  }

  if (value === 2) {
    return "relation";
  }

  return "node";
}

function isAdm3BoundaryCandidate(candidate: OsmCandidate): boolean {
  if (candidate.tags.boundary !== "administrative") {
    return false;
  }

  if (!ACCEPTED_ADMIN_LEVELS.has(candidate.tags.admin_level ?? "")) {
    return false;
  }

  return true;
}

function closedWayGeometry(
  way: OsmWay,
  nodes: ReadonlyMap<number, OsmNode>
): TerritoryGeometry | undefined {
  if (way.refs.length < 4 || way.refs[0] !== way.refs[way.refs.length - 1]) {
    return undefined;
  }

  const ring = way.refs.map((ref) => nodes.get(ref)?.coordinate);

  if (ring.some((point) => !point)) {
    return undefined;
  }

  return {
    type: "Polygon",
    coordinates: [ring as LngLat[]]
  };
}

function relationGeometry(
  relation: OsmRelation,
  ways: ReadonlyMap<number, OsmWay>,
  nodes: ReadonlyMap<number, OsmNode>
): TerritoryGeometry | undefined {
  if (relation.tags.type !== "multipolygon" && relation.tags.type !== "boundary") {
    return undefined;
  }

  const rings = relation.members
    .filter((member) => member.type === "way" && (member.role === "outer" || member.role === ""))
    .flatMap((member) => {
      const way = ways.get(member.ref);
      const geometry = way ? closedWayGeometry(way, nodes) : undefined;
      return geometry?.type === "Polygon" ? geometry.coordinates : [];
    });

  if (rings.length === 0) {
    return undefined;
  }

  if (rings.length === 1) {
    return { type: "Polygon", coordinates: [rings[0]!] };
  }

  return {
    type: "MultiPolygon",
    coordinates: rings.map((ring) => [ring])
  };
}

function classifyTurkeyAdm3OsmSemanticType(
  tags: Record<string, string>
): TurkeyAdm3OsmSemanticType {
  const place = tags.place;

  if (place === "neighbourhood" || place === "quarter" || place === "suburb") {
    return "neighbourhood";
  }

  if (place === "village" || tags.admin_level === "11") {
    return "village";
  }

  if (place === "locality") {
    return "locality";
  }

  if (tags.boundary === "administrative" && ACCEPTED_ADMIN_LEVELS.has(tags.admin_level ?? "")) {
    return "administrative-unit";
  }

  return "semantic-review-required";
}

function resolveTurkeyAdm3OsmParent(
  geometry: TerritoryGeometry,
  districtZones: readonly TerritoryZone[]
): { parentId?: string; confidence: TurkeyAdm3OsmParentConfidence } {
  if (districtZones.length === 0) {
    return { confidence: "unresolved" };
  }

  const representative = computeGeometryCenter(geometry);
  const containing = districtZones.find((district) =>
    geometryContainsPoint(district.geometry, representative)
  );

  if (containing) {
    return { parentId: containing.id, confidence: "high" };
  }

  return { confidence: "unresolved" };
}

function createOsmZone(input: {
  candidate: OsmCandidate;
  providerId: string;
  provinceCode?: string;
  parentId?: string;
  parentConfidence: TurkeyAdm3OsmParentConfidence;
  name: string;
  semanticType: Exclude<TurkeyAdm3OsmSemanticType, "semantic-review-required">;
  geometryHash: string;
  geometry: TerritoryGeometry;
  generatedAt: string;
}): TerritoryZone {
  const sourceNativeId = `osm:${input.candidate.osmType}:${input.candidate.osmId}`;
  const localId = [
    input.provinceCode ? `tr-${input.provinceCode}` : "tr",
    input.parentId?.replace(/^tr:adm2:/, "adm2-") ?? "adm2-unresolved",
    "osm",
    input.candidate.osmType,
    String(input.candidate.osmId),
    slugifyTerritoryIdPart(input.name)
  ].join("-");
  const id = createTerritoryGlobalId({
    countryCode: "TR",
    adminLevel: "ADM3",
    localId
  });
  const bbox = computeGeometryBBox(input.geometry);

  return {
    id,
    datasetId: "tr-adm3-osm",
    countryCode: "TR",
    level: 3,
    sourceAdminLevel: "ADM3",
    semanticType: input.semanticType,
    name: input.name,
    localName: input.name,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    neighborIds: [],
    geometry: input.geometry,
    center: computeGeometryCenter(input.geometry),
    bbox,
    properties: {
      territory: {
        adminLevel: "ADM3",
        sourceAdminLevel: "ADM3",
        semanticType: input.semanticType,
        localType: input.semanticType,
        localTypeName: input.semanticType === "village" ? "Köy" : "Mahalle",
        countryCode: "TR",
        ...(input.provinceCode ? { provinceCode: input.provinceCode } : {}),
        ...(input.parentId ? { districtCode: input.parentId.replace(/^tr:adm2:/, "") } : {}),
        hierarchyDepth: 3,
        ...(input.parentId ? { parentId: input.parentId } : {}),
        coverageStatus: "verified",
        semanticReviewStatus: "mapping-review-required",
        sourceClass: "osm",
        sourceProvider: input.providerId,
        sourceDatasetId: "openstreetmap",
        sourceDate: input.generatedAt,
        sourceUrl: TURKEY_ADM3_OSM_SOURCE_URL,
        license: TURKEY_ADM3_OSM_LICENSE,
        attribution: TURKEY_ADM3_OSM_ATTRIBUTION,
        official: false,
        generated: false,
        providerId: input.providerId,
        osmType: input.candidate.osmType,
        osmId: input.candidate.osmId,
        sourceNativeId,
        parentAdm2Id: input.parentId,
        parentResolutionConfidence: input.parentConfidence,
        geometryHash: input.geometryHash,
        originalGeometryHash: input.geometryHash,
        effectiveGeometryHash: input.geometryHash,
        clippedByPriority: false,
        source: {
          provider: input.providerId,
          sourceClass: "osm",
          sourceDatasetId: "openstreetmap",
          sourceId: sourceNativeId,
          sourceNativeId,
          sourceDate: input.generatedAt,
          license: TURKEY_ADM3_OSM_LICENSE,
          attribution: TURKEY_ADM3_OSM_ATTRIBUTION,
          sourceUrl: TURKEY_ADM3_OSM_SOURCE_URL
        },
        osmTags: input.candidate.tags
      }
    }
  };
}

function normalizeOsmIdentityName(input: string): string {
  return input.trim().normalize("NFKC").toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function compareOsmCandidates(left: OsmCandidate, right: OsmCandidate): number {
  return (
    left.osmType.localeCompare(right.osmType) ||
    left.osmId - right.osmId ||
    serializeJsonStable(left.tags).localeCompare(serializeJsonStable(right.tags))
  );
}

function geometryContainsPoint(geometry: TerritoryGeometry, point: LngLat): boolean {
  const polygons = (geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates) as unknown as readonly LngLat[][][];

  return polygons.some((polygon) => polygonContainsPoint(polygon, point));
}

function polygonContainsPoint(polygon: readonly LngLat[][], point: LngLat): boolean {
  const [shell, ...holes] = polygon;

  if (!shell || !ringContainsPoint(shell, point)) {
    return false;
  }

  return !holes.some((hole) => ringContainsPoint(hole, point));
}

function ringContainsPoint(ring: readonly LngLat[], point: LngLat): boolean {
  let inside = false;
  const [x, y] = point;

  for (
    let index = 0, lastIndex = ring.length - 1;
    index < ring.length;
    lastIndex = index, index += 1
  ) {
    const current = ring[index];
    const previous = ring[lastIndex];

    if (!current || !previous) {
      continue;
    }

    const intersects =
      current[1] > y !== previous[1] > y &&
      x < ((previous[0] - current[0]) * (y - current[1])) / (previous[1] - current[1]) + current[0];

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");

  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });

  return hash.digest("hex");
}

export function createTurkeyAdm3OsmDataset(input: {
  zones: readonly TerritoryZone[];
  generatedAt: string;
}): { manifest: Record<string, unknown>; zones: TerritoryZone[] } {
  return {
    manifest: {
      schemaVersion: "territory-schema@1",
      datasetId: "tr-adm3-osm",
      datasetVersion: "0.0.0",
      sourceDate: input.generatedAt,
      buildDate: input.generatedAt,
      geometryHash: sha256Hex(serializeJsonStable(input.zones.map((zone) => zone.geometry))),
      adminLevels: ["ADM3"],
      countryCodes: ["TR"],
      crs: "EPSG:4326",
      license: TURKEY_ADM3_OSM_LICENSE,
      attribution: TURKEY_ADM3_OSM_ATTRIBUTION,
      sourceProvider: "OpenStreetMap / Geofabrik Turkey PBF"
    },
    zones: [...input.zones].sort((left, right) => left.id.localeCompare(right.id))
  };
}
