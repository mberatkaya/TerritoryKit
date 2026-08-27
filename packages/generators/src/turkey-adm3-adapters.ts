import type { LngLat, TerritoryGeometry, TerritorySemanticAdminType } from "@territory-kit/dataset";
import type { TerritoryCountryBuildIssue } from "./countries/types.js";
import { isRecord, readPropertyPath, readStringPropertyPath, sha256Hex } from "./sources/utils.js";
import { extractZipMember, listZipMembers } from "./sources/zip.js";

export const TURKEY_ADM3_IMPORTER_VERSION = "territorykit-tr-adm3-importer@3";

export type TurkeyAdm3ProviderAdapterId =
  | "geojson-property-map"
  | "json-feature-map"
  | "arcgis-rest-json"
  | "kml-description-table"
  | "kmz-kml-description-table"
  | "shapefile-zip-property-map"
  | "wfs-geojson-property-map";

export type TurkeyAdm3SourceFormat =
  | "GeoJSON"
  | "JSON"
  | "KML"
  | "KMZ"
  | "Shapefile"
  | "Shapefile ZIP"
  | "ArcGIS REST"
  | "ArcGIS FeatureServer"
  | "ArcGIS MapServer"
  | "WFS";

export type TurkeyAdm3CrsOperation = "none" | "reprojected" | "failed";
export type TurkeyAdm3NormalizedCrs = "EPSG:4326" | "OGC:CRS84" | "EPSG:3857";

export interface TurkeyAdm3ProviderAdapterConfig {
  id: TurkeyAdm3ProviderAdapterId;
  nameProperty?: string;
  nameField?: string;
  sourceIdProperty?: string;
  sourceIdField?: string;
  parentProperty?: string;
  parentField?: string;
  parentIdProperty?: string;
  parentNameProperty?: string;
  semanticTypeProperty?: string;
  localTypeProperty?: string;
  defaultSemanticType?: TerritorySemanticAdminType;
  defaultLocalType?: string;
  parentMappings?: Record<string, string>;
  featureArrayPath?: string;
  attributesProperty?: string;
  geometryProperty?: string;
  sourceCrs?: string;
  dbfEncoding?: string;
}

export interface TurkeyAdm3AdapterSourceContext {
  provinceCode: string;
  provinceName: string;
  providerId: string;
  crs?: string;
  format?: string;
  adapter: TurkeyAdm3ProviderAdapterConfig;
}

export interface TurkeyAdm3RawProviderFeature {
  sourceId: string;
  sourceObjectId: string;
  sourceParentId?: string;
  parentAdm2Id?: string;
  name: string;
  semanticType: TerritorySemanticAdminType;
  localType: string;
  geometry: TerritoryGeometry;
  rawProperties: Record<string, unknown>;
  rawFeatureId?: string;
  originalGeometryHash: string;
  effectiveGeometryHash: string;
}

export interface TurkeyAdm3CrsHandling {
  configuredCrs?: string;
  detectedCrs?: string;
  sourceCrs?: TurkeyAdm3NormalizedCrs;
  targetCrs: "EPSG:4326";
  operation: TurkeyAdm3CrsOperation;
  reason?: string;
}

export interface TurkeyAdm3AdapterParseReport {
  adapterId: TurkeyAdm3ProviderAdapterId;
  format: string;
  rawFeatureCount: number;
  acceptedFeatureCount: number;
  rejectedFeatureCount: number;
  unresolvedFeatureCount: number;
  geometryTypeDistribution: Record<string, number>;
  duplicateStableSourceIds: string[];
  duplicateNames: Array<{ name: string; parent: string; count: number }>;
  crsHandling: TurkeyAdm3CrsHandling;
}

export interface TurkeyAdm3AdapterParseResult {
  features: TurkeyAdm3RawProviderFeature[];
  issues: TerritoryCountryBuildIssue[];
  report: TurkeyAdm3AdapterParseReport;
}

interface TransportFeature {
  properties: Record<string, unknown>;
  geometry?: TerritoryGeometry;
  rawFeatureId?: string;
  sourceObjectId?: string;
}

interface TransportParseResult {
  features: TransportFeature[];
  issues: TerritoryCountryBuildIssue[];
  detectedCrs?: string;
  crsDetectionFailed?: boolean;
}

const SUPPORTED_ADAPTERS = new Set<TurkeyAdm3ProviderAdapterId>([
  "geojson-property-map",
  "json-feature-map",
  "arcgis-rest-json",
  "kml-description-table",
  "kmz-kml-description-table",
  "shapefile-zip-property-map",
  "wfs-geojson-property-map"
]);
const ALLOWED_ADM3_SEMANTIC_TYPES = new Set<TerritorySemanticAdminType>([
  "neighbourhood",
  "village",
  "locality",
  "administrative-unit"
]);
const DEFAULT_TARGET_CRS = "EPSG:4326" as const;
const MAX_ARCHIVE_MEMBERS = 128;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const WEB_MERCATOR_RADIUS = 6_378_137;

export function isSupportedTurkeyAdm3Adapter(input: unknown): input is TurkeyAdm3ProviderAdapterId {
  return typeof input === "string" && SUPPORTED_ADAPTERS.has(input as TurkeyAdm3ProviderAdapterId);
}

export function isSupportedTurkeyAdm3SourceFormat(input: unknown): input is TurkeyAdm3SourceFormat {
  if (typeof input !== "string") {
    return false;
  }

  return Boolean(normalizeTurkeyAdm3SourceFormat(input));
}

export function isSupportedTurkeyAdm3Crs(input: unknown): boolean {
  return normalizeSupportedCrs(input).ok;
}

export function normalizeTurkeyAdm3SourceFormat(input: string): TurkeyAdm3SourceFormat | undefined {
  const normalized = input.trim().toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");

  if (normalized === "geojson" || normalized === "geo json") {
    return "GeoJSON";
  }

  if (normalized === "json") {
    return "JSON";
  }

  if (normalized === "kml") {
    return "KML";
  }

  if (normalized === "kmz") {
    return "KMZ";
  }

  if (normalized === "shapefile" || normalized === "shp" || normalized === "shp zip") {
    return "Shapefile ZIP";
  }

  if (normalized === "shapefile zip" || normalized === "esri shapefile") {
    return "Shapefile ZIP";
  }

  if (
    normalized === "arcgis rest" ||
    normalized === "arcgis feature service" ||
    normalized === "featureserver" ||
    normalized === "feature server"
  ) {
    return "ArcGIS FeatureServer";
  }

  if (
    normalized === "arcgis map service" ||
    normalized === "mapserver" ||
    normalized === "map server"
  ) {
    return "ArcGIS MapServer";
  }

  if (normalized === "wfs" || normalized === "geoserver") {
    return "WFS";
  }

  return undefined;
}

