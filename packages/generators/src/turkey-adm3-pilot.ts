import { readFile, stat, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  createTerritoryRenderFeatureCollection,
  computeGeometryBBox,
  validateGeometryDataset,
  validateTerritoryDataset
} from "@territory-kit/dataset";
import type {
  GeometryQualityChecks,
  GeometryQualityReport,
  LngLat,
  TerritoryAdminLevel,
  TerritoryDataset,
  TerritoryGeometry,
  TerritoryValidationResult,
  TerritoryZone
} from "@territory-kit/dataset";
import { buildTerritoryAdjacency } from "./adjacency.js";
import {
  computeGeometryRepresentativePoint,
  repairTerritoryGeometries
} from "./geometry-repair.js";
import type { TerritoryGeometryRepairReport } from "./geometry-repair.js";
import { buildTerritoryRenderArtifacts } from "./render-artifacts.js";
import {
  createDatasetGeometryHash,
  serializeJsonStable,
  sha256Hex,
  sortJson
} from "./sources/utils.js";
import { validateOfficialOpenDataSourceManifest } from "./sources/open-data-manifest.js";
import type {
  TerritoryOfficialOpenDataSourceManifest,
  TerritoryOfficialOpenDataSourceManifestValidationResult
} from "./sources/open-data-manifest.js";

export const TURKEY_GAZIANTEP_ADM3_DATASET_ID = "territory-kit-tr-adm3-gaziantep-pilot";
export const TURKEY_GAZIANTEP_ADM3_DATASET_VERSION = "2026.02.18";
export const TURKEY_GAZIANTEP_ADM3_BUILD_DATE = "2026-07-18T00:00:00.000Z";
export const TURKEY_GAZIANTEP_ADM3_SOURCE_DATE = "2026-02-18T13:52:03Z";
export const TURKEY_GAZIANTEP_ADM3_RETRIEVED_AT = "2026-07-18T00:00:00.000Z";
export const TURKEY_GAZIANTEP_ADM3_SOURCE_SHA256 =
  "f145ae9edd2db7a341634e14d59060a535258461794d361c3f49bdec2bcbfa9a";
export const TURKEY_GAZIANTEP_ADM3_SOURCE_SIZE_BYTES = 7_439_237;
export const TURKEY_GAZIANTEP_ADM3_SOURCE_URL =
  "https://ulasav.csb.gov.tr/dataset/27-mahalle-sinir-alanlari";
export const TURKEY_GAZIANTEP_ADM3_DOWNLOAD_URL =
  "https://acikveri.gaziantep.bel.tr/dataset/5fac9bc5-8cc0-4883-8805-1f71149319db/resource/df82c9ce-f69d-4cc2-bf57-d4a36ed1c144/download/mahalle_sinirlari-1.kml";
export const TURKEY_GAZIANTEP_ADM3_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
export const TURKEY_GAZIANTEP_ADM3_ATTRIBUTION =
  "Gaziantep Büyükşehir Belediyesi, Mahalle Sınır Alanları, CC BY 4.0";
const TURKEY_GAZIANTEP_ADM3_GEOMETRY_CHECKS: GeometryQualityChecks = {
  coordinates: true,
  rings: true,
  selfIntersections: false,
  holes: false,
  bbox: true,
  center: true,
  antimeridian: true,
  parentContainment: false,
  siblingOverlaps: false
};
const TURKEY_GAZIANTEP_ADM3_ADJACENCY_GEOMETRY_CHECKS: GeometryQualityChecks = {
  ...TURKEY_GAZIANTEP_ADM3_GEOMETRY_CHECKS,
  center: false
};

export interface TurkeyGaziantepAdm3ParentMapping {
  sourceDistrictId: string;
  districtName: string;
  territoryAdm2Id: string;
  provinceName: "Gaziantep";
  provinceCode: "TR-27";
  resolutionMethod: "reviewed-spatial-containment";
  featureCount: number;
}

export const TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS: readonly TurkeyGaziantepAdm3ParentMapping[] = [
  parentMapping(
    "{4F692FBF-DD8E-4C6D-93E4-D4C49CACC4C9}",
    "Araban",
    "tr:adm2:54988432b99023740963316",
    49
  ),
  parentMapping(
    "{460503BF-0C83-4365-AC2E-CA607C45B043}",
    "Karkamış",
    "tr:adm2:54988432b54960387029794",
    39
  ),
  parentMapping(
    "{48C8E95D-CD95-444A-8D02-722147A859A4}",
    "Yavuzeli",
    "tr:adm2:54988432b19771634656837",
    44
  ),
  parentMapping(
    "{622A6409-5CF2-4AFC-9BFF-09AD53B76AE5}",
    "İslahiye",
    "tr:adm2:54988432b41731057290221",
    71
  ),
  parentMapping(
    "{8F014A2B-53F9-4823-9FAE-E51D55B81A67}",
    "Şehitkamil",
    "tr:adm2:54988432b61004264745956",
    149
  ),
  parentMapping(
    "{43FA2512-DB22-41C0-A03E-0A2561941EE6}",
    "Nurdağı",
    "tr:adm2:54988432b85612149706662",
    48
  ),
  parentMapping(
    "{CCECD7A9-7F9F-421B-9DDC-33920592CE42}",
    "Şahinbey",
    "tr:adm2:54988432b26387222249237",
    183
  ),
  parentMapping(
    "{D34E09C3-2479-4A5D-A923-546908520744}",
    "Nizip",
    "tr:adm2:54988432b32789090404224",
    111
  ),
  parentMapping(
    "{E2A0D610-4A82-4138-941E-9E6C785BFA53}",
    "Oğuzeli",
    "tr:adm2:54988432b72028378604273",
    92
  )
].sort((left, right) => left.territoryAdm2Id.localeCompare(right.territoryAdm2Id));

export interface TurkeyGaziantepAdm3SourceFeature {
  sourceObjectId: string;
  neighbourhoodCode: string;
  neighbourhoodName: string;
  sourceDistrictId: string;
  geometry: TerritoryGeometry;
}

export interface TurkeyGaziantepAdm3BuildOptions {
  sourcePath?: string;
  outputPath?: string;
  adm0DatasetPath?: string;
  adm1DatasetPath?: string;
  adm2DatasetPath?: string;
  buildDate?: string;
  fetchSource?: boolean;
  dryRun?: boolean;
  approveUnexpectedSource?: boolean;
  repairPythonPath?: string;
}

