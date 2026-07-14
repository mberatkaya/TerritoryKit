import { mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createTerritoryEngine } from "@territory-kit/core";
import {
  TERRITORY_SCHEMA_VERSION,
  computeGeometryBBox,
  computeGeometryCenter,
  validateGeometryDataset,
  validateTerritoryDataset
} from "@territory-kit/dataset";
import type {
  TerritoryDataset,
  TerritoryGeometry,
  TerritoryGlobalMetadata,
  TerritoryZone
} from "@territory-kit/dataset";
import {
  NATURAL_EARTH_ADM0_DATASET_NAME,
  NATURAL_EARTH_ADM0_SOURCE_URL,
  NATURAL_EARTH_ATTRIBUTION,
  NATURAL_EARTH_PROVIDER,
  NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
  createWorldCountriesAdm0ArtifactPlan,
  parseNaturalEarthAdm0FeatureCollection,
  resolveBuildDate
} from "./natural-earth.js";
import type { NaturalEarthAdm0Detail } from "./natural-earth.js";
import { ISO_3166_COUNTRIES } from "./countries/iso3166.js";
import { fetchHttpSourceArtifact } from "./sources/transports/http.js";
import {
  createDatasetGeometryHash,
  isRecord,
  serializeJsonStable,
  sha256Hex,
  writeFilesAtomically
} from "./sources/utils.js";

export const GLOBAL_ADMIN_DATASET_ID = "global-admin" as const;
export const GLOBAL_ADMIN_ADM0_OUTPUT = "datasets/generated/global/ADM0" as const;
export const GLOBAL_ADMIN_WORLD_ID = "territory:global-admin:WORLD" as const;
export const NATURAL_EARTH_ADM0_GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson" as const;

export interface GlobalAdminAdm0BuildOptions {
  sourcePath?: string;
  sourceUrl?: string;
  outputPath: string;
  cacheDir?: string;
  buildDate?: string;
  datasetVersion?: string;
  sourceDate?: string;
  sourceVersion?: string;
  force?: boolean;
  cwd?: string;
}

export interface GlobalAdminAdm0BuildResult {
  ok: boolean;
  outputPath: string;
  featureCount: number;
  validatedArtifactCount: number;
  issues: Array<{ code: string; message: string; severity: "error" | "warning" }>;
  smoke: GlobalAdminSmokeReport;
  files: Map<string, string>;
}

export interface GlobalAdminSmokeReport {
  ok: boolean;
  checks: Array<{
    name: string;
    ok: boolean;
    expected?: string;
    actual?: string | null | number;
  }>;
}

type DetailName = "low" | "medium" | "full";

const DETAIL_MAP: Record<DetailName, NaturalEarthAdm0Detail> = {
  full: "high",
  low: "low",
  medium: "medium"
};

