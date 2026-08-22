import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  computeGeometryBBox,
  hasRingSelfIntersection,
  loadTerritoryDataset,
  validateGeometryDataset
} from "@territory-kit/dataset";
import type {
  GeometryQualityChecks,
  GeometryQualityIssue,
  GeometryQualitySeverity,
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
import { computeGeometryRepresentativePoint } from "./geometry-repair.js";

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
  topologyAudit: TerritorySimplificationTopologyAudit;
}

export type TerritorySimplificationAuditIssueCode =
  | "SHARED_BOUNDARY_MISSING"
  | "SHARED_BOUNDARY_MISMATCH"
  | "SHARED_BOUNDARY_OWNER_MISMATCH"
  | "SIMPLIFIED_GEOMETRY_INVALID";

export interface TerritorySimplificationGeometryValidationSummary {
  ok: boolean;
  invalidFeatureCount: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
}

export interface TerritorySimplificationAuditIssue {
  code: TerritorySimplificationAuditIssueCode;
  severity: GeometryQualitySeverity;
  message: string;
  detail?: TerritorySimplificationDetail;
  boundaryId?: string;
  zoneId?: string;
  otherZoneId?: string;
  zoneIds?: string[];
  expectedOwnerZoneIds?: string[];
  observedOwnerZoneIds?: string[];
  endpoints?: [string, string];
  reason?: string;
  path?: string;
  featureId?: string;
  geometryIssueCode?: GeometryQualityIssue["code"];
  check?: GeometryQualityIssue["check"];
  polygonIndex?: number;
  ringIndex?: number;
  coordinateIndex?: number;
  details?: Record<string, unknown>;
}

export interface TerritorySimplificationTopologyAudit {
  ok: boolean;
  sharedSegmentCountBefore: number;
  sharedSegmentCountAfter: number;
  sharedBoundaryCountBefore: number;
  sharedBoundaryCountAfter: number;
  sharedBoundaryMismatchCount: number;
  geometryValidation: TerritorySimplificationGeometryValidationSummary;
  issues: TerritorySimplificationAuditIssue[];
}

export interface TerritorySimplificationReport {
  reportVersion: "2";
  ok: boolean;
  strategy: TerritorySimplificationStrategy;
  source: {
    datasetId: string;
    datasetVersion: string;
    geometryHash: string;
    featureCount: number;
    vertexCount: number;
    sharedSegmentCount: number;
    sharedBoundaryCount: number;
  };
  tiers: TerritorySimplificationTierReport[];
}

export interface TerritorySimplificationPathResult {
  inputPath: string;
  outputPath: string;
  report: TerritorySimplificationReport;
}

interface TerritorySimplificationBuildTier {
  report: TerritorySimplificationTierReport;
  dataset: TerritoryDataset;
  serializedDataset: string;
  serializedGeoJson?: string;
}

