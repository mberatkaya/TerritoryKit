import {
  computeGeometryBBox,
  createTerritoryGlobalId,
  geometryToPolygons
} from "@territory-kit/dataset";
import type {
  LngLat,
  TerritoryBBox,
  TerritoryGeometry,
  TerritoryZone
} from "@territory-kit/dataset";
import * as polygonClipping from "polygon-clipping";
import type {
  MultiPolygon as ClippingMultiPolygon,
  Polygon as ClippingPolygon
} from "polygon-clipping";
import {
  createDatasetGeometryHash,
  isRecord,
  readStringPropertyPath,
  serializeJsonStable,
  sha256Hex
} from "./sources/utils.js";
import { computeGeometryRepresentativePoint } from "./geometry-repair.js";

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
  provinceCode?: string;
  districtGeometry: TerritoryGeometry;
  official?: readonly TerritoryGeometry[];
  runtime?: readonly TerritoryGeometry[];
  osm?: readonly TerritoryGeometry[];
  generated?: readonly TerritoryGeometry[];
}

export interface TurkeyAdm3DistrictCoverageReport {
  districtId: string;
  provinceCode?: string;
  districtAreaKm2: number;
  officialPolygonCount: number;
  runtimePolygonCount: number;
  osmPolygonCount: number;
  generatedPolygonCount: number;
  officialAreaKm2: number;
  runtimeAreaKm2: number;
  osmAreaKm2: number;
  generatedAreaKm2: number;
  realCoverageAreaKm2: number;
  missingBeforeGeneratedAreaKm2: number;
  finalCoverageAreaKm2: number;
  officialCoveragePercent: number;
  runtimeCoveragePercent: number;
  osmCoveragePercent: number;
  realCoveragePercent: number;
  missingAreaKm2: number;
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

export interface TurkeyAdm3EffectiveZoneBuildOptions {
  district: TerritoryZone;
  provinceCode: string;
  officialZones?: readonly TerritoryZone[];
  runtimeZones?: readonly TerritoryZone[];
  osmZones?: readonly TerritoryZone[];
  generatedZones?: readonly TerritoryZone[];
  minEffectiveAreaKm2?: number;
}

export interface TurkeyAdm3EffectiveZoneBuildResult {
  officialZones: TerritoryZone[];
  runtimeZones: TerritoryZone[];
  osmZones: TerritoryZone[];
  generatedZones: TerritoryZone[];
  zones: TerritoryZone[];
  coverage: TurkeyAdm3DistrictCoverageReport;
  issues: TurkeyAdm3RegistryIssue[];
}

export interface TurkeyAdm3SpatialQualityOptions {
  zones: readonly TerritoryZone[];
  districts: readonly TerritoryZone[];
  maxAllowedOverlapAreaKm2?: number;
  minSliverAreaKm2?: number;
  parentOutsideToleranceKm2?: number;
  gapToleranceKm2?: number;
}

export interface TurkeyAdm3SpatialQualityReport {
  schemaVersion: "territorykit-tr-adm3-spatial-quality@1";
  ok: boolean;
  summary: {
    overlapCount: number;
    gapCount: number;
    sliverCount: number;
    parentContainmentErrors: number;
    duplicateGeometryCount: number;
  };
  overlaps: Array<{
    leftZoneId: string;
    rightZoneId: string;
    parentId?: string;
    areaKm2: number;
  }>;
  gaps: Array<{
    districtId: string;
    areaKm2: number;
  }>;
  slivers: Array<{
    zoneId: string;
    parentId?: string;
    sourceClass?: string;
    areaKm2: number;
  }>;
  parentContainmentErrors: Array<{
    zoneId: string;
    parentId?: string;
    outsideAreaKm2: number;
  }>;
  duplicateGeometryHashes: Array<{
    geometryHash: string;
    zoneIds: string[];
  }>;
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

interface GridRect {
  west: number;
  south: number;
  east: number;
  north: number;
}

type PolygonClippingApi = {
  difference: typeof polygonClipping.difference;
  intersection: typeof polygonClipping.intersection;
  union: typeof polygonClipping.union;
};

const CLIPPER =
  (polygonClipping as unknown as { default?: PolygonClippingApi }).default ??
  (polygonClipping as unknown as PolygonClippingApi);
const EARTH_RADIUS_METERS = 6_371_008.8;
const GEOMETRY_EPSILON = 1e-12;
const RING_AREA_EPSILON = 1e-9;

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
    .flatMap((provider) => {
      if (
        provider.countryCode !== options.countryCode ||
        provider.provinceCode !== options.provinceCode
      ) {
        return [];
      }

      if (!allowed.has(provider.providerClass)) {
        return [];
      }

      if (provider.experimental && !options.allowExperimental) {
        return [];
      }

      if (!isProviderSelectable(provider, Boolean(options.allowExperimental))) {
        return [];
      }

      if (provider.districtCodes && options.districtCode) {
        const specificity = providerSpecificity(provider, options.districtCode);
        return specificity > 0 ? [{ provider, specificity }] : [];
      }

      if (provider.districtCodes && !options.districtCode) {
        return [];
      }

      return provider.enabledByDefault ||
        (provider.experimental && Boolean(options.allowExperimental))
        ? [{ provider, specificity: providerSpecificity(provider, options.districtCode) }]
        : [];
    })
    .sort((left, right) => {
      const leftPriority = priority.indexOf(left.provider.providerClass);
      const rightPriority = priority.indexOf(right.provider.providerClass);

      return (
        leftPriority - rightPriority ||
        right.specificity - left.specificity ||
        left.provider.id.localeCompare(right.provider.id)
      );
    })[0]?.provider;
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
  const issues: TurkeyAdm3RegistryIssue[] = [];
  const districtGeometry = geometryToClippingMultiPolygon(options.district.geometry);
  const realGeometry = unionClippingGeometries(
    (options.realZones ?? []).map((zone) => geometryToClippingMultiPolygon(zone.geometry))
  );
  const missingGeometry = differenceClippingGeometries(
    districtGeometry,
    intersectClippingGeometries(districtGeometry, realGeometry)
  );
  const districtAreaKm2 = clippingAreaKm2(districtGeometry);
  const config = {
    ...createDefaultGeneratedZoneConfig({
      districtAreaKm2,
      realZoneCount: options.realZones?.length ?? 0,
      seed: `${options.district.id}:generated`
    }),
    ...options.config
  };
  const cells = tessellateClippedGeometry(missingGeometry, config);
  let zones = cells.map((geometry, index) =>
    createGeneratedZone({
      district: options.district,
      provinceCode: options.provinceCode,
      geometry,
      cellIndex: index,
      config
    })
  );
  let coverage = computeTurkeyAdm3DistrictCoverage({
    districtId: options.district.id,
    provinceCode: options.provinceCode,
    districtGeometry: options.district.geometry,
    official: options.realZones?.map((zone) => zone.geometry) ?? [],
    generated: zones.map((zone) => zone.geometry)
  });