export interface TurkeyGaziantepAdm3BuildResult {
  ok: boolean;
  outputPath: string;
  dryRun: boolean;
  sourceSha256: string;
  sourceSizeBytes: number;
  featureCount: number;
  coveredParentIds: string[];
  qualityReport: GeometryQualityReport;
  adjacencyStatistics: Record<string, unknown>;
  artifactSizes: Record<string, number>;
  issues: Array<{ code: string; severity: "error" | "warning"; message: string }>;
}

export function createTurkeyGaziantepAdm3SourceManifest(): TerritoryOfficialOpenDataSourceManifest {
  return {
    manifestVersion: "territory-source-manifest@1",
    provider: "official-open-data",
    countryCode: "TR",
    adminLevel: "ADM3",
    semanticType: "neighbourhood",
    localTypeName: "Mahalle",
    publisher: "Gaziantep Büyükşehir Belediyesi",
    datasetTitle: "Mahalle Sınır Alanları",
    sourceUrl: TURKEY_GAZIANTEP_ADM3_SOURCE_URL,
    downloadUrl: TURKEY_GAZIANTEP_ADM3_DOWNLOAD_URL,
    sourceDate: TURKEY_GAZIANTEP_ADM3_SOURCE_DATE,
    sourceVersion: TURKEY_GAZIANTEP_ADM3_SOURCE_DATE,
    retrievedAt: TURKEY_GAZIANTEP_ADM3_RETRIEVED_AT,
    license: "CC BY 4.0",
    attribution: TURKEY_GAZIANTEP_ADM3_ATTRIBUTION,
    redistributionStatus: "allowed",
    commercialUseStatus: "allowed",
    modificationStatus: "allowed",
    expectedSha256: TURKEY_GAZIANTEP_ADM3_SOURCE_SHA256,
    format: "KML"
  };
}

export function validateTurkeyGaziantepAdm3SourceManifest(
  input: unknown = createTurkeyGaziantepAdm3SourceManifest()
): TerritoryOfficialOpenDataSourceManifestValidationResult {
  return validateOfficialOpenDataSourceManifest(input, { strict: true });
}

export function parseTurkeyGaziantepAdm3Kml(kml: string): TurkeyGaziantepAdm3SourceFeature[] {
  const placemarks = [...kml.matchAll(/<Placemark\b[\s\S]*?<\/Placemark>/g)];

  return placemarks.map((match, index) => parsePlacemark(match[0], index));
}

export function createTurkeyGaziantepAdm3TerritoryId(input: {
  neighbourhoodCode: string;
  parentId: string;
}): string {
  const code = input.neighbourhoodCode.trim();

  if (!/^\d+$/.test(code)) {
    throw new Error(
      `Gaziantep ADM3 source feature has invalid KIMLIKNO '${input.neighbourhoodCode}'.`
    );
  }

  return `tr:adm3:27:${input.parentId.replace(/^tr:adm2:/, "")}:${code}`;
}

