import {
  TERRITORY_COVERAGE_STATUSES,
  TERRITORY_SEMANTIC_REVIEW_STATUSES,
  TERRITORY_SOURCE_CLASSES
} from "./global.js";
import { validateTerritoryDataset } from "./validation.js";
import type {
  TerritoryDataset,
  TerritorySourceClass,
  TerritoryValidationCode,
  TerritoryValidationIssue,
  TerritoryValidationResult,
  TerritoryValidationSeverity,
  TerritoryZone
} from "./types.js";

export const TURKEY_V2_DATA_CONTRACT_VERSION = "territorykit-tr-v2-data-contract@1" as const;
export const TURKEY_V2_DATASET_VALIDATION_PROFILE = "tr-v2" as const;
export const TURKEY_V2_SOURCE_CLASS_PRIORITY = ["official", "osm", "generated"] as const;

export type TurkeyV2DatasetValidationProfile = typeof TURKEY_V2_DATASET_VALIDATION_PROFILE;

export interface TurkeyV2ValidationOptions {
  profile?: TurkeyV2DatasetValidationProfile;
}

interface TurkeyV2ZoneMetadata {
  sourceClass: string | undefined;
  sourceProvider: string | undefined;
  sourceDatasetId: string | undefined;
  sourceNativeId: string | undefined;
  sourceId: string | undefined;
  sourceDate: string | undefined;
  sourceUrl: string | undefined;
  license: string | undefined;
  attribution: string | undefined;
  official: boolean | undefined;
  generated: boolean | undefined;
  algorithmVersion: string | undefined;
  generationSeed: string | undefined;
  semanticType: string | undefined;
  localType: string | undefined;
  localTypeName: string | undefined;
  countryCode: string | undefined;
  provinceCode: string | undefined;
  districtCode: string | undefined;
  sourceAdminLevel: string | undefined;
  hierarchyDepth: number | undefined;
  parentId: string | undefined;
  coverageStatus: string | undefined;
  semanticReviewStatus: string | undefined;
  stableId: string | undefined;
}

export function validateTurkeyV2Dataset(
  input: unknown,
  _options: TurkeyV2ValidationOptions = {}
): TerritoryValidationResult {
  const base = validateTerritoryDataset(input);

  if (!base.ok || !base.dataset) {
    return {
      ok: false,
      issues: sortAndDedupeIssues(base.issues)
    };
  }

  const issues = sortAndDedupeIssues([
    ...base.issues,
    ...validateTurkeyV2DatasetObject(base.dataset)
  ]);
  const ok = issues.every((issue) => issue.severity !== "error");

  return {
    ok,
    issues,
    ...(ok ? { dataset: base.dataset } : {})
  };
}

function validateTurkeyV2DatasetObject(dataset: TerritoryDataset): TerritoryValidationIssue[] {
  const issues: TerritoryValidationIssue[] = [];
  const zonesById = new Map(dataset.zones.map((zone) => [zone.id, zone]));
  const pathById = new Map(dataset.zones.map((zone, index) => [zone.id, `$.zones[${index}]`]));
  const stableIds = new Map<string, TerritoryZone>();

  for (const zone of dataset.zones) {
    if (!isAdm3Zone(zone)) {
      continue;
    }

    const metadata = readTurkeyV2ZoneMetadata(zone);
    const path = pathById.get(zone.id) ?? `$.zones[?(@.id=="${zone.id}")]`;
    const sourceClass = metadata.sourceClass;

    validateAdm3Parent({ dataset, zone, metadata, zonesById, path, issues });
    validateHierarchyCodes({ dataset, zone, metadata, zonesById, path, issues });
    validateStatuses({ dataset, zone, metadata, path, issues });

    if (!isTerritorySourceClass(sourceClass)) {
      pushIssue(issues, {
        code: "INVALID_SOURCE_CLASS",
        message: `Turkey V2 ADM3 zone '${zone.id}' must declare sourceClass official, osm, or generated.`,
        dataset,
        zone,
        path: `${path}.properties.territory.sourceClass`,
        field: "sourceClass",
        expected: [...TERRITORY_SOURCE_CLASSES],
        actual: sourceClass
      });
      continue;
    }

    validateSourceFlags({ dataset, zone, metadata, sourceClass, path, issues });
    validateSourceClassContract({ dataset, zone, metadata, sourceClass, path, issues });

    const stableId = metadata.stableId ?? zone.id;
    const existing = stableIds.get(stableId);

    if (existing && existing.id !== zone.id) {
      pushIssue(issues, {
        code: "DUPLICATE_STABLE_ID",
        message: `Turkey V2 ADM3 stable id '${stableId}' is used by multiple zones.`,
        dataset,
        zone,
        path: `${path}.properties.territory.stableId`,
        field: "stableId",
        expected: "unique stable id",
        actual: stableId,
        parentId: metadata.parentId
      });
    } else {
      stableIds.set(stableId, zone);
    }
  }

  return issues;
}