export function defaultTurkeyAdm3AdapterForFormat(
  format: string
): TurkeyAdm3ProviderAdapterId | undefined {
  const normalized = normalizeTurkeyAdm3SourceFormat(format);

  switch (normalized) {
    case "GeoJSON":
      return "geojson-property-map";
    case "JSON":
      return "json-feature-map";
    case "KML":
      return "kml-description-table";
    case "KMZ":
      return "kmz-kml-description-table";
    case "Shapefile":
    case "Shapefile ZIP":
      return "shapefile-zip-property-map";
    case "ArcGIS REST":
    case "ArcGIS FeatureServer":
    case "ArcGIS MapServer":
      return "arcgis-rest-json";
    case "WFS":
      return "wfs-geojson-property-map";
    default:
      return undefined;
  }
}

export function parseTurkeyAdm3ProviderSource(
  source: TurkeyAdm3AdapterSourceContext,
  input: string | Uint8Array
): TurkeyAdm3AdapterParseResult {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const adapter = source.adapter;
  const transport = parseTransportFeatures(adapter, bytes);
  const issues: TerritoryCountryBuildIssue[] = [...transport.issues];
  const crsHandling = resolveCrsHandling({
    ...(transport.detectedCrs ? { detectedCrs: transport.detectedCrs } : {}),
    detectionFailed: transport.crsDetectionFailed ?? false,
    ...((adapter.sourceCrs ?? source.crs) ? { configuredCrs: adapter.sourceCrs ?? source.crs } : {})
  });

  if (crsHandling.operation === "failed" || !crsHandling.sourceCrs) {
    issues.push(
      createIssue(
        crsHandling.reason === "unknown"
          ? "TR_ADM3_CRS_UNKNOWN"
          : crsHandling.reason === "conflict"
            ? "TR_ADM3_CRS_CONFLICT"
            : "TR_ADM3_CRS_UNSUPPORTED",
        crsHandling.reason === "unknown"
          ? `Province ${source.provinceCode} source CRS could not be determined safely.`
          : crsHandling.reason === "conflict"
            ? `Province ${source.provinceCode} source CRS metadata conflicts with configured CRS.`
            : `Province ${source.provinceCode} source CRS is not supported by the ADM3 importer.`
      )
    );

    return {
      features: [],
      issues: issues.sort(compareIssues),
      report: createParseReport(source, [], transport.features.length, issues, {
        ...crsHandling,
        operation: "failed"
      })
    };
  }

  const features = transport.features.flatMap((feature, index) =>
    normalizeTransportFeature({
      source,
      feature,
      featureIndex: index,
      crs: crsHandling.sourceCrs as TurkeyAdm3NormalizedCrs,
      issues
    })
  );

  issues.push(...createDuplicateSourceIdIssues(source, features));

  return {
    features: features.sort(compareRawFeatures),
    issues: issues.sort(compareIssues),
    report: createParseReport(source, features, transport.features.length, issues, crsHandling)
  };
}

function parseTransportFeatures(
  adapter: TurkeyAdm3ProviderAdapterConfig,
  bytes: Uint8Array
): TransportParseResult {
  try {
    switch (adapter.id) {
      case "geojson-property-map":
      case "wfs-geojson-property-map":
        return parseGeoJsonTransport(readUtf8(bytes));
      case "json-feature-map":
        return parseJsonFeatureTransport(readUtf8(bytes), adapter);
      case "arcgis-rest-json":
        return parseArcGisRestTransport(readUtf8(bytes), adapter);
      case "kml-description-table":
        return parseKmlTransport(readUtf8(bytes));
      case "kmz-kml-description-table":
        return parseKmlTransport(readKmzKml(bytes));
      case "shapefile-zip-property-map":
        return parseShapefileZipTransport(bytes, adapter);
      default:
        return {
          features: [],
          issues: [
            createIssue(
              "TR_ADM3_ADAPTER_UNSUPPORTED",
              "Turkey ADM3 provider adapter is unsupported."
            )
          ]
        };
    }
  } catch (error) {
    return {
      features: [],
      issues: [
        createIssue(
          "TR_ADM3_SOURCE_PARSE_FAILED",
          error instanceof Error ? error.message : String(error)
        )
      ]
    };
  }
}

function parseGeoJsonTransport(text: string): TransportParseResult {
  let input: unknown;

  try {
    input = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      features: [],
      issues: [
        createIssue(
          "TR_ADM3_SOURCE_JSON_INVALID",
          error instanceof Error ? error.message : String(error)
        )
      ]
    };
  }

  if (!isRecord(input) || input.type !== "FeatureCollection" || !Array.isArray(input.features)) {
    return {
      features: [],
      issues: [
        createIssue(
          "TR_ADM3_SOURCE_FORMAT_UNSUPPORTED",
          "ADM3 GeoJSON must be a FeatureCollection."
        )
      ]
    };
  }

  const crs = readGeoJsonCrs(input);
  const issues: TerritoryCountryBuildIssue[] = [];
  const features = input.features.flatMap((feature, index): TransportFeature[] => {
    if (!isRecord(feature)) {
      issues.push(
        createIssue(
          "TR_ADM3_SOURCE_FEATURE_INVALID",
          `GeoJSON feature ${index} is not an object.`,
          {
            severity: "warning"
          }
        )
      );
      return [];
    }

    const geometry = readGeometry(feature.geometry);

    if (!geometry) {
      issues.push(
        createIssue(
          "TR_ADM3_UNSUPPORTED_GEOMETRY",
          `GeoJSON feature ${index} is missing Polygon or MultiPolygon geometry.`,
          { severity: "warning" }
        )
      );
      return [];
    }

    const rawFeatureId = readFeatureId(feature);

    return [
      {
        properties: isRecord(feature.properties) ? feature.properties : {},
        geometry,
        ...(rawFeatureId ? { rawFeatureId } : {})
      }
    ];
  });

  return {
    features,
    issues,
    ...(crs.value ? { detectedCrs: crs.value } : {}),
    ...(crs.present && !crs.value ? { crsDetectionFailed: true } : {})
  };
}

