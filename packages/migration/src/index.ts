import { createTerritoryEngine } from "@territory-kit/core";
import {
  computeGeometryBBox,
  computeTerritoryAreaM2,
  geometryToPolygons
} from "@territory-kit/dataset";
import type {
  LngLat,
  TerritoryBBox,
  TerritoryDataset,
  TerritoryGeometry
} from "@territory-kit/dataset";
import * as polygonClipping from "polygon-clipping";

export type SpatialMigrationStrategy = "centroid" | "max-overlap";
export type SpatialMigrationConfidence = "EXACT" | "HIGH" | "AMBIGUOUS" | "NO_MATCH";

export interface SourceSpatialRecord {
  readonly sourceSpatialId: string;
  readonly geometry?: TerritoryGeometry;
  readonly center?: LngLat;
  readonly score?: number;
  readonly ownerId?: string;
  readonly ownerMetadata?: Readonly<Record<string, unknown>>;
  readonly properties?: Readonly<Record<string, unknown>>;
}

export interface SpatialMigrationOptions {
  readonly sourceSystem: string;
  readonly sourceVersion?: string;
  readonly targetDataset: TerritoryDataset;
  readonly targetLevel?: number;
  readonly targetTerritoryIds?: readonly string[];
  readonly strategy: SpatialMigrationStrategy;
  readonly generatedAt?: string;
  readonly toolVersion?: string;
  readonly minOverlapRatio?: number;
  readonly highConfidenceOverlapRatio?: number;
  readonly ambiguityDeltaRatio?: number;
}

export interface SpatialMigrationTargetMatch {
  readonly targetTerritoryId: string;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly level: number;
  readonly overlapAreaM2: number;
  readonly overlapRatio: number;
  readonly targetOverlapRatio: number;
}

export interface SpatialMigrationMapping {
  readonly sourceSpatialId: string;
  readonly targetTerritoryId: string | null;
  readonly strategy: SpatialMigrationStrategy;
  readonly confidence: SpatialMigrationConfidence;
  readonly overlapAreaM2: number;
  readonly overlapRatio: number;
  readonly targets: readonly SpatialMigrationTargetMatch[];
  readonly diagnostics: readonly string[];
  readonly score?: number;
  readonly ownerId?: string;
}

export interface SpatialMigrationConflict {
  readonly targetTerritoryId: string;
  readonly sourceSpatialIds: readonly string[];
  readonly ownerIds: readonly string[];
}

export interface SpatialMigrationManifest {
  readonly schemaVersion: "territorykit-spatial-migration@1";
  readonly sourceSystem: string;
  readonly sourceVersion?: string;
  readonly targetDatasetId: string;
  readonly targetDatasetVersion: string;
  readonly targetGeometryHash: string;
  readonly targetLevel?: number;
  readonly mappingStrategy: SpatialMigrationStrategy;
  readonly generatedAt: string;
  readonly toolVersion: string;
  readonly dryRun: true;
  readonly summary: SpatialMigrationSummary;
}

export interface SpatialMigrationSummary {
  readonly sourceCount: number;
  readonly mappedCount: number;
  readonly exactCount: number;
  readonly highConfidenceCount: number;
  readonly ambiguousCount: number;
  readonly noMatchCount: number;
  readonly multiTargetCount: number;
  readonly conflictCount: number;
}

export interface SpatialMigrationPlan {
  readonly manifest: SpatialMigrationManifest;
  readonly mappings: readonly SpatialMigrationMapping[];
  readonly conflicts: readonly SpatialMigrationConflict[];
}

type ClippingRing = LngLat[];
type ClippingPolygon = ClippingRing[];
type ClippingMultiPolygon = ClippingPolygon[];

type PolygonClippingApi = {
  intersection: typeof polygonClipping.intersection;
};

const CLIPPER =
  (polygonClipping as unknown as { default?: PolygonClippingApi }).default ??
  (polygonClipping as unknown as PolygonClippingApi);
const DEFAULT_TOOL_VERSION = "territorykit-spatial-migration@1";
const DEFAULT_MIN_OVERLAP_RATIO = 0.000001;
const DEFAULT_HIGH_CONFIDENCE_OVERLAP_RATIO = 0.8;
const DEFAULT_AMBIGUITY_DELTA_RATIO = 0.1;

