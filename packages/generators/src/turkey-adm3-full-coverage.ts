import {
  computeGeometryBBox,
  computeGeometryCenter,
  createTerritoryGlobalId
} from "@territory-kit/dataset";
import type {
  LngLat,
  TerritoryBBox,
  TerritoryGeometry,
  TerritoryZone
} from "@territory-kit/dataset";
import {
  createDatasetGeometryHash,
  isRecord,
  readStringPropertyPath,
  serializeJsonStable,
  sha256Hex
} from "./sources/utils.js";

export const TURKEY_ADM3_PROVIDER_REGISTRY_SCHEMA_VERSION =
  "territorykit-tr-adm3-provider-registry@1";
export const TURKEY_ADM3_FALLBACK_SCHEMA_VERSION = "territorykit-tr-adm3-fallback@1";
export const TURKEY_ADM3_GENERATED_ALGORITHM_VERSION = "tr-adm3-generated-zone-v1";
export const TURKEY_ADM3_PROVIDER_CLASSES = [
  "official",
  "runtime",
  "experimental",
  "osm",
  "generated"
] as const;
export const TURKEY_ADM3_DEFAULT_PROVIDER_PRIORITY = [
  "official",
  "runtime",
  "osm",
  "generated"
] as const;

export type TurkeyAdm3ProviderClass = (typeof TURKEY_ADM3_PROVIDER_CLASSES)[number];
export type TurkeyAdm3DefaultProviderClass = (typeof TURKEY_ADM3_DEFAULT_PROVIDER_PRIORITY)[number];
export type TurkeyAdm3ProviderFormat =
  | "geojson"
  | "json"
  | "kml"
  | "kmz"
  | "shapefile"
  | "gpkg"
  | "arcgis-feature-service"
  | "arcgis-map-service"
  | "wfs"
  | "geoserver"
  | "keos"
  | "osm-pbf"
  | "generated";

export interface TurkeyAdm3ProviderRecord {
  id: string;
  countryCode: "TR";
  provinceCode: string;
  districtCodes?: string[];
  providerClass: TurkeyAdm3ProviderClass;
  providerName: string;
  sourceUrl?: string;
  downloadUrl?: string;
  serviceUrl?: string;
  layerId?: string | number;
  format: TurkeyAdm3ProviderFormat;
  crs?: string;
  geometryType?: "Polygon" | "MultiPolygon";
  nameField?: string;
  sourceIdField?: string;
  parentIdField?: string;
  parentNameField?: string;
  official: boolean;
  experimental: boolean;
  enabledByDefault: boolean;
  license?: string;
  licenseUrl?: string;
  attribution?: string;
  redistribution: "allowed" | "runtime-only" | "permission-required" | "unknown";
  commercialUse: "allowed" | "permission-required" | "unknown";
  modification: "allowed" | "permission-required" | "unknown";
  cachePolicy: "persistent" | "session" | "memory-only" | "disabled" | "unknown";
  expectedFeatureCount?: number;
  expectedSha256?: string;
  expectedByteSize?: number;
  coverage: "province" | "districts" | "partial" | "unknown";
  status:
    | "verified"
    | "reachable"
    | "unreachable"
    | "quality-blocked"
    | "license-blocked"
    | "experimental";
  lastVerifiedAt?: string;
  evidenceUrls: string[];
  notes?: string;
}

export interface TurkeyAdm3ProviderRegistry {
  schemaVersion: typeof TURKEY_ADM3_PROVIDER_REGISTRY_SCHEMA_VERSION;
  country: "TR";
  generatedAt: string;
  providerPriority: readonly TurkeyAdm3DefaultProviderClass[];
  records: TurkeyAdm3ProviderRecord[];
}

export interface TurkeyAdm3DistrictFallbackRecord {
  districtId: string;
  districtName: string;
  provinceCode: string;
  provinceName: string;
  providerIds: string[];
  providerClasses: TurkeyAdm3ProviderClass[];
  finalCoverageTargetPercent: 99.99;
}