export async function buildTurkeyGaziantepAdm3Pilot(
  options: TurkeyGaziantepAdm3BuildOptions = {}
): Promise<TurkeyGaziantepAdm3BuildResult> {
  const root = resolve(process.cwd());
  const buildDate = options.buildDate ?? TURKEY_GAZIANTEP_ADM3_BUILD_DATE;
  const outputPath = resolve(
    options.outputPath ?? join(root, "datasets/generated/countries/TR/levels/ADM3")
  );
  const sourcePath = resolve(
    options.sourcePath ??
      join(root, ".territory/cache/tr-adm3-sources/gaziantep/mahalle_sinirlari.kml")
  );
  const issues: TurkeyGaziantepAdm3BuildResult["issues"] = [];
  const manifestValidation = validateTurkeyGaziantepAdm3SourceManifest();

  if (!manifestValidation.ok) {
    return {
      ok: false,
      outputPath,
      dryRun: options.dryRun ?? false,
      sourceSha256: "",
      sourceSizeBytes: 0,
      featureCount: 0,
      coveredParentIds: [],
      qualityReport: emptyQualityReport(),
      adjacencyStatistics: {},
      artifactSizes: {},
      issues: manifestValidation.issues.map((issue) => ({
        code: issue.code,
        severity: "error",
        message: issue.message
      }))
    };
  }

  if (options.fetchSource) {
    await fetchGaziantepAdm3Source(sourcePath);
  }

  const sourceBytes = await readFile(sourcePath);
  const sourceSha256 = sha256Hex(sourceBytes);
  const sourceSizeBytes = (await stat(sourcePath)).size;

  if (sourceSha256 !== TURKEY_GAZIANTEP_ADM3_SOURCE_SHA256 && !options.approveUnexpectedSource) {
    issues.push({
      code: "SOURCE_CHECKSUM_MISMATCH",
      severity: "error",
      message: `Expected ${TURKEY_GAZIANTEP_ADM3_SOURCE_SHA256}, received ${sourceSha256}.`
    });
  }

  const parsed = parseTurkeyGaziantepAdm3Kml(sourceBytes.toString("utf8"));
  const sourceSchemaReport = inspectParsedSource(parsed);
  const hierarchy = await readHierarchyContext({
    root,
    ...(options.adm0DatasetPath ? { adm0DatasetPath: options.adm0DatasetPath } : {}),
    ...(options.adm1DatasetPath ? { adm1DatasetPath: options.adm1DatasetPath } : {}),
    ...(options.adm2DatasetPath ? { adm2DatasetPath: options.adm2DatasetPath } : {})
  });
  const rawDataset = createPilotDataset({
    parsed,
    hierarchy,
    buildDate,
    sourceSha256,
    sourceSizeBytes
  });

  const repair = await repairPilotAdm3Geometries(rawDataset, {
    root,
    ...(options.repairPythonPath ? { pythonPath: options.repairPythonPath } : {})
  });

  if (repair.report.featuresRejected > 0) {
    issues.push({
      code: "GEOMETRY_REPAIR_REJECTED_FEATURES",
      severity: "error",
      message: `${repair.report.featuresRejected} Gaziantep ADM3 features could not be repaired into valid polygon geometry.`
    });
  }

  const repairedDataset = finalizePilotDataset(repair.dataset);
  const adm3OnlyDataset = pickAdm3Dataset(repairedDataset);
  const adjacency = await buildTerritoryAdjacency(adm3OnlyDataset, {
    buildDate,
    includePointTouches: true,
    qualityChecks: TURKEY_GAZIANTEP_ADM3_ADJACENCY_GEOMETRY_CHECKS,
    sameAdminLevelOnly: true,
    sameParentOnly: false,
    minimumSharedBoundaryMeters: 0.001
  });
  const datasetWithNeighbors = addSharedBorderNeighbors(repairedDataset, adjacency.artifact.edges);
  const finalized = finalizePilotDataset(datasetWithNeighbors);
  const adm3OnlyFinalized = pickAdm3Dataset(finalized);
  const validation = validateTerritoryDataset(finalized);

  if (!validation.ok) {
    for (const issue of validation.issues) {
      issues.push({
        code: issue.code,
        severity: issue.severity,
        message: issue.message
      });
    }
  }

  const qualityReport = validateGeometryDataset(finalized, {
    checks: TURKEY_GAZIANTEP_ADM3_GEOMETRY_CHECKS,
    strict: true
  });

  if (!qualityReport.ok) {
    for (const issue of qualityReport.issues.filter((issue) => issue.severity === "error")) {
      issues.push({
        code: issue.code,
        severity: "error",
        message: issue.message
      });
    }
  }

  const buildOk = issues.every((issue) => issue.severity !== "error");
  const coverage = createCoverageReport(finalized);
  const hierarchyReport = createHierarchyReport(parsed);
  const sourceLock = createSourceLock({ sourceSha256, sourceSizeBytes });
  const sourceEvaluation = createSourceEvaluationRecord();
  const renderArtifacts = buildTerritoryRenderArtifacts({
    dataset: adm3OnlyFinalized,
    format: "mvt",
    layerId: "territory_adm3",
    minZoom: 12,
    maxZoom: 12,
    buildDate
  });
  const files = new Map<string, string | Uint8Array>([
    ["dataset.json", serializeJsonStable(finalized)],
    ["index.json", serializeJsonStable(createSpatialIndex(finalized))],
    [
      "validation-report.json",
      serializeJsonStable(createDatasetValidationReport(validation, qualityReport))
    ],
    ["manifest.json", serializeJsonStable(createPilotManifest(finalized))],
    ["full.geojson", serializeJsonStable(createTerritoryRenderFeatureCollection(finalized))],
    ["medium.geojson", serializeJsonStable(createTerritoryRenderFeatureCollection(finalized))],
    ["low.geojson", serializeJsonStable(createTerritoryRenderFeatureCollection(finalized))],
    ["source-metadata.json", serializeJsonStable(createTurkeyGaziantepAdm3SourceManifest())],
    ["sources.lock.json", serializeJsonStable(sourceLock)],
    ["source-evaluation.json", serializeJsonStable(sourceEvaluation)],
    ["source-schema-report.json", serializeJsonStable(sourceSchemaReport)],
    ["coverage.json", serializeJsonStable(coverage)],
    ["hierarchy-report.json", serializeJsonStable(hierarchyReport)],
    ["identity-map.json", serializeJsonStable(createIdentityMap(finalized))],
    ["quality-report.json", serializeJsonStable(qualityReport)],
    ["repair-report.json", serializeJsonStable(createRepairReport(buildDate, repair.report))],
    ["rejection-report.json", serializeJsonStable(createRejectionReport(buildDate, repair.report))],
    ["adjacency/adjacency.json", serializeJsonStable(adjacency.artifact)],
    [
      "adjacency/build-report.json",
      serializeJsonStable({
        generatedAt: buildDate,
        issues: adjacency.issues,
        statistics: adjacency.statistics
      })
    ],
    [
      "attribution.json",
      serializeJsonStable({
        provider: "Gaziantep Büyükşehir Belediyesi",
        text: TURKEY_GAZIANTEP_ADM3_ATTRIBUTION,
        license: "CC BY 4.0",
        licenseUrl: TURKEY_GAZIANTEP_ADM3_LICENSE_URL,
        sourceUrl: TURKEY_GAZIANTEP_ADM3_SOURCE_URL
      })
    ],
    ["attribution.txt", `${TURKEY_GAZIANTEP_ADM3_ATTRIBUTION}\n`]
  ]);

  for (const [path, content] of renderArtifacts.files) {
    files.set(path, content);
  }

  const checksums = createChecksums(files);
  files.set("checksums.json", serializeJsonStable(checksums));

  const artifactSizes = Object.fromEntries(
    [...files.entries()]
      .map(
        ([path, content]) =>
          [
            path,
            typeof content === "string" ? Buffer.byteLength(content) : content.byteLength
          ] as const
      )
      .sort(([left], [right]) => left.localeCompare(right))
  );

  if (!options.dryRun && buildOk) {
    await writePilotFiles(outputPath, files);
  }

  return {
    ok: buildOk,
    outputPath,
    dryRun: options.dryRun ?? false,
    sourceSha256,
    sourceSizeBytes,
    featureCount: parsed.length,
    coveredParentIds: [
      ...new Set(TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS.map((mapping) => mapping.territoryAdm2Id))
    ].sort(),
    qualityReport,
    adjacencyStatistics: adjacency.statistics as unknown as Record<string, unknown>,
    artifactSizes,
    issues
  };
}

function parentMapping(
  sourceDistrictId: string,
  districtName: string,
  territoryAdm2Id: string,
  featureCount: number
): TurkeyGaziantepAdm3ParentMapping {
  return {
    sourceDistrictId,
    districtName,
    territoryAdm2Id,
    provinceName: "Gaziantep",
    provinceCode: "TR-27",
    resolutionMethod: "reviewed-spatial-containment",
    featureCount
  };
}

function parsePlacemark(placemark: string, index: number): TurkeyGaziantepAdm3SourceFeature {
  const description =
    placemark.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] ?? "";
  const sourceObjectId =
    placemark.match(/<Placemark[^>]*\bid="([^"]+)"/)?.[1] ?? `placemark-${index}`;
  const neighbourhoodName = readDescriptionTableValue(description, "AD");
  const neighbourhoodCode = readDescriptionTableValue(description, "KIMLIKNO");
  const sourceDistrictId = readDescriptionTableValue(description, "ILCEID");

  if (!neighbourhoodName || !neighbourhoodCode || !sourceDistrictId) {
    throw new Error(
      `Gaziantep KML placemark ${sourceObjectId} is missing AD, KIMLIKNO, or ILCEID.`
    );
  }

  return {
    sourceObjectId,
    neighbourhoodName,
    neighbourhoodCode,
    sourceDistrictId,
    geometry: parsePlacemarkGeometry(placemark)
  };
}