  if (zones.length > 0 && coverage.finalCoveragePercent < 99.99) {
    const missingTerritoryGeometry = clippingMultiPolygonToTerritoryGeometry(missingGeometry);

    if (missingTerritoryGeometry) {
      zones = [
        createGeneratedZone({
          district: options.district,
          provinceCode: options.provinceCode,
          geometry: missingTerritoryGeometry,
          cellIndex: 0,
          config
        })
      ];
      coverage = computeTurkeyAdm3DistrictCoverage({
        districtId: options.district.id,
        provinceCode: options.provinceCode,
        districtGeometry: options.district.geometry,
        official: options.realZones?.map((zone) => zone.geometry) ?? [],
        generated: zones.map((zone) => zone.geometry)
      });
    }
  }

  return { zones, coverage, issues };
}

export function computeTurkeyAdm3DistrictCoverage(
  input: TurkeyAdm3CoverageInput
): TurkeyAdm3DistrictCoverageReport {
  const districtGeometry = geometryToClippingMultiPolygon(input.districtGeometry);
  const officialCandidate = intersectClippingGeometries(
    districtGeometry,
    unionTerritoryGeometries(input.official ?? [])
  );
  const runtimeCandidate = intersectClippingGeometries(
    districtGeometry,
    unionTerritoryGeometries(input.runtime ?? [])
  );
  const osmCandidate = intersectClippingGeometries(
    districtGeometry,
    unionTerritoryGeometries(input.osm ?? [])
  );
  const officialEffective = officialCandidate;
  const runtimeEffective = differenceClippingGeometries(runtimeCandidate, officialEffective);
  const officialRuntimeUnion = unionClippingGeometries([officialEffective, runtimeEffective]);
  const osmEffective = differenceClippingGeometries(osmCandidate, officialRuntimeUnion);
  const realCoverageGeometry = unionClippingGeometries([
    officialEffective,
    runtimeEffective,
    osmEffective
  ]);
  const missingBeforeGeneratedGeometry = differenceClippingGeometries(
    districtGeometry,
    realCoverageGeometry
  );
  const generatedCandidate = intersectClippingGeometries(
    districtGeometry,
    unionTerritoryGeometries(input.generated ?? [])
  );
  const generatedEffective = differenceClippingGeometries(generatedCandidate, realCoverageGeometry);
  const finalCoverageGeometry = unionClippingGeometries([realCoverageGeometry, generatedEffective]);
  const districtAreaKm2 = clippingAreaKm2(districtGeometry);
  const officialAreaKm2 = clippingAreaKm2(officialEffective);
  const runtimeAreaKm2 = clippingAreaKm2(runtimeEffective);
  const osmAreaKm2 = clippingAreaKm2(osmEffective);
  const realCoverageAreaKm2 = clippingAreaKm2(realCoverageGeometry);
  const missingBeforeGeneratedAreaKm2 = clippingAreaKm2(missingBeforeGeneratedGeometry);
  const generatedAreaKm2 = clippingAreaKm2(generatedEffective);
  const finalCoverageAreaKm2 = clippingAreaKm2(finalCoverageGeometry);
  const realCoveragePercent = percentage(realCoverageAreaKm2, districtAreaKm2);
  const officialCoveragePercent = percentage(officialAreaKm2, districtAreaKm2);
  const runtimeCoveragePercent = percentage(runtimeAreaKm2, districtAreaKm2);
  const osmCoveragePercent = percentage(osmAreaKm2, districtAreaKm2);
  const generatedCoveragePercent = percentage(generatedAreaKm2, districtAreaKm2);
  const finalCoveragePercent = Math.min(100, percentage(finalCoverageAreaKm2, districtAreaKm2));

  return {
    districtId: input.districtId,
    ...(input.provinceCode ? { provinceCode: input.provinceCode } : {}),
    districtAreaKm2,
    officialPolygonCount: input.official?.length ?? 0,
    runtimePolygonCount: input.runtime?.length ?? 0,
    osmPolygonCount: input.osm?.length ?? 0,
    generatedPolygonCount: input.generated?.length ?? 0,
    officialAreaKm2,
    runtimeAreaKm2,
    osmAreaKm2,
    generatedAreaKm2,
    realCoverageAreaKm2,
    missingBeforeGeneratedAreaKm2,
    finalCoverageAreaKm2,
    officialCoveragePercent,
    runtimeCoveragePercent,
    osmCoveragePercent,
    realCoveragePercent,
    missingAreaKm2: missingBeforeGeneratedAreaKm2,
    generatedCoveragePercent,
    finalCoveragePercent
  };
}

export function buildTurkeyAdm3EffectiveZones(
  options: TurkeyAdm3EffectiveZoneBuildOptions
): TurkeyAdm3EffectiveZoneBuildResult {
  const issues: TurkeyAdm3RegistryIssue[] = [];
  const minEffectiveAreaKm2 = options.minEffectiveAreaKm2 ?? 0.000001;
  const districtGeometry = geometryToClippingMultiPolygon(options.district.geometry);
  let priorityMask: ClippingMultiPolygon = [];
  const officialZones = clipTurkeyAdm3ZoneClass({
    zones: options.officialZones ?? [],
    districtGeometry,
    priorityMask,
    sourceClass: "official",
    minEffectiveAreaKm2
  });

  priorityMask = unionClippingGeometries([
    priorityMask,
    unionTerritoryGeometries(officialZones.map((zone) => zone.geometry))
  ]);

  const runtimeZones = clipTurkeyAdm3ZoneClass({
    zones: options.runtimeZones ?? [],
    districtGeometry,
    priorityMask,
    sourceClass: "runtime",
    minEffectiveAreaKm2
  });

  priorityMask = unionClippingGeometries([
    priorityMask,
    unionTerritoryGeometries(runtimeZones.map((zone) => zone.geometry))
  ]);

  const osmZones = clipTurkeyAdm3ZoneClass({
    zones: options.osmZones ?? [],
    districtGeometry,
    priorityMask,
    sourceClass: "osm",
    minEffectiveAreaKm2
  });

  priorityMask = unionClippingGeometries([
    priorityMask,
    unionTerritoryGeometries(osmZones.map((zone) => zone.geometry))
  ]);

  const generatedZones = clipTurkeyAdm3ZoneClass({
    zones: options.generatedZones ?? [],
    districtGeometry,
    priorityMask,
    sourceClass: "generated",
    minEffectiveAreaKm2
  });
  const coverage = computeTurkeyAdm3DistrictCoverage({
    districtId: options.district.id,
    provinceCode: options.provinceCode,
    districtGeometry: options.district.geometry,
    official: officialZones.map((zone) => zone.geometry),
    runtime: runtimeZones.map((zone) => zone.geometry),
    osm: osmZones.map((zone) => zone.geometry),
    generated: generatedZones.map((zone) => zone.geometry)
  });

  return {
    officialZones,
    runtimeZones,
    osmZones,
    generatedZones,
    zones: [...officialZones, ...runtimeZones, ...osmZones, ...generatedZones].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    coverage,
    issues
  };
}

export function inspectTurkeyAdm3SpatialQuality(
  options: TurkeyAdm3SpatialQualityOptions
): TurkeyAdm3SpatialQualityReport {
  const maxAllowedOverlapAreaKm2 = options.maxAllowedOverlapAreaKm2 ?? 0.000001;
  const minSliverAreaKm2 = options.minSliverAreaKm2 ?? 0.00001;
  const parentOutsideToleranceKm2 = options.parentOutsideToleranceKm2 ?? 0.000001;
  const gapToleranceKm2 = options.gapToleranceKm2 ?? 0.0001;
  const districtsById = new Map(options.districts.map((district) => [district.id, district]));
  const zonesByParent = new Map<string, TerritoryZone[]>();
  const overlaps: TurkeyAdm3SpatialQualityReport["overlaps"] = [];
  const gaps: TurkeyAdm3SpatialQualityReport["gaps"] = [];
  const slivers: TurkeyAdm3SpatialQualityReport["slivers"] = [];
  const parentContainmentErrors: TurkeyAdm3SpatialQualityReport["parentContainmentErrors"] = [];
  const geometryHashes = new Map<string, string[]>();

  for (const zone of options.zones) {
    if (zone.parentId) {
      const siblings = zonesByParent.get(zone.parentId) ?? [];
      siblings.push(zone);
      zonesByParent.set(zone.parentId, siblings);
    }

    const areaKm2 = computeTurkeyAdm3GeometryAreaKm2(zone.geometry);
    const territory = isRecord(zone.properties.territory) ? zone.properties.territory : {};
    const sourceClass = readStringPropertyPath(territory, "sourceClass");

    if (areaKm2 > 0 && areaKm2 < minSliverAreaKm2) {
      slivers.push({
        zoneId: zone.id,
        ...(zone.parentId ? { parentId: zone.parentId } : {}),
        ...(sourceClass ? { sourceClass } : {}),
        areaKm2
      });
    }

    const geometryHash = createTurkeyAdm3GeometryHash(zone.geometry);
    const duplicateIds = geometryHashes.get(geometryHash) ?? [];
    duplicateIds.push(zone.id);
    geometryHashes.set(geometryHash, duplicateIds);

    if (zone.parentId) {
      const parent = districtsById.get(zone.parentId);

      if (parent) {
        const outside = differenceClippingGeometries(
          geometryToClippingMultiPolygon(zone.geometry),
          geometryToClippingMultiPolygon(parent.geometry)
        );
        const outsideAreaKm2 = clippingAreaKm2(outside);

        if (outsideAreaKm2 > parentOutsideToleranceKm2) {
          parentContainmentErrors.push({
            zoneId: zone.id,
            parentId: zone.parentId,
            outsideAreaKm2
          });
        }
      }
    }
  }

  for (const [parentId, siblings] of zonesByParent.entries()) {
    const sorted = siblings.sort((left, right) => left.id.localeCompare(right.id));

    for (let index = 0; index < sorted.length; index += 1) {
      const left = sorted[index];

      if (!left) {
        continue;
      }

      for (let nextIndex = index + 1; nextIndex < sorted.length; nextIndex += 1) {
        const right = sorted[nextIndex];

        if (!right || !bboxesOverlap(left.bbox, right.bbox)) {
          continue;
        }

        const overlapAreaKm2 = clippingAreaKm2(
          intersectClippingGeometries(
            geometryToClippingMultiPolygon(left.geometry),
            geometryToClippingMultiPolygon(right.geometry)
          )
        );

        if (overlapAreaKm2 > maxAllowedOverlapAreaKm2) {
          overlaps.push({
            leftZoneId: left.id,
            rightZoneId: right.id,
            parentId,
            areaKm2: overlapAreaKm2
          });
        }
      }
    }
  }

  for (const district of options.districts) {
    const zones = zonesByParent.get(district.id) ?? [];
    const union = unionTerritoryGeometries(zones.map((zone) => zone.geometry));
    const gap = differenceClippingGeometries(
      geometryToClippingMultiPolygon(district.geometry),
      union
    );
    const clippedGapAreaKm2 = clippingAreaKm2(gap);
    const districtAreaKm2 = computeTurkeyAdm3GeometryAreaKm2(district.geometry);
    const zoneAreaKm2 = zones.reduce(
      (total, zone) => total + computeTurkeyAdm3GeometryAreaKm2(zone.geometry),
      0
    );
    const overlapAreaKm2 = overlaps
      .filter((overlap) => overlap.parentId === district.id)
      .reduce((total, overlap) => total + overlap.areaKm2, 0);
    const estimatedGapAreaKm2 = Math.max(0, districtAreaKm2 - (zoneAreaKm2 - overlapAreaKm2));
    const areaKm2 =
      clippedGapAreaKm2 > districtAreaKm2 * 0.25 && estimatedGapAreaKm2 < clippedGapAreaKm2
        ? Number(estimatedGapAreaKm2.toFixed(6))
        : clippedGapAreaKm2;

    if (areaKm2 > gapToleranceKm2) {
      gaps.push({
        districtId: district.id,
        areaKm2
      });
    }
  }

  const duplicateGeometryHashes = [...geometryHashes.entries()]
    .filter(([, zoneIds]) => zoneIds.length > 1)
    .map(([geometryHash, zoneIds]) => ({
      geometryHash,
      zoneIds: zoneIds.sort()
    }))
    .sort((left, right) => left.geometryHash.localeCompare(right.geometryHash));

  return {
    schemaVersion: "territorykit-tr-adm3-spatial-quality@1",
    ok:
      overlaps.length === 0 &&
      gaps.length === 0 &&
      parentContainmentErrors.length === 0 &&
      duplicateGeometryHashes.length === 0,
    summary: {
      overlapCount: overlaps.length,
      gapCount: gaps.length,
      sliverCount: slivers.length,
      parentContainmentErrors: parentContainmentErrors.length,
      duplicateGeometryCount: duplicateGeometryHashes.length
    },
    overlaps: overlaps.sort((left, right) => left.leftZoneId.localeCompare(right.leftZoneId)),
    gaps: gaps.sort((left, right) => left.districtId.localeCompare(right.districtId)),
    slivers: slivers.sort((left, right) => left.zoneId.localeCompare(right.zoneId)),
    parentContainmentErrors: parentContainmentErrors.sort((left, right) =>
      left.zoneId.localeCompare(right.zoneId)
    ),
    duplicateGeometryHashes
  };
}

export function createTurkeyAdm3GeneratedMigrationReport(input: {
  generatedAt: string;
  oldGeneratedZones: readonly TerritoryZone[];
  newOfficialZones: readonly TerritoryZone[];
}): TurkeyAdm3GeneratedMigrationReport {
  const migrations = input.oldGeneratedZones.flatMap((generatedZone) => {
    const generatedGeometry = geometryToClippingMultiPolygon(generatedZone.geometry);
    const generatedAreaKm2 = clippingAreaKm2(generatedGeometry);
    const best = input.newOfficialZones
      .map((officialZone) => {
        const officialGeometry = geometryToClippingMultiPolygon(officialZone.geometry);
        const overlapAreaKm2 = clippingAreaKm2(
          intersectClippingGeometries(generatedGeometry, officialGeometry)
        );
        const overlapPercent = percentage(overlapAreaKm2, generatedAreaKm2);

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
  geometry: TerritoryGeometry;
  cellIndex: number;
  config: GeneratedZoneConfig;
}): TerritoryZone {
  const geometry = input.geometry;
  const geometryHash = createTurkeyAdm3GeometryHash(geometry);
  const districtTerritory = isRecord(input.district.properties.territory)
    ? input.district.properties.territory
    : {};
  const districtCode =
    readStringPropertyPath(districtTerritory, "districtCode") ??
    input.district.id.replace(/^tr:adm2:/, "");
  const cellId = [
    input.config.algorithmVersion,
    input.config.seed,
    input.district.id,
    input.cellIndex,
    geometryHash
  ].join(":");
  const localId = [
    `tr-${input.provinceCode}`,
    input.district.id.replace(/^tr:adm2:/, "adm2-"),
    "generated",
    input.config.algorithmVersion,
    sha256Hex(cellId).slice(0, 16)
  ].join("-");
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
    semanticType: "generated-zone",
    name: `Generated zone ${input.cellIndex + 1}`,
    localName: `Zone ${input.cellIndex + 1}`,
    parentId: input.district.id,
    neighborIds: [],
    geometry,
    center: computeGeometryRepresentativePoint(geometry),
    bbox,
    properties: {
      territory: {
        adminLevel: "ADM3",
        sourceAdminLevel: "ADM3",
        semanticType: "generated-zone",
        localType: "generated-zone",
        localTypeName: "Generated game zone",
        countryCode: "TR",
        provinceCode: input.provinceCode,
        districtCode,
        hierarchyDepth: 3,
        parentId: input.district.id,
        coverageStatus: "generated",
        semanticReviewStatus: "not-applicable",
        sourceClass: "generated",
        sourceProvider: "territory-kit-generated",
        sourceDatasetId: "tr-adm3-generated",
        sourceNativeId: id,
        sourceDate: input.config.algorithmVersion,
        license: "Apache-2.0",
        attribution: "TerritoryKit generated game zones from ADM2 boundaries",
        official: false,
        generated: true,
        algorithmVersion: input.config.algorithmVersion,
        generationSeed: input.config.seed,
        stableId: id,
        parentAdm2Id: input.district.id,
        geometryHash,
        source: {
          provider: "territory-kit-generated",
          sourceClass: "generated",
          sourceDatasetId: "tr-adm3-generated",
          sourceId: id,
          sourceNativeId: id,
          sourceDate: input.config.algorithmVersion,
          license: "Apache-2.0",
          attribution: "TerritoryKit generated game zones from ADM2 boundaries"
        },
        generatedZone: {
          algorithm: "deterministic-clipped-grid-tessellation",
          algorithmVersion: input.config.algorithmVersion,
          seed: input.config.seed,
          generationSeed: input.config.seed,
          localKey: localId,
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

function clipTurkeyAdm3ZoneClass(input: {
  zones: readonly TerritoryZone[];
  districtGeometry: ClippingMultiPolygon;
  priorityMask: ClippingMultiPolygon;
  sourceClass: TurkeyAdm3ProviderClass;
  minEffectiveAreaKm2: number;
}): TerritoryZone[] {
  const zones: TerritoryZone[] = [];
  let localPriorityMask = input.priorityMask;

  for (const zone of input.zones) {
    const original = geometryToClippingMultiPolygon(zone.geometry);
    const districtClipped = intersectClippingGeometries(input.districtGeometry, original);
    const effective = differenceClippingGeometries(districtClipped, localPriorityMask);
    const areaKm2 = clippingAreaKm2(effective);
    const residualPriorityOverlapKm2 =
      input.sourceClass === "official"
        ? 0
        : clippingAreaKm2(intersectClippingGeometries(effective, localPriorityMask));
    const geometry =
      areaKm2 >= input.minEffectiveAreaKm2 &&
      residualPriorityOverlapKm2 <= input.minEffectiveAreaKm2
        ? clippingMultiPolygonToTerritoryGeometry(effective)
        : undefined;

    if (!geometry) {
      continue;
    }

    zones.push(
      createEffectiveTurkeyAdm3Zone({
        zone,
        geometry,
        sourceClass: input.sourceClass,
        originalGeometry: original,
        effectiveGeometry: effective
      })
    );
    localPriorityMask = unionClippingGeometries([localPriorityMask, effective]);
  }

  return zones;
}

function createEffectiveTurkeyAdm3Zone(input: {
  zone: TerritoryZone;
  geometry: TerritoryGeometry;
  sourceClass: TurkeyAdm3ProviderClass;
  originalGeometry: ClippingMultiPolygon;
  effectiveGeometry: ClippingMultiPolygon;
}): TerritoryZone {
  const territory = isRecord(input.zone.properties.territory)
    ? input.zone.properties.territory
    : {};
  const originalTerritoryGeometry =
    clippingMultiPolygonToTerritoryGeometry(input.originalGeometry) ?? input.zone.geometry;
  const effectiveGeometryHash = createTurkeyAdm3GeometryHash(input.geometry);
  const originalGeometryHash = createTurkeyAdm3GeometryHash(originalTerritoryGeometry);
  const clippedByPriority = originalGeometryHash !== effectiveGeometryHash;
  const bbox = computeGeometryBBox(input.geometry);

  return {
    ...input.zone,
    geometry: input.geometry,
    bbox,
    center: computeGeometryRepresentativePoint(input.geometry),
    properties: {
      ...input.zone.properties,
      territory: {
        ...territory,
        sourceClass: input.sourceClass,
        originalGeometryHash,
        effectiveGeometryHash,
        geometryHash: effectiveGeometryHash,
        clippedByPriority,
        sourceNativeId:
          readStringPropertyPath(territory, "sourceNativeId") ??
          readStringPropertyPath(territory, "sourceId") ??
          readStringPropertyPath(territory, "source.sourceId") ??
          input.zone.id
      }
    }
  };
}

function tessellateClippedGeometry(
  missingGeometry: ClippingMultiPolygon,
  config: GeneratedZoneConfig
): TerritoryGeometry[] {
  const missingAreaKm2 = clippingAreaKm2(missingGeometry);

  if (missingAreaKm2 < config.minFragmentAreaKm2) {
    return [];
  }

  if (missingAreaKm2 <= config.maxAreaKm2) {
    const geometry = clippingMultiPolygonToTerritoryGeometry(missingGeometry);
    return geometry ? [geometry] : [];
  }

  const bbox = clippingBBox(missingGeometry);
  const rect = bboxToGridRect(bbox);
  const targetCells = Math.max(
    1,
    Math.min(config.maxZonesPerDistrict, Math.ceil(missingAreaKm2 / config.targetAreaKm2))
  );
  const centerLatitude = (rect.south + rect.north) / 2;
  const widthKm = Math.max(
    GEOMETRY_EPSILON,
    (rect.east - rect.west) * kilometersPerLongitudeDegree(centerLatitude)
  );
  const heightKm = Math.max(GEOMETRY_EPSILON, (rect.north - rect.south) * 111.32);
  const aspect = widthKm / heightKm;
  const columns = Math.max(
    1,
    Math.ceil(Math.sqrt(targetCells * Math.max(aspect, GEOMETRY_EPSILON)))
  );
  const rows = Math.max(1, Math.ceil(targetCells / columns));
  const cellWidth = (rect.east - rect.west) / columns;
  const cellHeight = (rect.north - rect.south) / rows;
  const cells: ClippingMultiPolygon[] = [];
  let subdivisionFailed = false;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cellRect = normalizeGridRect({
        west: rect.west + column * cellWidth,
        south: rect.south + row * cellHeight,
        east: column === columns - 1 ? rect.east : rect.west + (column + 1) * cellWidth,
        north: row === rows - 1 ? rect.north : rect.south + (row + 1) * cellHeight
      });
      let clipped: ClippingMultiPolygon;

      try {
        clipped = intersectClippingGeometries(
          missingGeometry,
          geometryToClippingMultiPolygon(gridRectToPolygon(cellRect))
        );
      } catch {
        subdivisionFailed = true;
        break;
      }

      if (clippingAreaKm2(clipped) >= config.minFragmentAreaKm2) {
        cells.push(clipped);
      }
    }

    if (subdivisionFailed) {
      break;
    }
  }

  if (subdivisionFailed) {
    const geometry = clippingMultiPolygonToTerritoryGeometry(missingGeometry);
    return geometry ? [geometry] : [];
  }

  if (cells.length === 0) {
    const geometry = clippingMultiPolygonToTerritoryGeometry(missingGeometry);
    return geometry ? [geometry] : [];
  }

  try {
    return coalesceClippedCells(cells.sort(compareClippingGeometries), config.maxZonesPerDistrict)
      .map(clippingMultiPolygonToTerritoryGeometry)
      .filter((geometry): geometry is TerritoryGeometry => Boolean(geometry))
      .sort(compareTerritoryGeometries);
  } catch {
    const geometry = clippingMultiPolygonToTerritoryGeometry(missingGeometry);
    return geometry ? [geometry] : [];
  }
}

function coalesceClippedCells(
  cells: readonly ClippingMultiPolygon[],
  maxZones: number
): ClippingMultiPolygon[] {
  if (cells.length <= maxZones) {
    return [...cells];
  }

  const stride = Math.ceil(cells.length / maxZones);
  const merged: ClippingMultiPolygon[] = [];

  for (let index = 0; index < cells.length; index += stride) {
    merged.push(unionClippingGeometries(cells.slice(index, index + stride)));
  }

  return merged.filter(isNonEmptyClippingGeometry).sort(compareClippingGeometries);
}

function unionTerritoryGeometries(geometries: readonly TerritoryGeometry[]): ClippingMultiPolygon {
  return unionClippingGeometries(geometries.map(geometryToClippingMultiPolygon));
}

function unionClippingGeometries(
  geometries: readonly ClippingMultiPolygon[]
): ClippingMultiPolygon {
  const nonEmpty = geometries.filter(isNonEmptyClippingGeometry);

  if (nonEmpty.length === 0) {
    return [];
  }

  if (nonEmpty.length === 1) {
    return nonEmpty[0]!;
  }

  try {
    return CLIPPER.union(nonEmpty[0]!, ...nonEmpty.slice(1));
  } catch {
    return nonEmpty.flatMap((geometry) => geometry);
  }
}

function intersectClippingGeometries(
  left: ClippingMultiPolygon,
  right: ClippingMultiPolygon
): ClippingMultiPolygon {
  if (!isNonEmptyClippingGeometry(left) || !isNonEmptyClippingGeometry(right)) {
    return [];
  }

  try {
    return CLIPPER.intersection(left, right);
  } catch {
    return right;
  }
}

function differenceClippingGeometries(
  subject: ClippingMultiPolygon,
  ...clips: readonly ClippingMultiPolygon[]
): ClippingMultiPolygon {
  const nonEmptyClips = clips.filter(isNonEmptyClippingGeometry);

  if (!isNonEmptyClippingGeometry(subject)) {
    return [];
  }

  if (nonEmptyClips.length === 0) {
    return subject;
  }

  try {
    return CLIPPER.difference(subject, ...nonEmptyClips);
  } catch {
    let result = subject;

    for (const clip of nonEmptyClips) {
      for (const clipPolygon of clip) {
        if (!isNonEmptyClippingGeometry(result)) {
          return [];
        }

        try {
          result = CLIPPER.difference(result, [clipPolygon]);
        } catch {
          continue;
        }
      }
    }

    return result;
  }
}

function geometryToClippingMultiPolygon(geometry: TerritoryGeometry): ClippingMultiPolygon {
  return geometryToPolygons(geometry)
    .map((polygon) => {
      const rings = polygon
        .map(normalizeRing)
        .filter((ring) => ring.length >= 4 && ringHasArea(ring));
      return rings.length > 0 ? (rings as ClippingPolygon) : undefined;
    })
    .filter((polygon): polygon is ClippingPolygon => Boolean(polygon));
}

function clippingMultiPolygonToTerritoryGeometry(
  geometry: ClippingMultiPolygon
): TerritoryGeometry | undefined {
  const polygons = geometry
    .map((polygon) =>
      polygon.map(normalizeRing).filter((ring) => ring.length >= 4 && ringHasArea(ring))
    )
    .filter((polygon) => polygon.length > 0);

  if (polygons.length === 0) {
    return undefined;
  }

  if (polygons.length === 1) {
    return {
      type: "Polygon",
      coordinates: polygons[0]!
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: polygons
  };
}

export function computeTurkeyAdm3GeometryAreaKm2(geometry: TerritoryGeometry): number {
  return clippingAreaKm2(geometryToClippingMultiPolygon(geometry));
}

function clippingAreaKm2(geometry: ClippingMultiPolygon): number {
  const areaM2 = geometry.reduce(
    (total, polygon) => total + Math.max(0, polygonAreaM2(polygon)),
    0
  );

  return roundAreaKm2(areaM2 / 1_000_000);
}

function polygonAreaM2(polygon: ClippingPolygon): number {
  const [shell, ...holes] = polygon;

  if (!shell) {
    return 0;
  }

  const shellArea = Math.abs(ringGeodesicAreaM2(shell));
  const holeArea = holes.reduce((total, hole) => total + Math.abs(ringGeodesicAreaM2(hole)), 0);
  return Math.max(0, shellArea - holeArea);
}

function ringGeodesicAreaM2(ring: readonly LngLat[]): number {
  let total = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];

    if (!current || !next) {
      continue;
    }

    const deltaLongitude = normalizeRadians(toRadians(next[0] - current[0]));
    total += deltaLongitude * (2 + Math.sin(toRadians(current[1])) + Math.sin(toRadians(next[1])));
  }

  return (total * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2;
}

function clippingBBox(geometry: ClippingMultiPolygon): TerritoryBBox {
  const territoryGeometry = clippingMultiPolygonToTerritoryGeometry(geometry);
  return territoryGeometry ? computeGeometryBBox(territoryGeometry) : [0, 0, 0, 0];
}

function gridRectToPolygon(rect: GridRect): TerritoryGeometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [rect.west, rect.south],
        [rect.east, rect.south],
        [rect.east, rect.north],
        [rect.west, rect.north],
        [rect.west, rect.south]
      ]
    ]
  };
}

function bboxToGridRect(bbox: TerritoryBBox): GridRect {
  return normalizeGridRect({
    west: bbox[0],
    south: bbox[1],
    east: bbox[2],
    north: bbox[3]
  });
}

function normalizeGridRect(rect: GridRect): GridRect {
  return {
    west: Math.min(rect.west, rect.east),
    south: Math.min(rect.south, rect.north),
    east: Math.max(rect.west, rect.east),
    north: Math.max(rect.south, rect.north)
  };
}

function normalizeRing(ring: readonly (readonly [number, number])[]): LngLat[] {
  const coordinates = ring
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => [Number(point[0]), Number(point[1])] satisfies LngLat);

  if (coordinates.length === 0) {
    return [];
  }

  const first = coordinates[0]!;
  const last = coordinates[coordinates.length - 1]!;

  if (!coordinatesEqual(first, last)) {
    coordinates.push([...first]);
  }

  return coordinates;
}

function isNonEmptyClippingGeometry(
  geometry: ClippingMultiPolygon
): geometry is ClippingMultiPolygon {
  return geometry.length > 0;
}

function compareTerritoryGeometries(left: TerritoryGeometry, right: TerritoryGeometry): number {
  return compareBBoxes(computeGeometryBBox(left), computeGeometryBBox(right));
}

function compareClippingGeometries(
  left: ClippingMultiPolygon,
  right: ClippingMultiPolygon
): number {
  return compareBBoxes(clippingBBox(left), clippingBBox(right));
}

function compareBBoxes(left: TerritoryBBox, right: TerritoryBBox): number {
  return left[1] - right[1] || left[0] - right[0] || left[3] - right[3] || left[2] - right[2];
}

function bboxesOverlap(left: TerritoryBBox, right: TerritoryBBox): boolean {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

function coordinatesEqual(left: LngLat, right: LngLat): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function ringHasArea(ring: readonly LngLat[]): boolean {
  let area = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];

    if (current && next) {
      area += current[0] * next[1] - next[0] * current[1];
    }
  }