function parseJsonFeatureTransport(
  text: string,
  adapter: TurkeyAdm3ProviderAdapterConfig
): TransportParseResult {
  let input: unknown;

  try {
    input = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      features: [],
      issues: [
        createIssue(
          "TR_ADM3_SOURCE_JSON_INVALID",
          error instanceof Error ? error.message : String(error)
        )
      ]
    };
  }

  if (isRecord(input) && input.type === "FeatureCollection" && Array.isArray(input.features)) {
    return parseGeoJsonTransport(text);
  }

  const featureRoot =
    adapter.featureArrayPath && isRecord(input)
      ? readPropertyPath(input, adapter.featureArrayPath)
      : isRecord(input)
        ? input.features
        : Array.isArray(input)
          ? input
          : undefined;

  if (!Array.isArray(featureRoot)) {
    return {
      features: [],
      issues: [
        createIssue(
          "TR_ADM3_SOURCE_SCHEMA_MISMATCH",
          "JSON ADM3 source must be an array or expose a configured feature array path."
        )
      ]
    };
  }

  const issues: TerritoryCountryBuildIssue[] = [];
  const geometryPath = adapter.geometryProperty ?? "geometry";
  const features = featureRoot.flatMap((feature, index): TransportFeature[] => {
    if (!isRecord(feature)) {
      issues.push(
        createIssue("TR_ADM3_SOURCE_FEATURE_INVALID", `JSON feature ${index} is not an object.`, {
          severity: "warning"
        })
      );
      return [];
    }

    const geometry = readGeometry(readPropertyPath(feature, geometryPath));

    if (!geometry) {
      issues.push(
        createIssue(
          "TR_ADM3_UNSUPPORTED_GEOMETRY",
          `JSON feature ${index} is missing configured Polygon or MultiPolygon geometry.`,
          { severity: "warning" }
        )
      );
      return [];
    }

    const rawFeatureId = readFeatureId(feature);

    return [
      {
        properties: feature,
        geometry,
        ...(rawFeatureId ? { rawFeatureId } : {})
      }
    ];
  });

  return { features, issues };
}

function parseArcGisRestTransport(
  text: string,
  adapter: TurkeyAdm3ProviderAdapterConfig
): TransportParseResult {
  let input: unknown;

  try {
    input = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      features: [],
      issues: [
        createIssue(
          "TR_ADM3_SOURCE_JSON_INVALID",
          error instanceof Error ? error.message : String(error)
        )
      ]
    };
  }

  if (!isRecord(input) || !Array.isArray(input.features)) {
    return {
      features: [],
      issues: [
        createIssue(
          "TR_ADM3_SOURCE_SCHEMA_MISMATCH",
          "ArcGIS REST ADM3 source must expose a features array."
        )
      ]
    };
  }

  const rootSpatialReference = readArcGisSpatialReference(input.spatialReference);
  const objectIdField = readStringPropertyPath(input, "objectIdFieldName") ?? "OBJECTID";
  const attributesPath = adapter.attributesProperty ?? "attributes";
  const geometryPath = adapter.geometryProperty ?? "geometry";
  const issues: TerritoryCountryBuildIssue[] = [];
  const features = input.features.flatMap((feature, index): TransportFeature[] => {
    if (!isRecord(feature)) {
      issues.push(
        createIssue("TR_ADM3_SOURCE_FEATURE_INVALID", `ArcGIS feature ${index} is not an object.`, {
          severity: "warning"
        })
      );
      return [];
    }

    const attributesValue = readPropertyPath(feature, attributesPath);
    const attributes = isRecord(attributesValue) ? attributesValue : {};
    const geometryValue = readPropertyPath(feature, geometryPath);
    const geometry = readArcGisPolygonGeometry(geometryValue);
    const rawFeatureId =
      readStringPropertyPath(attributes, objectIdField) ??
      readStringPropertyPath(feature, objectIdField) ??
      String(index + 1);

    if (!geometry) {
      issues.push(
        createIssue(
          "TR_ADM3_UNSUPPORTED_GEOMETRY",
          `ArcGIS feature ${rawFeatureId} is missing polygon rings.`,
          { severity: "warning" }
        )
      );
      return [];
    }

    return [
      {
        properties: attributes,
        geometry,
        rawFeatureId,
        sourceObjectId: rawFeatureId
      }
    ];
  });
  const featureSpatialReferences = input.features
    .filter(isRecord)
    .flatMap((feature) => {
      const geometry = readPropertyPath(feature, geometryPath);
      return isRecord(geometry) ? [readArcGisSpatialReference(geometry.spatialReference)] : [];
    })
    .filter((value): value is string => Boolean(value));
  const detectedCrs = [
    ...new Set([rootSpatialReference, ...featureSpatialReferences].filter(Boolean))
  ]
    .sort()
    .at(0);

  return {
    features,
    issues,
    ...(detectedCrs ? { detectedCrs } : {})
  };
}

function parseKmlTransport(text: string): TransportParseResult {
  const safetyIssue = inspectXmlSafety(text);

  if (safetyIssue) {
    return { features: [], issues: [safetyIssue], detectedCrs: "EPSG:4326" };
  }

  const placemarks = [...text.matchAll(/<Placemark\b[\s\S]*?<\/Placemark>/gi)];
  const issues: TerritoryCountryBuildIssue[] = [];
  const features = placemarks.flatMap((match, index): TransportFeature[] => {
    const placemark = match[0];
    const sourceObjectId =
      readXmlAttribute(placemark.match(/<Placemark\b[^>]*>/i)?.[0] ?? "", "id") ??
      `placemark-${index + 1}`;
    const properties = parseKmlProperties(placemark);
    const geometry = readKmlGeometry(placemark);

    if (!geometry) {
      issues.push(
        createIssue(
          "TR_ADM3_UNSUPPORTED_GEOMETRY",
          `KML placemark ${sourceObjectId} is missing Polygon geometry.`,
          { severity: "warning" }
        )
      );
      return [];
    }

    return [{ properties, geometry, rawFeatureId: sourceObjectId, sourceObjectId }];
  });

  return { features, issues, detectedCrs: "EPSG:4326" };
}