export function createSpatialMigrationPlan(
  sources: readonly SourceSpatialRecord[],
  options: SpatialMigrationOptions
): SpatialMigrationPlan {
  const mappings = sources.map((source) => mapSourceSpatialRecord(source, options));
  const conflicts = collectOwnershipConflicts(mappings);
  const summary = summarizeMappings(sources.length, mappings, conflicts.length);
  const manifest: SpatialMigrationManifest = {
    schemaVersion: "territorykit-spatial-migration@1",
    sourceSystem: options.sourceSystem,
    ...(options.sourceVersion ? { sourceVersion: options.sourceVersion } : {}),
    targetDatasetId: options.targetDataset.manifest.datasetId,
    targetDatasetVersion: options.targetDataset.manifest.datasetVersion,
    targetGeometryHash: options.targetDataset.manifest.geometryHash,
    ...(options.targetLevel === undefined ? {} : { targetLevel: options.targetLevel }),
    mappingStrategy: options.strategy,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    toolVersion: options.toolVersion ?? DEFAULT_TOOL_VERSION,
    dryRun: true,
    summary
  };

  return {
    manifest,
    mappings,
    conflicts
  };
}

export function mapSourceSpatialRecord(
  source: SourceSpatialRecord,
  options: SpatialMigrationOptions
): SpatialMigrationMapping {
  return options.strategy === "centroid"
    ? mapByCentroid(source, options)
    : mapByMaximumOverlap(source, options);
}

export function aggregateSpatialMigrationScores(
  mappings: readonly SpatialMigrationMapping[],
  mode: "sum" | "overlap-weighted" = "sum"
): ReadonlyMap<string, number> {
  const scores = new Map<string, number>();

  for (const mapping of mappings) {
    if (!mapping.targetTerritoryId || mapping.score === undefined) {
      continue;
    }

    const weightedScore =
      mode === "overlap-weighted" ? mapping.score * mapping.overlapRatio : mapping.score;
    scores.set(
      mapping.targetTerritoryId,
      (scores.get(mapping.targetTerritoryId) ?? 0) + weightedScore
    );
  }

  return scores;
}

function mapByCentroid(
  source: SourceSpatialRecord,
  options: SpatialMigrationOptions
): SpatialMigrationMapping {
  const center =
    source.center ??
    (source.geometry ? centerOfBBox(computeGeometryBBox(source.geometry)) : undefined);
  const diagnostics: string[] = [];

  if (!center) {
    return noMatch(source, options.strategy, ["centroid missing"]);
  }

  const engine = createTerritoryEngine({ dataset: options.targetDataset });
  const targetTerritoryId = engine.latLngToZone(
    { lng: center[0], lat: center[1] },
    options.targetLevel === undefined ? {} : { level: options.targetLevel }
  );

  if (!targetTerritoryId) {
    return noMatch(source, options.strategy, ["centroid does not fall inside a target territory"]);
  }

  const zone = options.targetDataset.zones.find((candidate) => candidate.id === targetTerritoryId);

  if (!zone) {
    return noMatch(source, options.strategy, ["centroid target was not present in the dataset"]);
  }

  if (source.geometry) {
    diagnostics.push("centroid strategy does not measure boundary overlap");
  }

  return {
    sourceSpatialId: source.sourceSpatialId,
    targetTerritoryId,
    strategy: options.strategy,
    confidence: "HIGH",
    overlapAreaM2: 0,
    overlapRatio: 0,
    targets: [
      {
        targetTerritoryId,
        datasetId: zone.datasetId,
        datasetVersion: options.targetDataset.manifest.datasetVersion,
        level: zone.level,
        overlapAreaM2: 0,
        overlapRatio: 0,
        targetOverlapRatio: 0
      }
    ],
    diagnostics,
    ...(source.score === undefined ? {} : { score: source.score }),
    ...(source.ownerId ? { ownerId: source.ownerId } : {})
  };
}

