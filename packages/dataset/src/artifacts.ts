import type { Feature, FeatureCollection } from "geojson";
import type {
  TerritoryAdminLevel,
  TerritoryBBox,
  TerritoryDataset,
  TerritoryGeometry,
  TerritoryZone
} from "./types.js";
import { compareAdminLevels } from "./global.js";

export interface TerritoryQueryArtifact {
  queryArtifactVersion: "1";
  datasetId: string;
  datasetVersion: string;
  schemaVersion: "territory-schema@1";
  levels: readonly TerritoryAdminLevel[];
  datasetContentHash: string;
  identityMapHash: string;
  zones: readonly TerritoryZone[];
}

export interface TerritoryRenderLevelPolicy {
  adminLevel: TerritoryAdminLevel;
  minZoom: number;
  maxZoom: number;
  simplificationTolerance?: number;
  minimumArea?: number;
}

export interface TerritoryRenderLayerManifest {
  id: string;
  adminLevels: readonly TerritoryAdminLevel[];
  minZoom: number;
  maxZoom: number;
  featureCount: number;
}

export interface TerritoryRenderArtifactManifest {
  renderArtifactVersion: "1";
  datasetId: string;
  datasetVersion: string;
  schemaVersion: "territory-schema@1";
  datasetContentHash: string;
  identityMapHash: string;
  format: "geojson" | "mvt";
  tileTemplate?: string;
  layers: readonly TerritoryRenderLayerManifest[];
  featureCounts: Record<string, number>;
  bounds: TerritoryBBox;
  center: [longitude: number, latitude: number];
  generatedAt: string;
}

export interface TerritoryRenderFeatureProperties extends Record<string, unknown> {
  territoryId: string;
  adminLevel: TerritoryAdminLevel;
  name?: string;
  parentId?: string;
  sourceAdminLevel?: TerritoryAdminLevel;
  semanticType?: string;
  localName?: string;
  districtName?: string;
  provinceName?: string;
  sourceProvider?: string;
  sourceAttribution?: string;
  license?: string;
  datasetId: string;
  datasetVersion: string;
}

export interface TerritoryQueryRenderCompatibilityIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
  territoryId?: string;
}

export interface TerritoryQueryRenderCompatibilityResult {
  ok: boolean;
  issues: TerritoryQueryRenderCompatibilityIssue[];
}

export const DEFAULT_TERRITORY_RENDER_LEVEL_POLICY: readonly TerritoryRenderLevelPolicy[] = [
  { adminLevel: "ADM0", minZoom: 0, maxZoom: 4, simplificationTolerance: 0.02 },
  { adminLevel: "ADM1", minZoom: 5, maxZoom: 7, simplificationTolerance: 0.01 },
  { adminLevel: "ADM2", minZoom: 8, maxZoom: 11, simplificationTolerance: 0.005 },
  { adminLevel: "ADM3", minZoom: 12, maxZoom: 14, simplificationTolerance: 0.0025 },
  { adminLevel: "ADM4", minZoom: 15, maxZoom: 17, simplificationTolerance: 0.001 },
  { adminLevel: "ADM5", minZoom: 18, maxZoom: 24, simplificationTolerance: 0.0005 }
];

export function createTerritoryQueryArtifact(
  dataset: TerritoryDataset,
  options: { datasetContentHash: string; identityMapHash?: string }
): TerritoryQueryArtifact {
  return {
    queryArtifactVersion: "1",
    datasetId: dataset.manifest.datasetId,
    datasetVersion: dataset.manifest.datasetVersion,
    schemaVersion: dataset.manifest.schemaVersion,
    levels: normalizeDatasetLevels(dataset),
    datasetContentHash: options.datasetContentHash,
    identityMapHash: options.identityMapHash ?? options.datasetContentHash,
    zones: dataset.zones
  };
}