function parseShapefileZipTransport(
  bytes: Uint8Array,
  adapter: TurkeyAdm3ProviderAdapterConfig
): TransportParseResult {
  const archiveMembers = listZipMembers(bytes);
  const totalUncompressedBytes = archiveMembers.reduce(
    (sum, member) => sum + member.uncompressedSize,
    0
  );

  if (
    archiveMembers.length > MAX_ARCHIVE_MEMBERS ||
    totalUncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES
  ) {
    return {
      features: [],
      issues: [
        createIssue(
          "TR_ADM3_SOURCE_ARCHIVE_UNSAFE",
          "Shapefile ZIP exceeds the ADM3 archive member or uncompressed-size safety limit."
        )
      ]
    };
  }

  const shpMember = archiveMembers.find((member) => member.filename.toLowerCase().endsWith(".shp"));

  if (!shpMember) {
    return {
      features: [],
      issues: [
        createIssue("TR_ADM3_SOURCE_SCHEMA_MISMATCH", "Shapefile ZIP is missing a .shp member.")
      ]
    };
  }

  const baseName = stripExtension(shpMember.filename).toLowerCase();
  const dbfMember =
    archiveMembers.find(
      (member) =>
        stripExtension(member.filename).toLowerCase() === baseName &&
        member.filename.toLowerCase().endsWith(".dbf")
    ) ?? archiveMembers.find((member) => member.filename.toLowerCase().endsWith(".dbf"));
  const prjMember =
    archiveMembers.find(
      (member) =>
        stripExtension(member.filename).toLowerCase() === baseName &&
        member.filename.toLowerCase().endsWith(".prj")
    ) ?? archiveMembers.find((member) => member.filename.toLowerCase().endsWith(".prj"));

  if (!dbfMember) {
    return {
      features: [],
      issues: [
        createIssue("TR_ADM3_SOURCE_SCHEMA_MISMATCH", "Shapefile ZIP is missing a .dbf member.")
      ]
    };
  }

  const shp = extractZipMember(bytes, shpMember.filename).bytes;
  const dbf = extractZipMember(bytes, dbfMember.filename).bytes;
  const prj = prjMember ? readUtf8(extractZipMember(bytes, prjMember.filename).bytes) : undefined;
  const geometries = parseShpPolygonGeometries(shp);
  const rows = parseDbfRows(dbf, adapter.dbfEncoding ?? "utf-8");
  const issues: TerritoryCountryBuildIssue[] = [];
  const count = Math.min(geometries.length, rows.length);
  const features: TransportFeature[] = [];

  if (geometries.length !== rows.length) {
    issues.push(
      createIssue(
        "TR_ADM3_SOURCE_SCHEMA_MISMATCH",
        `Shapefile geometry count ${geometries.length} does not match DBF row count ${rows.length}.`
      )
    );
  }

  for (let index = 0; index < count; index += 1) {
    const geometry = geometries[index];
    const row = rows[index];

    if (!geometry || !row) {
      continue;
    }

    features.push({
      properties: row,
      geometry,
      rawFeatureId: String(index + 1),
      sourceObjectId: String(index + 1)
    });
  }

  return {
    features,
    issues,
    ...(prj ? { detectedCrs: detectPrjCrs(prj) ?? prj } : {})
  };
}

function normalizeTransportFeature(input: {
  source: TurkeyAdm3AdapterSourceContext;
  feature: TransportFeature;
  featureIndex: number;
  crs: TurkeyAdm3NormalizedCrs;
  issues: TerritoryCountryBuildIssue[];
}): TurkeyAdm3RawProviderFeature[] {
  const { source, feature, featureIndex, crs, issues } = input;
  const adapter = source.adapter;
  const nameProperty = adapter.nameProperty ?? adapter.nameField ?? "name";
  const sourceIdProperty = adapter.sourceIdProperty ?? adapter.sourceIdField;
  const parentProperty =
    adapter.parentProperty ??
    adapter.parentField ??
    adapter.parentIdProperty ??
    adapter.parentNameProperty;
  const sourceObjectId = feature.sourceObjectId ?? feature.rawFeatureId ?? String(featureIndex + 1);
  const name =
    readStringPropertyPath(feature.properties, nameProperty) ??
    readStringPropertyPath(feature.properties, "name") ??
    readStringPropertyPath(feature.properties, "Name") ??
    readStringPropertyPath(feature.properties, "NAME");
  const explicitSourceId = sourceIdProperty
    ? readStringPropertyPath(feature.properties, sourceIdProperty)
    : undefined;
  const rawParent = parentProperty
    ? readStringPropertyPath(feature.properties, parentProperty)
    : undefined;
  const rawSemanticType = adapter.semanticTypeProperty
    ? readStringPropertyPath(feature.properties, adapter.semanticTypeProperty)
    : undefined;
  const semanticType = normalizeAdm3SemanticType(
    rawSemanticType ?? adapter.defaultSemanticType ?? "neighbourhood"
  );
  const localType =
    (adapter.localTypeProperty
      ? readStringPropertyPath(feature.properties, adapter.localTypeProperty)
      : undefined) ??
    adapter.defaultLocalType ??
    "Mahalle";

  if (!name || !feature.geometry) {
    issues.push(
      createIssue(
        "TR_ADM3_REQUIRED_FIELD_MISSING",
        `Province ${source.provinceCode} feature ${sourceObjectId} is missing name or polygon geometry.`,
        { severity: "warning" }
      )
    );
    return [];
  }

  if (!semanticType || !ALLOWED_ADM3_SEMANTIC_TYPES.has(semanticType)) {
    issues.push(
      createIssue(
        "TR_ADM3_SEMANTIC_BLOCKED",
        `Province ${source.provinceCode} feature ${sourceObjectId} declares unsupported ADM3 semantic type '${rawSemanticType ?? "unknown"}'.`
      )
    );
    return [];
  }

  const sourceId =
    explicitSourceId ??
    feature.rawFeatureId ??
    createFingerprintSourceId({
      providerId: source.providerId,
      provinceCode: source.provinceCode,
      name,
      ...(rawParent ? { parent: rawParent } : {}),
      geometry: feature.geometry
    });

  if (!explicitSourceId) {
    issues.push(
      createIssue(
        "TR_ADM3_SOURCE_ID_FINGERPRINTED",
        `Province ${source.provinceCode} feature ${sourceObjectId} is missing the configured source ID field; deterministic provider-feature identity was used.`,
        { severity: "warning" }
      )
    );
  }

  if (!rawParent) {
    issues.push(
      createIssue(
        "TR_ADM3_PARENT_MISSING",
        `Province ${source.provinceCode} feature ${sourceId} is missing a configured district parent field.`,
        { severity: "warning" }
      )
    );
  }

  const parentAdm2Id = rawParent
    ? resolveParentMapping(adapter.parentMappings, rawParent)
    : undefined;

  if (rawParent && adapter.parentMappings && !parentAdm2Id) {
    issues.push(
      createIssue(
        "TR_ADM3_PARENT_MAPPING_MISSING",
        `Province ${source.provinceCode} feature ${sourceId} has unmapped parent '${rawParent}'.`
      )
    );
  }

  const originalGeometryHash = hashGeometry(feature.geometry);
  const geometry = reprojectGeometry(feature.geometry, crs);
  const effectiveGeometryHash = hashGeometry(geometry);

  return [
    {
      sourceId,
      sourceObjectId,
      ...(rawParent ? { sourceParentId: rawParent } : {}),
      ...(parentAdm2Id ? { parentAdm2Id } : {}),
      name: normalizeDisplayName(name),
      semanticType,
      localType,
      geometry,
      rawProperties: feature.properties,
      ...(feature.rawFeatureId ? { rawFeatureId: feature.rawFeatureId } : {}),
      originalGeometryHash,
      effectiveGeometryHash
    }
  ];
}