export interface TurkeyAdm3FallbackRegistry {
  schemaVersion: typeof TURKEY_ADM3_FALLBACK_SCHEMA_VERSION;
  country: "TR";
  generatedAt: string;
  allowExperimentalByDefault: false;
  providerPriority: readonly TurkeyAdm3DefaultProviderClass[];
  districtCount: number;
  provinces: Record<string, { provinceCode: string; provinceName: string; providerIds: string[] }>;
  districts: TurkeyAdm3DistrictFallbackRecord[];
}

export interface TurkeyAdm3RegistryValidationResult {
  ok: boolean;
  issues: TurkeyAdm3RegistryIssue[];
  summary: {
    provinceCount: number;
    providerCount: number;
    districtCount?: number;
    officialCount: number;
    runtimeCount: number;
    experimentalCount: number;
    osmCount: number;
    generatedCount: number;
  };
}

export interface TurkeyAdm3RegistryIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  providerId?: string;
  districtId?: string;
}

export interface TurkeyAdm3ResolveOptions {
  countryCode: "TR";
  provinceCode: string;
  districtCode?: string;
  providers: readonly TurkeyAdm3ProviderRecord[];
  allowOfficial?: boolean;
  allowRuntime?: boolean;
  allowOsm?: boolean;
  allowExperimental?: boolean;
  allowGenerated?: boolean;
}

export interface ProviderHealth {
  providerId: string;
  reachable: boolean;
  latencyMs?: number;
  featureCount?: number;
  lastCheckedAt: string;
  errorCode?: string;
  fallbackProviderId?: string;
}

export interface GeneratedZoneConfig {
  targetAreaKm2: number;
  minAreaKm2: number;
  maxAreaKm2: number;
  maxZonesPerDistrict: number;
  minFragmentAreaKm2: number;
  algorithmVersion: string;
  seed: string;
}

export interface TurkeyAdm3CoverageInput {
  districtId: string;
  districtGeometry: TerritoryGeometry;
  official?: readonly TerritoryGeometry[];
  runtime?: readonly TerritoryGeometry[];
  osm?: readonly TerritoryGeometry[];
  generated?: readonly TerritoryGeometry[];
}

export interface TurkeyAdm3DistrictCoverageReport {
  districtId: string;
  districtAreaKm2: number;
  officialAreaKm2: number;
  runtimeAreaKm2: number;
  osmAreaKm2: number;
  realCoverageAreaKm2: number;
  realCoveragePercent: number;
  missingAreaKm2: number;
  generatedAreaKm2: number;
  generatedCoveragePercent: number;
  finalCoveragePercent: number;
}

export interface TurkeyAdm3GeneratedBuildOptions {
  district: TerritoryZone;
  provinceCode: string;
  realZones?: readonly TerritoryZone[];
  config?: Partial<GeneratedZoneConfig>;
}

export interface TurkeyAdm3GeneratedBuildResult {
  zones: TerritoryZone[];
  coverage: TurkeyAdm3DistrictCoverageReport;
  issues: TurkeyAdm3RegistryIssue[];
}

export interface TurkeyAdm3GeneratedMigrationReport {
  schemaVersion: "territorykit-tr-adm3-generated-migration@1";
  country: "TR";
  generatedAt: string;
  migrations: Array<{
    oldGeneratedId: string;
    newOfficialTerritoryId: string;
    overlapPercent: number;
  }>;
}

interface Rect {
  west: number;
  south: number;
  east: number;
  north: number;
}

const SQ_DEGREES_TO_KM2 = 10_000;
const RECT_EPSILON = 1e-9;

export function createTurkeyAdm3Registry(input: {
  providers: readonly TurkeyAdm3ProviderRecord[];
  experimentalSources?: boolean;
  generatedAt?: string;
}): TurkeyAdm3ProviderRegistry {
  const records = input.providers
    .filter((provider) => input.experimentalSources || !provider.experimental)
    .map((provider) => ({ ...provider }))
    .sort(compareProviderRecords);

  return {
    schemaVersion: TURKEY_ADM3_PROVIDER_REGISTRY_SCHEMA_VERSION,
    country: "TR",
    generatedAt: input.generatedAt ?? new Date(0).toISOString(),
    providerPriority: TURKEY_ADM3_DEFAULT_PROVIDER_PRIORITY,
    records
  };
}

