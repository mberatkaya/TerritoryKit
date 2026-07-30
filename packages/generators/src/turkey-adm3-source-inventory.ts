import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { TerritoryCountryBuildIssue } from "./countries/types.js";
import { isRecord, serializeJsonStable, sha256Hex } from "./sources/utils.js";

export const TURKEY_ADM3_SOURCE_INVENTORY_SCHEMA_VERSION =
  "territorykit-tr-adm3-source-inventory@1";
export const TURKEY_ADM3_SOURCE_INVENTORY_LOCK_SCHEMA_VERSION =
  "territorykit-tr-adm3-source-inventory-lock@1";

export const TURKEY_ADM3_SOURCE_INVENTORY_STATUSES = [
  "approved",
  "candidate",
  "license-unclear",
  "geometry-unavailable",
  "attribute-only",
  "inaccessible",
  "incompatible-administrative-model",
  "outdated"
] as const;

export type TurkeyAdm3SourceInventoryStatus =
  (typeof TURKEY_ADM3_SOURCE_INVENTORY_STATUSES)[number];

export interface TurkeyAdm3SourceInventory {
  schemaVersion: typeof TURKEY_ADM3_SOURCE_INVENTORY_SCHEMA_VERSION;
  country: "TR";
  generatedAt: string;
  reviewedAt: string;
  reviewedBy: string;
  nationalCoverageClaim: false;
  methodology?: {
    batches?: readonly string[];
    sourcePriority?: readonly string[];
    notes?: readonly string[];
  };
  provinces: readonly TurkeyAdm3SourceInventoryProvince[];
}

export interface TurkeyAdm3SourceInventoryProvince {
  provinceCode: string;
  provinceName: string;
  region: string;
  status: TurkeyAdm3SourceInventoryStatus;
  productionEligible: boolean;
  reviewedAt: string;
  reviewedBy: string;
  blockerCategory?: string;
  blockerReason?: string;
  coverage?: {
    adm3GeometryAvailable: boolean;
    provinceWide: boolean;
    featureCount?: number;
    builtFeatureCount?: number;
    fallbackLevel?: "ADM2";
  };
  sources?: readonly TurkeyAdm3SourceInventorySource[];
  notes?: readonly string[];
}

export interface TurkeyAdm3SourceInventorySource {
  sourceId: string;
  providerName: string;
  officialInstitution: string;
  sourceUrl: string;
  downloadUrl?: string;
  format?: string;
  license?: string;
  licenseUrl?: string;
  sourceDate?: string;
  updatedAt?: string;
  featureCount?: number;
  districtParentField?: string;
  neighbourhoodNameField?: string;
  stableSourceIdField?: string;
  crs?: string;
  checksumSha256?: string;
  byteSize?: number;
  catalogEntry?: boolean;
  productionEligible: boolean;
  reviewStatus: TurkeyAdm3SourceInventoryStatus;
  reviewedAt: string;
  reviewedBy: string;
  knownQualityProblems?: readonly string[];
  evidence?: readonly string[];
}

export interface TurkeyAdm3SourceInventoryCoverageSummary {
  totalProvinceCount: number;
  approvedProvinceCount: number;
  candidateProvinceCount: number;
  blockedProvinceCount: number;
  nationalCoverageClaim: false;
  builtProvinceCount: number;
  metadataOnlyProvinceCount: number;
  statusCounts: Record<TurkeyAdm3SourceInventoryStatus, number>;
  regionCounts: Record<
    string,
    {
      total: number;
      approved: number;
      candidate: number;
      blocked: number;
    }
  >;
}

export interface TurkeyAdm3SourceInventoryLock {
  schemaVersion: typeof TURKEY_ADM3_SOURCE_INVENTORY_LOCK_SCHEMA_VERSION;
  country: "TR";
  inventoryHash: string;
  generatedAt: string;
  provinces: Array<{
    provinceCode: string;
    status: TurkeyAdm3SourceInventoryStatus;
    productionEligible: boolean;
    sourceIds: string[];
  }>;
  summary: TurkeyAdm3SourceInventoryCoverageSummary;
}

export type TurkeyAdm3SourceInventoryArtifactResolver = (
  source: TurkeyAdm3SourceInventorySource
) => Promise<{
  sha256: string;
  sizeBytes: number;
}>;

const EXPECTED_PROVINCE_CODES = new Set(
  Array.from({ length: 81 }, (_, index) => String(index + 1).padStart(2, "0"))
);
const STATUS_SET = new Set<string>(TURKEY_ADM3_SOURCE_INVENTORY_STATUSES);