function mapByMaximumOverlap(
  source: SourceSpatialRecord,
  options: SpatialMigrationOptions
): SpatialMigrationMapping {
  if (!source.geometry) {
    return mapByCentroid(source, {
      ...options,
      strategy: "centroid"
    });
  }

  const sourceAreaM2 = computeTerritoryAreaM2(source.geometry);

  if (sourceAreaM2 <= 0) {
    return noMatch(source, options.strategy, ["source geometry has zero area"]);
  }

  const matches = collectOverlapMatches(source.geometry, sourceAreaM2, options);

  if (matches.length === 0) {
    return noMatch(source, options.strategy, [
      "source geometry does not overlap target territories"
    ]);
  }

  const confidence = classifyOverlapConfidence(matches, options);
  const best = matches[0];

  return {
    sourceSpatialId: source.sourceSpatialId,
    targetTerritoryId: best?.targetTerritoryId ?? null,
    strategy: options.strategy,
    confidence,
    overlapAreaM2: best?.overlapAreaM2 ?? 0,
    overlapRatio: best?.overlapRatio ?? 0,
    targets: matches,
    diagnostics:
      confidence === "AMBIGUOUS" ? ["multiple target territories have similar overlap"] : [],
    ...(source.score === undefined ? {} : { score: source.score }),
    ...(source.ownerId ? { ownerId: source.ownerId } : {})
  };
}

function collectOverlapMatches(
  sourceGeometry: TerritoryGeometry,
  sourceAreaM2: number,
  options: SpatialMigrationOptions
): SpatialMigrationTargetMatch[] {
  const sourceBounds = computeGeometryBBox(sourceGeometry);
  const sourceClipping = geometryToClippingMultiPolygon(sourceGeometry);
  const targetIds = options.targetTerritoryIds ? new Set(options.targetTerritoryIds) : undefined;
  const minOverlapRatio = options.minOverlapRatio ?? DEFAULT_MIN_OVERLAP_RATIO;
  const matches: SpatialMigrationTargetMatch[] = [];

  for (const zone of options.targetDataset.zones) {
    if (options.targetLevel !== undefined && zone.level !== options.targetLevel) {
      continue;
    }

    if (targetIds && !targetIds.has(zone.id)) {
      continue;
    }

    if (!bboxesIntersect(sourceBounds, zone.bbox)) {
      continue;
    }

    const overlapGeometry = intersectClippingGeometries(
      sourceClipping,
      geometryToClippingMultiPolygon(zone.geometry)
    );
    const overlapAreaM2 = computeClippingAreaM2(overlapGeometry);
    const overlapRatio = sourceAreaM2 > 0 ? roundRatio(overlapAreaM2 / sourceAreaM2) : 0;

    if (overlapRatio < minOverlapRatio) {
      continue;
    }

    const targetAreaM2 = computeTerritoryAreaM2(zone.geometry);
    matches.push({
      targetTerritoryId: zone.id,
      datasetId: zone.datasetId,
      datasetVersion: options.targetDataset.manifest.datasetVersion,
      level: zone.level,
      overlapAreaM2: roundArea(overlapAreaM2),
      overlapRatio,
      targetOverlapRatio: targetAreaM2 > 0 ? roundRatio(overlapAreaM2 / targetAreaM2) : 0
    });
  }

  return matches.sort(
    (left, right) =>
      right.overlapRatio - left.overlapRatio ||
      right.overlapAreaM2 - left.overlapAreaM2 ||
      left.targetTerritoryId.localeCompare(right.targetTerritoryId)
  );
}

function classifyOverlapConfidence(
  matches: readonly SpatialMigrationTargetMatch[],
  options: SpatialMigrationOptions
): SpatialMigrationConfidence {
  const best = matches[0];

  if (!best) {
    return "NO_MATCH";
  }

  const second = matches[1];
  const ambiguityDeltaRatio = options.ambiguityDeltaRatio ?? DEFAULT_AMBIGUITY_DELTA_RATIO;
  const highConfidenceOverlapRatio =
    options.highConfidenceOverlapRatio ?? DEFAULT_HIGH_CONFIDENCE_OVERLAP_RATIO;

  if (second && best.overlapRatio - second.overlapRatio < ambiguityDeltaRatio) {
    return "AMBIGUOUS";
  }

  if (best.overlapRatio >= 0.999) {
    return "EXACT";
  }

  if (best.overlapRatio >= highConfidenceOverlapRatio) {
    return "HIGH";
  }

  return "AMBIGUOUS";
}

function noMatch(
  source: SourceSpatialRecord,
  strategy: SpatialMigrationStrategy,
  diagnostics: readonly string[]
): SpatialMigrationMapping {
  return {
    sourceSpatialId: source.sourceSpatialId,
    targetTerritoryId: null,
    strategy,
    confidence: "NO_MATCH",
    overlapAreaM2: 0,
    overlapRatio: 0,
    targets: [],
    diagnostics,
    ...(source.score === undefined ? {} : { score: source.score }),
    ...(source.ownerId ? { ownerId: source.ownerId } : {})
  };
}