function validateAdm3Parent(input: {
  dataset: TerritoryDataset;
  zone: TerritoryZone;
  metadata: TurkeyV2ZoneMetadata;
  zonesById: ReadonlyMap<string, TerritoryZone>;
  path: string;
  issues: TerritoryValidationIssue[];
}): void {
  const parentId = input.metadata.parentId ?? input.zone.parentId;

  if (!parentId) {
    pushIssue(input.issues, {
      code: "ADM3_ORPHAN",
      message: `Turkey V2 ADM3 zone '${input.zone.id}' must have an ADM2 parentId.`,
      dataset: input.dataset,
      zone: input.zone,
      path: `${input.path}.parentId`,
      field: "parentId",
      expected: "existing ADM2 parent id",
      actual: parentId
    });
    return;
  }

  const parent = input.zonesById.get(parentId);

  if (!parent) {
    pushIssue(input.issues, {
      code: "ADM3_ORPHAN",
      message: `Turkey V2 ADM3 zone '${input.zone.id}' references missing parent '${parentId}'.`,
      dataset: input.dataset,
      zone: input.zone,
      path: `${input.path}.parentId`,
      field: "parentId",
      expected: "existing ADM2 parent id",
      actual: parentId,
      parentId
    });
    return;
  }

  if (!isAdm2Zone(parent)) {
    pushIssue(input.issues, {
      code: "INVALID_PARENT_LEVEL",
      message: `Turkey V2 ADM3 zone '${input.zone.id}' must point to an ADM2 parent, not level ${parent.level}.`,
      dataset: input.dataset,
      zone: input.zone,
      path: `${input.path}.parentId`,
      field: "parentId",
      expected: "ADM2",
      actual: zoneAdminLevel(parent),
      parentId
    });
  }
}

function validateHierarchyCodes(input: {
  dataset: TerritoryDataset;
  zone: TerritoryZone;
  metadata: TurkeyV2ZoneMetadata;
  zonesById: ReadonlyMap<string, TerritoryZone>;
  path: string;
  issues: TerritoryValidationIssue[];
}): void {
  const parentId = input.metadata.parentId ?? input.zone.parentId;
  const parent = parentId ? input.zonesById.get(parentId) : undefined;
  const parentMetadata = parent ? readTurkeyV2ZoneMetadata(parent) : undefined;

  if (input.metadata.countryCode !== "TR") {
    pushIssue(input.issues, {
      code: "HIERARCHY_CODE_MISMATCH",
      message: `Turkey V2 ADM3 zone '${input.zone.id}' must carry countryCode TR.`,
      dataset: input.dataset,
      zone: input.zone,
      path: `${input.path}.properties.territory.countryCode`,
      field: "countryCode",
      expected: "TR",
      actual: input.metadata.countryCode,
      parentId
    });
  }

  if (!input.metadata.provinceCode) {
    pushIssue(input.issues, {
      code: "HIERARCHY_CODE_MISMATCH",
      message: `Turkey V2 ADM3 zone '${input.zone.id}' must carry provinceCode.`,
      dataset: input.dataset,
      zone: input.zone,
      path: `${input.path}.properties.territory.provinceCode`,
      field: "provinceCode",
      expected: "Turkey province code",
      actual: input.metadata.provinceCode,
      parentId
    });
  }

  if (!input.metadata.districtCode) {
    pushIssue(input.issues, {
      code: "HIERARCHY_CODE_MISMATCH",
      message: `Turkey V2 ADM3 zone '${input.zone.id}' must carry districtCode.`,
      dataset: input.dataset,
      zone: input.zone,
      path: `${input.path}.properties.territory.districtCode`,
      field: "districtCode",
      expected: "Turkey district code",
      actual: input.metadata.districtCode,
      parentId
    });
  }

  if (
    parentMetadata?.provinceCode &&
    input.metadata.provinceCode &&
    parentMetadata.provinceCode !== input.metadata.provinceCode
  ) {
    pushIssue(input.issues, {
      code: "HIERARCHY_CODE_MISMATCH",
      message: `Turkey V2 ADM3 zone '${input.zone.id}' provinceCode does not match parent '${parent?.id}'.`,
      dataset: input.dataset,
      zone: input.zone,
      path: `${input.path}.properties.territory.provinceCode`,
      field: "provinceCode",
      expected: parentMetadata.provinceCode,
      actual: input.metadata.provinceCode,
      parentId
    });
  }

  if (
    parentMetadata?.districtCode &&
    input.metadata.districtCode &&
    parentMetadata.districtCode !== input.metadata.districtCode
  ) {
    pushIssue(input.issues, {
      code: "HIERARCHY_CODE_MISMATCH",
      message: `Turkey V2 ADM3 zone '${input.zone.id}' districtCode does not match parent '${parent?.id}'.`,
      dataset: input.dataset,
      zone: input.zone,
      path: `${input.path}.properties.territory.districtCode`,
      field: "districtCode",
      expected: parentMetadata.districtCode,
      actual: input.metadata.districtCode,
      parentId
    });
  }
}