  return Math.abs(area / 2) > RING_AREA_EPSILON;
}

function kilometersPerLongitudeDegree(latitude: number): number {
  return Math.max(GEOMETRY_EPSILON, 111.32 * Math.cos(toRadians(latitude)));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function normalizeRadians(radians: number): number {
  if (radians > Math.PI) {
    return radians - Math.PI * 2;
  }

  if (radians < -Math.PI) {
    return radians + Math.PI * 2;
  }

  return radians;
}

function roundAreaKm2(value: number): number {
  return Number(value.toFixed(6));
}

function percentage(value: number, total: number): number {
  return total <= 0 ? 0 : roundPercent((value / total) * 100);
}

function roundPercent(value: number): number {
  return Number(value.toFixed(6));
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

function isProviderSelectable(
  provider: TurkeyAdm3ProviderRecord,
  allowExperimental: boolean
): boolean {
  if (provider.providerClass === "experimental") {
    return allowExperimental && provider.status === "experimental";
  }

  return provider.status === "verified" || provider.status === "reachable";
}

function providerSpecificity(
  provider: TurkeyAdm3ProviderRecord,
  districtCode: string | undefined
): number {
  if (!provider.districtCodes || provider.districtCodes.length === 0) {
    return 1;
  }

  if (!districtCode || !provider.districtCodes.includes(districtCode)) {
    return 0;
  }

  return provider.districtCodes.length === 1 ? 3 : 2;
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