export function validateTurkeyAdm3ProviderRegistry(input: {
  providers: readonly TurkeyAdm3ProviderRecord[];
  fallbacks?: TurkeyAdm3FallbackRegistry;
}): TurkeyAdm3RegistryValidationResult {
  const issues: TurkeyAdm3RegistryIssue[] = [];
  const ids = new Set<string>();
  const provinceCodes = new Set<string>();

  for (const provider of input.providers) {
    provinceCodes.add(provider.provinceCode);

    if (ids.has(provider.id)) {
      issues.push(
        issue("TR_ADM3_PROVIDER_ID_DUPLICATE", `Duplicate provider id ${provider.id}.`, provider.id)
      );
    }

    ids.add(provider.id);

    if (!TURKEY_ADM3_PROVIDER_CLASSES.includes(provider.providerClass)) {
      issues.push(
        issue(
          "TR_ADM3_PROVIDER_CLASS_INVALID",
          `Invalid provider class for ${provider.id}.`,
          provider.id
        )
      );
    }

    if (provider.countryCode !== "TR") {
      issues.push(
        issue(
          "TR_ADM3_PROVIDER_COUNTRY_INVALID",
          `Provider ${provider.id} must target TR.`,
          provider.id
        )
      );
    }

    if (provider.providerClass === "official" && (!provider.license || !provider.attribution)) {
      issues.push(
        issue(
          "TR_ADM3_OFFICIAL_LICENSE_MISSING",
          `Official provider ${provider.id} requires license and attribution metadata.`,
          provider.id
        )
      );
    }

    if (provider.providerClass === "experimental" && provider.enabledByDefault) {
      issues.push(
        issue(
          "TR_ADM3_EXPERIMENTAL_DEFAULT_ENABLED",
          `Experimental provider ${provider.id} must be disabled by default.`,
          provider.id
        )
      );
    }

    if (
      provider.providerClass === "osm" &&
      (provider.official || provider.license !== "ODbL-1.0" || !provider.attribution)
    ) {
      issues.push(
        issue(
          "TR_ADM3_OSM_METADATA_INVALID",
          `OSM provider ${provider.id} must be non-official and carry ODbL attribution.`,
          provider.id
        )
      );
    }

    if (
      provider.providerClass === "generated" &&
      (provider.official || provider.experimental || provider.format !== "generated")
    ) {
      issues.push(
        issue(
          "TR_ADM3_GENERATED_METADATA_INVALID",
          `Generated provider ${provider.id} must be non-official, non-experimental, and generated format.`,
          provider.id
        )
      );
    }
  }

  if (provinceCodes.size !== 81) {
    issues.push(
      issue(
        "TR_ADM3_PROVIDER_PROVINCE_COUNT",
        `Turkey ADM3 provider registry must include 81 provinces, received ${provinceCodes.size}.`
      )
    );
  }

  if (input.fallbacks) {
    for (const district of input.fallbacks.districts) {
      if (district.providerIds.length === 0) {
        issues.push(
          issue(
            "TR_ADM3_DISTRICT_FALLBACK_MISSING",
            `District ${district.districtId} has no fallback chain.`,
            undefined,
            district.districtId
          )
        );
      }

      if (!district.providerClasses.includes("generated")) {
        issues.push(
          issue(
            "TR_ADM3_DISTRICT_GENERATED_FALLBACK_MISSING",
            `District ${district.districtId} must include generated fallback.`,
            undefined,
            district.districtId
          )
        );
      }
    }
  }

  const summary = {
    provinceCount: provinceCodes.size,
    providerCount: input.providers.length,
    ...(input.fallbacks ? { districtCount: input.fallbacks.districts.length } : {}),
    officialCount: countProviders(input.providers, "official"),
    runtimeCount: countProviders(input.providers, "runtime"),
    experimentalCount: countProviders(input.providers, "experimental"),
    osmCount: countProviders(input.providers, "osm"),
    generatedCount: countProviders(input.providers, "generated")
  };

  return { ok: issues.every((item) => item.severity !== "error"), issues, summary };
}