interface TerritorySimplificationBuildResult {
  report: TerritorySimplificationReport;
  tiers: TerritorySimplificationBuildTier[];
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

interface SharedBoundaryOwnerRef {
  zoneId: string;
  ringId: RingId;
  polygonIndex: number;
  ringIndex: number;
  startKey: string;
  endKey: string;
}

interface SharedBoundaryAuditRecord {
  id: string;
  ownerZoneIds: string[];
  endpoints: [string, string];
  sourceCoordinateKeys: string[];
  sourceSegmentCount: number;
  ownerRefs: SharedBoundaryOwnerRef[];
}

interface SharedBoundaryAuditModel {
  records: SharedBoundaryAuditRecord[];
  sharedSegmentCount: number;
  ownersBySegmentKey: Map<string, string[]>;
}

const SIMPLIFICATION_GEOMETRY_VALIDATION_CHECKS: GeometryQualityChecks = {
  coordinates: true,
  rings: true,
  selfIntersections: true,
  holes: true,
  bbox: true,
  center: true,
  antimeridian: true,
  parentContainment: false,
  siblingOverlaps: false
};

export async function simplifyTerritoryDatasetPath(
  inputPath: string,
  outputPath: string,
  options: TerritorySimplificationOptions
): Promise<TerritorySimplificationPathResult> {
  const dataset = loadTerritoryDataset(JSON.parse(await readFile(resolve(inputPath), "utf8")));
  const result = buildTerritorySimplification(dataset, options);
  const files = new Map<string, string>();

  for (const tier of result.tiers) {
    if (
      tier.report.status !== "generated" ||
      !tier.report.datasetPath ||
      !tier.report.geojsonPath ||
      !tier.serializedGeoJson
    ) {
      continue;
    }

    files.set(tier.report.datasetPath, tier.serializedDataset);
    files.set(tier.report.geojsonPath, tier.serializedGeoJson);
  }

  files.set("simplification-report.json", serializeJsonStable(result.report));
  await writeFilesAtomically(resolve(outputPath), files, { force: options.force ?? false });

  return {
    inputPath: resolve(inputPath),
    outputPath: resolve(outputPath),
    report: result.report
  };
}

export function simplifyTerritoryDataset(
  dataset: TerritoryDataset,
  options: TerritorySimplificationOptions
): TerritorySimplificationReport {
  return buildTerritorySimplification(dataset, options).report;
}

function buildTerritorySimplification(
  dataset: TerritoryDataset,
  options: TerritorySimplificationOptions
): TerritorySimplificationBuildResult {
  const sourceHash = createDatasetGeometryHash(dataset);
  const sourceAuditModel = collectSharedBoundaryAuditModel(dataset);
  const sourceArea = sumDatasetArea(dataset);
  const sourceVertexCount = countDatasetVertices(dataset);
  const tiers = options.details.map((detail) =>
    buildSimplificationTier(dataset, detail, sourceHash, sourceArea, sourceAuditModel, options)
  );
  const report: TerritorySimplificationReport = {
    reportVersion: "2",
    ok: tiers.every((tier) => tier.report.topologyAudit.ok),
    strategy: options.strategy,
    source: {
      datasetId: dataset.manifest.datasetId,
      datasetVersion: dataset.manifest.datasetVersion,
      geometryHash: sourceHash,
      featureCount: dataset.zones.length,
      vertexCount: sourceVertexCount,
      sharedSegmentCount: sourceAuditModel.sharedSegmentCount,
      sharedBoundaryCount: sourceAuditModel.records.length
    },
    tiers: tiers.map((tier) => tier.report)
  };

  return {
    report,
    tiers
  };
}

function buildSimplificationTier(
  dataset: TerritoryDataset,
  detail: TerritorySimplificationDetail,
  sourceHash: string,
  sourceArea: number,
  sourceAuditModel: SharedBoundaryAuditModel,
  options: TerritorySimplificationOptions
): TerritorySimplificationBuildTier {
  const simplified = simplifyDataset(dataset, detail, options.buildDate);
  const geometryHash = createDatasetGeometryHash(simplified);
  const serializedDataset = serializeJsonStable(simplified);
  const topologyAudit = auditSimplifiedTerritoryDatasetWithModel(sourceAuditModel, simplified);

  if (geometryHash === sourceHash) {
    return {
      report: {
        detail,
        status: "omitted",
        reason: "tier-hash-matches-source",
        featureCount: simplified.zones.length,
        vertexCount: countDatasetVertices(simplified),
        byteSize: Buffer.byteLength(serializedDataset),
        areaDeltaRatio: 0,
        topologyAudit
      },
      dataset: simplified,
      serializedDataset
    };
  }

  return {
    report: {
      detail,
      status: "generated",
      datasetPath: `${detail}/dataset.json`,
      geojsonPath: `${detail}/features.geojson`,
      geometryHash,
      featureCount: simplified.zones.length,
      vertexCount: countDatasetVertices(simplified),
      byteSize: Buffer.byteLength(serializedDataset),
      areaDeltaRatio:
        sourceArea === 0 ? 0 : Math.abs(sumDatasetArea(simplified) - sourceArea) / sourceArea,
      topologyAudit
    },
    dataset: simplified,
    serializedDataset,
    serializedGeoJson: serializeJsonStable(datasetToFeatureCollection(simplified))
  };
}

export function auditSimplifiedTerritoryDataset(
  source: TerritoryDataset,
  output: TerritoryDataset
): TerritorySimplificationTopologyAudit {
  return auditSimplifiedTerritoryDatasetWithModel(collectSharedBoundaryAuditModel(source), output);
}

function auditSimplifiedTerritoryDatasetWithModel(
  sourceModel: SharedBoundaryAuditModel,
  output: TerritoryDataset
): TerritorySimplificationTopologyAudit {
  const outputModel = collectSharedBoundaryAuditModel(output);
  const outputRings = indexDatasetRings(output, new Map<string, LngLat>());
  const outputRingById = new Map(outputRings.map((ring) => [ring.id, ring]));
  const issues: TerritorySimplificationAuditIssue[] = [];
  let sharedBoundaryMismatchCount = 0;

  for (const boundary of sourceModel.records) {
    const boundaryIssue = auditSharedBoundaryRecord(boundary, outputRingById, outputModel);

    if (boundaryIssue) {
      sharedBoundaryMismatchCount += 1;
      issues.push(boundaryIssue);
    }
  }

  const geometryValidationReport = validateGeometryDataset(output, {
    checks: SIMPLIFICATION_GEOMETRY_VALIDATION_CHECKS
  });
  const geometryValidation: TerritorySimplificationGeometryValidationSummary = {
    ok: geometryValidationReport.ok,
    invalidFeatureCount: geometryValidationReport.summary.invalidFeatureCount,
    issueCount: geometryValidationReport.summary.issueCount,
    errorCount: geometryValidationReport.summary.errorCount,
    warningCount: geometryValidationReport.summary.warningCount
  };

  issues.push(...geometryValidationReport.issues.map(toSimplificationGeometryIssue));

  const sortedIssues = sortSimplificationAuditIssues(issues);

  return {
    ok: sharedBoundaryMismatchCount === 0 && geometryValidation.errorCount === 0,
    sharedSegmentCountBefore: sourceModel.sharedSegmentCount,
    sharedSegmentCountAfter: outputModel.sharedSegmentCount,
    sharedBoundaryCountBefore: sourceModel.records.length,
    sharedBoundaryCountAfter: outputModel.records.length,
    sharedBoundaryMismatchCount,
    geometryValidation,
    issues: sortedIssues
  };
}

function auditSharedBoundaryRecord(
  boundary: SharedBoundaryAuditRecord,
  outputRingById: ReadonlyMap<RingId, IndexedRing>,
  outputModel: SharedBoundaryAuditModel
): TerritorySimplificationAuditIssue | undefined {
  const outputChains = boundary.ownerRefs.map((owner) => ({
    owner,
    chain: extractRingPath(
      outputRingById.get(owner.ringId)?.pointKeys,
      owner.startKey,
      owner.endKey
    )
  }));
  const missing = outputChains.filter((entry) => !entry.chain);

  if (missing.length > 0) {
    return createBoundaryIssue(boundary, {
      code: "SHARED_BOUNDARY_MISSING",
      reason: "missing-output-boundary-chain",
      message: `Shared boundary ${boundary.id} is missing from one or more simplified owners.`,
      details: {
        missingOwnerZoneIds: uniqueSorted(missing.map((entry) => entry.owner.zoneId))
      }
    });
  }

  const canonicalChains = outputChains.map((entry) => ({
    owner: entry.owner,
    chain: entry.chain!,
    canonicalKey: canonicalBoundarySequenceKey(entry.chain!)
  }));
  const uniqueChains = uniqueSorted(canonicalChains.map((entry) => entry.canonicalKey));

  if (uniqueChains.length > 1) {
    return createBoundaryIssue(boundary, {
      code: "SHARED_BOUNDARY_MISMATCH",
      reason: "owner-boundary-chains-diverged",
      message: `Shared boundary ${boundary.id} differs between simplified owners.`,
      details: {
        observedChainCount: uniqueChains.length,
        ownerChainHashes: canonicalChains
          .map((entry) => ({
            zoneId: entry.owner.zoneId,
            ringId: entry.owner.ringId,
            chainHash: sha256Hex(entry.canonicalKey).slice(0, 16)
          }))
          .sort(
            (left, right) =>
              left.zoneId.localeCompare(right.zoneId) || left.ringId.localeCompare(right.ringId)
          )
      }
    });
  }

  const observedOwnerSets = uniqueSorted(
    canonicalChains.flatMap((entry) => segmentOwnerSetKeys(entry.chain, outputModel))
  );
  const expectedOwnerKey = ownerSetKey(boundary.ownerZoneIds);

  if (observedOwnerSets.length !== 1 || observedOwnerSets[0] !== expectedOwnerKey) {
    return createBoundaryIssue(boundary, {
      code: "SHARED_BOUNDARY_OWNER_MISMATCH",
      reason: "output-owner-set-changed",
      message: `Shared boundary ${boundary.id} has a different simplified owner set.`,
      ...(observedOwnerSets.length === 1
        ? { observedOwnerZoneIds: ownerSetFromKey(observedOwnerSets[0]!) }
        : {}),
      details: {
        observedOwnerSets: observedOwnerSets.map(ownerSetFromKey)
      }
    });
  }

  return undefined;
}

function createBoundaryIssue(
  boundary: SharedBoundaryAuditRecord,
  input: {
    code: Extract<
      TerritorySimplificationAuditIssueCode,
      "SHARED_BOUNDARY_MISSING" | "SHARED_BOUNDARY_MISMATCH" | "SHARED_BOUNDARY_OWNER_MISMATCH"
    >;
    message: string;
    reason: string;
    observedOwnerZoneIds?: string[];
    details?: Record<string, unknown>;
  }
): TerritorySimplificationAuditIssue {
  const [zoneId, otherZoneId] = boundary.ownerZoneIds;

  return {
    code: input.code,
    severity: "error",
    message: input.message,
    boundaryId: boundary.id,
    ...(zoneId ? { zoneId } : {}),
    ...(otherZoneId ? { otherZoneId } : {}),
    zoneIds: boundary.ownerZoneIds,
    expectedOwnerZoneIds: boundary.ownerZoneIds,
    ...(input.observedOwnerZoneIds ? { observedOwnerZoneIds: input.observedOwnerZoneIds } : {}),
    endpoints: boundary.endpoints,
    reason: input.reason,
    details: {
      sourceSegmentCount: boundary.sourceSegmentCount,
      ownerRingIds: boundary.ownerRefs.map((owner) => owner.ringId).sort(),
      ...(input.details ?? {})
    }
  };
}

function toSimplificationGeometryIssue(
  issue: GeometryQualityIssue
): TerritorySimplificationAuditIssue {
  return {
    code: "SIMPLIFIED_GEOMETRY_INVALID",
    severity: issue.severity,
    message: issue.message,
    path: issue.path,
    ...(issue.zoneId ? { zoneId: issue.zoneId } : {}),
    ...(issue.featureId ? { featureId: issue.featureId } : {}),
    ...(issue.otherZoneId ? { otherZoneId: issue.otherZoneId } : {}),
    geometryIssueCode: issue.code,
    check: issue.check,
    ...(issue.polygonIndex === undefined ? {} : { polygonIndex: issue.polygonIndex }),
    ...(issue.ringIndex === undefined ? {} : { ringIndex: issue.ringIndex }),
    ...(issue.coordinateIndex === undefined ? {} : { coordinateIndex: issue.coordinateIndex }),
    details: {
      repairable: issue.repairable,
      ...(issue.repairSuggestion ? { repairSuggestion: issue.repairSuggestion } : {}),
      ...(issue.details ? { geometryDetails: issue.details } : {})
    }
  };
}

function collectSharedBoundaryAuditModel(dataset: TerritoryDataset): SharedBoundaryAuditModel {
  const rings = indexDatasetRings(dataset, new Map<string, LngLat>());
  const segmentUses = collectTopologySegmentUses(rings);
  const ownersBySegmentKey = new Map<string, string[]>();

  for (const [segment, uses] of segmentUses) {
    const zoneIds = uniqueSorted(uses.map((use) => use.zoneId));

    if (zoneIds.length > 1) {
      ownersBySegmentKey.set(segment, zoneIds);
    }
  }

  const recordsByKey = new Map<string, SharedBoundaryAuditRecord>();

  for (const ring of [...rings].sort((left, right) => left.id.localeCompare(right.id))) {
    collectSharedBoundaryRecordsForRing(ring, ownersBySegmentKey, recordsByKey);
  }

  const records = [...recordsByKey.values()]
    .map((record) => ({
      ...record,
      ownerRefs: [...record.ownerRefs].sort(compareSharedBoundaryOwnerRefs)
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    records,
    sharedSegmentCount: ownersBySegmentKey.size,
    ownersBySegmentKey
  };
}

function collectSharedBoundaryRecordsForRing(
  ring: IndexedRing,
  ownersBySegmentKey: ReadonlyMap<string, string[]>,
  recordsByKey: Map<string, SharedBoundaryAuditRecord>
): void {
  const segmentOwnerKeys = ring.pointKeys.slice(0, -1).map((start, index) => {
    const end = ring.pointKeys[index + 1]!;
    return ownerSetKeyOrUndefined(ownersBySegmentKey.get(segmentKeyFromCoordinateKeys(start, end)));
  });

  if (!segmentOwnerKeys.some(Boolean)) {
    return;
  }

  const firstOwnerKey = segmentOwnerKeys[0];

  if (firstOwnerKey && segmentOwnerKeys.every((key) => key === firstOwnerKey)) {
    addSharedBoundaryRecord(recordsByKey, ring, ring.pointKeys, ownerSetFromKey(firstOwnerKey));
    return;
  }

  for (let index = 0; index < segmentOwnerKeys.length; index += 1) {
    const ownerKey = segmentOwnerKeys[index];
    const previous =
      segmentOwnerKeys[(index - 1 + segmentOwnerKeys.length) % segmentOwnerKeys.length];

    if (!ownerKey || ownerKey === previous) {
      continue;
    }

    const chain = [ring.pointKeys[index]!];
    let cursor = index;

    while (segmentOwnerKeys[cursor] === ownerKey) {
      cursor = (cursor + 1) % segmentOwnerKeys.length;
      chain.push(ring.pointKeys[cursor]!);
    }

    addSharedBoundaryRecord(recordsByKey, ring, chain, ownerSetFromKey(ownerKey));
  }
}

function addSharedBoundaryRecord(
  recordsByKey: Map<string, SharedBoundaryAuditRecord>,
  ring: IndexedRing,
  pointKeys: readonly string[],
  ownerZoneIds: readonly string[]
): void {
  if (pointKeys.length < 2) {
    return;
  }

  const canonicalSequence = canonicalBoundarySequenceKey(pointKeys);
  const canonicalOwnerKey = ownerSetKey(ownerZoneIds);
  const recordKey = `${canonicalOwnerKey}|${canonicalSequence}`;
  const id = `boundary:${sha256Hex(recordKey).slice(0, 16)}`;
  const first = pointKeys[0]!;
  const last = pointKeys.at(-1)!;
  const endpoints: [string, string] = first <= last ? [first, last] : [last, first];
  const ownerRef: SharedBoundaryOwnerRef = {
    zoneId: ring.zoneId,
    ringId: ring.id,
    polygonIndex: ring.polygonIndex,
    ringIndex: ring.ringIndex,
    startKey: first,
    endKey: last
  };
  const existing = recordsByKey.get(recordKey);

  if (!existing) {
    recordsByKey.set(recordKey, {
      id,
      ownerZoneIds: ownerSetFromKey(canonicalOwnerKey),
      endpoints,
      sourceCoordinateKeys: [...pointKeys],
      sourceSegmentCount: pointKeys.length - 1,
      ownerRefs: [ownerRef]
    });
    return;
  }

  if (
    !existing.ownerRefs.some(
      (candidate) => sharedBoundaryOwnerRefKey(candidate) === sharedBoundaryOwnerRefKey(ownerRef)
    )
  ) {
    existing.ownerRefs.push(ownerRef);
  }
}

function extractRingPath(
  pointKeys: readonly string[] | undefined,
  startKey: string,
  endKey: string
): string[] | undefined {
  if (!pointKeys || pointKeys.length < 2) {
    return undefined;
  }

  if (startKey === endKey) {
    return pointKeys[0] === startKey ? [...pointKeys] : undefined;
  }

  const openPointKeys = pointKeys.slice(0, -1);
  const startIndex = openPointKeys.indexOf(startKey);
  const endIndex = openPointKeys.indexOf(endKey);

  if (startIndex < 0 || endIndex < 0) {
    return undefined;
  }

  const chain = [openPointKeys[startIndex]!];
  let cursor = startIndex;

  while (cursor !== endIndex) {
    cursor = (cursor + 1) % openPointKeys.length;
    chain.push(openPointKeys[cursor]!);
  }

  return chain;
}

function segmentOwnerSetKeys(
  pointKeys: readonly string[],
  model: SharedBoundaryAuditModel
): string[] {
  const ownerKeys: string[] = [];

  for (let index = 0; index < pointKeys.length - 1; index += 1) {
    const segment = segmentKeyFromCoordinateKeys(pointKeys[index]!, pointKeys[index + 1]!);
    const owners = model.ownersBySegmentKey.get(segment);
    ownerKeys.push(ownerSetKey(owners ?? []));
  }

  return ownerKeys;
}

function canonicalBoundarySequenceKey(pointKeys: readonly string[]): string {
  const first = pointKeys[0];
  const last = pointKeys.at(-1);

  if (pointKeys.length > 1 && first === last) {
    return canonicalClosedSequenceKey(pointKeys);
  }

  const forward = pointKeys.join(">");
  const reversed = [...pointKeys].reverse().join(">");

  return forward <= reversed ? forward : reversed;
}

function canonicalClosedSequenceKey(pointKeys: readonly string[]): string {
  const openKeys = pointKeys.slice(0, -1);

  if (openKeys.length === 0) {
    return pointKeys.join(">");
  }

  return [
    ...closedSequenceRotations(openKeys),
    ...closedSequenceRotations([...openKeys].reverse())
  ].sort()[0]!;
}

function closedSequenceRotations(openKeys: readonly string[]): string[] {
  return openKeys.map((_, index) => {
    const rotated = [...openKeys.slice(index), ...openKeys.slice(0, index)];
    return [...rotated, rotated[0]!].join(">");
  });
}

function ownerSetKeyOrUndefined(zoneIds: readonly string[] | undefined): string | undefined {
  return zoneIds && zoneIds.length > 0 ? ownerSetKey(zoneIds) : undefined;
}

function ownerSetKey(zoneIds: readonly string[]): string {
  return uniqueSorted(zoneIds).join("|");
}

function ownerSetFromKey(key: string): string[] {
  return key === "" ? [] : key.split("|");
}

function sharedBoundaryOwnerRefKey(ownerRef: SharedBoundaryOwnerRef): string {
  return [
    ownerRef.zoneId,
    ownerRef.ringId,
    ownerRef.polygonIndex,
    ownerRef.ringIndex,
    ownerRef.startKey,
    ownerRef.endKey
  ].join("|");
}

function compareSharedBoundaryOwnerRefs(
  left: SharedBoundaryOwnerRef,
  right: SharedBoundaryOwnerRef
): number {
  return (
    left.zoneId.localeCompare(right.zoneId) ||
    left.ringId.localeCompare(right.ringId) ||
    left.polygonIndex - right.polygonIndex ||
    left.ringIndex - right.ringIndex ||
    left.startKey.localeCompare(right.startKey) ||
    left.endKey.localeCompare(right.endKey)
  );
}

function sortSimplificationAuditIssues(
  issues: readonly TerritorySimplificationAuditIssue[]
): TerritorySimplificationAuditIssue[] {
  const severityRank: Record<GeometryQualitySeverity, number> = {
    error: 0,
    warning: 1,
    info: 2
  };

  return [...issues].sort(
    (left, right) =>
      severityRank[left.severity] - severityRank[right.severity] ||
      left.code.localeCompare(right.code) ||
      (left.zoneId ?? "").localeCompare(right.zoneId ?? "") ||
      (left.otherZoneId ?? "").localeCompare(right.otherZoneId ?? "") ||
      (left.boundaryId ?? "").localeCompare(right.boundaryId ?? "") ||
      (left.path ?? "").localeCompare(right.path ?? "") ||
      left.message.localeCompare(right.message)
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
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
      center: computeGeometryRepresentativePoint(geometry)
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
  settleInvalidFeaturesOnSourceArcs(dataset, model);
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

function settleInvalidFeaturesOnSourceArcs(dataset: TerritoryDataset, model: TopologyModel): void {
  const maxIterations = model.rings.length + 1;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const validation = validateGeometryDataset(
      datasetWithReconstructedGeometriesForValidation(dataset, model),
      { checks: SIMPLIFICATION_GEOMETRY_VALIDATION_CHECKS }
    );

    if (validation.summary.errorCount === 0) {
      return;
    }

    const invalidZoneIds = uniqueSorted(
      validation.issues
        .filter((issue) => issue.severity === "error")
        .flatMap((issue) => (issue.zoneId ? [issue.zoneId] : []))
    );
    const fallbackZoneIds =
      invalidZoneIds.length > 0 ? invalidZoneIds : dataset.zones.map((zone) => zone.id);

    if (!forceSourceArcsForZoneIds(model, fallbackZoneIds)) {
      return;
    }
  }
}

function datasetWithReconstructedGeometriesForValidation(
  dataset: TerritoryDataset,
  model: TopologyModel
): TerritoryDataset {
  const geometries = reconstructDatasetGeometries(dataset, model);

  return {
    ...dataset,
    zones: dataset.zones.map((zone) => {
      const geometry = geometries.get(zone.id) ?? zone.geometry;

      return {
        ...zone,
        geometry,
        bbox: computeGeometryBBox(geometry),
        center: computeGeometryRepresentativePoint(geometry)
      };
    })
  };
}

function forceSourceArcsForZoneIds(model: TopologyModel, zoneIds: readonly string[]): boolean {
  const fallbackZoneIds = new Set(zoneIds);
  let changed = false;

  for (const ring of [...model.rings].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!fallbackZoneIds.has(ring.zoneId)) {
      continue;
    }

    for (const ref of model.ringRefs.get(ring.id) ?? []) {
      const arc = model.arcs.get(ref.arcId);

      if (arc && !arc.forceSource) {
        arc.forceSource = true;
        changed = true;
      }
    }
  }

  return changed;
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

function geometryRings(geometry: TerritoryGeometry): LngLat[][] {
  return geometry.type === "Polygon"
    ? (geometry.coordinates as LngLat[][])
    : (geometry.coordinates.flat(1) as LngLat[][]);
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