function parsePlacemarkGeometry(placemark: string): TerritoryGeometry {
  const polygons = [...placemark.matchAll(/<Polygon\b[\s\S]*?<\/Polygon>/g)].map((match) => {
    const polygon = match[0];
    const outer = polygon.match(
      /<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/outerBoundaryIs>/
    )?.[1];
    const holes = [
      ...polygon.matchAll(
        /<innerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/innerBoundaryIs>/g
      )
    ]
      .map((hole) => parseCoordinateRing(hole[1] ?? ""))
      .filter((ring) => ring.length > 0);
    const outerRing = parseCoordinateRing(outer ?? "");

    if (outerRing.length === 0) {
      throw new Error("Gaziantep KML polygon is missing an outer coordinate ring.");
    }

    return [outerRing, ...holes];
  });

  if (polygons.length === 0) {
    throw new Error("Gaziantep KML placemark is missing polygon geometry.");
  }

  if (polygons.length === 1) {
    return { type: "Polygon", coordinates: polygons[0] as LngLat[][] };
  }

  return { type: "MultiPolygon", coordinates: polygons as LngLat[][][] };
}

function parseCoordinateRing(input: string): LngLat[] {
  const ring = input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tuple): LngLat => {
      const parts = tuple.split(",");
      const lng = Number(parts[0]);
      const lat = Number(parts[1]);

      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        throw new Error(`Invalid KML coordinate tuple '${tuple}'.`);
      }

      return [lng, lat];
    });
  const first = ring[0];
  const last = ring.at(-1);

  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0], first[1]]);
  }

  return ring;
}

function readDescriptionTableValue(description: string, key: string): string {
  const match = description.match(new RegExp(`<td>${key}<\\/td>\\s*<td>(.*?)<\\/td>`, "s"));
  return decodeHtml(match?.[1] ?? "").trim();
}