export function resolveTurkeyAdm3Provider(
  options: TurkeyAdm3ResolveOptions
): TurkeyAdm3ProviderRecord | undefined {
  const allowed = new Set<TurkeyAdm3ProviderClass>();

  if (options.allowOfficial ?? true) allowed.add("official");
  if (options.allowRuntime ?? true) allowed.add("runtime");
  if (options.allowExperimental ?? false) allowed.add("experimental");
  if (options.allowOsm ?? true) allowed.add("osm");
  if (options.allowGenerated ?? true) allowed.add("generated");

  const priority: TurkeyAdm3ProviderClass[] = [
    "official",
    "runtime",
    ...(options.allowExperimental ? (["experimental"] as const) : []),
    "osm",
    "generated"
  ];

  return options.providers
    .filter((provider) => {
      if (
        provider.countryCode !== options.countryCode ||
        provider.provinceCode !== options.provinceCode
      ) {
        return false;
      }

      if (!allowed.has(provider.providerClass)) {
        return false;
      }

      if (provider.experimental && !options.allowExperimental) {
        return false;
      }

      if (provider.districtCodes && options.districtCode) {
        return provider.districtCodes.includes(options.districtCode);
      }

      return (
        provider.enabledByDefault || (provider.experimental && Boolean(options.allowExperimental))
      );
    })
    .sort((left, right) => {
      const leftPriority = priority.indexOf(left.providerClass);
      const rightPriority = priority.indexOf(right.providerClass);

      return leftPriority - rightPriority || left.id.localeCompare(right.id);
    })[0];
}

export function createTurkeyAdm3ProviderHealthReport(input: {
  providers: readonly TurkeyAdm3ProviderRecord[];
  checkedAt: string;
}): ProviderHealth[] {
  return input.providers
    .filter(
      (provider) =>
        provider.providerClass === "runtime" || provider.providerClass === "experimental"
    )
    .map((provider) => ({
      providerId: provider.id,
      reachable: provider.status === "reachable" || provider.status === "verified",
      ...(provider.expectedFeatureCount !== undefined
        ? { featureCount: provider.expectedFeatureCount }
        : {}),
      lastCheckedAt: input.checkedAt,
      ...(provider.status !== "reachable" && provider.status !== "verified"
        ? { errorCode: `TR_ADM3_${provider.status.toUpperCase().replace(/-/g, "_")}` }
        : {}),
      fallbackProviderId: `tr-adm3-osm-${provider.provinceCode}`
    }))
    .sort((left, right) => left.providerId.localeCompare(right.providerId));
}

export function createDefaultGeneratedZoneConfig(input: {
  districtAreaKm2: number;
  realZoneCount?: number;
  seed?: string;
}): GeneratedZoneConfig {
  const densityAdjustment = input.realZoneCount && input.realZoneCount > 0 ? 0.75 : 1;
  const targetAreaKm2 = clamp(input.districtAreaKm2 / 24, 2, 50) * densityAdjustment;

  return {
    targetAreaKm2,
    minAreaKm2: Math.max(0.05, targetAreaKm2 * 0.08),
    maxAreaKm2: targetAreaKm2 * 4,
    maxZonesPerDistrict: 256,
    minFragmentAreaKm2: Math.max(0.01, targetAreaKm2 * 0.02),
    algorithmVersion: TURKEY_ADM3_GENERATED_ALGORITHM_VERSION,
    seed: input.seed ?? "territory-kit-tr-adm3"
  };
}