export async function buildGlobalAdminAdm0Artifacts(
  options: GlobalAdminAdm0BuildOptions
): Promise<GlobalAdminAdm0BuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const outputPath = resolve(cwd, options.outputPath);
  const buildDate = resolveBuildDate(options.buildDate, process.env);
  const source = await resolveGlobalAdm0Source({
    cwd,
    buildDate,
    ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
    sourceUrl: options.sourceUrl ?? NATURAL_EARTH_ADM0_GEOJSON_URL,
    ...(options.cacheDir ? { cacheDir: options.cacheDir } : {})
  });
  const input = JSON.parse(await readFile(source.localPath, "utf8")) as unknown;
  const sourceDescriptor = {
    provider: NATURAL_EARTH_PROVIDER,
    datasetName: NATURAL_EARTH_ADM0_DATASET_NAME,
    version: options.sourceVersion ?? source.version ?? "natural-earth-vector-master",
    sourcePath: source.localPath,
    sourceUrl: source.sourceUrl,
    sourceSha256: source.sha256,
    license: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
    attribution: NATURAL_EARTH_ATTRIBUTION,
    sourceDate: options.sourceDate ?? options.sourceVersion ?? source.version ?? "unknown",
    importedAt: buildDate
  };
  const naturalEarthPlan = createWorldCountriesAdm0ArtifactPlan(input, {
    buildDate,
    datasetVersion: options.datasetVersion,
    details: ["low", "medium", "high"],
    source: sourceDescriptor
  });
  const naturalEarthParse = parseNaturalEarthAdm0FeatureCollection(input, sourceDescriptor);
  const isoCodes = new Set(ISO_3166_COUNTRIES.map((country) => country.iso2));
  const sourceCodes = new Set(naturalEarthParse.records.map((record) => record.iso3166_1));
  const unmatchedIso = ISO_3166_COUNTRIES.filter((country) => !sourceCodes.has(country.iso2));
  const nonIsoSource = extractNonIsoSourceEntities(input, isoCodes);
  const worldChildIds: string[] = [];
  const detailDatasets = new Map<DetailName, TerritoryDataset>();
  const issues: GlobalAdminAdm0BuildResult["issues"] = naturalEarthPlan.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    severity: issue.severity
  }));

  for (const detailName of ["low", "medium", "full"] as const) {
    const naturalEarthDetail = DETAIL_MAP[detailName];
    const sourceDataset = JSON.parse(
      naturalEarthPlan.files.get(`${naturalEarthDetail}/dataset.json`) ?? "{}"
    ) as TerritoryDataset;
    const zones = sourceDataset.zones.map((zone) => {
      const adminZone = rebaseAdm0Zone(zone, detailName, buildDate);
      worldChildIds.push(adminZone.id);
      return adminZone;
    });
    const world = createWorldZone({
      datasetVersion: options.datasetVersion ?? "0.1.0",
      buildDate,
      childIds: [...new Set(worldChildIds)].sort()
    });
    const dataset = finalizeGlobalAdminDataset({
      zones: [world, ...zones].sort((left, right) => left.id.localeCompare(right.id)),
      detail: detailName,
      buildDate,
      datasetVersion: options.datasetVersion ?? "0.1.0",
      sourceDate: sourceDescriptor.sourceDate
    });
    const validation = validateTerritoryDataset(dataset);
    const geometry = validateGeometryDataset(dataset, { checks: "full" });

    if (!validation.ok) {
      issues.push(
        ...validation.issues.map((issue) => ({
          code: `DATASET_${issue.code}`,
          message: issue.message,
          severity: issue.severity
        }))
      );
    }

    if (!geometry.ok) {
      issues.push(
        ...geometry.issues
          .filter((issue) => issue.severity !== "info")
          .map((issue) => ({
            code: `GEOMETRY_${issue.code}`,
            message: issue.message,
            severity: (issue.severity === "error" ? "error" : "warning") as "error" | "warning"
          }))
      );
    }

    detailDatasets.set(detailName, dataset);
  }

  const fullDataset = detailDatasets.get("full");
  const mediumDataset = detailDatasets.get("medium");
  const lowDataset = detailDatasets.get("low");

  if (!fullDataset || !mediumDataset || !lowDataset) {
    throw new Error("Global ADM0 detail datasets were not created.");
  }

  const files = new Map<string, string>();
  files.set("dataset.json", serializeJsonStable(fullDataset));
  files.set("full.geojson", serializeJsonStable(datasetToFeatureCollection(fullDataset)));
  files.set("medium.geojson", serializeJsonStable(datasetToFeatureCollection(mediumDataset)));
  files.set("low.geojson", serializeJsonStable(datasetToFeatureCollection(lowDataset)));
  files.set("index.json", serializeJsonStable(createSpatialIndex(fullDataset)));
  files.set(
    "validation-report.json",
    serializeJsonStable({
      reportVersion: "1",
      dataset: validateTerritoryDataset(fullDataset),
      geometry: validateGeometryDataset(fullDataset, { checks: "full" })
    })
  );
  files.set(
    "attribution.json",
    serializeJsonStable({
      providerId: NATURAL_EARTH_PROVIDER,
      sourceUrl: source.sourceUrl,
      downloadUrl: source.sourceUrl,
      licence: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
      attribution: NATURAL_EARTH_ATTRIBUTION,
      redistributionPermission: true,
      commercialUsePermission: true,
      sourceDate: sourceDescriptor.sourceDate,
      downloadDate: buildDate,
      originalChecksum: source.sha256,
      transformedArtifactChecksum: sha256Hex(serializeJsonStable(fullDataset)),
      country: "GLOBAL",
      sourceAdministrativeLevel: "ADM0"
    })
  );
  files.set(
    "manifest.json",
    serializeJsonStable({
      manifestVersion: "1",
      datasetId: GLOBAL_ADMIN_DATASET_ID,
      datasetVersion: options.datasetVersion ?? "0.1.0",
      schemaVersion: TERRITORY_SCHEMA_VERSION,
      sourceProvider: NATURAL_EARTH_PROVIDER,
      sourceDatasetName: NATURAL_EARTH_ADM0_DATASET_NAME,
      sourceUrl: source.sourceUrl,
      sourceChecksum: source.sha256,
      supportedLevels: ["world", "ADM0"],
      geometryVariants: {
        full: { path: "full.geojson", naturalEarthDetail: "high", simplification: "source" },
        medium: {
          path: "medium.geojson",
          naturalEarthDetail: "medium",
          simplification: "natural-earth-detail"
        },
        low: {
          path: "low.geojson",
          naturalEarthDetail: "low",
          simplification: "natural-earth-detail"
        }
      },
      artifacts: {
        dataset: "dataset.json",
        full: "full.geojson",
        medium: "medium.geojson",
        low: "low.geojson",
        index: "index.json",
        validationReport: "validation-report.json",
        attribution: "attribution.json",
        unmatchedReport: "unmatched-report.json"
      },
      featureCount: fullDataset.zones.filter((zone) => zone.sourceAdminLevel === "ADM0").length,
      rootZoneId: GLOBAL_ADMIN_WORLD_ID,
      buildDate,
      license: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
      attribution: NATURAL_EARTH_ATTRIBUTION,
      artifactStatus: "built"
    })
  );
  files.set(
    "unmatched-report.json",
    serializeJsonStable({
      reportVersion: "1",
      unmatchedIsoCountries: unmatchedIso.map((country) => ({
        iso2: country.iso2,
        iso3: country.iso3,
        name: country.name
      })),
      nonIsoSourceEntities: nonIsoSource
    })
  );
  const smoke = issues.some((issue) => issue.severity === "error")
    ? {
        ok: false,
        checks: [
          {
            name: "loader-smoke",
            ok: false,
            expected: "valid dataset",
            actual: "skipped because validation errors were reported"
          }
        ]
      }
    : smokeGlobalAdm0Dataset(fullDataset);
  files.set("smoke-report.json", serializeJsonStable(smoke));

  const checksums = Object.fromEntries(
    [...files.entries()].map(([path, content]) => [path, sha256Hex(content)]).sort()
  );
  files.set("checksums.json", serializeJsonStable({ algorithm: "sha256", files: checksums }));

  if (issues.every((issue) => issue.severity !== "error")) {
    await writeFilesAtomically(outputPath, files, { force: options.force ?? false });
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error") && smoke.ok,
    outputPath,
    featureCount: fullDataset.zones.filter((zone) => zone.sourceAdminLevel === "ADM0").length,
    validatedArtifactCount: 1,
    issues,
    smoke,
    files
  };
}