function validateStatuses(input: {
  dataset: TerritoryDataset;
  zone: TerritoryZone;
  metadata: TurkeyV2ZoneMetadata;
  path: string;
  issues: TerritoryValidationIssue[];
}): void {
  if (
    input.metadata.coverageStatus !== undefined &&
    !TERRITORY_COVERAGE_STATUSES.includes(
      input.metadata.coverageStatus as (typeof TERRITORY_COVERAGE_STATUSES)[number]
    )
  ) {
    pushIssue(input.issues, {
      code: "INVALID_COVERAGE_STATUS",
      message: `Turkey V2 ADM3 zone '${input.zone.id}' has invalid coverageStatus.`,
      dataset: input.dataset,
      zone: input.zone,
      path: `${input.path}.properties.territory.coverageStatus`,
      field: "coverageStatus",
      expected: [...TERRITORY_COVERAGE_STATUSES],
      actual: input.metadata.coverageStatus,
      parentId: input.metadata.parentId
    });
  }

  if (
    input.metadata.semanticReviewStatus !== undefined &&
    !TERRITORY_SEMANTIC_REVIEW_STATUSES.includes(
      input.metadata.semanticReviewStatus as (typeof TERRITORY_SEMANTIC_REVIEW_STATUSES)[number]
    )
  ) {
    pushIssue(input.issues, {
      code: "INVALID_SEMANTIC_REVIEW_STATUS",
      message: `Turkey V2 ADM3 zone '${input.zone.id}' has invalid semanticReviewStatus.`,
      dataset: input.dataset,
      zone: input.zone,
      path: `${input.path}.properties.territory.semanticReviewStatus`,
      field: "semanticReviewStatus",
      expected: [...TERRITORY_SEMANTIC_REVIEW_STATUSES],
      actual: input.metadata.semanticReviewStatus,
      parentId: input.metadata.parentId
    });
  }
}

function validateSourceFlags(input: {
  dataset: TerritoryDataset;
  zone: TerritoryZone;
  metadata: TurkeyV2ZoneMetadata;
  sourceClass: TerritorySourceClass;
  path: string;
  issues: TerritoryValidationIssue[];
}): void {
  const expectedFlags = expectedFlagsForSourceClass(input.sourceClass);

  if (
    input.metadata.official !== expectedFlags.official ||
    input.metadata.generated !== expectedFlags.generated
  ) {
    pushIssue(input.issues, {
      code: "SOURCE_FLAG_CONFLICT",
      message: `Turkey V2 ADM3 zone '${input.zone.id}' has sourceClass/official/generated flag conflict.`,
      dataset: input.dataset,
      zone: input.zone,
      path: `${input.path}.properties.territory`,
      field: "sourceClass,official,generated",
      expected: expectedFlags,
      actual: {
        sourceClass: input.sourceClass,
        official: input.metadata.official,
        generated: input.metadata.generated
      },
      parentId: input.metadata.parentId
    });
  }
}