export async function readTurkeyAdm3SourceInventory(options: {
  inventoryPath: string;
  cwd?: string;
}): Promise<TurkeyAdm3SourceInventory> {
  const input = JSON.parse(
    await readFile(resolve(options.cwd ?? process.cwd(), options.inventoryPath), "utf8")
  ) as unknown;
  const result = validateTurkeyAdm3SourceInventory(input);

  if (!result.ok || !result.inventory) {
    throw new Error(
      `Turkey ADM3 source inventory is invalid: ${result.issues
        .map((issue) => issue.message)
        .join("; ")}`
    );
  }

  return result.inventory;
}

export function validateTurkeyAdm3SourceInventory(input: unknown): {
  ok: boolean;
  inventory?: TurkeyAdm3SourceInventory;
  issues: TerritoryCountryBuildIssue[];
} {
  const issues: TerritoryCountryBuildIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [createIssue("TR_ADM3_INVENTORY_INVALID", "Inventory must be an object.")]
    };
  }

  if (input.schemaVersion !== TURKEY_ADM3_SOURCE_INVENTORY_SCHEMA_VERSION) {
    issues.push(
      createIssue(
        "TR_ADM3_INVENTORY_SCHEMA_VERSION",
        `Inventory schemaVersion must be ${TURKEY_ADM3_SOURCE_INVENTORY_SCHEMA_VERSION}.`
      )
    );
  }

  if (input.country !== "TR") {
    issues.push(createIssue("TR_ADM3_INVENTORY_COUNTRY", "Inventory country must be TR."));
  }

  if (input.nationalCoverageClaim !== false) {
    issues.push(
      createIssue(
        "TR_ADM3_INVENTORY_NATIONAL_CLAIM",
        "Turkey ADM3 inventory must not claim nationwide coverage unless all 81 provinces are approved."
      )
    );
  }

  if (!Array.isArray(input.provinces)) {
    issues.push(createIssue("TR_ADM3_INVENTORY_PROVINCES", "Inventory requires provinces array."));
  } else {
    issues.push(...validateProvinceMatrix(input.provinces));
  }

  const ok = issues.every((issue) => issue.severity !== "error");

  return {
    ok,
    ...(ok ? { inventory: input as unknown as TurkeyAdm3SourceInventory } : {}),
    issues: issues.sort(compareIssues)
  };
}

export function createTurkeyAdm3SourceInventoryCoverageSummary(
  inventory: TurkeyAdm3SourceInventory
): TurkeyAdm3SourceInventoryCoverageSummary {
  const statusCounts = Object.fromEntries(
    TURKEY_ADM3_SOURCE_INVENTORY_STATUSES.map((status) => [status, 0])
  ) as Record<TurkeyAdm3SourceInventoryStatus, number>;
  const regionCounts: TurkeyAdm3SourceInventoryCoverageSummary["regionCounts"] = {};
  let builtProvinceCount = 0;
  let metadataOnlyProvinceCount = 0;

  for (const province of inventory.provinces) {
    statusCounts[province.status] += 1;
    const region = (regionCounts[province.region] ??= {
      total: 0,
      approved: 0,
      candidate: 0,
      blocked: 0
    });
    region.total += 1;

    if (province.status === "approved") {
      region.approved += 1;
    } else if (province.status === "candidate") {
      region.candidate += 1;
    } else {
      region.blocked += 1;
    }

    if ((province.coverage?.builtFeatureCount ?? 0) > 0) {
      builtProvinceCount += 1;
    } else if ((province.sources?.length ?? 0) > 0) {
      metadataOnlyProvinceCount += 1;
    }
  }

  const approvedProvinceCount = statusCounts.approved;
  const candidateProvinceCount = statusCounts.candidate;

  return {
    totalProvinceCount: inventory.provinces.length,
    approvedProvinceCount,
    candidateProvinceCount,
    blockedProvinceCount:
      inventory.provinces.length - approvedProvinceCount - candidateProvinceCount,
    nationalCoverageClaim: false,
    builtProvinceCount,
    metadataOnlyProvinceCount,
    statusCounts,
    regionCounts: Object.fromEntries(
      Object.entries(regionCounts).sort(([left], [right]) => left.localeCompare(right))
    )
  };
}

export function createTurkeyAdm3SourceInventoryLock(
  inventory: TurkeyAdm3SourceInventory
): TurkeyAdm3SourceInventoryLock {
  return {
    schemaVersion: TURKEY_ADM3_SOURCE_INVENTORY_LOCK_SCHEMA_VERSION,
    country: "TR",
    inventoryHash: sha256Hex(serializeJsonStable(inventory)),
    generatedAt: inventory.generatedAt,
    provinces: inventory.provinces
      .map((province) => ({
        provinceCode: province.provinceCode,
        status: province.status,
        productionEligible: province.productionEligible,
        sourceIds: (province.sources ?? []).map((source) => source.sourceId).sort()
      }))
      .sort((left, right) => left.provinceCode.localeCompare(right.provinceCode)),
    summary: createTurkeyAdm3SourceInventoryCoverageSummary(inventory)
  };
}