function createParseReport(
  source: TurkeyAdm3AdapterSourceContext,
  features: readonly TurkeyAdm3RawProviderFeature[],
  rawFeatureCount: number,
  issues: readonly TerritoryCountryBuildIssue[],
  crsHandling: TurkeyAdm3CrsHandling
): TurkeyAdm3AdapterParseReport {
  return {
    adapterId: source.adapter.id,
    format: source.format ?? "unknown",
    rawFeatureCount,
    acceptedFeatureCount: features.length,
    rejectedFeatureCount: Math.max(0, rawFeatureCount - features.length),
    unresolvedFeatureCount: issues.filter((issue) =>
      [
        "TR_ADM3_PARENT_MISSING",
        "TR_ADM3_PARENT_MAPPING_MISSING",
        "TR_ADM3_SOURCE_ID_FINGERPRINTED",
        "TR_ADM3_REQUIRED_FIELD_MISSING",
        "TR_ADM3_UNSUPPORTED_GEOMETRY",
        "TR_ADM3_CRS_UNKNOWN",
        "TR_ADM3_CRS_UNSUPPORTED",
        "TR_ADM3_CRS_CONFLICT"
      ].includes(issue.code)
    ).length,
    geometryTypeDistribution: countBy(features.map((feature) => feature.geometry.type)),
    duplicateStableSourceIds: findDuplicateValues(
      features.map((feature) =>
        [
          source.providerId,
          feature.parentAdm2Id ?? feature.sourceParentId ?? "unresolved-parent",
          feature.sourceId
        ].join("|")
      )
    ),
    duplicateNames: findDuplicateNames(features),
    crsHandling
  };
}

function createDuplicateSourceIdIssues(
  source: TurkeyAdm3AdapterSourceContext,
  features: readonly TurkeyAdm3RawProviderFeature[]
): TerritoryCountryBuildIssue[] {
  return findDuplicateValues(
    features.map((feature) =>
      [
        source.providerId,
        feature.parentAdm2Id ?? feature.sourceParentId ?? "unresolved-parent",
        feature.sourceId
      ].join("|")
    )
  ).map((id) =>
    createIssue(
      "TR_ADM3_DUPLICATE_STABLE_ID",
      `Province ${source.provinceCode} ADM3 source produced duplicate stable source identity '${id}'.`
    )
  );
}

function resolveCrsHandling(input: {
  detectedCrs?: string;
  detectionFailed: boolean;
  configuredCrs?: string;
}): TurkeyAdm3CrsHandling {
  const base = {
    ...(input.configuredCrs ? { configuredCrs: input.configuredCrs } : {}),
    ...(input.detectedCrs ? { detectedCrs: input.detectedCrs } : {}),
    targetCrs: DEFAULT_TARGET_CRS
  };

  if (input.detectionFailed) {
    return { ...base, operation: "failed", reason: "unknown" };
  }

  const detected = normalizeSupportedCrs(input.detectedCrs);
  const configured = normalizeSupportedCrs(input.configuredCrs);

  if (input.detectedCrs && !detected.ok) {
    return { ...base, operation: "failed", reason: "unsupported" };
  }

  if (input.configuredCrs && !configured.ok) {
    return { ...base, operation: "failed", reason: "unsupported" };
  }

  if (detected.crs && configured.crs && !areEquivalentCrs(detected.crs, configured.crs)) {
    return { ...base, operation: "failed", reason: "conflict" };
  }

  const sourceCrs = detected.crs ?? configured.crs;

  if (!sourceCrs) {
    return { ...base, operation: "failed", reason: "unknown" };
  }

  return {
    ...base,
    sourceCrs,
    operation: areEquivalentCrs(sourceCrs, DEFAULT_TARGET_CRS) ? "none" : "reprojected"
  };
}

function normalizeSupportedCrs(input: unknown): { ok: boolean; crs?: TurkeyAdm3NormalizedCrs } {
  if (input === undefined || input === null || input === "") {
    return { ok: true };
  }

  if (typeof input !== "string") {
    return { ok: false };
  }

  const normalized = input
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, "")
    .replace(/^URN:OGC:DEF:CRS:/, "")
    .replace(/^HTTP:\/\/WWW\.OPENGIS\.NET\/DEF\/CRS\//, "");

  if (
    normalized === "EPSG:4326" ||
    normalized === "EPSG::4326" ||
    normalized === "EPSG/0/4326" ||
    normalized.includes("WGS84") ||
    normalized.includes("WGS1984")
  ) {
    return { ok: true, crs: "EPSG:4326" };
  }

  if (
    normalized === "OGC:CRS84" ||
    normalized === "OGC::CRS84" ||
    normalized.includes("OGC:CRS84") ||
    normalized.includes("CRS84")
  ) {
    return { ok: true, crs: "OGC:CRS84" };
  }

  if (
    normalized === "EPSG:3857" ||
    normalized === "EPSG::3857" ||
    normalized === "EPSG:900913" ||
    normalized.includes("EPSG:3857") ||
    normalized.includes("WEBMERCATOR") ||
    normalized.includes("WGS84PSEUDOMERCATOR")
  ) {
    return { ok: true, crs: "EPSG:3857" };
  }

  return { ok: false };
}

function areEquivalentCrs(left: TurkeyAdm3NormalizedCrs, right: TurkeyAdm3NormalizedCrs): boolean {
  if (left === right) {
    return true;
  }

  return (
    (left === "EPSG:4326" && right === "OGC:CRS84") ||
    (left === "OGC:CRS84" && right === "EPSG:4326")
  );
}

function reprojectGeometry(
  geometry: TerritoryGeometry,
  sourceCrs: TurkeyAdm3NormalizedCrs
): TerritoryGeometry {
  if (areEquivalentCrs(sourceCrs, DEFAULT_TARGET_CRS)) {
    return geometry;
  }

  const projectRing = (ring: readonly LngLat[]): LngLat[] =>
    ring.map((point) => webMercatorToLonLat(point));

  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) => projectRing(ring as LngLat[]))
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((polygon) =>
      polygon.map((ring) => projectRing(ring as LngLat[]))
    )
  };
}