function validateSourceClassContract(input: {
  dataset: TerritoryDataset;
  zone: TerritoryZone;
  metadata: TurkeyV2ZoneMetadata;
  sourceClass: TerritorySourceClass;
  path: string;
  issues: TerritoryValidationIssue[];
}): void {
  if (input.sourceClass === "generated") {
    if (!input.metadata.algorithmVersion) {
      pushIssue(input.issues, {
        code: "MISSING_GENERATOR_VERSION",
        message: `Turkey V2 generated ADM3 zone '${input.zone.id}' must carry algorithmVersion.`,
        dataset: input.dataset,
        zone: input.zone,
        path: `${input.path}.properties.territory.algorithmVersion`,
        field: "algorithmVersion",
        expected: "deterministic generator algorithm version",
        actual: input.metadata.algorithmVersion,
        parentId: input.metadata.parentId
      });
    }

    if (input.metadata.semanticType !== "generated-zone") {
      pushIssue(input.issues, {
        code: "INVALID_GENERATED_SEMANTIC_TYPE",
        message: `Turkey V2 generated ADM3 zone '${input.zone.id}' must use semanticType generated-zone.`,
        dataset: input.dataset,
        zone: input.zone,
        path: `${input.path}.properties.territory.semanticType`,
        field: "semanticType",
        expected: "generated-zone",
        actual: input.metadata.semanticType,
        parentId: input.metadata.parentId
      });
    }

    if (
      input.metadata.localType === "neighbourhood" ||
      input.metadata.localType === "village" ||
      input.metadata.localTypeName === "Mahalle" ||
      input.metadata.localTypeName === "Köy"
    ) {
      pushIssue(input.issues, {
        code: "INVALID_GENERATED_SEMANTIC_TYPE",
        message: `Turkey V2 generated ADM3 zone '${input.zone.id}' must not be presented as a mahalle or village.`,
        dataset: input.dataset,
        zone: input.zone,
        path: `${input.path}.properties.territory.localTypeName`,
        field: "localTypeName",
        expected: "generated-zone",
        actual: input.metadata.localTypeName ?? input.metadata.localType,
        parentId: input.metadata.parentId
      });
    }

    return;
  }

  if (input.metadata.semanticType === "generated-zone") {
    pushIssue(input.issues, {
      code: "INVALID_GENERATED_SEMANTIC_TYPE",
      message: `Turkey V2 real ADM3 zone '${input.zone.id}' must not use generated-zone semanticType.`,
      dataset: input.dataset,
      zone: input.zone,
      path: `${input.path}.properties.territory.semanticType`,
      field: "semanticType",
      expected: "neighbourhood or village",
      actual: input.metadata.semanticType,
      parentId: input.metadata.parentId
    });
  }

  if (!hasRequiredRealSourceProvenance(input.metadata)) {
    pushIssue(input.issues, {
      code: "MISSING_SOURCE_PROVENANCE",
      message: `Turkey V2 ${input.sourceClass} ADM3 zone '${input.zone.id}' must carry provider, verifiable source reference, license, and attribution.`,
      dataset: input.dataset,
      zone: input.zone,
      path: `${input.path}.properties.territory.source`,
      field: "source",
      expected:
        "provider plus sourceUrl/sourceDatasetId/sourceId/sourceNativeId, license, attribution",
      actual: {
        sourceProvider: input.metadata.sourceProvider,
        sourceUrl: input.metadata.sourceUrl,
        sourceDatasetId: input.metadata.sourceDatasetId,
        sourceId: input.metadata.sourceId,
        sourceNativeId: input.metadata.sourceNativeId,
        license: input.metadata.license,
        attribution: input.metadata.attribution
      },
      parentId: input.metadata.parentId
    });
  }
}

function readTurkeyV2ZoneMetadata(zone: TerritoryZone): TurkeyV2ZoneMetadata {
  const territory = isRecord(zone.properties.territory) ? zone.properties.territory : {};
  const source = isRecord(territory.source) ? territory.source : {};
  const generatedZone = isRecord(territory.generatedZone) ? territory.generatedZone : {};
  const adm3 = isRecord(territory.adm3) ? territory.adm3 : {};

  return {
    sourceClass: readString(territory.sourceClass) ?? readString(source.sourceClass),
    sourceProvider:
      readString(territory.sourceProvider) ??
      readString(source.provider) ??
      readString(territory.providerId),
    sourceDatasetId: readString(territory.sourceDatasetId) ?? readString(source.sourceDatasetId),
    sourceNativeId:
      readString(territory.sourceNativeId) ??
      readString(source.sourceNativeId) ??
      readString(source.sourceId),
    sourceId: readString(territory.sourceId) ?? readString(source.sourceId),
    sourceDate: readString(territory.sourceDate) ?? readString(source.sourceDate),
    sourceUrl: readString(territory.sourceUrl) ?? readString(source.sourceUrl),
    license: readString(territory.license) ?? readString(source.license),
    attribution: readString(territory.attribution) ?? readString(source.attribution),
    official: readBoolean(territory.official),
    generated: readBoolean(territory.generated),
    algorithmVersion:
      readString(territory.algorithmVersion) ?? readString(generatedZone.algorithmVersion),
    generationSeed:
      readString(territory.generationSeed) ??
      readString(generatedZone.generationSeed) ??
      readString(generatedZone.seed),
    semanticType: readString(territory.semanticType) ?? zone.semanticType,
    localType: readString(territory.localType),
    localTypeName: readString(territory.localTypeName),
    countryCode: readString(territory.countryCode) ?? zone.countryCode,
    provinceCode: readString(territory.provinceCode) ?? readString(adm3.provinceCode),
    districtCode: readString(territory.districtCode) ?? readString(adm3.districtCode),
    sourceAdminLevel: readString(territory.sourceAdminLevel) ?? zone.sourceAdminLevel,
    hierarchyDepth: readInteger(territory.hierarchyDepth),
    parentId:
      readString(territory.parentId) ??
      zone.parentId ??
      readString(territory.parentAdm2Id) ??
      readString(source.parentId),
    coverageStatus: readString(territory.coverageStatus),
    semanticReviewStatus: readString(territory.semanticReviewStatus),
    stableId: readString(territory.stableId)
  };
}