async function resolveGlobalAdm0Source(options: {
  cwd: string;
  buildDate: string;
  sourcePath?: string;
  sourceUrl: string;
  cacheDir?: string;
}): Promise<{ localPath: string; sourceUrl: string; sha256: string; version?: string }> {
  if (options.sourcePath) {
    const localPath = resolve(options.cwd, options.sourcePath);
    const content = await readFile(localPath);
    return {
      localPath,
      sourceUrl: options.sourceUrl,
      sha256: sha256Hex(new Uint8Array(content))
    };
  }

  const destinationDirectory = resolve(
    options.cwd,
    options.cacheDir ?? ".territory/cache/global-admin"
  );
  await mkdir(destinationDirectory, { recursive: true });
  const artifact = await fetchHttpSourceArtifact({
    provider: NATURAL_EARTH_PROVIDER,
    url: options.sourceUrl,
    destinationDirectory,
    maxSourceSizeBytes: 32 * 1024 * 1024,
    now: () => options.buildDate
  });

  return {
    localPath: artifact.localPath,
    sourceUrl: artifact.originalUrl ?? options.sourceUrl,
    sha256: artifact.sha256,
    ...(artifact.sourceVersion ? { version: artifact.sourceVersion } : {})
  };
}

function extractNonIsoSourceEntities(
  input: unknown,
  isoCodes: ReadonlySet<string>
): Array<Record<string, string>> {
  if (!isRecord(input) || !Array.isArray(input.features)) {
    return [];
  }

  return input.features.flatMap((feature, index) => {
    if (!isRecord(feature) || !isRecord(feature.properties)) {
      return [];
    }

    const properties = feature.properties;
    const iso2 = readString(properties.ISO_A2) ?? readString(properties.ISO_A2_EH);
    const sourceCode =
      readString(properties.ADM0_A3) ??
      readString(properties.ISO_A3) ??
      readString(properties.SOV_A3) ??
      readString(properties.BRK_A3);

    if (!sourceCode || sourceCode === "-99") {
      return [];
    }

    if (iso2 && iso2 !== "-99" && isoCodes.has(iso2.toUpperCase())) {
      return [];
    }

    return [
      {
        sourceCode,
        name:
          readString(properties.NAME) ??
          readString(properties.ADMIN) ??
          readString(properties.SOVEREIGNT) ??
          sourceCode,
        featureIndex: String(index)
      }
    ];
  });
}

