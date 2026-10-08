import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeTerritoryAreaM2 } from "../packages/dataset/dist/index.mjs";
import { createDatasetGeometryHash } from "../packages/generators/dist/turkey-adm3.mjs";

export const metadata = (zone) => zone.properties?.territory ?? {};
export const parentId = (zone) =>
  zone.parentId ?? metadata(zone).parentAdm2Id ?? metadata(zone).parentId;
const unique = (values) => [...new Set(values.filter((v) => v != null))].sort();

export const DEFAULT_PARENT_REGISTRY = "datasets/registry/tr-adm3-district-fallbacks.json";
export const CANONICAL_ADM1_HIERARCHY_REPORT = "reports/tr-v2-national/hierarchy-report.json";
const EXPECTED_ADM2_COUNT = 973;
const EXPECTED_ADM1_COUNT = 81;
/** Registry-only ADM1 ids follow the national hierarchy formula but are not polygon-verified. */
export const METADATA_LOOKUP_ADM1_IDENTITY_SCOPE = "METADATA_LOOKUP_REF";

export function adm1LookupRefFromProvinceCode(provinceCode) {
  return `tr:adm1:tr-${provinceCode}`;
}

/** @deprecated Use adm1LookupRefFromProvinceCode; name kept for importers. */
export const adm1IdFromProvinceCode = adm1LookupRefFromProvinceCode;

export function adm2ParentGeometryIsUsable(zone) {
  if (!zone?.geometry) return false;
  try {
    const area = computeTerritoryAreaM2(zone.geometry);
    return Number.isFinite(area) && area > 0;
  } catch {
    return false;
  }
}

export function parentInventoryHasUsableAdm2Geometries(dataset) {
  const districts = dataset?.zones?.filter((zone) => zone.level === 2) ?? [];
  return districts.length === EXPECTED_ADM2_COUNT && districts.every(adm2ParentGeometryIsUsable);
}

export function parentInventoryFromRegistry(registry) {
  if (
    registry?.districtCount !== EXPECTED_ADM2_COUNT ||
    registry?.districts?.length !== EXPECTED_ADM2_COUNT
  ) {
    throw new Error(
      `Registry parent inventory must contain exactly ${EXPECTED_ADM2_COUNT} districts.`
    );
  }
  const provinceByCode = new Map();
  const districts = registry.districts.map((entry) => {
    const provinceCode = entry.provinceCode;
    const parentId = adm1LookupRefFromProvinceCode(provinceCode);
    if (!provinceByCode.has(provinceCode)) {
      provinceByCode.set(provinceCode, {
        id: parentId,
        name: entry.provinceName,
        level: 1,
        geometry: null,
        properties: {
          territory: {
            provinceCode,
            identityScope: METADATA_LOOKUP_ADM1_IDENTITY_SCOPE,
            authoritativeProductionIdentity: false
          }
        }
      });
    }
    return {
      id: entry.districtId,
      name: entry.districtName,
      level: 2,
      parentId,
      geometry: null,
      properties: {
        territory: {
          provinceCode,
          parentAdm1LookupRef: parentId,
          parentAdm1IdentityScope: METADATA_LOOKUP_ADM1_IDENTITY_SCOPE
        }
      }
    };
  });
  if (new Set(districts.map((district) => district.id)).size !== EXPECTED_ADM2_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_ADM2_COUNT} distinct registry ADM2 parents.`);
  }
  if (provinceByCode.size !== EXPECTED_ADM1_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_ADM1_COUNT} distinct registry ADM1 parents.`);
  }
  return {
    parents: { zones: districts },
    provinces: {
      zones: [...provinceByCode.values()].sort((a, b) =>
        a.properties.territory.provinceCode.localeCompare(b.properties.territory.provinceCode)
      )
    },
    parentInventorySource: "METADATA_REGISTRY_ONLY",
    parentGeometryAvailable: false,
    parentAdm1IdentityScope: METADATA_LOOKUP_ADM1_IDENTITY_SCOPE
  };
}

function assertCanonicalAdm2Parents(dataset) {
  const districts = dataset?.zones?.filter((zone) => zone.level === 2) ?? [];
  if (
    districts.length !== EXPECTED_ADM2_COUNT ||
    new Set(districts.map((zone) => zone.id)).size !== EXPECTED_ADM2_COUNT
  ) {
    throw new Error(`Expected exactly ${EXPECTED_ADM2_COUNT} distinct canonical ADM2 parents.`);
  }
  return districts;
}