function webMercatorToLonLat(point: LngLat): LngLat {
  const lon = (point[0] / WEB_MERCATOR_RADIUS) * (180 / Math.PI);
  const lat =
    (2 * Math.atan(Math.exp(point[1] / WEB_MERCATOR_RADIUS)) - Math.PI / 2) * (180 / Math.PI);

  return [roundCoordinate(lon), roundCoordinate(lat)];
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(7));
}

function readGeoJsonCrs(input: Record<string, unknown>): { present: boolean; value?: string } {
  if (!("crs" in input)) {
    return { present: false };
  }

  const crs = input.crs;

  if (typeof crs === "string") {
    return { present: true, value: crs };
  }

  if (!isRecord(crs)) {
    return { present: true };
  }

  if (typeof crs.name === "string") {
    return { present: true, value: crs.name };
  }

  if (isRecord(crs.properties) && typeof crs.properties.name === "string") {
    return { present: true, value: crs.properties.name };
  }

  return { present: true };
}

function readArcGisSpatialReference(input: unknown): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const wkid = typeof input.wkid === "number" ? input.wkid : input.latestWkid;

  if (typeof wkid === "number" && Number.isFinite(wkid)) {
    return `EPSG:${wkid}`;
  }

  if (typeof input.wkt === "string") {
    return input.wkt;
  }

  return undefined;
}

function readArcGisPolygonGeometry(input: unknown): TerritoryGeometry | undefined {
  if (!isRecord(input) || !Array.isArray(input.rings)) {
    return undefined;
  }

  const rings = input.rings.flatMap((ring): LngLat[][] =>
    Array.isArray(ring) ? normalizeRing(ring) : []
  );

  return ringsToGeometry(rings);
}

function readGeometry(input: unknown): TerritoryGeometry | undefined {
  if (!isRecord(input) || (input.type !== "Polygon" && input.type !== "MultiPolygon")) {
    return undefined;
  }

  if (input.type === "Polygon" && Array.isArray(input.coordinates)) {
    const rings = input.coordinates.flatMap((ring): LngLat[][] =>
      Array.isArray(ring) ? normalizeRing(ring) : []
    );

    return rings.length > 0 ? { type: "Polygon", coordinates: rings } : undefined;
  }

  if (input.type === "MultiPolygon" && Array.isArray(input.coordinates)) {
    const polygons = input.coordinates.flatMap((polygon): LngLat[][][] =>
      Array.isArray(polygon)
        ? [
            polygon.flatMap((ring): LngLat[][] => (Array.isArray(ring) ? normalizeRing(ring) : []))
          ].filter((rings) => rings.length > 0)
        : []
    );

    return polygons.length > 0 ? { type: "MultiPolygon", coordinates: polygons } : undefined;
  }

  return undefined;
}

function readKmlGeometry(placemark: string): TerritoryGeometry | undefined {
  const polygons = [...placemark.matchAll(/<Polygon\b[\s\S]*?<\/Polygon>/gi)].flatMap((match) => {
    const polygon = match[0];
    const outer = polygon.match(
      /<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/outerBoundaryIs>/i
    )?.[1];
    const outerRing = parseKmlCoordinateRing(outer ?? "");
    const holes = [
      ...polygon.matchAll(
        /<innerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/innerBoundaryIs>/gi
      )
    ].flatMap((hole): LngLat[][] => parseKmlCoordinateRing(hole[1] ?? ""));

    return outerRing.length > 0 ? [[outerRing[0]!, ...holes]] : [];
  });

  if (polygons.length === 0) {
    return undefined;
  }

  if (polygons.length === 1) {
    return { type: "Polygon", coordinates: polygons[0]! };
  }

  return { type: "MultiPolygon", coordinates: polygons };
}

function parseKmlCoordinateRing(input: string): LngLat[][] {
  const ring = input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((tuple): LngLat[] => {
      const parts = tuple.split(",");
      const lng = Number(parts[0]);
      const lat = Number(parts[1]);

      return Number.isFinite(lng) && Number.isFinite(lat) ? [[lng, lat]] : [];
    });

  return normalizeRing(ring);
}