function decodeHtml(input: string): string {
  return input
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

async function fetchGaziantepAdm3Source(sourcePath: string): Promise<void> {
  if (!globalThis.fetch) {
    throw new Error("Global fetch is required to download the Gaziantep ADM3 source.");
  }

  const response = await globalThis.fetch(TURKEY_GAZIANTEP_ADM3_DOWNLOAD_URL);

  if (!response.ok) {
    throw new Error(
      `Failed to download Gaziantep ADM3 source: ${response.status} ${response.statusText}`
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, bytes);
}

async function readHierarchyContext(input: {
  root: string;
  adm0DatasetPath?: string;
  adm1DatasetPath?: string;
  adm2DatasetPath?: string;
}): Promise<{ adm0: TerritoryZone; adm1: TerritoryZone; adm2ById: Map<string, TerritoryZone> }> {
  const adm0 = await readDataset(
    input.adm0DatasetPath ??
      join(input.root, "datasets/generated/countries/TR/levels/ADM0/dataset.json")
  );
  const adm1 = await readDataset(
    input.adm1DatasetPath ??
      join(input.root, "datasets/generated/countries/TR/levels/ADM1/dataset.json")
  );
  const adm2 = await readDataset(
    input.adm2DatasetPath ??
      join(input.root, "datasets/generated/countries/TR/levels/ADM2/dataset.json")
  );
  const country = adm0.zones.find((zone) => zone.id === "tr");
  const province = adm1.zones.find((zone) => zone.id === "tr:adm1:tr-27");
  const adm2ById = new Map(adm2.zones.map((zone) => [zone.id, zone]));

  if (!country || !province) {
    throw new Error("Turkey ADM0 or Gaziantep ADM1 hierarchy context is missing.");
  }

  for (const mapping of TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS) {
    if (!adm2ById.has(mapping.territoryAdm2Id)) {
      throw new Error(`Turkey ADM2 hierarchy context is missing ${mapping.territoryAdm2Id}.`);
    }
  }

  return { adm0: country, adm1: province, adm2ById };
}

async function readDataset(path: string): Promise<TerritoryDataset> {
  return JSON.parse(await readFile(path, "utf8")) as TerritoryDataset;
}

function createPilotDataset(input: {
  parsed: TurkeyGaziantepAdm3SourceFeature[];
  hierarchy: { adm0: TerritoryZone; adm1: TerritoryZone; adm2ById: Map<string, TerritoryZone> };
  buildDate: string;
  sourceSha256: string;
  sourceSizeBytes: number;
}): TerritoryDataset {
  assertUniqueCodes(input.parsed);
  const mappingsBySourceDistrictId = new Map(
    TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS.map((mapping) => [mapping.sourceDistrictId, mapping])
  );
  const childrenByParentId = new Map<string, string[]>();
  const adm3Zones = input.parsed
    .map((feature) => {
      const mapping = mappingsBySourceDistrictId.get(feature.sourceDistrictId);

      if (!mapping) {
        throw new Error(
          `No reviewed Gaziantep ADM3 parent mapping for source district ${feature.sourceDistrictId}.`
        );
      }

      const id = createTurkeyGaziantepAdm3TerritoryId({
        neighbourhoodCode: feature.neighbourhoodCode,
        parentId: mapping.territoryAdm2Id
      });
      const zone = createNeighbourhoodZone(feature, mapping, id, input.buildDate);
      const children = childrenByParentId.get(mapping.territoryAdm2Id) ?? [];
      children.push(zone.id);
      childrenByParentId.set(mapping.territoryAdm2Id, children);
      return zone;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const coveredParentIds = TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS.map(
    (mapping) => mapping.territoryAdm2Id
  ).sort();
  const contextZones = [
    copyHierarchyZone(input.hierarchy.adm0, {
      sourceAdminLevel: "ADM0",
      semanticType: "country",
      childIds: ["tr:adm1:tr-27"]
    }),
    copyHierarchyZone(input.hierarchy.adm1, {
      sourceAdminLevel: "ADM1",
      semanticType: "province",
      parentId: "tr",
      childIds: coveredParentIds
    }),
    ...coveredParentIds.map((parentId) => {
      const source = input.hierarchy.adm2ById.get(parentId);

      if (!source) {
        throw new Error(`Missing hierarchy source zone ${parentId}.`);
      }

      return copyHierarchyZone(source, {
        sourceAdminLevel: "ADM2",
        semanticType: "district",
        parentId: "tr:adm1:tr-27",
        childIds: (childrenByParentId.get(parentId) ?? []).sort()
      });
    })
  ];

  return finalizePilotDataset({
    manifest: {
      datasetId: TURKEY_GAZIANTEP_ADM3_DATASET_ID,
      datasetVersion: TURKEY_GAZIANTEP_ADM3_DATASET_VERSION,
      schemaVersion: "territory-schema@1",
      sourceDate: TURKEY_GAZIANTEP_ADM3_SOURCE_DATE,
      geometryHash: "pending",
      adminLevels: ["ADM0", "ADM1", "ADM2", "ADM3"],
      artifactChecksum: "pending",
      attribution: `${TURKEY_GAZIANTEP_ADM3_ATTRIBUTION}; ADM0-ADM2 hierarchy context from existing TerritoryKit Turkey artifacts.`,
      boundaryPolicy:
        "Gaziantep ADM3 source boundaries with existing TerritoryKit ADM0-ADM2 hierarchy context.",
      buildDate: input.buildDate,
      countryCodes: ["TR"],
      crs: "EPSG:4326",
      disputedAreaPolicy: "source-disputed-boundaries-not-authoritative",
      geometryDetail: "source",
      license: "CC BY 4.0",
      name: "Turkey Gaziantep ADM3 Neighbourhood Pilot",
      description:
        "Official Gaziantep neighbourhood boundary pilot. Coverage is partial and limited to the nine Gaziantep ADM2 districts.",
      sourceProvider: "Gaziantep Büyükşehir Belediyesi",
      worldview: "source"
    },
    zones: [...contextZones, ...adm3Zones]
  });
}

function createNeighbourhoodZone(
  feature: TurkeyGaziantepAdm3SourceFeature,
  mapping: TurkeyGaziantepAdm3ParentMapping,
  id: string,
  buildDate: string
): TerritoryZone {
  const territory = {
    adminLevel: "ADM3",
    sourceAdminLevel: "ADM3",
    semanticType: "neighbourhood",
    localType: "neighbourhood",
    localTypeName: "Mahalle",
    hierarchyDepth: 3,
    parentId: mapping.territoryAdm2Id,
    sourceParentId: mapping.sourceDistrictId,
    semanticReviewStatus: "reviewed",
    coverageStatus: "partial",
    codes: {
      official: feature.neighbourhoodCode,
      source: feature.neighbourhoodCode
    },
    names: {
      default: feature.neighbourhoodName,
      tr: feature.neighbourhoodName
    },
    source: {
      provider: "Gaziantep Büyükşehir Belediyesi",
      sourceId: feature.neighbourhoodCode,
      sourceUrl: TURKEY_GAZIANTEP_ADM3_SOURCE_URL,
      sourceDate: TURKEY_GAZIANTEP_ADM3_SOURCE_DATE,
      importedAt: buildDate,
      license: "CC BY 4.0",
      attribution: TURKEY_GAZIANTEP_ADM3_ATTRIBUTION
    }
  };

  return {
    id,
    datasetId: TURKEY_GAZIANTEP_ADM3_DATASET_ID,
    countryCode: "TR",
    level: 3,
    sourceAdminLevel: "ADM3",
    semanticType: "neighbourhood",
    name: feature.neighbourhoodName,
    localName: feature.neighbourhoodName,
    parentId: mapping.territoryAdm2Id,
    neighborIds: [],
    geometry: feature.geometry,
    center: computeGeometryRepresentativePoint(feature.geometry),
    bbox: computeGeometryBBox(feature.geometry),
    properties: {
      name: feature.neighbourhoodName,
      districtName: mapping.districtName,
      provinceName: mapping.provinceName,
      sourceObjectId: feature.sourceObjectId,
      sourceDistrictId: mapping.sourceDistrictId,
      territory
    }
  };
}

async function repairPilotAdm3Geometries(
  dataset: TerritoryDataset,
  options: { root: string; pythonPath?: string }
): Promise<{ dataset: TerritoryDataset; report: TerritoryGeometryRepairReport }> {
  const adm3Features = dataset.zones
    .filter((zone) => zone.sourceAdminLevel === "ADM3")
    .map((zone) => ({ id: zone.id, geometry: zone.geometry }));
  const report = await repairTerritoryGeometries(adm3Features, {
    engine: "auto",
    cwd: options.root,
    precision: 6,
    ...(options.pythonPath ? { pythonPath: options.pythonPath } : {})
  });
  const resultsById = new Map(report.results.map((result) => [result.id, result]));

  return {
    report,
    dataset: {
      ...dataset,
      zones: dataset.zones.map((zone) => {
        if (zone.sourceAdminLevel !== "ADM3") {
          return zone;
        }

        const result = resultsById.get(zone.id);

        if (!result?.geometry) {
          return zone;
        }

        return {
          ...zone,
          geometry: result.geometry,
          bbox: result.bbox ?? computeGeometryBBox(result.geometry),
          center: result.center ?? computeGeometryRepresentativePoint(result.geometry)
        };
      })
    }
  };
}

function pickAdm3Dataset(dataset: TerritoryDataset): TerritoryDataset {
  return {
    ...dataset,
    zones: dataset.zones.filter((zone) => zone.sourceAdminLevel === "ADM3")
  };
}

function copyHierarchyZone(
  source: TerritoryZone,
  overrides: {
    sourceAdminLevel: TerritoryAdminLevel;
    semanticType: "country" | "province" | "district";
    parentId?: string;
    childIds: string[];
  }
): TerritoryZone {
  const territory = {
    ...(source.properties.territory && typeof source.properties.territory === "object"
      ? (source.properties.territory as Record<string, unknown>)
      : {}),
    adminLevel: overrides.sourceAdminLevel,
    sourceAdminLevel: overrides.sourceAdminLevel,
    semanticType: overrides.semanticType,
    hierarchyDepth: Number(overrides.sourceAdminLevel.slice(3)),
    ...(overrides.parentId ? { parentId: overrides.parentId } : {}),
    semanticReviewStatus: "reviewed",
    coverageStatus: overrides.sourceAdminLevel === "ADM3" ? "partial" : "verified"
  };

  return {
    ...source,
    datasetId: TURKEY_GAZIANTEP_ADM3_DATASET_ID,
    sourceAdminLevel: overrides.sourceAdminLevel,
    semanticType: overrides.semanticType,
    ...(overrides.parentId ? { parentId: overrides.parentId } : {}),
    childIds: overrides.childIds,
    neighborIds: [],
    properties: {
      ...source.properties,
      territory
    }
  };
}

function finalizePilotDataset(dataset: TerritoryDataset): TerritoryDataset {
  const geometryHash = createDatasetGeometryHash(dataset);
  const zones = dataset.zones
    .map((zone) => ({
      ...zone,
      neighborIds: [...zone.neighborIds].sort(),
      ...(zone.childIds ? { childIds: [...zone.childIds].sort() } : {})
    }))
    .sort((left, right) => left.level - right.level || left.id.localeCompare(right.id));

  return {
    manifest: {
      ...dataset.manifest,
      geometryHash,
      artifactChecksum: sha256Hex(serializeJsonStable(zones))
    },
    zones
  };
}

function addSharedBorderNeighbors(
  dataset: TerritoryDataset,
  edges: Array<{ from: string; to: string; type: string }>
): TerritoryDataset {
  const neighbors = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (edge.type !== "shared-border") {
      continue;
    }

    const left = neighbors.get(edge.from) ?? new Set<string>();
    const right = neighbors.get(edge.to) ?? new Set<string>();
    left.add(edge.to);
    right.add(edge.from);
    neighbors.set(edge.from, left);
    neighbors.set(edge.to, right);
  }

  return {
    ...dataset,
    zones: dataset.zones.map((zone) =>
      zone.sourceAdminLevel === "ADM3"
        ? { ...zone, neighborIds: [...(neighbors.get(zone.id) ?? [])].sort() }
        : zone
    )
  };
}

function assertUniqueCodes(features: TurkeyGaziantepAdm3SourceFeature[]): void {
  const seen = new Map<string, string>();

  for (const feature of features) {
    const existing = seen.get(feature.neighbourhoodCode);

    if (existing) {
      throw new Error(
        `Duplicate Gaziantep ADM3 KIMLIKNO '${feature.neighbourhoodCode}' in ${existing} and ${feature.sourceObjectId}.`
      );
    }

    seen.set(feature.neighbourhoodCode, feature.sourceObjectId);
  }
}

function inspectParsedSource(
  features: TurkeyGaziantepAdm3SourceFeature[]
): Record<string, unknown> {
  const districtIds = new Set(features.map((feature) => feature.sourceDistrictId));
  const duplicateNames = new Map<string, number>();

  for (const feature of features) {
    duplicateNames.set(
      feature.neighbourhoodName,
      (duplicateNames.get(feature.neighbourhoodName) ?? 0) + 1
    );
  }

  return {
    schemaVersion: "territorykit-tr-adm3-source-schema-report@1",
    generatedAt: TURKEY_GAZIANTEP_ADM3_BUILD_DATE,
    geometryType: "Polygon/MultiPolygon from KML Polygon/MultiGeometry",
    coordinateReferenceSystem: "EPSG:4326",
    encoding: "UTF-8",
    featureCount: features.length,
    duplicateFeatureCodes: 0,
    duplicateNeighbourhoodNames: [...duplicateNames.entries()]
      .filter(([, count]) => count > 1)
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    nullGeometries: 0,
    sourceProperties: {
      nameProperty: "description table AD",
      idProperty: "description table KIMLIKNO",
      parentIdProperty: "description table ILCEID",
      sourceObjectIdProperty: "Placemark @id",
      provinceName: "Gaziantep"
    },
    sourceDistrictIdCount: districtIds.size,
    sourceDistrictIds: [...districtIds].sort()
  };
}

function createHierarchyReport(
  features: TurkeyGaziantepAdm3SourceFeature[]
): Record<string, unknown> {
  const countsByDistrict = new Map<string, number>();

  for (const feature of features) {
    countsByDistrict.set(
      feature.sourceDistrictId,
      (countsByDistrict.get(feature.sourceDistrictId) ?? 0) + 1
    );
  }

  const mappedCount = TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS.reduce(
    (sum, mapping) => sum + (countsByDistrict.get(mapping.sourceDistrictId) ?? 0),
    0
  );

  return {
    schemaVersion: "territorykit-hierarchy-report@1",
    generatedAt: TURKEY_GAZIANTEP_ADM3_BUILD_DATE,
    totalAdm3Features: features.length,
    explicitCodeMatches: 0,
    sourceIdMatches: mappedCount,
    reviewedMappingMatches: mappedCount,
    reviewedExactNameMatches: 0,
    spatialContainmentMatches: 0,
    manualOverrideMatches: 0,
    zeroParentMatches: features.length - mappedCount,
    multipleParentMatches: 0,
    crossProvinceMismatches: 0,
    parentMappings: TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS
  };
}

function createCoverageReport(dataset: TerritoryDataset): Record<string, unknown> {
  const adm3Zones = dataset.zones.filter((zone) => zone.sourceAdminLevel === "ADM3");
  const coveredParents = [
    ...new Set(adm3Zones.flatMap((zone) => (zone.parentId ? [zone.parentId] : [])))
  ].sort();

  return {
    schemaVersion: "territorykit-partial-coverage@1",
    country: "TR",
    level: "ADM3",
    semanticType: "neighbourhood",
    localTypeName: "Mahalle",
    status: "partial",
    scopeType: "complete-selected-parents",
    scopeDescription:
      "All Gaziantep province neighbourhood polygons published in the selected source.",
    coveredProvince: "tr:adm1:tr-27",
    coveredParents,
    missingParents:
      "All Turkey ADM2 parent IDs outside Gaziantep are intentionally not covered by this pilot.",
    featureCount: adm3Zones.length,
    sourceProvider: "Gaziantep Büyükşehir Belediyesi",
    sourceVersion: TURKEY_GAZIANTEP_ADM3_SOURCE_DATE,
    licence: "CC BY 4.0",
    semanticReviewStatus: "reviewed"
  };
}

function createIdentityMap(dataset: TerritoryDataset): Record<string, unknown> {
  return {
    schemaVersion: "territorykit-identity-map@1",
    generatedAt: TURKEY_GAZIANTEP_ADM3_BUILD_DATE,
    ids: dataset.zones
      .filter((zone) => zone.sourceAdminLevel === "ADM3")
      .map((zone) => ({
        territoryId: zone.id,
        sourceId:
          zone.properties.territory && typeof zone.properties.territory === "object"
            ? (zone.properties.territory as { codes?: { official?: string } }).codes?.official
            : undefined,
        parentId: zone.parentId,
        name: zone.name
      }))
      .sort((left, right) => left.territoryId.localeCompare(right.territoryId))
  };
}

function createPilotManifest(dataset: TerritoryDataset): Record<string, unknown> {
  const adm3Zones = dataset.zones.filter((zone) => zone.sourceAdminLevel === "ADM3");

  return {
    manifestVersion: "territorykit-country-artifact@1",
    datasetId: dataset.manifest.datasetId,
    datasetVersion: dataset.manifest.datasetVersion,
    schemaVersion: dataset.manifest.schemaVersion,
    country: { alpha2: "TR", alpha3: "TUR", name: "Turkey" },
    supportedLevels: dataset.manifest.adminLevels,
    featureCountByLevel: countByLevel(dataset.zones),
    adm3FeatureCount: adm3Zones.length,
    coverageStatus: "partial",
    coveredParents: [
      ...new Set(adm3Zones.flatMap((zone) => (zone.parentId ? [zone.parentId] : [])))
    ].sort(),
    sourceProvider: dataset.manifest.sourceProvider,
    sourceDate: dataset.manifest.sourceDate,
    license: dataset.manifest.license,
    attribution: dataset.manifest.attribution,
    publishReady: true
  };
}

function createSpatialIndex(dataset: TerritoryDataset): Record<string, unknown> {
  return {
    indexVersion: "1",
    algorithm: "bbox-linear",
    datasetId: dataset.manifest.datasetId,
    datasetVersion: dataset.manifest.datasetVersion,
    geometryHash: dataset.manifest.geometryHash,
    entries: dataset.zones.map((zone) => ({
      id: zone.id,
      countryCode: zone.countryCode,
      level: zone.level,
      sourceAdminLevel: zone.sourceAdminLevel,
      parentId: zone.parentId,
      bbox: zone.bbox,
      center: zone.center
    }))
  };
}

function createDatasetValidationReport(
  validation: TerritoryValidationResult,
  qualityReport: GeometryQualityReport
): Record<string, unknown> {
  return {
    reportVersion: "1",
    dataset: validation,
    geometry: qualityReport
  };
}

function createSourceLock(input: {
  sourceSha256: string;
  sourceSizeBytes: number;
}): Record<string, unknown> {
  return {
    lockVersion: "territorykit-source-lock@1",
    provider: "official-open-data",
    sourceUrl: TURKEY_GAZIANTEP_ADM3_SOURCE_URL,
    downloadUrl: TURKEY_GAZIANTEP_ADM3_DOWNLOAD_URL,
    retrievalDate: TURKEY_GAZIANTEP_ADM3_RETRIEVED_AT,
    sourceVersion: TURKEY_GAZIANTEP_ADM3_SOURCE_DATE,
    sha256: input.sourceSha256,
    contentType: "application/vnd.google-earth.kml+xml",
    fileSizeBytes: input.sourceSizeBytes,
    licence: {
      id: "CC-BY-4.0",
      name: "Creative Commons Attribution 4.0 International",
      url: TURKEY_GAZIANTEP_ADM3_LICENSE_URL,
      redistributionAllowed: true,
      commercialUseAllowed: true,
      modificationAllowed: true,
      attributionRequired: true,
      attributionText: TURKEY_GAZIANTEP_ADM3_ATTRIBUTION
    },
    selectedAdministrativeLevel: "ADM3",
    pilotGeographicScope: "Gaziantep province: complete selected ADM2 parents"
  };
}

function createSourceEvaluationRecord(): Record<string, unknown> {
  return {
    schemaVersion: "territorykit-source-evaluation@1",
    generatedAt: TURKEY_GAZIANTEP_ADM3_BUILD_DATE,
    selectedSource: "gaziantep-buyuksehir-belediyesi-mahalle-sinir-alanlari",
    candidates: [
      {
        provider: "TUCBS",
        datasetTitle: "Türkiye Ulusal Coğrafi Bilgi Platformu lower administrative services",
        officialPublisher: "T.C. Çevre, Şehircilik ve İklim Değişikliği Bakanlığı",
        sourceUrl: "https://tucbs.gov.tr/",
        downloadUrlOrApiEndpoint: "https://ucbp.tucbs.gov.tr/veri-arama",
        publicationOrUpdateDate: "2026-07-18 inspection",
        licenceName: "not confirmed for direct redistribution",
        redistributionPermission: "unclear",
        commercialUsePermission: "unclear",
        modificationPermission: "unclear",
        attributionRequirement: "unclear",
        availableFileFormats: "view/services; login or access-controlled search observed",
        coordinateReferenceSystem: "not inspected",
        featureCount: "not inspected",
        availableIdentifiers: "not inspected",
        provinceDistrictNeighbourhoodProperties: "not inspected",
        selectionResult: "rejected",
        rejectionReason:
          "Public pages describe services and open data portal, but the data search endpoint was not reproducibly downloadable without access controls."
      },
      {
        provider: "İstanbul Büyükşehir Belediyesi Açık Veri Portalı",
        datasetTitle: "Muhtarlık Adres Bilgileri",
        officialPublisher: "İstanbul Büyükşehir Belediyesi",
        sourceUrl: "https://data.ibb.gov.tr/",
        downloadUrlOrApiEndpoint:
          "https://data.ibb.gov.tr/api/3/action/package_search?q=mahalle%20s%C4%B1n%C4%B1rlar%C4%B1",
        publicationOrUpdateDate: "2025-06-05 metadata modification",
        licenceName: "İBB Açık Veri Lisansı",
        redistributionPermission: "not evaluated for geometry because source is points/addresses",
        commercialUsePermission: "not evaluated for geometry because source is points/addresses",
        modificationPermission: "not evaluated for geometry because source is points/addresses",
        attributionRequirement: "required",
        availableFileFormats: "GeoJSON point dataset",
        coordinateReferenceSystem: "EPSG:4326",
        featureCount: "not boundary polygons",
        availableIdentifiers: "muhtarlık address properties",
        provinceDistrictNeighbourhoodProperties: "district/neighbourhood address fields",
        selectionResult: "rejected",
        rejectionReason:
          "Machine-readable and official, but it provides mukhtar office/address locations, not neighbourhood boundary polygons."
      },
      {
        provider: "Sivas Belediyesi / Ulusal Akıllı Şehir Açık Veri Platformu",
        datasetTitle: "Sivas Mahalle Sınırı Haritası",
        officialPublisher: "Sivas Belediyesi",
        sourceUrl: "https://ulasav.csb.gov.tr/dataset/58-sivas-mahalle-siniri-haritasi",
        downloadUrlOrApiEndpoint:
          "https://acikveri.sivas.bel.tr/dataset/c0caa4ec-c071-4759-9873-7a945fc8d673/resource/3ec8e7eb-4a8c-4f7c-8614-31e36a73d69c/download/mahalle_sinir.zip",
        publicationOrUpdateDate: "2025-10-24T08:52:49Z",
        licenceName: "CC BY 4.0",
        redistributionPermission: "allowed",
        commercialUsePermission: "allowed",
        modificationPermission: "allowed",
        attributionRequirement: "required",
        availableFileFormats: "SHP, PNG, PDF",
        coordinateReferenceSystem: "not inspected; download endpoint timed out",
        featureCount: "not inspected; download endpoint timed out",
        availableIdentifiers: "not inspected",
        provinceDistrictNeighbourhoodProperties: "not inspected",
        selectionResult: "rejected",
        rejectionReason:
          "Legally strong, but the SHP endpoint timed out in bounded reproducibility checks."
      },
      {
        provider: "Gaziantep Büyükşehir Belediyesi / Ulusal Akıllı Şehir Açık Veri Platformu",
        datasetTitle: "Mahalle Sınır Alanları",
        officialPublisher: "Gaziantep Büyükşehir Belediyesi",
        sourceUrl: TURKEY_GAZIANTEP_ADM3_SOURCE_URL,
        downloadUrlOrApiEndpoint: TURKEY_GAZIANTEP_ADM3_DOWNLOAD_URL,
        publicationOrUpdateDate: TURKEY_GAZIANTEP_ADM3_SOURCE_DATE,
        licenceName: "CC BY 4.0",
        redistributionPermission: "allowed",
        commercialUsePermission: "allowed",
        modificationPermission: "allowed",
        attributionRequirement: "required",
        availableFileFormats: "KML",
        coordinateReferenceSystem: "EPSG:4326",
        featureCount: 786,
        availableIdentifiers: "KIMLIKNO, ILCEID, Placemark id",
        provinceDistrictNeighbourhoodProperties:
          "AD, KIMLIKNO, ILCEID; province implied by dataset scope",
        selectionResult: "selected",
        rejectionReason: null
      },
      {
        provider: "Kırıkkale Belediyesi / Ulusal Akıllı Şehir Açık Veri Platformu",
        datasetTitle: "Kırıkkale Mahalle Sınırları",
        officialPublisher: "Kırıkkale Belediyesi",
        sourceUrl: "https://ulasav.csb.gov.tr/dataset/kirikkale-mahalle-sinirlari",
        downloadUrlOrApiEndpoint:
          "https://ulasav.csb.gov.tr/dataset/afce03a4-fb6b-4c77-9eff-5725305b218a/resource/3fc1538c-7bb6-4551-a138-135137c40e47/download/merkez_mahalle.zip",
        publicationOrUpdateDate: "2025-04-25T13:00:27Z",
        licenceName: "No License Provided",
        redistributionPermission: "not allowed to assume",
        commercialUsePermission: "not allowed to assume",
        modificationPermission: "not allowed to assume",
        attributionRequirement: "unknown",
        availableFileFormats: "SHP",
        coordinateReferenceSystem: "not inspected",
        featureCount: "not inspected",
        availableIdentifiers: "not inspected",
        provinceDistrictNeighbourhoodProperties: "not inspected",
        selectionResult: "rejected",
        rejectionReason: "Catalog explicitly reports no licence."
      }
    ]
  };
}

function createRepairReport(
  buildDate: string,
  report: TerritoryGeometryRepairReport
): Record<string, unknown> {
  return {
    schemaVersion: "territorykit-repair-report@1",
    generatedAt: buildDate,
    engine: report.engine,
    engineVersion: report.engineVersion,
    mode: report.mode,
    precision: report.precision,
    repairedFeatureCount: report.featuresRepaired,
    unchangedFeatureCount: report.featuresUnchanged,
    rejectedRepairCount: report.featuresRejected,
    areaDifference: report.areaDifference,
    componentsDiscarded: report.componentsDiscarded,
    repairs: report.results
      .filter((result) => result.status !== "unchanged")
      .map((result) => ({
        id: result.id,
        status: result.status,
        engine: result.engine,
        engineVersion: result.engineVersion,
        mode: result.mode,
        precision: result.precision,
        areaBefore: result.areaBefore,
        areaAfter: result.areaAfter,
        areaDifference: result.areaDifference,
        componentsDiscarded: result.componentsDiscarded,
        ...(result.message ? { message: result.message } : {})
      }))
  };
}

function createRejectionReport(
  buildDate: string,
  report: TerritoryGeometryRepairReport
): Record<string, unknown> {
  const rejections = report.results.filter((result) => result.status === "rejected");

  return {
    schemaVersion: "territorykit-rejection-report@1",
    generatedAt: buildDate,
    rejectedFeatureCount: rejections.length,
    rejections: rejections.map((result) => ({
      id: result.id,
      reason: result.message ?? "Geometry repair rejected the source feature."
    }))
  };
}

function countByLevel(zones: TerritoryZone[]): Record<TerritoryAdminLevel, number> {
  const counts = { ADM0: 0, ADM1: 0, ADM2: 0, ADM3: 0, ADM4: 0, ADM5: 0 };

  for (const zone of zones) {
    if (zone.sourceAdminLevel && zone.sourceAdminLevel in counts) {
      counts[zone.sourceAdminLevel as TerritoryAdminLevel] += 1;
    }
  }

  return counts;
}

function createChecksums(files: ReadonlyMap<string, string | Uint8Array>): Record<string, unknown> {
  const entries = [...files.entries()]
    .filter(([path]) => path !== "checksums.json")
    .map(
      ([path, content]) =>
        [path, sha256Hex(typeof content === "string" ? content : content)] as const
    )
    .sort(([left], [right]) => left.localeCompare(right));

  return {
    algorithm: "sha256",
    files: Object.fromEntries(entries)
  };
}

async function writePilotFiles(
  outputPath: string,
  files: ReadonlyMap<string, string | Uint8Array>
): Promise<void> {
  await rm(outputPath, { recursive: true, force: true });

  for (const [relativePath, content] of [...files.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const target = join(outputPath, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

function emptyQualityReport(): GeometryQualityReport {
  return {
    ok: false,
    mode: "validate-only",
    strict: true,
    backend: "typescript",
    checks: {
      coordinates: true,
      rings: true,
      selfIntersections: false,
      holes: false,
      bbox: true,
      center: true,
      antimeridian: true,
      parentContainment: false,
      siblingOverlaps: false
    },
    summary: {
      zoneCount: 0,
      validFeatureCount: 0,
      invalidFeatureCount: 0,
      polygonCount: 0,
      multiPolygonCount: 0,
      ringCount: 0,
      coordinateCount: 0,
      issueCount: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      repairedFeatureCount: 0,
      backend: "typescript",
      checks: {
        coordinates: true,
        rings: true,
        selfIntersections: false,
        holes: false,
        bbox: true,
        center: true,
        antimeridian: true,
        parentContainment: false,
        siblingOverlaps: false
      },
      performance: {
        candidatePairCount: 0,
        exactComparisonCount: 0,
        durationMs: 0
      }
    },
    issues: []
  };
}

export function stableTurkeyGaziantepAdm3Json(input: unknown): string {
  return serializeJsonStable(sortJson(input));
}