export async function resolveCanonicalParentInventory({
  artifactRoot,
  parentDataset,
  parentRegistry = DEFAULT_PARENT_REGISTRY,
  checksums = null
} = {}) {
  const resolvedChecksums =
    checksums ?? (await jsonIfAvailable(path.join(artifactRoot, "checksums.json")));
  const attempts = [];
  const polygonCandidates = [
    {
      label: "ARTIFACT_ADM2_BYTES",
      datasetPath: path.join(artifactRoot, "levels/ADM2/dataset.json"),
      provincePath: path.join(artifactRoot, "levels/ADM1/dataset.json"),
      checksum: resolvedChecksums?.files?.["levels/ADM2/dataset.json"]
    },
    {
      label: "CONFIGURED_PARENT_DATASET",
      datasetPath: parentDataset,
      provincePath: null,
      checksum: null
    }
  ];
  for (const candidate of polygonCandidates) {
    const fileEvidence = await inspectFile(candidate.datasetPath, candidate.checksum);
    attempts.push({ ...candidate, fileEvidence });
    if (fileEvidence.status === "CHECKSUM_MISMATCH") continue;
    const dataset = await jsonIfAvailable(candidate.datasetPath);
    if (!dataset) continue;
    try {
      assertCanonicalAdm2Parents(dataset);
    } catch {
      continue;
    }
    if (!parentInventoryHasUsableAdm2Geometries(dataset)) continue;
    const provinceDataset =
      (candidate.provincePath ? await jsonIfAvailable(candidate.provincePath) : null) ?? dataset;
    const provinces = provinceDataset?.zones?.filter((zone) => zone.level === 1) ?? [];
    if (provinces.length !== EXPECTED_ADM1_COUNT) continue;
    return {
      parents: dataset,
      provinces: provinceDataset,
      parentInventorySource: candidate.label,
      parentGeometryAvailable: true,
      parentAdm1IdentityScope: "CANONICAL_POLYGON_BYTES",
      parentFileEvidence: fileEvidence,
      parentResolutionAttempts: attempts
    };
  }
  const registry = await jsonIfAvailable(parentRegistry);
  if (!registry) {
    throw new Error("Canonical ADM1/ADM2 parent inventory is unavailable.");
  }
  return {
    ...parentInventoryFromRegistry(registry),
    parentFileEvidence: null,
    parentResolutionAttempts: attempts
  };
}

export async function inspectFile(filePath, expected) {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    const sha256 = hash.digest("hex");
    const byteSize = (await stat(filePath)).size;
    return {
      path: filePath,
      sha256,
      byteSize,
      status: expected
        ? sha256 === expected.sha256 && byteSize === expected.byteSize
          ? "LOCKED_BYTES_VERIFIED"
          : "CHECKSUM_MISMATCH"
        : "BYTES_AVAILABLE_UNPINNED"
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { path: filePath, sha256: null, byteSize: null, status: "ARTIFACT_NOT_AVAILABLE" };
  }
}