function parseKmlProperties(placemark: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const name = decodeHtml(readXmlText(placemark, "name") ?? "").trim();

  if (name) {
    properties.name = name;
  }

  const description = readKmlDescription(placemark);

  if (description) {
    for (const [key, value] of parseDescriptionTable(description)) {
      properties[key] = value;
    }
  }

  for (const match of placemark.matchAll(
    /<SimpleData\b[^>]*\bname=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/SimpleData>/gi
  )) {
    const key = decodeHtml(match[2] ?? "").trim();
    const value = decodeHtml(stripTags(match[3] ?? "")).trim();

    if (key) {
      properties[key] = value;
    }
  }

  for (const match of placemark.matchAll(
    /<Data\b[^>]*\bname=(["'])(.*?)\1[^>]*>[\s\S]*?<value>([\s\S]*?)<\/value>[\s\S]*?<\/Data>/gi
  )) {
    const key = decodeHtml(match[2] ?? "").trim();
    const value = decodeHtml(stripTags(match[3] ?? "")).trim();

    if (key) {
      properties[key] = value;
    }
  }

  return properties;
}

function readKmlDescription(placemark: string): string {
  const cdata = placemark.match(
    /<description\b[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i
  )?.[1];

  if (cdata !== undefined) {
    return cdata;
  }

  return readXmlText(placemark, "description") ?? "";
}

function parseDescriptionTable(description: string): Array<[string, string]> {
  return [
    ...description.matchAll(
      /<tr\b[^>]*>\s*<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi
    )
  ]
    .map((match): [string, string] => [
      decodeHtml(stripTags(match[1] ?? "")).trim(),
      decodeHtml(stripTags(match[2] ?? "")).trim()
    ])
    .filter(([key]) => key.length > 0);
}

function readKmzKml(bytes: Uint8Array): string {
  const members = listZipMembers(bytes);
  const totalUncompressedBytes = members.reduce((sum, member) => sum + member.uncompressedSize, 0);

  if (
    members.length > MAX_ARCHIVE_MEMBERS ||
    totalUncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES
  ) {
    throw new Error("KMZ exceeds the ADM3 archive member or uncompressed-size safety limit.");
  }

  const kmlMember =
    members.find((member) => member.filename.toLowerCase() === "doc.kml") ??
    members.find((member) => member.filename.toLowerCase().endsWith(".kml"));

  if (!kmlMember) {
    throw new Error("KMZ archive does not contain a KML member.");
  }

  return readUtf8(extractZipMember(bytes, kmlMember.filename).bytes);
}

function parseShpPolygonGeometries(bytes: Uint8Array): TerritoryGeometry[] {
  const buffer = Buffer.from(bytes);

  if (buffer.byteLength < 100 || buffer.readInt32BE(0) !== 9994) {
    throw new Error("Invalid Shapefile header.");
  }

  const geometries: TerritoryGeometry[] = [];
  let offset = 100;

  while (offset + 8 <= buffer.byteLength) {
    const contentLengthBytes = buffer.readInt32BE(offset + 4) * 2;
    const contentOffset = offset + 8;
    const nextOffset = contentOffset + contentLengthBytes;

    if (nextOffset > buffer.byteLength || contentLengthBytes < 4) {
      throw new Error("Invalid Shapefile record length.");
    }

    const shapeType = buffer.readInt32LE(contentOffset);

    if (shapeType === 0) {
      offset = nextOffset;
      continue;
    }

    if (shapeType !== 5 && shapeType !== 15 && shapeType !== 25) {
      throw new Error(`Unsupported Shapefile shape type ${shapeType}; expected Polygon.`);
    }

    if (contentLengthBytes < 44) {
      throw new Error("Invalid Shapefile Polygon record.");
    }

    const numberOfParts = buffer.readInt32LE(contentOffset + 36);
    const numberOfPoints = buffer.readInt32LE(contentOffset + 40);
    const partsOffset = contentOffset + 44;
    const pointsOffset = partsOffset + numberOfParts * 4;

    if (
      numberOfParts < 1 ||
      numberOfPoints < 1 ||
      pointsOffset + numberOfPoints * 16 > nextOffset
    ) {
      throw new Error("Invalid Shapefile Polygon parts or points.");
    }

    const partStarts: number[] = [];

    for (let partIndex = 0; partIndex < numberOfParts; partIndex += 1) {
      partStarts.push(buffer.readInt32LE(partsOffset + partIndex * 4));
    }

    const points: LngLat[] = [];

    for (let pointIndex = 0; pointIndex < numberOfPoints; pointIndex += 1) {
      points.push([
        buffer.readDoubleLE(pointsOffset + pointIndex * 16),
        buffer.readDoubleLE(pointsOffset + pointIndex * 16 + 8)
      ]);
    }

    const rings = partStarts.flatMap((start, index): LngLat[][] => {
      const end = partStarts[index + 1] ?? points.length;
      return normalizeRing(points.slice(start, end));
    });
    const geometry = ringsToGeometry(rings);

    if (geometry) {
      geometries.push(geometry);
    }

    offset = nextOffset;
  }

  return geometries;
}

function parseDbfRows(bytes: Uint8Array, encoding: string): Record<string, unknown>[] {
  const buffer = Buffer.from(bytes);

  if (buffer.byteLength < 32) {
    throw new Error("Invalid DBF header.");
  }

  const recordCount = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields: Array<{ name: string; type: string; length: number; offset: number }> = [];
  let descriptorOffset = 32;
  let fieldOffset = 1;
  const decoder = createTextDecoder(encoding);

  while (descriptorOffset + 32 <= buffer.byteLength && buffer[descriptorOffset] !== 0x0d) {
    const rawName = buffer.subarray(descriptorOffset, descriptorOffset + 11);
    const name = decoder
      .decode(rawName.subarray(0, rawName.indexOf(0) === -1 ? 11 : rawName.indexOf(0)))
      .trim();
    const type = String.fromCharCode(buffer[descriptorOffset + 11] ?? 0);
    const length = buffer[descriptorOffset + 16] ?? 0;

    if (name) {
      fields.push({ name, type, length, offset: fieldOffset });
      fieldOffset += length;
    }

    descriptorOffset += 32;
  }

  const rows: Record<string, unknown>[] = [];

  for (let rowIndex = 0; rowIndex < recordCount; rowIndex += 1) {
    const rowOffset = headerLength + rowIndex * recordLength;

    if (rowOffset + recordLength > buffer.byteLength) {
      break;
    }

    if (String.fromCharCode(buffer[rowOffset] ?? 0) === "*") {
      continue;
    }

    const row: Record<string, unknown> = {};

    for (const field of fields) {
      const valueBytes = buffer.subarray(
        rowOffset + field.offset,
        rowOffset + field.offset + field.length
      );
      const text = decoder.decode(valueBytes).trim();

      if (text.length === 0) {
        continue;
      }

      if (field.type === "N" || field.type === "F") {
        const numeric = Number(text);
        row[field.name] = Number.isFinite(numeric) ? numeric : text;
      } else {
        row[field.name] = text;
      }
    }

    rows.push(row);
  }

  return rows;
}

function createTextDecoder(encoding: string): TextDecoder {
  try {
    return new TextDecoder(encoding);
  } catch {
    return new TextDecoder("utf-8");
  }
}

function ringsToGeometry(rings: readonly LngLat[][]): TerritoryGeometry | undefined {
  if (rings.length === 0) {
    return undefined;
  }

  const outers = rings.filter((ring) => signedRingArea(ring) < 0);
  const holes = rings.filter((ring) => signedRingArea(ring) >= 0);
  const outerRings = outers.length > 0 ? outers : [rings[0]!];
  const holeRings = outers.length > 0 ? holes : rings.slice(1);
  const polygons = outerRings.map((outer) => [
    outer,
    ...holeRings.filter((hole) => pointInRing(firstUsablePoint(hole), outer))
  ]);

  if (polygons.length === 1) {
    return { type: "Polygon", coordinates: polygons[0]! };
  }

  return { type: "MultiPolygon", coordinates: polygons };
}

function normalizeRing(input: readonly unknown[]): LngLat[][] {
  const ring = input.flatMap((point): LngLat[] => {
    if (!Array.isArray(point) || point.length < 2) {
      return [];
    }

    const lng = Number(point[0]);
    const lat = Number(point[1]);

    return Number.isFinite(lng) && Number.isFinite(lat) ? [[lng, lat]] : [];
  });
  const first = ring[0];
  const last = ring.at(-1);

  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0], first[1]]);
  }

  return ring.length >= 4 ? [ring] : [];
}

function signedRingArea(ring: readonly LngLat[]): number {
  let area = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index] ?? [0, 0];
    const next = ring[index + 1] ?? [0, 0];
    area += current[0] * next[1] - next[0] * current[1];
  }

  return area / 2;
}

function firstUsablePoint(ring: readonly LngLat[]): LngLat {
  return ring[0] ?? [0, 0];
}