export function createTerritoryRenderFeatureCollection(
  dataset: TerritoryDataset
): FeatureCollection<TerritoryGeometry, TerritoryRenderFeatureProperties> {
  return {
    type: "FeatureCollection",
    features: dataset.zones
      .map((zone): Feature<TerritoryGeometry, TerritoryRenderFeatureProperties> => {
        const adminLevel = zoneToAdminLevel(zone);
        const name = readZoneName(zone);
        const territory = readRecord(zone.properties.territory);
        const source = readRecord(territory?.source);
        const sourceProvider = readString(source?.provider) ?? dataset.manifest.sourceProvider;
        const sourceAttribution = readString(source?.attribution) ?? dataset.manifest.attribution;
        const license = readString(source?.license) ?? dataset.manifest.license;
        const sourceAdminLevel = isTerritoryAdminLevel(zone.sourceAdminLevel)
          ? zone.sourceAdminLevel
          : undefined;
        const districtName = readString(zone.properties.districtName);
        const provinceName = readString(zone.properties.provinceName);

        return {
          type: "Feature",
          id: zone.id,
          geometry: zone.geometry,
          properties: {
            territoryId: zone.id,
            adminLevel,
            datasetId: dataset.manifest.datasetId,
            datasetVersion: dataset.manifest.datasetVersion,
            ...(name ? { name } : {}),
            ...(zone.parentId ? { parentId: zone.parentId } : {}),
            ...(sourceAdminLevel ? { sourceAdminLevel } : {}),
            ...(zone.semanticType ? { semanticType: zone.semanticType } : {}),
            ...(zone.localName ? { localName: zone.localName } : {}),
            ...(districtName ? { districtName } : {}),
            ...(provinceName ? { provinceName } : {}),
            ...(sourceProvider ? { sourceProvider } : {}),
            ...(sourceAttribution ? { sourceAttribution } : {}),
            ...(license ? { license } : {})
          }
        };
      })
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
  };
}

export function createTerritoryRenderArtifactManifest(input: {
  dataset: TerritoryDataset;
  datasetContentHash: string;
  identityMapHash?: string;
  format: "geojson" | "mvt";
  generatedAt: string;
  tileTemplate?: string;
  policies?: readonly TerritoryRenderLevelPolicy[];
}): TerritoryRenderArtifactManifest {
  const levels = normalizeDatasetLevels(input.dataset);
  const policies = normalizeRenderPolicies(input.policies ?? DEFAULT_TERRITORY_RENDER_LEVEL_POLICY)
    .filter((policy) => levels.includes(policy.adminLevel))
    .sort(
      (left, right) =>
        left.minZoom - right.minZoom || left.adminLevel.localeCompare(right.adminLevel)
    );
  const featureCounts = Object.fromEntries(
    levels.map((level) => [
      level,
      input.dataset.zones.filter((zone) => zoneToAdminLevel(zone) === level).length
    ])
  );

  return {
    renderArtifactVersion: "1",
    datasetId: input.dataset.manifest.datasetId,
    datasetVersion: input.dataset.manifest.datasetVersion,
    schemaVersion: input.dataset.manifest.schemaVersion,
    datasetContentHash: input.datasetContentHash,
    identityMapHash: input.identityMapHash ?? input.datasetContentHash,
    format: input.format,
    ...(input.tileTemplate ? { tileTemplate: input.tileTemplate } : {}),
    layers: policies.map((policy) => ({
      id: `territory-${policy.adminLevel.toLowerCase()}`,
      adminLevels: [policy.adminLevel],
      minZoom: policy.minZoom,
      maxZoom: policy.maxZoom,
      featureCount: featureCounts[policy.adminLevel] ?? 0
    })),
    featureCounts,
    bounds: mergeBounds(input.dataset.zones.map((zone) => zone.bbox)),
    center: input.dataset.zones[0]?.center ?? [0, 0],
    generatedAt: input.generatedAt
  };
}

