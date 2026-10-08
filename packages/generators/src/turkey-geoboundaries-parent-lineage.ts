import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { TerritoryDataset, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import { repairTerritoryGeometries } from "./geometry-repair.js";
import {
  TURKEY_PARENT_INVENTORY_EXPECTED,
  TURKEY_V2_ADM_PARENT_LEVELS,
  auditGeometryHash,
  type TurkeyV2AdmParentLevel
} from "./turkey-parent-provenance.js";
import { GEOBOUNDARIES_LICENSE } from "./sources/geoboundaries.js";
import {
  isRecord,
  readStringPropertyPath,
  serializeJsonStable,
  sha256Hex
} from "./sources/utils.js";

export const TURKEY_GEOBOUNDARIES_PARENT_LINEAGE_SCHEMA_VERSION =
  "territorykit-tr-geoboundaries-parent-lineage@2" as const;

export const GEOBOUNDARIES_ADAPTER_DEFAULT_LICENSE = GEOBOUNDARIES_LICENSE;

export type ComparisonAssessmentStatus = "NOT_ASSESSED" | "COMPARED";

export type PathBLegalReviewStatus = "PENDING_REVIEW" | "APPROVED_WITH_AUTHORIZATION";

export type PathBMigrationAuthorizationStatus =
  "NOT_AUTHORIZED" | "BLOCKED_PENDING_EVIDENCE" | "AUTHORIZED_SEPARATE_PR";

export const TURKEY_GEOBOUNDARIES_GIT_RELEASE_COMMIT =
  "9469f09592ced973a3448cf66b6100b741b64c0d" as const;

export type PathBFeasibilityClassification =
  | "PATH_B_VERIFIED_CANDIDATE"
  | "PATH_B_PARTIALLY_VERIFIED"
  | "PATH_B_NOT_SUPPORTED"
  | "PATH_B_BLOCKED_BY_MISSING_EVIDENCE";

export type GeoBoundariesSourceByteStatus =
  | "LOCKED_BYTES_VERIFIED"
  | "ARTIFACT_NOT_AVAILABLE"
  | "CHECKSUM_MISMATCH"
  | "EXPECTED_HASH_MISSING";

export interface TurkeyGeoBoundariesSourceLockLevel {
  adminLevel: TurkeyV2AdmParentLevel;
  originalFilename?: string;
  resolvedDownloadUrl?: string;
  sourceUrl?: string;
  metadataUrl?: string;
  sha256?: string;
  sizeBytes?: number;
  sourceDate?: string;
  sourceVersion?: string;
  sourceFeatureCount?: number;
  license?: string;
  licenseUrl?: string;
  licenseDetail?: string;
  attribution?: string;
  boundaryYearRepresented?: string;
}

export interface TurkeyGeoBoundariesSourceLock {
  provider: string;
  releaseType?: string;
  resolvedAt?: string;
  levels: Partial<Record<TurkeyV2AdmParentLevel, TurkeyGeoBoundariesSourceLockLevel>>;
}

export interface GeoBoundariesSourceCandidate {
  adminLevel: TurkeyV2AdmParentLevel;
  releaseFamily: string;
  countryCode: string;
  gitReleaseCommit: string;
  originalFilename: string | null;
  downloadUrl: string | null;
  metadataUrl: string | null;
  expectedSha256: string | null;
  expectedByteSize: number | null;
  sourcePublicationDate: string | null;
  sourceVersion: string | null;
  lockLicense: string | null;
  lockLicenseUrl: string | null;
  lockLicenseDetail: string | null;
  lockAttribution: string | null;
  adapterDefaultLicense: string;
  distributionLicenseNote: string;
  sourceNativeIdField: "shapeID";
  featureCountFromLock: number | null;
  confidence: "verified-lock" | "inferred-cache" | "manual-pin";
}

export interface GeoBoundariesSourceFeatureInventory {
  adminLevel: TurkeyV2AdmParentLevel;
  rawGeoJsonFeatureCount: number;
  parsedFeatureCount: number;
  rejectedFeatureCount: number;
  rejectionReasons: Record<string, number>;
  duplicateShapeIdCount: number;
  lockMetadataFeatureCount: number | null;
  canonicalParentZoneCount: number;
  unmatchedSourceFeaturesAfterParentJoin: number;
  inventoryInterpretation: string;
}

export interface PathBEvidenceRequirements {
  missingArtifacts: string[];
  unresolvedGeometryEvidence: string[];
  unresolvedSourceInventoryEvidence: string[];
  unresolvedLicensingEvidence: string[];
  migrationAuthorizationStatus: PathBMigrationAuthorizationStatus;
  fullPipelineReproducibilityStatus: "NOT_ASSESSED" | "INCOMPLETE" | "COMPLETE";
}

export interface GeoBoundariesByteVerificationEntry {
  adminLevel: TurkeyV2AdmParentLevel;
  status: GeoBoundariesSourceByteStatus;
  expectedSha256: string | null;
  expectedByteSize: number | null;
  actualSha256?: string;
  actualByteSize?: number;
  artifactPath?: string;
  originalUrl?: string;
  fetchedAt?: string;
}

export interface GeoBoundariesIdentityComparisonRow {
  adminLevel: TurkeyV2AdmParentLevel;
  parentZoneCount: number;
  sourceFeatureCount: number;
  matchedBySourceNativeId: number;
  unmatchedParentZones: number;
  unmatchedSourceFeatures: number;
  duplicateSourceNativeIds: number;
  territoryStableIdAssessment: ComparisonAssessmentStatus;
  parentRelationshipAssessment: ComparisonAssessmentStatus;
  administrativeNameMatches: number;
  administrativeNameMismatches: number;
  identityMatchMethod: "shapeID-to-territory.source.sourceId";
}

export interface GeoBoundariesGeometryComparisonRow {
  adminLevel: TurkeyV2AdmParentLevel;
  comparisonMethod: "geometry-repair-then-serialized-hash";
  crs: "EPSG:4326 (source GeoJSON)";
  identityMatchedPairs: number;
  rawSerializedGeometryHashMatches: number;
  repairedSerializedGeometryHashMatches: number;
  serializedGeometryHashMismatches: number;
  geographicEquivalenceStatus: "NOT_ASSESSED";
  sampleMismatches: Array<{
    sourceNativeId: string;
    parentZoneId: string;
    parentHash: string;
    repairedSourceHash: string;
  }>;
}

export interface TurkeyGeoBoundariesParentLineageInspection {
  schemaVersion: typeof TURKEY_GEOBOUNDARIES_PARENT_LINEAGE_SCHEMA_VERSION;
  parentDatasetVersion: string | null;
  parentDatasetSha256: string | null;
  parentInventoryStatus: "COMPLETE" | "INCOMPLETE" | "MISSING_ARTIFACT";
  sourceLockPath: string | null;
  sourceLockProvider: string | null;
  sourceLockReleaseType: string | null;
  sourceLockResolvedAt: string | null;
  candidates: GeoBoundariesSourceCandidate[];
  byteVerification: GeoBoundariesByteVerificationEntry[];
  geoBoundariesUpstreamBytesVerified: boolean;
  identityComparison: GeoBoundariesIdentityComparisonRow[];
  geometryComparison: GeoBoundariesGeometryComparisonRow[];
  pathBFeasibility: PathBFeasibilityClassification;
  pathBFeasibilitySummary: string;
  /** @deprecated Use pathBEvidenceRequirements.missingArtifacts */
  missingEvidence: string[];
  pathBEvidenceRequirements: PathBEvidenceRequirements;
  sourceFeatureInventory: GeoBoundariesSourceFeatureInventory[];
  legalReviewStatus: PathBLegalReviewStatus;
  notAuthoritativeGovernmentData: true;
}

export interface InspectTurkeyGeoBoundariesParentLineageOptions {
  parentDataset?: TerritoryDataset;
  parentDatasetPath?: string;
  sourceLockPath?: string;
  sourceArtifactPaths?: Partial<Record<TurkeyV2AdmParentLevel, string>>;
  geoBoundariesCacheRoot?: string;
  diagnosticMode?: boolean;
}

const LEVEL_TO_NUMBER: Record<TurkeyV2AdmParentLevel, number> = {
  ADM0: 0,
  ADM1: 1,
  ADM2: 2
};

function zonesForLevel(dataset: TerritoryDataset, level: TurkeyV2AdmParentLevel): TerritoryZone[] {
  return dataset.zones.filter((zone) => zone.level === LEVEL_TO_NUMBER[level]);
}

function readParentSourceNativeId(zone: TerritoryZone): string | null {
  const territory = zone.properties?.territory;
  if (!territory || typeof territory !== "object") {
    return null;
  }
  const source = (territory as Record<string, unknown>).source;
  if (!source || typeof source !== "object") {
    return null;
  }
  const sourceId = (source as Record<string, unknown>).sourceId;
  return typeof sourceId === "string" && sourceId.length > 0 ? sourceId : null;
}

function normalizeAdminName(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

async function sha256FilePath(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function loadTurkeyGeoBoundariesSourceLock(
  lockPath: string
): Promise<TurkeyGeoBoundariesSourceLock> {
  const parsed = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.levels)) {
    throw new Error(`Invalid geoBoundaries source lock at ${lockPath}`);
  }
  const levels: Partial<Record<TurkeyV2AdmParentLevel, TurkeyGeoBoundariesSourceLockLevel>> = {};
  for (const level of TURKEY_V2_ADM_PARENT_LEVELS) {
    const entry = parsed.levels[level];
    if (!isRecord(entry)) {
      continue;
    }
    levels[level] = {
      adminLevel: level,
      ...(typeof entry.originalFilename === "string"
        ? { originalFilename: entry.originalFilename }
        : {}),
      ...(typeof entry.resolvedDownloadUrl === "string"
        ? { resolvedDownloadUrl: entry.resolvedDownloadUrl }
        : {}),
      ...(typeof entry.sourceUrl === "string" ? { sourceUrl: entry.sourceUrl } : {}),
      ...(typeof entry.metadataUrl === "string" ? { metadataUrl: entry.metadataUrl } : {}),
      ...(typeof entry.sha256 === "string" ? { sha256: entry.sha256 } : {}),
      ...(typeof entry.sizeBytes === "number" ? { sizeBytes: entry.sizeBytes } : {}),
      ...(typeof entry.sourceDate === "string" ? { sourceDate: entry.sourceDate } : {}),
      ...(typeof entry.sourceVersion === "string" ? { sourceVersion: entry.sourceVersion } : {}),
      ...(typeof entry.sourceFeatureCount === "number"
        ? { sourceFeatureCount: entry.sourceFeatureCount }
        : {}),
      ...(typeof entry.license === "string" ? { license: entry.license } : {}),
      ...(typeof entry.licenseUrl === "string" ? { licenseUrl: entry.licenseUrl } : {}),
      ...(typeof entry.licenseDetail === "string" ? { licenseDetail: entry.licenseDetail } : {}),
      ...(typeof entry.attribution === "string" ? { attribution: entry.attribution } : {}),
      ...(typeof entry.boundaryYearRepresented === "string"
        ? { boundaryYearRepresented: entry.boundaryYearRepresented }
        : {})
    };
  }
  return {
    provider: typeof parsed.provider === "string" ? parsed.provider : "geoboundaries",
    ...(typeof parsed.releaseType === "string" ? { releaseType: parsed.releaseType } : {}),
    ...(typeof parsed.resolvedAt === "string" ? { resolvedAt: parsed.resolvedAt } : {}),
    levels
  };
}

export async function findGeoBoundariesArtifactBySha256(
  cacheRoot: string,
  expectedSha256: string
): Promise<{
  artifactPath: string;
  metadataPath: string;
  metadata: Record<string, unknown>;
} | null> {
  let entries: string[];
  try {
    entries = await readdir(cacheRoot);
  } catch {
    return null;
  }
  const normalizedExpected = expectedSha256.toLowerCase();
  for (const entry of entries) {
    const metadataPath = path.join(cacheRoot, entry, "metadata.json");
    try {
      const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
      const sha256 =
        typeof metadata.sha256 === "string"
          ? metadata.sha256.toLowerCase()
          : typeof metadata.etag === "string"
            ? metadata.etag.replace(/^"|"$/g, "").toLowerCase()
            : null;
      if (sha256 !== normalizedExpected) {
        continue;
      }
      const artifactPath = path.join(cacheRoot, entry, "artifact");
      await stat(artifactPath);
      return { artifactPath, metadataPath, metadata };
    } catch {
      continue;
    }
  }
  return null;
}

export function buildGeoBoundariesCandidatesFromSourceLock(
  lock: TurkeyGeoBoundariesSourceLock
): GeoBoundariesSourceCandidate[] {
  const releaseFamily = lock.releaseType ?? "gbOpen";
  return TURKEY_V2_ADM_PARENT_LEVELS.flatMap((adminLevel) => {
    const level = lock.levels[adminLevel];
    if (!level) {
      return [];
    }
    return [
      {
        adminLevel,
        releaseFamily,
        countryCode: "TR",
        gitReleaseCommit: TURKEY_GEOBOUNDARIES_GIT_RELEASE_COMMIT,
        originalFilename: level.originalFilename ?? null,
        downloadUrl: level.resolvedDownloadUrl ?? level.sourceUrl ?? null,
        metadataUrl: level.metadataUrl ?? null,
        expectedSha256: level.sha256 ?? null,
        expectedByteSize: level.sizeBytes ?? null,
        sourcePublicationDate: level.sourceDate ?? level.boundaryYearRepresented ?? null,
        sourceVersion: level.sourceVersion ?? null,
        lockLicense: level.license ?? null,
        lockLicenseUrl: level.licenseUrl ?? null,
        lockLicenseDetail: level.licenseDetail ?? null,
        lockAttribution: level.attribution ?? null,
        adapterDefaultLicense: GEOBOUNDARIES_ADAPTER_DEFAULT_LICENSE,
        distributionLicenseNote:
          "gbOpen distribution is commonly described as CC BY 4.0; per-feature lock strings may cite upstream OSM/ODbL or other terms — not legal equivalence.",
        sourceNativeIdField: "shapeID",
        featureCountFromLock: level.sourceFeatureCount ?? null,
        confidence: "verified-lock"
      }
    ];
  });
}

export async function verifyGeoBoundariesSourceArtifactBytes(input: {
  adminLevel: TurkeyV2AdmParentLevel;
  artifactPath: string;
  expectedSha256?: string | null;
  expectedByteSize?: number | null;
  originalUrl?: string;
  fetchedAt?: string;
}): Promise<GeoBoundariesByteVerificationEntry> {
  if (!input.expectedSha256) {
    return {
      adminLevel: input.adminLevel,
      status: "EXPECTED_HASH_MISSING",
      expectedSha256: null,
      expectedByteSize: input.expectedByteSize ?? null
    };
  }
  try {
    const fileStat = await stat(input.artifactPath);
    const actualSha256 = await sha256FilePath(input.artifactPath);
    const byteSizeOk =
      input.expectedByteSize === undefined ||
      input.expectedByteSize === null ||
      fileStat.size === input.expectedByteSize;
    const hashOk = actualSha256.toLowerCase() === input.expectedSha256.toLowerCase();
    return {
      adminLevel: input.adminLevel,
      status: hashOk && byteSizeOk ? "LOCKED_BYTES_VERIFIED" : "CHECKSUM_MISMATCH",
      expectedSha256: input.expectedSha256,
      expectedByteSize: input.expectedByteSize ?? null,
      actualSha256,
      actualByteSize: fileStat.size,
      artifactPath: input.artifactPath,
      ...(input.originalUrl ? { originalUrl: input.originalUrl } : {}),
      ...(input.fetchedAt ? { fetchedAt: input.fetchedAt } : {})
    };
  } catch {
    return {
      adminLevel: input.adminLevel,
      status: "ARTIFACT_NOT_AVAILABLE",
      expectedSha256: input.expectedSha256,
      expectedByteSize: input.expectedByteSize ?? null
    };
  }
}

interface ParsedGeoBoundariesFeature {
  shapeId: string;
  shapeName: string;
  geometry: TerritoryGeometry;
  parentShapeId: string | null;
}

function readGeoJsonPolygonGeometry(input: unknown): TerritoryGeometry | null {
  if (!isRecord(input) || (input.type !== "Polygon" && input.type !== "MultiPolygon")) {
    return null;
  }
  return input as unknown as TerritoryGeometry;
}

export interface GeoBoundariesFeatureParseReport {
  rawGeoJsonFeatureCount: number;
  parsedFeatureCount: number;
  rejectedFeatureCount: number;
  rejectionReasons: Record<string, number>;
  duplicateShapeIdCount: number;
  features: ParsedGeoBoundariesFeature[];
}

function incrementReason(reasons: Record<string, number>, reason: string): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

export function analyzeGeoBoundariesFeatureCollection(
  input: unknown
): GeoBoundariesFeatureParseReport {
  const rejectionReasons: Record<string, number> = {};
  if (!isRecord(input) || input.type !== "FeatureCollection" || !Array.isArray(input.features)) {
    return {
      rawGeoJsonFeatureCount: 0,
      parsedFeatureCount: 0,
      rejectedFeatureCount: 0,
      rejectionReasons: { invalid_feature_collection: 1 },
      duplicateShapeIdCount: 0,
      features: []
    };
  }
  const rawGeoJsonFeatureCount = input.features.length;
  const shapeIds = new Set<string>();
  let duplicateShapeIdCount = 0;
  const features = input.features.flatMap((rawFeature, index): ParsedGeoBoundariesFeature[] => {
    if (!isRecord(rawFeature)) {
      incrementReason(rejectionReasons, "feature_not_object");
      return [];
    }
    if (!isRecord(rawFeature.properties)) {
      incrementReason(rejectionReasons, "missing_properties");
      return [];
    }
    const shapeId = readStringPropertyPath(rawFeature.properties, "shapeID");
    const shapeName = readStringPropertyPath(rawFeature.properties, "shapeName");
    const geometry = readGeoJsonPolygonGeometry(rawFeature.geometry);
    if (!shapeId) {
      incrementReason(rejectionReasons, "missing_shapeID");
      return [];
    }
    if (!shapeName) {
      incrementReason(rejectionReasons, "missing_shapeName");
      return [];
    }
    if (!geometry) {
      incrementReason(rejectionReasons, "unsupported_or_missing_geometry");
      return [];
    }
    if (shapeIds.has(shapeId)) {
      duplicateShapeIdCount += 1;
      incrementReason(rejectionReasons, "duplicate_shapeID");
      return [];
    }
    shapeIds.add(shapeId);
    const parentShapeId =
      readStringPropertyPath(rawFeature.properties, "parentShapeID") ??
      readStringPropertyPath(rawFeature.properties, "shapeParentID") ??
      null;
    return [{ shapeId, shapeName, geometry, parentShapeId }];
  });
  const rejectedFeatureCount = rawGeoJsonFeatureCount - features.length;
  return {
    rawGeoJsonFeatureCount,
    parsedFeatureCount: features.length,
    rejectedFeatureCount,
    rejectionReasons,
    duplicateShapeIdCount,
    features
  };
}

function readGeoBoundariesFeaturesFromCollection(input: unknown): ParsedGeoBoundariesFeature[] {
  return analyzeGeoBoundariesFeatureCollection(input).features;
}

async function compareGeoBoundariesLevelToParent(input: {
  level: TurkeyV2AdmParentLevel;
  parentZones: TerritoryZone[];
  artifactPath: string;
}): Promise<{
  identity: GeoBoundariesIdentityComparisonRow;
  geometry: GeoBoundariesGeometryComparisonRow;
}> {
  const collection = JSON.parse(await readFile(input.artifactPath, "utf8")) as unknown;
  const parseReport = analyzeGeoBoundariesFeatureCollection(collection);
  const sourceFeatures = parseReport.features;
  const sourceById = new Map<string, ParsedGeoBoundariesFeature>();
  for (const feature of sourceFeatures) {
    sourceById.set(feature.shapeId, feature);
  }
  const duplicateSourceNativeIds = parseReport.duplicateShapeIdCount;

  const repairInput = sourceFeatures.map((feature, index) => ({
    id: String(index),
    geometry: feature.geometry
  }));
  const repairReport = await repairTerritoryGeometries(repairInput);
  const repairedByShapeId = new Map<string, unknown>();
  sourceFeatures.forEach((feature, index) => {
    const repaired = repairReport.results[index];
    if (repaired?.geometry) {
      repairedByShapeId.set(feature.shapeId, repaired.geometry);
    }
  });

  let matchedBySourceNativeId = 0;
  let unmatchedParentZones = 0;
  let administrativeNameMatches = 0;
  let administrativeNameMismatches = 0;
  let rawSerializedGeometryHashMatches = 0;
  let repairedSerializedGeometryHashMatches = 0;
  let serializedGeometryHashMismatches = 0;
  const sampleMismatches: GeoBoundariesGeometryComparisonRow["sampleMismatches"] = [];
  const matchedShapeIds = new Set<string>();

  for (const zone of input.parentZones) {
    const nativeId = readParentSourceNativeId(zone);
    if (!nativeId) {
      unmatchedParentZones += 1;
      continue;
    }
    const sourceFeature = sourceById.get(nativeId);
    if (!sourceFeature) {
      unmatchedParentZones += 1;
      continue;
    }
    matchedBySourceNativeId += 1;
    matchedShapeIds.add(nativeId);

    const parentName = normalizeAdminName(zone.name ?? "");
    const sourceName = normalizeAdminName(sourceFeature.shapeName);
    if (parentName && sourceName && parentName === sourceName) {
      administrativeNameMatches += 1;
    } else {
      administrativeNameMismatches += 1;
    }

    const parentHash = auditGeometryHash(zone.geometry);
    const rawHash = auditGeometryHash(sourceFeature.geometry);
    if (parentHash === rawHash) {
      rawSerializedGeometryHashMatches += 1;
    }
    const repairedGeometry = repairedByShapeId.get(nativeId);
    if (repairedGeometry) {
      const repairedHash = auditGeometryHash(repairedGeometry);
      if (parentHash === repairedHash) {
        repairedSerializedGeometryHashMatches += 1;
      } else {
        serializedGeometryHashMismatches += 1;
        if (sampleMismatches.length < 5) {
          sampleMismatches.push({
            sourceNativeId: nativeId,
            parentZoneId: zone.id,
            parentHash,
            repairedSourceHash: repairedHash
          });
        }
      }
    } else {
      serializedGeometryHashMismatches += 1;
    }
  }

  const unmatchedSourceFeatures = sourceFeatures.length - matchedShapeIds.size;

  return {
    identity: {
      adminLevel: input.level,
      parentZoneCount: input.parentZones.length,
      sourceFeatureCount: sourceFeatures.length,
      matchedBySourceNativeId,
      unmatchedParentZones,
      unmatchedSourceFeatures,
      duplicateSourceNativeIds,
      territoryStableIdAssessment: "NOT_ASSESSED",
      parentRelationshipAssessment: "NOT_ASSESSED",
      administrativeNameMatches,
      administrativeNameMismatches,
      identityMatchMethod: "shapeID-to-territory.source.sourceId"
    },
    geometry: {
      adminLevel: input.level,
      comparisonMethod: "geometry-repair-then-serialized-hash",
      crs: "EPSG:4326 (source GeoJSON)",
      identityMatchedPairs: matchedBySourceNativeId,
      rawSerializedGeometryHashMatches,
      repairedSerializedGeometryHashMatches,
      serializedGeometryHashMismatches,
      geographicEquivalenceStatus: "NOT_ASSESSED",
      sampleMismatches
    }
  };
}

function interpretSourceFeatureInventory(input: {
  adminLevel: TurkeyV2AdmParentLevel;
  parseReport: GeoBoundariesFeatureParseReport;
  lockMetadataFeatureCount: number | null;
  canonicalParentZoneCount: number;
  unmatchedSourceFeaturesAfterParentJoin: number;
}): string {
  const parts: string[] = [];
  if (
    input.lockMetadataFeatureCount !== null &&
    input.lockMetadataFeatureCount !== input.parseReport.rawGeoJsonFeatureCount
  ) {
    parts.push(
      `source-lock sourceFeatureCount (${input.lockMetadataFeatureCount}) differs from raw GeoJSON features (${input.parseReport.rawGeoJsonFeatureCount}); lock metadata likely from geoBoundaries API admUnitCount and may not match simplified artifact bytes.`
    );
  }
  if (input.parseReport.rejectedFeatureCount > 0) {
    parts.push(
      `${input.parseReport.rejectedFeatureCount} raw features rejected by audit parser (${JSON.stringify(input.parseReport.rejectionReasons)}).`
    );
  }
  if (input.parseReport.parsedFeatureCount !== input.canonicalParentZoneCount) {
    parts.push(
      `parsed features (${input.parseReport.parsedFeatureCount}) vs canonical parent zones (${input.canonicalParentZoneCount}).`
    );
  }
  if (input.unmatchedSourceFeaturesAfterParentJoin > 0) {
    parts.push(
      `${input.unmatchedSourceFeaturesAfterParentJoin} parsed source features had no matching parent zone by shapeID.`
    );
  }
  if (parts.length === 0) {
    return "Raw, parsed, and canonical parent counts align for this inspection scope.";
  }
  return parts.join(" ");
}

export function buildPathBEvidenceRequirements(input: {
  missingArtifacts: string[];
  sourceFeatureInventory: GeoBoundariesSourceFeatureInventory[];
  geometryComparison: GeoBoundariesGeometryComparisonRow[];
  candidates: GeoBoundariesSourceCandidate[];
  geoBoundariesUpstreamBytesVerified: boolean;
  parentInventoryStatus: TurkeyGeoBoundariesParentLineageInspection["parentInventoryStatus"];
  pathBFeasibility: PathBFeasibilityClassification;
}): PathBEvidenceRequirements {
  const unresolvedGeometryEvidence: string[] = [];
  for (const row of input.geometryComparison) {
    if (row.serializedGeometryHashMismatches > 0) {
      unresolvedGeometryEvidence.push(
        `${row.adminLevel}: ${row.serializedGeometryHashMismatches} serialized geometry hash mismatches after geometry-repair (${row.repairedSerializedGeometryHashMatches}/${row.identityMatchedPairs} matches); geographic equivalence ${row.geographicEquivalenceStatus}.`
      );
    }
    if (row.geographicEquivalenceStatus === "NOT_ASSESSED") {
      unresolvedGeometryEvidence.push(
        `${row.adminLevel}: geographic/topological equivalence not assessed (serialized hash only).`
      );
    }
  }
  unresolvedGeometryEvidence.push(
    "Full country-builder pipeline replay (buildTerritoryCountryDataset) not executed in this audit — geometry-repair-only replay is insufficient for PATH_B_VERIFIED_CANDIDATE."
  );

  const unresolvedSourceInventoryEvidence: string[] = [];
  for (const inventory of input.sourceFeatureInventory) {
    if (
      inventory.lockMetadataFeatureCount !== null &&
      inventory.lockMetadataFeatureCount !== inventory.rawGeoJsonFeatureCount
    ) {
      unresolvedSourceInventoryEvidence.push(
        `${inventory.adminLevel}: lock metadata feature count ${inventory.lockMetadataFeatureCount} vs raw GeoJSON ${inventory.rawGeoJsonFeatureCount} — ${inventory.inventoryInterpretation}`
      );
    }
    if (inventory.rejectedFeatureCount > 0) {
      unresolvedSourceInventoryEvidence.push(
        `${inventory.adminLevel}: ${inventory.rejectedFeatureCount} features rejected during parse (${JSON.stringify(inventory.rejectionReasons)}).`
      );
    }
    if (inventory.unmatchedSourceFeaturesAfterParentJoin > 0) {
      unresolvedSourceInventoryEvidence.push(
        `${inventory.adminLevel}: ${inventory.unmatchedSourceFeaturesAfterParentJoin} source features unmatched to parent zones.`
      );
    }
  }

  const unresolvedLicensingEvidence: string[] = [
    "Per-level lock license strings (OSM/CC-BY-SA/ODbL) are not automatically equivalent to geoBoundaries gbOpen CC BY 4.0 adapter default — legal compatibility requires human review.",
    "geoBoundaries data must not be represented as authoritative Turkish government boundaries."
  ];
  const lockLicenses = new Set(
    input.candidates
      .map((candidate) => candidate.lockLicense)
      .filter((value): value is string => !!value)
  );
  if (lockLicenses.size > 1) {
    unresolvedLicensingEvidence.push(
      `ADM levels declare different upstream license strings: ${[...lockLicenses].join(" | ")}.`
    );
  }
  for (const candidate of input.candidates) {
    if (candidate.metadataUrl) {
      unresolvedLicensingEvidence.push(
        `${candidate.adminLevel} metadata URL (inspect upstream fields): ${candidate.metadataUrl}`
      );
    }
  }

  const migrationAuthorizationStatus: PathBMigrationAuthorizationStatus =
    input.pathBFeasibility === "PATH_B_VERIFIED_CANDIDATE"
      ? "BLOCKED_PENDING_EVIDENCE"
      : "NOT_AUTHORIZED";

  const fullPipelineReproducibilityStatus =
    input.pathBFeasibility === "PATH_B_VERIFIED_CANDIDATE" ? "COMPLETE" : "INCOMPLETE";

  return {
    missingArtifacts: input.missingArtifacts,
    unresolvedGeometryEvidence,
    unresolvedSourceInventoryEvidence,
    unresolvedLicensingEvidence,
    migrationAuthorizationStatus,
    fullPipelineReproducibilityStatus
  };
}

export function classifyPathBFeasibility(input: {
  parentInventoryStatus: TurkeyGeoBoundariesParentLineageInspection["parentInventoryStatus"];
  byteVerification: GeoBoundariesByteVerificationEntry[];
  identityComparison: GeoBoundariesIdentityComparisonRow[];
  geometryComparison: GeoBoundariesGeometryComparisonRow[];
  candidates: GeoBoundariesSourceCandidate[];
  missingEvidence: string[];
}): { classification: PathBFeasibilityClassification; summary: string } {
  const allBytesVerified =
    input.byteVerification.length > 0 &&
    input.byteVerification.every((entry) => entry.status === "LOCKED_BYTES_VERIFIED");
  const anyBytesAvailable = input.byteVerification.some(
    (entry) => entry.status === "LOCKED_BYTES_VERIFIED"
  );
  const inventoryComplete = input.parentInventoryStatus === "COMPLETE";
  const fullIdentityCoverage =
    inventoryComplete &&
    input.identityComparison.every(
      (row) =>
        row.unmatchedParentZones === 0 &&
        row.matchedBySourceNativeId === row.parentZoneCount &&
        row.parentZoneCount === TURKEY_PARENT_INVENTORY_EXPECTED[row.adminLevel]
    );
  const fullRepairedGeometryMatch =
    fullIdentityCoverage &&
    input.geometryComparison.every(
      (row) =>
        row.identityMatchedPairs > 0 &&
        row.repairedSerializedGeometryHashMatches === row.identityMatchedPairs &&
        row.serializedGeometryHashMismatches === 0
    );

  const missingArtifactsOnly = input.missingEvidence.filter(
    (entry) => !entry.startsWith("geoboundaries-byte-verification-failed")
  );
  if (missingArtifactsOnly.length > 0 && !anyBytesAvailable) {
    return {
      classification: "PATH_B_BLOCKED_BY_MISSING_EVIDENCE",
      summary:
        "geoBoundaries upstream artifacts or canonical parent dataset were not available for byte-level lineage verification."
    };
  }

  if (!inventoryComplete || input.candidates.length < TURKEY_V2_ADM_PARENT_LEVELS.length) {
    return {
      classification: "PATH_B_BLOCKED_BY_MISSING_EVIDENCE",
      summary:
        "Parent inventory or pinned geoBoundaries source-lock levels are incomplete; Path B cannot be certified."
    };
  }

  if (!allBytesVerified) {
    return {
      classification: "PATH_B_PARTIALLY_VERIFIED",
      summary:
        "Some geoBoundaries member bytes were verified, but not all ADM levels matched the pinned SHA-256 expectations."
    };
  }

  if (fullRepairedGeometryMatch && fullIdentityCoverage) {
    return {
      classification: "PATH_B_VERIFIED_CANDIDATE",
      summary:
        "Pinned gbOpen geoBoundaries bytes match the historical source lock and reproduce canonical parent polygons after the documented geometry-repair transform."
    };
  }

  if (anyBytesAvailable && fullIdentityCoverage) {
    return {
      classification: "PATH_B_PARTIALLY_VERIFIED",
      summary:
        "Source-native identities align and bytes are pinned, but serialized geometry hashes do not fully match after repair (or geographic equivalence was not assessed)."
    };
  }

  return {
    classification: "PATH_B_NOT_SUPPORTED",
    summary:
      "geoBoundaries evidence does not support preserving canonical parent polygons under Path B metadata realignment."
  };
}

export async function inspectTurkeyGeoBoundariesParentLineage(
  options: InspectTurkeyGeoBoundariesParentLineageOptions
): Promise<TurkeyGeoBoundariesParentLineageInspection> {
  const missingEvidence: string[] = [];
  let parentDataset = options.parentDataset;
  let parentDatasetSha256: string | null = null;

  if (!parentDataset && options.parentDatasetPath) {
    try {
      const raw = await readFile(options.parentDatasetPath, "utf8");
      parentDatasetSha256 = sha256Hex(raw);
      parentDataset = JSON.parse(raw) as TerritoryDataset;
    } catch {
      missingEvidence.push("canonical-parent-dataset-unavailable");
    }
  }

  if (!parentDataset) {
    const empty = classifyPathBFeasibility({
      parentInventoryStatus: "MISSING_ARTIFACT",
      byteVerification: [],
      identityComparison: [],
      geometryComparison: [],
      candidates: [],
      missingEvidence
    });
    return {
      schemaVersion: TURKEY_GEOBOUNDARIES_PARENT_LINEAGE_SCHEMA_VERSION,
      parentDatasetVersion: null,
      parentDatasetSha256: null,
      parentInventoryStatus: "MISSING_ARTIFACT",
      sourceLockPath: options.sourceLockPath ?? null,
      sourceLockProvider: null,
      sourceLockReleaseType: null,
      sourceLockResolvedAt: null,
      candidates: [],
      byteVerification: [],
      geoBoundariesUpstreamBytesVerified: false,
      identityComparison: [],
      geometryComparison: [],
      pathBFeasibility: empty.classification,
      pathBFeasibilitySummary: empty.summary,
      missingEvidence,
      pathBEvidenceRequirements: buildPathBEvidenceRequirements({
        missingArtifacts: missingEvidence,
        sourceFeatureInventory: [],
        geometryComparison: [],
        candidates: [],
        geoBoundariesUpstreamBytesVerified: false,
        parentInventoryStatus: "MISSING_ARTIFACT",
        pathBFeasibility: empty.classification
      }),
      sourceFeatureInventory: [],
      legalReviewStatus: "PENDING_REVIEW",
      notAuthoritativeGovernmentData: true
    };
  }

  const inventoryComplete = TURKEY_V2_ADM_PARENT_LEVELS.every(
    (level) =>
      zonesForLevel(parentDataset, level).length === TURKEY_PARENT_INVENTORY_EXPECTED[level]
  );
  const parentInventoryStatus = inventoryComplete ? "COMPLETE" : "INCOMPLETE";

  let sourceLock: TurkeyGeoBoundariesSourceLock | null = null;
  if (options.sourceLockPath) {
    try {
      sourceLock = await loadTurkeyGeoBoundariesSourceLock(options.sourceLockPath);
    } catch {
      missingEvidence.push("geoboundaries-source-lock-unreadable");
    }
  } else {
    missingEvidence.push("geoboundaries-source-lock-path-not-provided");
  }

  const candidates = sourceLock ? buildGeoBoundariesCandidatesFromSourceLock(sourceLock) : [];
  const cacheRoot = options.geoBoundariesCacheRoot;
  const byteVerification: GeoBoundariesByteVerificationEntry[] = [];
  const resolvedArtifactPaths: Partial<Record<TurkeyV2AdmParentLevel, string>> = {
    ...options.sourceArtifactPaths
  };

  for (const level of TURKEY_V2_ADM_PARENT_LEVELS) {
    const lockLevel = sourceLock?.levels[level];
    const expectedSha256 = lockLevel?.sha256 ?? null;
    let discovered =
      expectedSha256 && cacheRoot
        ? await findGeoBoundariesArtifactBySha256(cacheRoot, expectedSha256)
        : null;
    if (!resolvedArtifactPaths[level] && discovered) {
      resolvedArtifactPaths[level] = discovered.artifactPath;
    }
    if (!resolvedArtifactPaths[level]) {
      byteVerification.push({
        adminLevel: level,
        status: expectedSha256 ? "ARTIFACT_NOT_AVAILABLE" : "EXPECTED_HASH_MISSING",
        expectedSha256,
        expectedByteSize: lockLevel?.sizeBytes ?? null
      });
      if (expectedSha256) {
        missingEvidence.push(`geoboundaries-artifact-unavailable-${level}`);
      }
      continue;
    }
    if (!discovered && expectedSha256 && cacheRoot) {
      discovered = await findGeoBoundariesArtifactBySha256(cacheRoot, expectedSha256);
    }
    const verified = await verifyGeoBoundariesSourceArtifactBytes({
      adminLevel: level,
      artifactPath: resolvedArtifactPaths[level]!,
      expectedSha256,
      expectedByteSize: lockLevel?.sizeBytes ?? null,
      ...(discovered?.metadata.originalUrl && typeof discovered.metadata.originalUrl === "string"
        ? { originalUrl: discovered.metadata.originalUrl }
        : {}),
      ...(discovered?.metadata.fetchedAt && typeof discovered.metadata.fetchedAt === "string"
        ? { fetchedAt: discovered.metadata.fetchedAt }
        : {})
    });
    byteVerification.push(verified);
    if (verified.status !== "LOCKED_BYTES_VERIFIED") {
      missingEvidence.push(`geoboundaries-byte-verification-failed-${level}`);
    }
  }

  const geoBoundariesUpstreamBytesVerified = byteVerification.every(
    (entry) => entry.status === "LOCKED_BYTES_VERIFIED"
  );

  const identityComparison: GeoBoundariesIdentityComparisonRow[] = [];
  const geometryComparison: GeoBoundariesGeometryComparisonRow[] = [];
  const sourceFeatureInventory: GeoBoundariesSourceFeatureInventory[] = [];

  for (const level of TURKEY_V2_ADM_PARENT_LEVELS) {
    const artifactPath = resolvedArtifactPaths[level];
    if (!artifactPath) {
      continue;
    }
    const parentZones = zonesForLevel(parentDataset, level);
    const collection = JSON.parse(await readFile(artifactPath, "utf8")) as unknown;
    const parseReport = analyzeGeoBoundariesFeatureCollection(collection);
    const compared = await compareGeoBoundariesLevelToParent({
      level,
      parentZones,
      artifactPath
    });
    identityComparison.push(compared.identity);
    geometryComparison.push(compared.geometry);
    const lockMetadataFeatureCount = sourceLock?.levels[level]?.sourceFeatureCount ?? null;
    sourceFeatureInventory.push({
      adminLevel: level,
      rawGeoJsonFeatureCount: parseReport.rawGeoJsonFeatureCount,
      parsedFeatureCount: parseReport.parsedFeatureCount,
      rejectedFeatureCount: parseReport.rejectedFeatureCount,
      rejectionReasons: parseReport.rejectionReasons,
      duplicateShapeIdCount: parseReport.duplicateShapeIdCount,
      lockMetadataFeatureCount,
      canonicalParentZoneCount: parentZones.length,
      unmatchedSourceFeaturesAfterParentJoin: compared.identity.unmatchedSourceFeatures,
      inventoryInterpretation: interpretSourceFeatureInventory({
        adminLevel: level,
        parseReport,
        lockMetadataFeatureCount,
        canonicalParentZoneCount: parentZones.length,
        unmatchedSourceFeaturesAfterParentJoin: compared.identity.unmatchedSourceFeatures
      })
    });
  }

  const { classification, summary } = classifyPathBFeasibility({
    parentInventoryStatus,
    byteVerification,
    identityComparison,
    geometryComparison,
    candidates,
    missingEvidence
  });

  const pathBEvidenceRequirements = buildPathBEvidenceRequirements({
    missingArtifacts: [...new Set(missingEvidence)],
    sourceFeatureInventory,
    geometryComparison,
    candidates,
    geoBoundariesUpstreamBytesVerified,
    parentInventoryStatus,
    pathBFeasibility: classification
  });

  return {
    schemaVersion: TURKEY_GEOBOUNDARIES_PARENT_LINEAGE_SCHEMA_VERSION,
    parentDatasetVersion:
      typeof parentDataset.manifest?.datasetVersion === "string"
        ? parentDataset.manifest.datasetVersion
        : null,
    parentDatasetSha256,
    parentInventoryStatus,
    sourceLockPath: options.sourceLockPath ?? null,
    sourceLockProvider: sourceLock?.provider ?? null,
    sourceLockReleaseType: sourceLock?.releaseType ?? null,
    sourceLockResolvedAt: sourceLock?.resolvedAt ?? null,
    candidates,
    byteVerification,
    geoBoundariesUpstreamBytesVerified,
    identityComparison,
    geometryComparison,
    pathBFeasibility: classification,
    pathBFeasibilitySummary: summary,
    missingEvidence: [...new Set(missingEvidence)],
    pathBEvidenceRequirements,
    sourceFeatureInventory,
    legalReviewStatus: "PENDING_REVIEW",
    notAuthoritativeGovernmentData: true
  };
}

export function verifyTurkeyGeoBoundariesParentLineage(
  inspection: TurkeyGeoBoundariesParentLineageInspection,
  options: { diagnosticMode?: boolean; strict?: boolean } = {}
): { ok: boolean; verified: boolean } {
  const strict = options.strict ?? !options.diagnosticMode;
  if (!strict) {
    return { ok: true, verified: false };
  }
  const verified =
    inspection.pathBFeasibility === "PATH_B_VERIFIED_CANDIDATE" &&
    inspection.geoBoundariesUpstreamBytesVerified &&
    inspection.parentInventoryStatus === "COMPLETE";
  const ok = verified;
  return { ok, verified };
}

export function computeParentDatasetContentSha256(dataset: TerritoryDataset): string {
  return sha256Hex(serializeJsonStable(dataset));
}

function bulletList(items: string[]): string {
  if (items.length === 0) {
    return "- (yok — bu kategori için kayıt yok)";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

export function renderPathBFeasibilityMarkdown(
  inspection: TurkeyGeoBoundariesParentLineageInspection,
  meta: { inspectedCommit: string; generatedAt: string }
): string {
  const requirements = inspection.pathBEvidenceRequirements;
  const geometrySummary = inspection.geometryComparison
    .map(
      (row) =>
        `${row.adminLevel}: onarım sonrası ${row.repairedSerializedGeometryHashMatches}/${row.identityMatchedPairs} serileştirilmiş hash eşleşmesi; ${row.serializedGeometryHashMismatches} uyumsuzluk`
    )
    .join("; ");

  return `# Path B (geoBoundaries metadata realignment) feasibility

**İnceleme commit:** \`${meta.inspectedCommit}\`
**Üretim zamanı (UTC):** ${meta.generatedAt}
**Sınıflandırma:** \`${inspection.pathBFeasibility}\`

## Özet

${inspection.pathBFeasibilitySummary}

## Kanıt durumu

| Alan | Durum |
| --- | --- |
| geoBoundaries bayt doğrulaması | ${inspection.geoBoundariesUpstreamBytesVerified ? "EVET" : "HAYIR"} |
| Ebeveyn envanter | ${inspection.parentInventoryStatus} |
| Hukuk inceleme | ${inspection.legalReviewStatus} |
| Migrasyon yetkisi | ${requirements.migrationAuthorizationStatus} |
| Tam pipeline yeniden üretilebilirlik | ${requirements.fullPipelineReproducibilityStatus} |
| Resmî devlet verisi iddiası | Hayır — geoBoundaries açık veri sınırları geçerli |

## Serileştirilmiş geometri özeti

${geometrySummary || "Karşılaştırma çalıştırılmadı."}

## Eksik artifact dosyaları

${bulletList(requirements.missingArtifacts)}

## Çözülmemiş geometri kanıtı

${bulletList(requirements.unresolvedGeometryEvidence)}

## Çözülmemiş kaynak envanter kanıtı

${bulletList(requirements.unresolvedSourceInventoryEvidence)}

## Çözülmemiş lisans / attribution kanıtı

${bulletList(requirements.unresolvedLicensingEvidence)}

## ADR-006 notu

Bu rapor ADR-006 (HDX/OCHA COD-AB varsayılanı) kararını **değiştirmez**. Path B yalnızca ayrı yetkilendirilmiş bir migrasyon PR'si için ön koşul kanıtı sağlar.

## Yeniden üretim

\`\`\`sh
pnpm data:tr:geoboundaries:parent:audit
\`\`\`

Yerel önbellek gerekir: \`.territory/cache/sources/geoboundaries\` ve gitignore altındaki \`datasets/generated/countries/TR/\`.
`;
}

export function renderGeoBoundariesProvenanceReadmeMarkdown(): string {
  return `# geoBoundaries ebeveyn soy kanıtı (Path B)

Türkiye ADM0–ADM2 canonical ebeveyn poligonlarının geoBoundaries gbOpen kaynağıyla hizalanabilirliği.

| Dosya | Amaç |
| --- | --- |
| [source-candidates.json](./source-candidates.json) | Pinlenmiş gbOpen release adayları |
| [source-byte-verification.json](./source-byte-verification.json) | SHA-256 bayt doğrulaması |
| [source-feature-inventory.json](./source-feature-inventory.json) | Ham/parsed özellik sayıları ve lock metadata |
| [path-b-evidence-requirements.json](./path-b-evidence-requirements.json) | Çözülmemiş kanıt gereksinimleri |
| [canonical-parent-inventory.json](./canonical-parent-inventory.json) | Yerel canonical artifact envanteri |
| [identity-comparison.json](./identity-comparison.json) | shapeID ↔ zone eşleşmeleri |
| [geometry-equivalence.json](./geometry-equivalence.json) | Onarım sonrası serileştirilmiş geometri hash |
| [path-b-feasibility.md](./path-b-feasibility.md) | Path B sınıflandırması |
| [migration-impact-plan.md](./migration-impact-plan.md) | Migrasyon etki planı (uygulanmadı) |

HDX karşılaştırma kanıtı: [../](../) (PR #104).
`;
}