function pointInRing(point: LngLat, ring: readonly LngLat[]): boolean {
  let inside = false;
  const [x, y] = point;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index] ?? [0, 0];
    const [xj, yj] = ring[previous] ?? [0, 0];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function normalizeAdm3SemanticType(input: string): TerritorySemanticAdminType | undefined {
  const normalized = input.trim().toLocaleLowerCase("tr-TR").replace(/_/g, "-");

  if (ALLOWED_ADM3_SEMANTIC_TYPES.has(normalized as TerritorySemanticAdminType)) {
    return normalized as TerritorySemanticAdminType;
  }

  if (normalized === "mahalle") {
    return "neighbourhood";
  }

  if (normalized === "koy" || normalized === "köy") {
    return "village";
  }

  return undefined;
}

function resolveParentMapping(
  parentMappings: Record<string, string> | undefined,
  rawParent: string
): string | undefined {
  if (!parentMappings) {
    return undefined;
  }

  const direct = parentMappings[rawParent];

  if (direct) {
    return direct;
  }

  const normalizedRaw = normalizeParentKey(rawParent);
  const normalized = Object.entries(parentMappings).find(
    ([key]) => normalizeParentKey(key) === normalizedRaw
  );

  return normalized?.[1];
}

function normalizeParentKey(input: string): string {
  return input.trim().normalize("NFKC").toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function normalizeDisplayName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function createFingerprintSourceId(input: {
  providerId: string;
  provinceCode: string;
  name: string;
  parent?: string;
  geometry: TerritoryGeometry;
}): string {
  return `fingerprint-${sha256Hex(
    JSON.stringify({
      providerId: input.providerId,
      provinceCode: input.provinceCode,
      parent: input.parent ?? null,
      name: normalizeDisplayName(input.name),
      geometryHash: hashGeometry(input.geometry)
    })
  ).slice(0, 20)}`;
}

function hashGeometry(geometry: TerritoryGeometry): string {
  return sha256Hex(JSON.stringify(canonicalGeometry(geometry)));
}

function canonicalGeometry(geometry: TerritoryGeometry): unknown {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : (geometry.coordinates as LngLat[][][]);

  return polygons
    .map((polygon) =>
      polygon
        .map((ring) => canonicalRing(ring as LngLat[]))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    )
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function canonicalRing(ring: LngLat[]): LngLat[] {
  const open = ring.length > 1 && pointsEqual(ring[0], ring.at(-1)) ? ring.slice(0, -1) : ring;
  const normalized = open.map((point): LngLat => [
    roundCoordinate(point[0]),
    roundCoordinate(point[1])
  ]);
  const forward = rotateToSmallestPoint(normalized);
  const reverse = rotateToSmallestPoint([...normalized].reverse());

  return JSON.stringify(forward).localeCompare(JSON.stringify(reverse)) <= 0 ? forward : reverse;
}

function rotateToSmallestPoint(ring: LngLat[]): LngLat[] {
  if (ring.length === 0) {
    return [];
  }

  let minIndex = 0;

  for (let index = 1; index < ring.length; index += 1) {
    if (comparePoints(ring[index]!, ring[minIndex]!) < 0) {
      minIndex = index;
    }
  }

  return [...ring.slice(minIndex), ...ring.slice(0, minIndex)];
}

function comparePoints(left: LngLat, right: LngLat): number {
  return left[0] - right[0] || left[1] - right[1];
}

function pointsEqual(left: LngLat | undefined, right: LngLat | undefined): boolean {
  return Boolean(left && right && left[0] === right[0] && left[1] === right[1]);
}

function readFeatureId(feature: Record<string, unknown>): string | undefined {
  const id = feature.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
}

function readXmlText(input: string, tagName: string): string | undefined {
  const match = input.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1] ? stripTags(match[1]) : undefined;
}

function readXmlAttribute(tag: string, attributeName: string): string | undefined {
  const pattern = new RegExp(`\\b${attributeName}=(["'])(.*?)\\1`, "i");
  return decodeHtml(tag.match(pattern)?.[2] ?? "").trim() || undefined;
}

function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

function decodeHtml(input: string): string {
  return input
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function inspectXmlSafety(input: string): TerritoryCountryBuildIssue | undefined {
  if (/<!DOCTYPE\b/i.test(input) || /<!ENTITY\b/i.test(input)) {
    return createIssue(
      "TR_ADM3_SOURCE_XML_UNSAFE",
      "KML/KMZ source contains a DOCTYPE or ENTITY declaration, which is not accepted."
    );
  }

  return undefined;
}

function detectPrjCrs(prj: string): string | undefined {
  const normalized = prj.toUpperCase().replace(/[\s_]+/g, "");

  if (
    normalized.includes("WGS84") ||
    normalized.includes("WGS1984") ||
    normalized.includes('EPSG",4326')
  ) {
    return "EPSG:4326";
  }

  if (
    normalized.includes("WEBMERCATOR") ||
    normalized.includes("PSEUDOMERCATOR") ||
    normalized.includes('EPSG",3857')
  ) {
    return "EPSG:3857";
  }

  return undefined;
}

function stripExtension(path: string): string {
  return path.replace(/\.[^.]+$/, "");
}

function readUtf8(input: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(input);
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
  );
}

function findDuplicateValues(values: readonly string[]): string[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

function findDuplicateNames(
  features: readonly TurkeyAdm3RawProviderFeature[]
): Array<{ name: string; parent: string; count: number }> {
  const counts = new Map<string, { name: string; parent: string; count: number }>();

  for (const feature of features) {
    const parent = feature.parentAdm2Id ?? feature.sourceParentId ?? "unresolved-parent";
    const key = `${normalizeParentKey(parent)}|${normalizeParentKey(feature.name)}`;
    const current = counts.get(key) ?? { name: feature.name, parent, count: 0 };
    counts.set(key, { ...current, count: current.count + 1 });
  }

  return [...counts.values()]
    .filter((entry) => entry.count > 1)
    .sort(
      (left, right) =>
        left.parent.localeCompare(right.parent) || left.name.localeCompare(right.name)
    );
}

function compareRawFeatures(
  left: TurkeyAdm3RawProviderFeature,
  right: TurkeyAdm3RawProviderFeature
): number {
  return (
    (left.parentAdm2Id ?? left.sourceParentId ?? "").localeCompare(
      right.parentAdm2Id ?? right.sourceParentId ?? ""
    ) ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.name.localeCompare(right.name)
  );
}

function createIssue(
  code: string,
  message: string,
  options: { severity?: "info" | "warning" | "error" } = {}
): TerritoryCountryBuildIssue {
  return {
    code,
    severity: options.severity ?? "error",
    message,
    level: "ADM3"
  };
}

function compareIssues(
  left: TerritoryCountryBuildIssue,
  right: TerritoryCountryBuildIssue
): number {
  return (
    (left.level ?? "").localeCompare(right.level ?? "") ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}