function isAdm3Zone(zone: TerritoryZone): boolean {
  const metadata = isRecord(zone.properties.territory) ? zone.properties.territory : {};
  return zone.level === 3 || zone.sourceAdminLevel === "ADM3" || metadata.adminLevel === "ADM3";
}

function isAdm2Zone(zone: TerritoryZone): boolean {
  const metadata = isRecord(zone.properties.territory) ? zone.properties.territory : {};
  return zone.level === 2 || zone.sourceAdminLevel === "ADM2" || metadata.adminLevel === "ADM2";
}

function zoneAdminLevel(zone: TerritoryZone): string {
  const metadata = isRecord(zone.properties.territory) ? zone.properties.territory : {};
  return readString(metadata.adminLevel) ?? zone.sourceAdminLevel ?? `ADM${zone.level}`;
}

function hasRequiredRealSourceProvenance(metadata: TurkeyV2ZoneMetadata): boolean {
  return Boolean(
    metadata.sourceProvider &&
    (metadata.sourceUrl ||
      metadata.sourceDatasetId ||
      metadata.sourceId ||
      metadata.sourceNativeId) &&
    metadata.license &&
    metadata.attribution
  );
}

function expectedFlagsForSourceClass(sourceClass: TerritorySourceClass): {
  official: boolean;
  generated: boolean;
} {
  if (sourceClass === "official") {
    return { official: true, generated: false };
  }

  if (sourceClass === "generated") {
    return { official: false, generated: true };
  }

  return { official: false, generated: false };
}

function pushIssue(
  issues: TerritoryValidationIssue[],
  input: {
    code: TerritoryValidationCode;
    message: string;
    dataset: TerritoryDataset;
    zone: TerritoryZone;
    path: string;
    field: string;
    expected?: unknown;
    actual?: unknown;
    parentId?: string | undefined;
    severity?: TerritoryValidationSeverity;
  }
): void {
  issues.push({
    code: input.code,
    message: input.message,
    path: input.path,
    severity: input.severity ?? "error",
    datasetId: input.dataset.manifest.datasetId,
    zoneId: input.zone.id,
    featureId: input.zone.id,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    field: input.field,
    ...(input.expected !== undefined ? { expected: input.expected } : {}),
    ...(input.actual !== undefined ? { actual: input.actual } : {})
  });
}

function sortAndDedupeIssues(
  issues: readonly TerritoryValidationIssue[]
): TerritoryValidationIssue[] {
  const byKey = new Map<string, TerritoryValidationIssue>();

  for (const issue of issues) {
    const key = [
      issue.code,
      issue.path,
      issue.zoneId ?? "",
      issue.parentId ?? "",
      issue.field ?? "",
      issue.message
    ].join("\u0000");
    byKey.set(key, issue);
  }

  return [...byKey.values()].sort(
    (left, right) =>
      [
        left.path.localeCompare(right.path),
        left.code.localeCompare(right.code),
        (left.zoneId ?? "").localeCompare(right.zoneId ?? ""),
        left.message.localeCompare(right.message)
      ].find((comparison) => comparison !== 0) ?? 0
  );
}

function isTerritorySourceClass(input: unknown): input is TerritorySourceClass {
  return (
    typeof input === "string" && TERRITORY_SOURCE_CLASSES.includes(input as TerritorySourceClass)
  );
}

function readString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0 ? input : undefined;
}

function readBoolean(input: unknown): boolean | undefined {
  return typeof input === "boolean" ? input : undefined;
}

function readInteger(input: unknown): number | undefined {
  return typeof input === "number" && Number.isInteger(input) ? input : undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