export async function verifyTurkeyAdm3SourceInventoryArtifacts(
  inventory: TurkeyAdm3SourceInventory,
  resolveArtifact: TurkeyAdm3SourceInventoryArtifactResolver
): Promise<TerritoryCountryBuildIssue[]> {
  const issues: TerritoryCountryBuildIssue[] = [];

  for (const province of inventory.provinces) {
    for (const source of province.sources ?? []) {
      if (!source.checksumSha256 && source.byteSize === undefined) {
        continue;
      }

      try {
        const artifact = await resolveArtifact(source);

        if (source.checksumSha256 && artifact.sha256 !== source.checksumSha256) {
          issues.push(
            createIssue(
              "TR_ADM3_INVENTORY_CHECKSUM_MISMATCH",
              `Inventory source ${source.sourceId} checksum mismatch.`,
              {
                details: {
                  provinceCode: province.provinceCode,
                  expected: source.checksumSha256,
                  actual: artifact.sha256
                }
              }
            )
          );
        }

        if (source.byteSize !== undefined && artifact.sizeBytes !== source.byteSize) {
          issues.push(
            createIssue(
              "TR_ADM3_INVENTORY_BYTE_SIZE_MISMATCH",
              `Inventory source ${source.sourceId} byte size mismatch.`,
              {
                details: {
                  provinceCode: province.provinceCode,
                  expected: source.byteSize,
                  actual: artifact.sizeBytes
                }
              }
            )
          );
        }
      } catch (error) {
        issues.push(
          createIssue(
            "TR_ADM3_INVENTORY_ARTIFACT_UNAVAILABLE",
            `Inventory source ${source.sourceId} could not be resolved: ${
              error instanceof Error ? error.message : String(error)
            }`,
            {
              severity: "warning",
              details: { provinceCode: province.provinceCode }
            }
          )
        );
      }
    }
  }

  return issues.sort(compareIssues);
}

function validateProvinceMatrix(input: unknown[]): TerritoryCountryBuildIssue[] {
  const issues: TerritoryCountryBuildIssue[] = [];
  const provinceCodes = new Set<string>();
  const sourceIds = new Map<string, string>();
  const downloadUrls = new Map<string, string>();

  for (const [index, province] of input.entries()) {
    if (!isRecord(province)) {
      issues.push(
        createIssue("TR_ADM3_INVENTORY_PROVINCE_INVALID", `Province at index ${index} is invalid.`)
      );
      continue;
    }

    const provinceCode = readString(province.provinceCode);
    if (!provinceCode || !EXPECTED_PROVINCE_CODES.has(provinceCode)) {
      issues.push(
        createIssue(
          "TR_ADM3_INVENTORY_PROVINCE_CODE",
          `Inventory province at index ${index} has invalid province code.`
        )
      );
      continue;
    }

    if (provinceCodes.has(provinceCode)) {
      issues.push(
        createIssue(
          "TR_ADM3_INVENTORY_DUPLICATE_PROVINCE",
          `Inventory has duplicate province ${provinceCode}.`
        )
      );
    }
    provinceCodes.add(provinceCode);

    const status = readString(province.status);
    if (!status || !STATUS_SET.has(status)) {
      issues.push(
        createIssue(
          "TR_ADM3_INVENTORY_STATUS",
          `Province ${provinceCode} has unsupported source status.`
        )
      );
    }

    const productionEligible = province.productionEligible === true;
    if (status !== "approved" && productionEligible) {
      issues.push(
        createIssue(
          "TR_ADM3_INVENTORY_PRODUCTION_ELIGIBILITY",
          `Province ${provinceCode} cannot be production eligible unless status is approved.`
        )
      );
    }

    if (status === "approved" && !productionEligible) {
      issues.push(
        createIssue(
          "TR_ADM3_INVENTORY_APPROVED_NOT_ELIGIBLE",
          `Province ${provinceCode} is approved but productionEligible is false.`
        )
      );
    }

    const sources = Array.isArray(province.sources) ? province.sources : [];
    if ((status === "approved" || productionEligible) && sources.length === 0) {
      issues.push(
        createIssue(
          "TR_ADM3_INVENTORY_APPROVED_SOURCE_MISSING",
          `Province ${provinceCode} approval requires at least one source.`
        )
      );
    }

    for (const source of sources) {
      issues.push(
        ...validateSource(source, {
          provinceCode,
          productionEligible,
          sourceIds,
          downloadUrls
        })
      );
    }
  }

  for (const provinceCode of EXPECTED_PROVINCE_CODES) {
    if (!provinceCodes.has(provinceCode)) {
      issues.push(
        createIssue(
          "TR_ADM3_INVENTORY_MISSING_PROVINCE",
          `Inventory is missing province ${provinceCode}.`
        )
      );
    }
  }

  if (provinceCodes.size !== EXPECTED_PROVINCE_CODES.size) {
    issues.push(
      createIssue(
        "TR_ADM3_INVENTORY_PROVINCE_COUNT",
        `Inventory must contain exactly ${EXPECTED_PROVINCE_CODES.size} provinces.`
      )
    );
  }

  return issues;
}