export function validateTerritoryQueryRenderCompatibility(
  query: Pick<
    TerritoryQueryArtifact,
    "datasetId" | "datasetVersion" | "datasetContentHash" | "identityMapHash" | "zones"
  >,
  render: {
    manifest: Pick<
      TerritoryRenderArtifactManifest,
      "datasetId" | "datasetVersion" | "datasetContentHash" | "identityMapHash"
    >;
    features: FeatureCollection<TerritoryGeometry, TerritoryRenderFeatureProperties>;
  }
): TerritoryQueryRenderCompatibilityResult {
  const issues: TerritoryQueryRenderCompatibilityIssue[] = [];

  if (query.datasetId !== render.manifest.datasetId) {
    issues.push({
      code: "DATASET_ID_MISMATCH",
      severity: "error",
      message: "Query and render artifacts reference different dataset ids."
    });
  }

  if (query.datasetVersion !== render.manifest.datasetVersion) {
    issues.push({
      code: "DATASET_VERSION_MISMATCH",
      severity: "error",
      message: "Query and render artifacts reference different dataset versions."
    });
  }

  if (query.datasetContentHash !== render.manifest.datasetContentHash) {
    issues.push({
      code: "DATASET_CONTENT_HASH_MISMATCH",
      severity: "error",
      message: "Query and render artifacts reference different dataset content hashes."
    });
  }

  if (query.identityMapHash !== render.manifest.identityMapHash) {
    issues.push({
      code: "IDENTITY_MAP_HASH_MISMATCH",
      severity: "error",
      message: "Query and render artifacts reference different identity map hashes."
    });
  }

  const queryIds = new Set(query.zones.map((zone) => zone.id));

  for (const feature of render.features.features) {
    const territoryId = feature.properties?.territoryId;

    if (!territoryId || !queryIds.has(territoryId)) {
      issues.push({
        code: "RENDER_TERRITORY_ID_MISSING_IN_QUERY",
        severity: "error",
        message: `Render feature '${territoryId ?? String(feature.id)}' is not present in query artifact.`,
        ...(territoryId ? { territoryId } : {})
      });
    }
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues
  };
}

export function normalizeRenderPolicies(
  policies: readonly TerritoryRenderLevelPolicy[]
): TerritoryRenderLevelPolicy[] {
  return [...policies].sort(
    (left, right) => left.minZoom - right.minZoom || left.adminLevel.localeCompare(right.adminLevel)
  );
}

export function zoneToAdminLevel(
  zone: Pick<TerritoryZone, "level" | "properties">
): TerritoryAdminLevel {
  const adminLevel = readAdminLevel(zone.properties);

  if (adminLevel) {
    return adminLevel;
  }

  return `ADM${zone.level}` as TerritoryAdminLevel;
}

function normalizeDatasetLevels(dataset: TerritoryDataset): TerritoryAdminLevel[] {
  const levels =
    dataset.manifest.adminLevels ?? dataset.zones.map((zone) => zoneToAdminLevel(zone));
  return [...new Set(levels)].sort(compareAdminLevels);
}

function readAdminLevel(properties: Record<string, unknown>): TerritoryAdminLevel | undefined {
  const territory = properties.territory;

  if (
    territory &&
    typeof territory === "object" &&
    "adminLevel" in territory &&
    typeof territory.adminLevel === "string"
  ) {
    return territory.adminLevel as TerritoryAdminLevel;
  }

  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isTerritoryAdminLevel(value: unknown): value is TerritoryAdminLevel {
  return (
    value === "ADM0" ||
    value === "ADM1" ||
    value === "ADM2" ||
    value === "ADM3" ||
    value === "ADM4" ||
    value === "ADM5"
  );
}

function readZoneName(zone: TerritoryZone): string | undefined {
  const name = zone.properties.name;

  if (typeof name === "string") {
    return name;
  }

  const territory = zone.properties.territory;

  if (
    territory &&
    typeof territory === "object" &&
    "names" in territory &&
    territory.names &&
    typeof territory.names === "object" &&
    "default" in territory.names &&
    typeof territory.names.default === "string"
  ) {
    return territory.names.default;
  }

  return undefined;
}

function mergeBounds(bounds: readonly TerritoryBBox[]): TerritoryBBox {
  if (bounds.length === 0) {
    return [0, 0, 0, 0];
  }

  return [
    Math.min(...bounds.map((bbox) => bbox[0])),
    Math.min(...bounds.map((bbox) => bbox[1])),
    Math.max(...bounds.map((bbox) => bbox[2])),
    Math.max(...bounds.map((bbox) => bbox[3]))
  ];
}