export function buildTurkeyAdm3GeneratedZones(
  options: TurkeyAdm3GeneratedBuildOptions
): TurkeyAdm3GeneratedBuildResult {
  const districtRect = geometryToRect(options.district.geometry);
  const issues: TurkeyAdm3RegistryIssue[] = [];
  const districtAreaKm2 = rectAreaKm2(districtRect);
  const config = {
    ...createDefaultGeneratedZoneConfig({
      districtAreaKm2,
      realZoneCount: options.realZones?.length ?? 0,
      seed: `${options.district.id}:generated`
    }),
    ...options.config
  };
  const realRects = (options.realZones ?? []).flatMap((zone) => {
    try {
      return [geometryToRect(zone.geometry)];
    } catch {
      issues.push(
        issue(
          "TR_ADM3_REAL_GEOMETRY_CLIP_UNSUPPORTED",
          `Real ADM3 geometry ${zone.id} is not an axis-aligned polygon supported by the deterministic fallback clipper.`,
          undefined,
          zone.id
        )
      );
      return [];
    }
  });
  const missingRects = subtractRects([districtRect], realRects);
  const cells = tessellateRects(missingRects, config);
  const zones = cells.map((cell, index) =>
    createGeneratedZone({
      district: options.district,
      provinceCode: options.provinceCode,
      rect: cell,
      cellIndex: index,
      config
    })
  );
  const coverage = computeTurkeyAdm3DistrictCoverage({
    districtId: options.district.id,
    districtGeometry: options.district.geometry,
    official: options.realZones?.map((zone) => zone.geometry) ?? [],
    generated: zones.map((zone) => zone.geometry)
  });

  return { zones, coverage, issues };
}

export function computeTurkeyAdm3DistrictCoverage(
  input: TurkeyAdm3CoverageInput
): TurkeyAdm3DistrictCoverageReport {
  const districtRect = geometryToRect(input.districtGeometry);
  const officialRects = geometriesToRects(input.official ?? []);
  const runtimeRects = geometriesToRects(input.runtime ?? []);
  const osmRects = geometriesToRects(input.osm ?? []);
  const generatedRects = geometriesToRects(input.generated ?? []);
  const realRects = [...officialRects, ...runtimeRects, ...osmRects];
  const districtAreaKm2 = rectAreaKm2(districtRect);
  const officialAreaKm2 = unionRectAreaKm2(officialRects);
  const runtimeAreaKm2 = unionRectAreaKm2(runtimeRects);
  const osmAreaKm2 = unionRectAreaKm2(osmRects);
  const realCoverageAreaKm2 = unionRectAreaKm2(realRects);
  const generatedAreaKm2 = unionRectAreaKm2(generatedRects);
  const finalCoverageAreaKm2 = unionRectAreaKm2([...realRects, ...generatedRects]);
  const realCoveragePercent = percentage(realCoverageAreaKm2, districtAreaKm2);
  const generatedCoveragePercent = percentage(generatedAreaKm2, districtAreaKm2);
  const finalCoveragePercent = Math.min(100, percentage(finalCoverageAreaKm2, districtAreaKm2));

  return {
    districtId: input.districtId,
    districtAreaKm2,
    officialAreaKm2,
    runtimeAreaKm2,
    osmAreaKm2,
    realCoverageAreaKm2,
    realCoveragePercent,
    missingAreaKm2: Math.max(0, districtAreaKm2 - realCoverageAreaKm2),
    generatedAreaKm2,
    generatedCoveragePercent,
    finalCoveragePercent
  };
}

export function createTurkeyAdm3GeneratedMigrationReport(input: {
  generatedAt: string;
  oldGeneratedZones: readonly TerritoryZone[];
  newOfficialZones: readonly TerritoryZone[];
}): TurkeyAdm3GeneratedMigrationReport {
  const migrations = input.oldGeneratedZones.flatMap((generatedZone) => {
    const generatedRect = geometryToRect(generatedZone.geometry);
    const generatedArea = rectArea(generatedRect);
    const best = input.newOfficialZones
      .map((officialZone) => {
        const officialRect = geometryToRect(officialZone.geometry);
        const overlapPercent = percentage(
          rectArea(intersectRect(generatedRect, officialRect)),
          generatedArea
        );

        return { officialZone, overlapPercent };
      })
      .sort((left, right) => right.overlapPercent - left.overlapPercent)[0];

    if (!best || best.overlapPercent <= 0) {
      return [];
    }

    return [
      {
        oldGeneratedId: generatedZone.id,
        newOfficialTerritoryId: best.officialZone.id,
        overlapPercent: roundPercent(best.overlapPercent)
      }
    ];
  });

  return {
    schemaVersion: "territorykit-tr-adm3-generated-migration@1",
    country: "TR",
    generatedAt: input.generatedAt,
    migrations: migrations.sort((left, right) =>
      left.oldGeneratedId.localeCompare(right.oldGeneratedId)
    )
  };
}