function collectOwnershipConflicts(
  mappings: readonly SpatialMigrationMapping[]
): SpatialMigrationConflict[] {
  const byTarget = new Map<string, Map<string, string[]>>();

  for (const mapping of mappings) {
    if (!mapping.targetTerritoryId || !mapping.ownerId) {
      continue;
    }

    const byOwner = byTarget.get(mapping.targetTerritoryId) ?? new Map<string, string[]>();
    const sourceIds = byOwner.get(mapping.ownerId) ?? [];
    sourceIds.push(mapping.sourceSpatialId);
    byOwner.set(mapping.ownerId, sourceIds);
    byTarget.set(mapping.targetTerritoryId, byOwner);
  }

  return [...byTarget.entries()]
    .filter(([, byOwner]) => byOwner.size > 1)
    .map(([targetTerritoryId, byOwner]) => ({
      targetTerritoryId,
      sourceSpatialIds: [...byOwner.values()].flat().sort(),
      ownerIds: [...byOwner.keys()].sort()
    }))
    .sort((left, right) => left.targetTerritoryId.localeCompare(right.targetTerritoryId));
}

function summarizeMappings(
  sourceCount: number,
  mappings: readonly SpatialMigrationMapping[],
  conflictCount: number
): SpatialMigrationSummary {
  return {
    sourceCount,
    mappedCount: mappings.filter((mapping) => mapping.targetTerritoryId !== null).length,
    exactCount: mappings.filter((mapping) => mapping.confidence === "EXACT").length,
    highConfidenceCount: mappings.filter((mapping) => mapping.confidence === "HIGH").length,
    ambiguousCount: mappings.filter((mapping) => mapping.confidence === "AMBIGUOUS").length,
    noMatchCount: mappings.filter((mapping) => mapping.confidence === "NO_MATCH").length,
    multiTargetCount: mappings.filter((mapping) => mapping.targets.length > 1).length,
    conflictCount
  };
}

function geometryToClippingMultiPolygon(geometry: TerritoryGeometry): ClippingMultiPolygon {
  return geometryToPolygons(geometry).map((polygon) =>
    polygon.map((ring) =>
      closeRing(ring.map((coordinate) => [coordinate[0], coordinate[1]] as LngLat))
    )
  );
}

function intersectClippingGeometries(
  left: ClippingMultiPolygon,
  right: ClippingMultiPolygon
): ClippingMultiPolygon {
  if (left.length === 0 || right.length === 0) {
    return [];
  }

  try {
    return normalizeClippingMultiPolygon(CLIPPER.intersection(left, right) as ClippingMultiPolygon);
  } catch {
    return [];
  }
}

function computeClippingAreaM2(geometry: ClippingMultiPolygon): number {
  const territoryGeometry = clippingToTerritoryGeometry(geometry);

  return territoryGeometry ? computeTerritoryAreaM2(territoryGeometry) : 0;
}

function clippingToTerritoryGeometry(
  geometry: ClippingMultiPolygon
): TerritoryGeometry | undefined {
  const normalized = normalizeClippingMultiPolygon(geometry);

  if (normalized.length === 0) {
    return undefined;
  }

  if (normalized.length === 1) {
    return {
      type: "Polygon",
      coordinates: normalized[0]!
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: normalized
  };
}

function normalizeClippingMultiPolygon(geometry: ClippingMultiPolygon): ClippingMultiPolygon {
  return geometry
    .map((polygon) =>
      polygon
        .map((ring) => closeRing(ring.filter(isFiniteLngLat)))
        .filter((ring) => ring.length >= 4)
    )
    .filter((polygon) => polygon.length > 0);
}

function closeRing(ring: readonly LngLat[]): LngLat[] {
  const coordinates = ring.map((coordinate) => [coordinate[0], coordinate[1]] as LngLat);
  const first = coordinates[0];
  const last = coordinates.at(-1);

  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    coordinates.push([first[0], first[1]]);
  }

  return coordinates;
}

function isFiniteLngLat(coordinate: LngLat): boolean {
  return (
    Number.isFinite(coordinate[0]) &&
    Number.isFinite(coordinate[1]) &&
    coordinate[1] >= -90 &&
    coordinate[1] <= 90
  );
}

function bboxesIntersect(left: TerritoryBBox, right: TerritoryBBox): boolean {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

function centerOfBBox(bbox: TerritoryBBox): LngLat {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundArea(value: number): number {
  return Math.round(value * 1000) / 1000;
}
