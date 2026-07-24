import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  computeGeometryBBox,
  computeGeometryCenter,
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
  const zones = dataset.zones.map((zone): TerritoryZone => {
    const geometry = simplifyGeometry(zone.geometry, tolerance);

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

function simplifyGeometry(geometry: TerritoryGeometry, tolerance: number): TerritoryGeometry {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) => simplifyRing(ring as LngLat[], tolerance))
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((polygon) =>
      polygon.map((ring) => simplifyRing(ring as LngLat[], tolerance))
    )
  };
}

function simplifyRing(ring: readonly LngLat[], tolerance: number): LngLat[] {
  if (ring.length <= 4) {
    return [...ring];
  }

  const openRing = ring.slice(0, -1);
  const simplified = ramerDouglasPeucker(openRing, tolerance);
  const closed = closeRing(simplified.length >= 3 ? simplified : openRing);

  return Math.abs(ringArea(closed)) > 0 ? closed : [...ring];
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