export function filterOsmAdministrativeBoundaryPolygons<
  T extends { properties?: unknown; geometry?: unknown }
>(features: readonly T[]): T[] {
  return features.filter((feature) => {
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const geometry = isRecord(feature.geometry) ? feature.geometry : {};
    const osmType =
      readStringPropertyPath(properties, "osm_type") ?? readStringPropertyPath(properties, "type");
    const boundary = readStringPropertyPath(properties, "boundary");
    const adminLevel = readStringPropertyPath(properties, "admin_level");
    const place = readStringPropertyPath(properties, "place");

    if (
      osmType === "node" ||
      place === "neighbourhood" ||
      place === "suburb" ||
      place === "quarter"
    ) {
      return false;
    }

    if (boundary !== "administrative") {
      return false;
    }

    if (!adminLevel || !["9", "10", "11"].includes(adminLevel)) {
      return false;
    }

    return geometry.type === "Polygon" || geometry.type === "MultiPolygon";
  });
}

export function createTurkeyAdm3GeometryHash(geometry: TerritoryGeometry): string {
  return sha256Hex(serializeJsonStable(geometry));
}

function createGeneratedZone(input: {
  district: TerritoryZone;
  provinceCode: string;
  rect: Rect;
  cellIndex: number;
  config: GeneratedZoneConfig;
}): TerritoryZone {
  const cellId = [
    input.config.algorithmVersion,
    input.config.seed,
    input.district.id,
    input.cellIndex,
    input.rect.west.toFixed(6),
    input.rect.south.toFixed(6),
    input.rect.east.toFixed(6),
    input.rect.north.toFixed(6)
  ].join(":");
  const localId = [
    `tr-${input.provinceCode}`,
    input.district.id.replace(/^tr:adm2:/, "adm2-"),
    "generated",
    input.config.algorithmVersion,
    sha256Hex(cellId).slice(0, 16)
  ].join("-");
  const geometry = rectToPolygon(input.rect);
  const geometryHash = createTurkeyAdm3GeometryHash(geometry);
  const id = createTerritoryGlobalId({
    countryCode: "TR",
    adminLevel: "ADM3",
    localId
  });
  const bbox = computeGeometryBBox(geometry);

  return {
    id,
    datasetId: "tr-adm3-generated",
    countryCode: "TR",
    level: 3,
    sourceAdminLevel: "ADM3",
    semanticType: "game-region",
    name: `Generated zone ${input.cellIndex + 1}`,
    localName: `Generated zone ${input.cellIndex + 1}`,
    parentId: input.district.id,
    neighborIds: [],
    geometry,
    center: computeGeometryCenter(geometry),
    bbox,
    properties: {
      territory: {
        adminLevel: "ADM3",
        sourceAdminLevel: "ADM3",
        semanticType: "generated-zone",
        localType: "generated-zone",
        coverageStatus: "generated",
        sourceClass: "generated",
        official: false,
        generated: true,
        parentAdm2Id: input.district.id,
        geometryHash,
        source: {
          provider: "territory-kit-generated",
          sourceId: id,
          sourceDate: input.config.algorithmVersion,
          license: "Apache-2.0",
          attribution: "TerritoryKit generated game zones from ADM2 boundaries"
        },
        generatedZone: {
          algorithm: "deterministic-rectangular-tessellation",
          algorithmVersion: input.config.algorithmVersion,
          seed: input.config.seed,
          targetAreaKm2: input.config.targetAreaKm2,
          minAreaKm2: input.config.minAreaKm2,
          maxAreaKm2: input.config.maxAreaKm2,
          maxZonesPerDistrict: input.config.maxZonesPerDistrict,
          minFragmentAreaKm2: input.config.minFragmentAreaKm2
        }
      }
    }
  };
}