async function jsonIfAvailable(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

/** Counts and areas come exclusively from available canonical polygon bytes. */
export function districtRow({ district, province, zones, available, smart, artifactPath }) {
  const grouped = { official: [], osm: [], generated: [], unknown: [] };
  for (const zone of zones) {
    const sourceClass = metadata(zone).sourceClass;
    const key = sourceClass === "osm-administrative" ? "osm" : sourceClass;
    (grouped[key] ?? grouped.unknown).push(zone);
  }
  const parentArea = district.geometry != null ? computeTerritoryAreaM2(district.geometry) : null;
  const percent = (items) =>
    parentArea != null && parentArea > 0
      ? (items.reduce((sum, z) => sum + computeTerritoryAreaM2(z.geometry), 0) / parentArea) * 100
      : null;
  const source = zones.map(metadata);
  return {
    provinceCode:
      metadata(district).provinceCode ??
      metadata(province).provinceCode ??
      metadata(province).codes?.official?.match(/^TR-(\d{2})$/)?.[1] ??
      null,
    provinceName: province?.name ?? null,
    adm2Id: district.id,
    districtName: district.name,
    parentAreaM2: parentArea,
    officialFeatureCount: available ? grouped.official.length : null,
    osmAdministrativeFeatureCount: available ? grouped.osm.length : null,
    generatedFeatureCount: available ? grouped.generated.length : null,
    officialAreaPercent: available ? percent(grouped.official) : null,
    osmAreaPercent: available ? percent(grouped.osm) : null,
    estimatedAreaPercent: available ? percent(grouped.generated) : null,
    sourceProviderIds: available
      ? unique(source.map((t) => t.providerId ?? t.source?.provider))
      : [],
    sourceVersion: available ? unique(source.map((t) => t.sourceVersion)) : [],
    sourceSnapshotHash: available
      ? unique(source.map((t) => t.sourceSnapshotChecksum ?? t.source?.sourceSnapshotChecksum))
      : [],
    geometryHash: available ? createDatasetGeometryHash({ zones }) : null,
    licenseStatus: available ? unique(source.map((t) => t.licenseState)) : [],
    redistributionStatus: available ? unique(source.map((t) => t.redistributionPolicy)) : [],
    sourceQAStatus: available
      ? "IMPORTED_METADATA_ONLY_SEE_SOURCE_FIDELITY"
      : "ARTIFACT_NOT_AVAILABLE",
    effectiveGeometryQAStatus: available
      ? smart
        ? "RECORDED_BUILD_QA_NOT_RERUN"
        : "QUALITY_NOT_AVAILABLE"
      : "ARTIFACT_NOT_AVAILABLE",
    confidence: available ? (smart?.confidence ?? null) : null,
    acceptanceStatus: available ? (smart?.smartAcceptanceStatus ?? "NOT_EVALUATED") : "UNAVAILABLE",
    availableArtifactPath: available ? artifactPath : null,
    reasonCode: available
      ? grouped.unknown.length
        ? "UNCLASSIFIED_SOURCE_CLASS"
        : grouped.generated.length
          ? "ESTIMATED_GAMEPLAY_BOUNDARIES"
          : "REAL_SOURCE_BYTES_AVAILABLE"
      : "ARTIFACT_NOT_AVAILABLE",
    evidenceStatus: available
      ? "CANONICAL_BYTES_MEASURED_LOCAL_CANDIDATE"
      : "ARTIFACT_NOT_AVAILABLE",
    unknownSourceFeatureCount: available ? grouped.unknown.length : null,
    recordedReasonCodes: available ? (smart?.reasonCodes ?? []) : [],
    hostedOrMobileEvidenceStatus: "NOT_OBSERVED"
  };
}

export async function generateCoverage({
  artifactRoot = ".territory/sprint-6/final/candidate",
  parentDataset = "datasets/generated/countries/TR/dataset.json",
  parentRegistry = DEFAULT_PARENT_REGISTRY,
  output = "reports/tr-adm3/audit"
} = {}) {
  const artifactPath = path.join(artifactRoot, "levels/ADM3/dataset.json");
  const checksums = await jsonIfAvailable(path.join(artifactRoot, "checksums.json"));
  const fileEvidence = await inspectFile(
    artifactPath,
    checksums?.files?.["levels/ADM3/dataset.json"]
  );
  const dataset = await jsonIfAvailable(artifactPath);
  const {
    parents,
    provinces,
    parentInventorySource,
    parentGeometryAvailable,
    parentAdm1IdentityScope,
    parentFileEvidence,
    parentResolutionAttempts
  } = await resolveCanonicalParentInventory({
    artifactRoot,
    parentDataset,
    parentRegistry,
    checksums
  });
  const districts = assertCanonicalAdm2Parents(parents);
  const measuredGeometryHash = dataset ? createDatasetGeometryHash(dataset) : null;
  const available =
    dataset != null &&
    fileEvidence.status !== "CHECKSUM_MISMATCH" &&
    measuredGeometryHash === dataset.manifest.geometryHash;
  const smartReport = await jsonIfAvailable(path.join(artifactRoot, "smart-coverage.json"));
  const sourceLock = await jsonIfAvailable(path.join(artifactRoot, "source-lock.json"));
  const smartCompatible = sourceLock && smartReport?.sourceLockHash === sourceLock.contentHash;
  const smart = new Map((smartCompatible ? smartReport.districts : []).map((d) => [d.adm2Id, d]));
  const byParent = new Map();
  for (const zone of dataset?.zones ?? []) {
    const id = parentId(zone);
    const list = byParent.get(id) ?? [];
    list.push(zone);
    byParent.set(id, list);
  }
  const knownParents = new Set(districts.map((d) => d.id));
  const orphanIds = (dataset?.zones ?? [])
    .filter((z) => !knownParents.has(parentId(z)))
    .map((z) => z.id);
  const rows = districts
    .map((district) =>
      districtRow({
        district,
        province: provinces.zones.find((p) => p.id === district.parentId),
        zones: byParent.get(district.id) ?? [],
        available,
        smart: smart.get(district.id),
        artifactPath
      })
    )
    .sort(
      (a, b) => a.provinceCode.localeCompare(b.provinceCode) || a.adm2Id.localeCompare(b.adm2Id)
    );
  const report = {
    schemaVersion: "territorykit-tr-adm3-source-quality-audit@1",
    inspectedCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    datasetVersion: dataset?.manifest.datasetVersion ?? null,
    sourceLockHash: sourceLock?.contentHash ?? null,
    geometryHash: measuredGeometryHash,
    declaredGeometryHash: dataset?.manifest.geometryHash ?? null,
    manifestContentHash: dataset
      ? createHash("sha256").update(JSON.stringify(dataset.manifest)).digest("hex")
      : null,
    manifestContentHashMethod: "sha256(JSON.stringify(parsed ADM3 manifest)); not a delivery hash",
    fileEvidence,
    parentInventorySource,
    parentGeometryAvailable,
    parentAdm1IdentityScope,
    parentFileEvidence,
    parentResolutionAttempts,
    orphanIds,
    evidenceScope: "LOCAL_RELEASE_CANDIDATE; hosted and mobile selection unobserved",
    areaMethod:
      "Sum of effective spherical polygon areas / canonical parent area; not union coverage. Overlap QA is separate.",
    metadataCaveat:
      "Official sourceSnapshotHash may be a per-geometry hash; exact upstream download hashes are in artifact-evidence.json.",
    recordedQualityEvidence: smartCompatible
      ? path.join(artifactRoot, "smart-coverage.json")
      : null,
    totals: available
      ? Object.fromEntries(
          [
            "officialFeatureCount",
            "osmAdministrativeFeatureCount",
            "generatedFeatureCount",
            "unknownSourceFeatureCount"
          ].map((key) => [key, rows.reduce((sum, row) => sum + row[key], 0)])
        )
      : null,
    measuredAreaPercent:
      available && parentGeometryAvailable
        ? Object.fromEntries(
            ["officialAreaPercent", "osmAreaPercent", "estimatedAreaPercent"].map((key) => [
              key,
              rows.reduce((sum, row) => sum + row[key] * row.parentAreaM2, 0) /
                rows.reduce((sum, row) => sum + row.parentAreaM2, 0)
            ])
          )
        : null,
    districts: rows
  };
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "adm3-district-coverage.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  let markdown =
    "# ADM3 district coverage\n\nLocal candidate polygon measurements; no hosted/mobile claim. Areas are effective area sums, not union coverage. QA/confidence are recorded build diagnostics. Missing or mismatched bytes produce null measurements.\n\n";
  for (const code of unique(rows.map((r) => r.provinceCode))) {
    const cohort = rows.filter((r) => r.provinceCode === code);
    markdown += `## ${code} ${cohort[0].provinceName}\n\n| District | Official | OSM administrative | Generated | Official area % | Estimated area % | Confidence | Evidence |\n| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |\n`;
    for (const row of cohort) {
      const fmt = (v) => (v == null ? "null" : typeof v === "number" ? Number(v.toFixed(6)) : v);
      markdown += `| ${row.districtName} | ${fmt(row.officialFeatureCount)} | ${fmt(row.osmAdministrativeFeatureCount)} | ${fmt(row.generatedFeatureCount)} | ${fmt(row.officialAreaPercent)} | ${fmt(row.estimatedAreaPercent)} | ${row.confidence ?? "unknown"} | ${row.evidenceStatus} |\n`;
    }
    markdown += "\n";
  }
  await writeFile(path.join(output, "adm3-district-coverage.md"), markdown);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const allowed = new Set(["--artifact-root", "--parent-dataset", "--parent-registry", "--output"]);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--"))
      throw new Error(
        "Usage: node scripts/tr-adm3-quality-source-audit.mjs [--artifact-root PATH] [--parent-dataset PATH] [--parent-registry PATH] [--output PATH]"
      );
    const key = {
      "--artifact-root": "artifactRoot",
      "--parent-dataset": "parentDataset",
      "--parent-registry": "parentRegistry",
      "--output": "output"
    }[args[i]];
    options[key] = args[i + 1];
  }
  const result = await generateCoverage(options);
  console.log(
    JSON.stringify({
      districts: result.districts.length,
      totals: result.totals,
      fileEvidence: result.fileEvidence
    })
  );
}