function rebaseAdm0Zone(zone: TerritoryZone, detail: DetailName, buildDate: string): TerritoryZone {
  const territory = isRecord(zone.properties.territory) ? zone.properties.territory : {};
  const codes = isRecord(territory.codes) ? territory.codes : {};
  const sourceCode =
    readString(codes.source) ?? readString(codes.iso3166_1) ?? zone.countryCode ?? zone.id;
  const countryCode = (zone.countryCode ?? readString(codes.iso3166_1) ?? zone.id).toUpperCase();
  const id = `territory:global-admin:${countryCode}:ADM0:${sourceCode.toUpperCase()}`;
  const metadata: TerritoryGlobalMetadata & Record<string, unknown> = {
    ...(isRecord(zone.properties.territory) ? zone.properties.territory : {}),
    adminLevel: "ADM0",
    localType: "country",
    source: {
      provider: NATURAL_EARTH_PROVIDER,
      sourceId: sourceCode,
      sourceUrl: NATURAL_EARTH_ADM0_SOURCE_URL,
      importedAt: buildDate,
      license: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
      attribution: NATURAL_EARTH_ATTRIBUTION
    },
    geometryVariant: detail
  };

  return {
    ...zone,
    id,
    datasetId: GLOBAL_ADMIN_DATASET_ID,
    level: 1,
    parentId: GLOBAL_ADMIN_WORLD_ID,
    countryCode,
    sourceAdminLevel: "ADM0",
    semanticType: "country",
    childIds: [],
    properties: {
      ...zone.properties,
      id,
      parentId: GLOBAL_ADMIN_WORLD_ID,
      countryCode,
      level: 1,
      sourceAdminLevel: "ADM0",
      semanticType: "country",
      territory: metadata
    }
  };
}

function createWorldZone(input: {
  datasetVersion: string;
  buildDate: string;
  childIds: string[];
}): TerritoryZone {
  const geometry: TerritoryGeometry = {
    type: "Polygon",
    coordinates: [
      [
        [-180, -90],
        [180, -90],
        [180, 90],
        [-180, 90],
        [-180, -90]
      ]
    ]
  };

  return {
    id: GLOBAL_ADMIN_WORLD_ID,
    datasetId: GLOBAL_ADMIN_DATASET_ID,
    level: 0,
    sourceAdminLevel: "WORLD",
    semanticType: "world",
    name: "World",
    childIds: input.childIds,
    neighborIds: [],
    geometry,
    center: computeGeometryCenter(geometry),
    bbox: computeGeometryBBox(geometry),
    properties: {
      id: GLOBAL_ADMIN_WORLD_ID,
      level: 0,
      sourceAdminLevel: "WORLD",
      semanticType: "world",
      name: "World",
      territory: {
        adminLevel: "ADM0",
        localType: "world",
        names: { default: "World" },
        source: {
          provider: "territory-kit",
          sourceId: "WORLD",
          importedAt: input.buildDate,
          license: "derived",
          attribution: "TerritoryKit generated root zone"
        },
        datasetVersion: input.datasetVersion
      }
    }
  };
}