function validateSource(
  source: unknown,
  options: {
    provinceCode: string;
    productionEligible: boolean;
    sourceIds: Map<string, string>;
    downloadUrls: Map<string, string>;
  }
): TerritoryCountryBuildIssue[] {
  const issues: TerritoryCountryBuildIssue[] = [];

  if (!isRecord(source)) {
    return [
      createIssue(
        "TR_ADM3_INVENTORY_SOURCE_INVALID",
        `Province ${options.provinceCode} source entry is invalid.`
      )
    ];
  }

  const sourceId = readString(source.sourceId);
  if (!sourceId) {
    issues.push(
      createIssue(
        "TR_ADM3_INVENTORY_SOURCE_ID",
        `Province ${options.provinceCode} source is missing sourceId.`
      )
    );
  } else {
    const existingProvince = options.sourceIds.get(sourceId);
    if (existingProvince) {
      issues.push(
        createIssue(
          "TR_ADM3_INVENTORY_DUPLICATE_SOURCE",
          `Source ${sourceId} is listed for both ${existingProvince} and ${options.provinceCode}.`
        )
      );
    }
    options.sourceIds.set(sourceId, options.provinceCode);
  }

  const downloadUrl = readString(source.downloadUrl);
  if (downloadUrl) {
    const existingProvince = options.downloadUrls.get(downloadUrl);
    if (existingProvince) {
      issues.push(
        createIssue(
          "TR_ADM3_INVENTORY_DUPLICATE_SOURCE_URL",
          `Download URL for source ${sourceId ?? "unknown"} is listed for both ${existingProvince} and ${options.provinceCode}.`
        )
      );
    }
    options.downloadUrls.set(downloadUrl, options.provinceCode);
  }

  if (source.productionEligible === true && source.reviewStatus !== "approved") {
    issues.push(
      createIssue(
        "TR_ADM3_INVENTORY_SOURCE_PRODUCTION_STATUS",
        `Source ${sourceId ?? "unknown"} cannot be production eligible unless reviewStatus is approved.`
      )
    );
  }

  if (options.productionEligible || source.productionEligible === true) {
    for (const field of [
      "providerName",
      "officialInstitution",
      "sourceUrl",
      "downloadUrl",
      "format",
      "license",
      "licenseUrl",
      "sourceDate",
      "featureCount",
      "districtParentField",
      "neighbourhoodNameField",
      "stableSourceIdField",
      "crs",
      "checksumSha256",
      "byteSize"
    ]) {
      if (source[field] === undefined || source[field] === null || source[field] === "") {
        issues.push(
          createIssue(
            "TR_ADM3_INVENTORY_APPROVED_METADATA_MISSING",
            `Approved source ${sourceId ?? "unknown"} is missing ${field}.`
          )
        );
      }
    }

    if (source.catalogEntry !== true) {
      issues.push(
        createIssue(
          "TR_ADM3_INVENTORY_APPROVED_CATALOG_ENTRY",
          `Approved source ${sourceId ?? "unknown"} must be represented in the production catalog.`
        )
      );
    }
  }

  return issues;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function createIssue(
  code: string,
  message: string,
  options: {
    severity?: TerritoryCountryBuildIssue["severity"];
    details?: Record<string, unknown>;
  } = {}
): TerritoryCountryBuildIssue {
  return {
    code,
    severity: options.severity ?? "error",
    message,
    ...(options.details ? { details: options.details } : {})
  };
}

function compareIssues(
  left: TerritoryCountryBuildIssue,
  right: TerritoryCountryBuildIssue
): number {
  return `${left.severity}:${left.code}:${left.message}`.localeCompare(
    `${right.severity}:${right.code}:${right.message}`
  );
}