function tessellateRects(rects: readonly Rect[], config: GeneratedZoneConfig): Rect[] {
  const cells = rects.flatMap((rect) => tessellateRect(rect, config));

  if (cells.length <= config.maxZonesPerDistrict) {
    return cells;
  }

  const stride = Math.ceil(cells.length / config.maxZonesPerDistrict);
  const merged: Rect[] = [];

  for (let index = 0; index < cells.length; index += stride) {
    merged.push(mergeRects(cells.slice(index, index + stride)));
  }

  return merged;
}

function tessellateRect(rect: Rect, config: GeneratedZoneConfig): Rect[] {
  const areaKm2 = rectAreaKm2(rect);

  if (areaKm2 <= config.maxAreaKm2) {
    return areaKm2 >= config.minFragmentAreaKm2 ? [rect] : [];
  }

  const targetCells = Math.max(1, Math.ceil(areaKm2 / config.targetAreaKm2));
  const width = rect.east - rect.west;
  const height = rect.north - rect.south;
  const columns = Math.max(
    1,
    Math.ceil(Math.sqrt(targetCells * (width / Math.max(height, RECT_EPSILON))))
  );
  const rows = Math.max(1, Math.ceil(targetCells / columns));
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const cells: Rect[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cell = normalizeRect({
        west: rect.west + column * cellWidth,
        south: rect.south + row * cellHeight,
        east: column === columns - 1 ? rect.east : rect.west + (column + 1) * cellWidth,
        north: row === rows - 1 ? rect.north : rect.south + (row + 1) * cellHeight
      });

      if (rectAreaKm2(cell) >= config.minFragmentAreaKm2) {
        cells.push(cell);
      }
    }
  }

  return cells;
}

function subtractRects(baseRects: readonly Rect[], subtractors: readonly Rect[]): Rect[] {
  return subtractors.reduce(
    (remaining, subtractor) => remaining.flatMap((rect) => subtractRect(rect, subtractor)),
    [...baseRects]
  );
}

function subtractRect(rect: Rect, subtractor: Rect): Rect[] {
  const overlap = intersectRect(rect, subtractor);

  if (rectArea(overlap) <= RECT_EPSILON) {
    return [rect];
  }

  return [
    { west: rect.west, south: rect.south, east: rect.east, north: overlap.south },
    { west: rect.west, south: overlap.north, east: rect.east, north: rect.north },
    { west: rect.west, south: overlap.south, east: overlap.west, north: overlap.north },
    { west: overlap.east, south: overlap.south, east: rect.east, north: overlap.north }
  ]
    .map(normalizeRect)
    .filter((candidate) => rectArea(candidate) > RECT_EPSILON)
    .sort(compareRects);
}

function unionRectAreaKm2(rects: readonly Rect[]): number {
  return unionRectArea(rects) * SQ_DEGREES_TO_KM2;
}

function unionRectArea(rects: readonly Rect[]): number {
  const xs = [...new Set(rects.flatMap((rect) => [rect.west, rect.east]))].sort(
    (left, right) => left - right
  );
  let area = 0;

  for (let index = 0; index < xs.length - 1; index += 1) {
    const west = xs[index]!;
    const east = xs[index + 1]!;
    const covering = rects
      .filter((rect) => rect.west < east && rect.east > west)
      .map((rect) => [rect.south, rect.north] as const)
      .sort((left, right) => left[0] - right[0]);

    let coveredHeight = 0;
    let currentSouth: number | undefined;
    let currentNorth: number | undefined;

    for (const [south, north] of covering) {
      if (currentSouth === undefined || currentNorth === undefined) {
        currentSouth = south;
        currentNorth = north;
        continue;
      }

      if (south <= currentNorth) {
        currentNorth = Math.max(currentNorth, north);
      } else {
        coveredHeight += currentNorth - currentSouth;
        currentSouth = south;
        currentNorth = north;
      }
    }

    if (currentSouth !== undefined && currentNorth !== undefined) {
      coveredHeight += currentNorth - currentSouth;
    }

    area += (east - west) * coveredHeight;
  }

  return area;
}

function geometriesToRects(geometries: readonly TerritoryGeometry[]): Rect[] {
  return geometries.map(geometryToRect);
}