function finalizeGlobalAdminDataset(input: {
  zones: TerritoryZone[];
  detail: DetailName;
  buildDate: string;
  datasetVersion: string;
  sourceDate: string;
}): TerritoryDataset {
  const dataset: TerritoryDataset = {
    manifest: {
      datasetId: GLOBAL_ADMIN_DATASET_ID,
      datasetVersion: input.datasetVersion,
      schemaVersion: TERRITORY_SCHEMA_VERSION,
      sourceDate: input.sourceDate,
      geometryHash: "pending",
      adminLevels: ["ADM0"],
      artifactChecksum: "recorded-in-global-admin-checksums",
      attribution: NATURAL_EARTH_ATTRIBUTION,
      boundaryPolicy: "natural-earth-source-represented",
      buildDate: input.buildDate,
      countryCodes: input.zones
        .flatMap((zone) => (zone.countryCode ? [zone.countryCode.toLowerCase()] : []))
        .sort(),
      crs: "EPSG:4326",
      disputedAreaPolicy: "natural-earth-disputed-boundaries-not-authoritative",
      geometryDetail: input.detail === "full" ? "source" : input.detail,
      license: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
      name: "Global Administrative ADM0",
      description: "World root and Natural Earth ADM0 country boundaries.",
      sourceProvider: NATURAL_EARTH_PROVIDER,
      worldview: "natural-earth-international"
    },
    zones: input.zones
  };
  const geometryHash = createDatasetGeometryHash(dataset);

  return {
    ...dataset,
    manifest: {
      ...dataset.manifest,
      geometryHash,
      artifactChecksum: sha256Hex(serializeJsonStable(dataset.zones))
    }
  };
}

function datasetToFeatureCollection(dataset: TerritoryDataset): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    features: dataset.zones
      .filter((zone) => zone.sourceAdminLevel === "ADM0")
      .map((zone) => ({
        type: "Feature",
        id: zone.id,
        properties: {
          ...zone.properties,
          id: zone.id,
          name: zone.name,
          localName: zone.localName,
          countryCode: zone.countryCode,
          level: zone.level,
          sourceAdminLevel: zone.sourceAdminLevel,
          semanticType: zone.semanticType,
          parentId: zone.parentId,
          childIds: zone.childIds ?? [],
          neighborIds: zone.neighborIds
        },
        geometry: zone.geometry
      }))
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
      level: zone.level,
      sourceAdminLevel: zone.sourceAdminLevel,
      bbox: zone.bbox,
      center: zone.center
    }))
  };
}

function smokeGlobalAdm0Dataset(dataset: TerritoryDataset): GlobalAdminSmokeReport {
  const engine = createTerritoryEngine({ dataset });
  const checks: GlobalAdminSmokeReport["checks"] = [];
  const sampleZones = [
    { name: "Istanbul", coordinate: { lat: 41.0082, lng: 28.9784 }, country: "TR" },
    { name: "New York", coordinate: { lat: 40.7128, lng: -74.006 }, country: "US" },
    { name: "Tokyo", coordinate: { lat: 35.6762, lng: 139.6503 }, country: "JP" },
    { name: "Jakarta", coordinate: { lat: -6.2088, lng: 106.8456 }, country: "ID" },
    { name: "Berlin", coordinate: { lat: 52.52, lng: 13.405 }, country: "DE" }
  ];

  const firstCountry = dataset.zones.find((zone) => zone.sourceAdminLevel === "ADM0");
  checks.push({
    name: "getZoneById",
    ok: Boolean(firstCountry && engine.getZoneById(firstCountry.id)),
    ...(firstCountry?.id ? { expected: firstCountry.id } : {}),
    actual: firstCountry ? (engine.getZoneById(firstCountry.id)?.id ?? null) : null
  });

  for (const sample of sampleZones) {
    const actual = engine.latLngToZone(sample.coordinate, { level: 1 });
    checks.push({
      name: `latLngToZone:${sample.name}`,
      ok: actual?.includes(`:${sample.country}:ADM0:`) ?? false,
      expected: sample.country,
      actual
    });
  }

  checks.push({
    name: "zoneToBoundary",
    ok: Boolean(firstCountry?.geometry),
    expected: "Polygon|MultiPolygon",
    ...(firstCountry?.geometry.type ? { actual: firstCountry.geometry.type } : {})
  });
  checks.push({
    name: "getZonesInBounds",
    ok:
      engine.getZonesInBounds({
        west: -10,
        south: 35,
        east: 40,
        north: 60,
        level: 1
      }).length > 0,
    expected: "positive",
    actual: engine.getZonesInBounds({ west: -10, south: 35, east: 40, north: 60, level: 1 }).length
  });

  return {
    ok: checks.every((check) => check.ok),
    checks
  };
}

function readString(input: unknown): string | undefined {
  if (typeof input === "string" && input.length > 0) {
    return input;
  }

  if (typeof input === "number" && Number.isFinite(input)) {
    return String(input);
  }

  return undefined;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