function geometryToRect(geometry: TerritoryGeometry): Rect {
  if (geometry.type !== "Polygon" || geometry.coordinates.length !== 1) {
    throw new Error(
      "Turkey ADM3 generated-zone fallback currently requires single-ring Polygon geometry."
    );
  }

  const ring = geometry.coordinates[0] as LngLat[];
  const bbox = computeGeometryBBox(geometry);
  const rect = bboxToRect(bbox);
  const expected = new Set(
    rectToRing(rect)
      .slice(0, -1)
      .map((point) => `${point[0].toFixed(9)},${point[1].toFixed(9)}`)
  );
  const actual = new Set(
    ring
      .slice(0, -1)
      .map((point) => `${Number(point[0]).toFixed(9)},${Number(point[1]).toFixed(9)}`)
  );

  if (expected.size !== actual.size || [...expected].some((point) => !actual.has(point))) {
    throw new Error(
      "Turkey ADM3 generated-zone fallback cannot safely clip non-rectangular geometry yet."
    );
  }

  return rect;
}

function rectToPolygon(rect: Rect): TerritoryGeometry {
  return {
    type: "Polygon",
    coordinates: [rectToRing(rect)]
  };
}

function rectToRing(rect: Rect): LngLat[] {
  return [
    [rect.west, rect.south],
    [rect.east, rect.south],
    [rect.east, rect.north],
    [rect.west, rect.north],
    [rect.west, rect.south]
  ];
}

function bboxToRect(bbox: TerritoryBBox): Rect {
  return normalizeRect({
    west: bbox[0],
    south: bbox[1],
    east: bbox[2],
    north: bbox[3]
  });
}

function normalizeRect(rect: Rect): Rect {
  return {
    west: Math.min(rect.west, rect.east),
    south: Math.min(rect.south, rect.north),
    east: Math.max(rect.west, rect.east),
    north: Math.max(rect.south, rect.north)
  };
}

function intersectRect(left: Rect, right: Rect): Rect {
  return normalizeRect({
    west: Math.max(left.west, right.west),
    south: Math.max(left.south, right.south),
    east: Math.max(Math.max(left.west, right.west), Math.min(left.east, right.east)),
    north: Math.max(Math.max(left.south, right.south), Math.min(left.north, right.north))
  });
}

function mergeRects(rects: readonly Rect[]): Rect {
  return normalizeRect({
    west: Math.min(...rects.map((rect) => rect.west)),
    south: Math.min(...rects.map((rect) => rect.south)),
    east: Math.max(...rects.map((rect) => rect.east)),
    north: Math.max(...rects.map((rect) => rect.north))
  });
}

function rectArea(rect: Rect): number {
  return Math.max(0, rect.east - rect.west) * Math.max(0, rect.north - rect.south);
}

function rectAreaKm2(rect: Rect): number {
  return rectArea(rect) * SQ_DEGREES_TO_KM2;
}

function percentage(value: number, total: number): number {
  return total <= 0 ? 0 : roundPercent((value / total) * 100);
}

function roundPercent(value: number): number {
  return Number(value.toFixed(6));
}

function compareRects(left: Rect, right: Rect): number {
  return (
    left.south - right.south ||
    left.west - right.west ||
    left.north - right.north ||
    left.east - right.east
  );
}

function compareProviderRecords(
  left: TurkeyAdm3ProviderRecord,
  right: TurkeyAdm3ProviderRecord
): number {
  return (
    left.provinceCode.localeCompare(right.provinceCode) ||
    left.providerClass.localeCompare(right.providerClass) ||
    left.id.localeCompare(right.id)
  );
}

function countProviders(
  providers: readonly TurkeyAdm3ProviderRecord[],
  providerClass: TurkeyAdm3ProviderClass
): number {
  return providers.filter((provider) => provider.providerClass === providerClass).length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function issue(
  code: string,
  message: string,
  providerId?: string,
  districtId?: string
): TurkeyAdm3RegistryIssue {
  return {
    code,
    severity: "error",
    message,
    ...(providerId ? { providerId } : {}),
    ...(districtId ? { districtId } : {})
  };
}

export function createTurkeyAdm3GeneratedGeometryHash(zones: readonly TerritoryZone[]): string {
  return createDatasetGeometryHash({ zones: [...zones] });
}
