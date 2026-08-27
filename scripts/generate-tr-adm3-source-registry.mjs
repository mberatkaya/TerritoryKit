#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { format as formatPrettier } from "prettier";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const GENERATED_AT = "2026-08-26T00:00:00.000Z";
const INVENTORY_PATH = resolve(ROOT, "datasets/registry/tr-adm3-source-inventory.json");
const SOURCE_DIR = resolve(ROOT, "datasets/sources/TR/adm3");
const REPORT_DIR = resolve(ROOT, "reports/tr-adm3");
const DOC_DIR = resolve(ROOT, "docs/datasets");

const REGISTRY_SCHEMA_VERSION = "territorykit-tr-adm3-source-registry@1";
const COVERAGE_SCHEMA_VERSION = "territorykit-tr-adm3-source-coverage@1";
const NATIONAL_SCHEMA_VERSION = "territorykit-tr-adm3-national-source-assessments@1";

const PROVINCE_SOURCE_STATUSES = [
  "official-ready",
  "official-license-review",
  "official-restricted",
  "official-service-only",
  "partial-official",
  "osm-candidate",
  "research-required",
  "unavailable"
];

const DISCOVERY_CONFIDENCES = ["verified", "probable", "unverified"];
const LIFECYCLE_STATES = ["discovered", "verified", "downloaded", "approved"];
const LICENSE_STATES = ["approved", "review-required", "restricted", "unknown"];
const REDISTRIBUTION_STATES = ["allowed", "prohibited", "unclear"];
const ACCESS_TYPES = [
  "public-download",
  "public-api",
  "authenticated",
  "request-required",
  "restricted",
  "unknown"
];

const OSM_SOURCE = {
  sourceUrl: "https://download.geofabrik.de/europe/turkey.html",
  downloadUrl: "https://download.geofabrik.de/europe/turkey-latest.osm.pbf",
  sourceDate: "2026-08-24T20:20:50Z",
  expectedByteSize: 613_000_000,
  license: "ODbL-1.0",
  licenseUrl: "https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ",
  attribution: "OpenStreetMap contributors, ODbL 1.0; extract by Geofabrik"
};

const NATIONAL_SOURCES = [
  {
    access: "restricted",
    authoritative: true,
    authorityType: "national-government",
    coverage: "national",
    evidenceUrls: [
      "https://maks.nvi.gov.tr/",
      "https://adres.nvi.gov.tr/Home",
      "https://www.youtube.com/watch?v=mE2PuqUmtUw"
    ],
    formats: ["restricted MAKS service/export"],
    geometryAvailable: "unknown",
    licenseState: "restricted",
    notes:
      "MAKS is the national authority path for spatialized address data and UAVT linkage, but no public WFS/WMS/API or redistributable ADM3 polygon download was found. Treat as authority-request only.",
    productionEligible: false,
    provider: "NVI Mekansal Adres Kayit Sistemi (MAKS)",
    redistribution: "unclear"
  },
  {
    access: "request-required",
    authoritative: false,
    authorityType: "national-government",
    coverage: "national",
    evidenceUrls: [
      "https://tucbs.gov.tr/",
      "https://www.turkiye.gov.tr/csb-tucbs-8514",
      "https://cbs.csb.gov.tr/"
    ],
    formats: ["metadata catalog", "WMS/WFS/WMTS/WCS when a data owner grants access"],
    geometryAvailable: "unknown",
    licenseState: "review-required",
    notes:
      "TUCBS is the national geographic information platform and request channel. Public pages confirm identity-gated access and data-owner permission controls; no openly redistributable ADM3 layer was locked.",
    productionEligible: false,
    provider: "TUCBS Ulusal Cografi Bilgi Platformu",
    redistribution: "unclear"
  },
  {
    access: "restricted",
    authoritative: true,
    authorityType: "national-government",
    coverage: "national",
    evidenceUrls: ["https://adres.nvi.gov.tr/Home", "https://maks.nvi.gov.tr/"],
    formats: ["restricted address registry interface"],
    geometryAvailable: false,
    licenseState: "restricted",
    notes:
      "NVI/UAVT is authoritative for stable address components and neighbourhood identifiers, but the public interface is not an ADM3 polygon distribution endpoint.",
    productionEligible: false,
    provider: "NVI Adres Kayit Sistemi / UAVT",
    redistribution: "unclear"
  },
  {
    access: "public-download",
    authoritative: true,
    authorityType: "national-government",
    coverage: "partial",
    evidenceUrls: ["https://www.harita.gov.tr/urun/turkiye-mulki-idare-sinirlari/232"],
    formats: ["map/product download"],
    geometryAvailable: "unknown",
    licenseState: "review-required",
    notes:
      "Harita Genel Mudurlugu publishes a national mulki idare boundary product, but current evidence points at country/province/district/village administrative boundaries rather than a reviewed urban mahalle polygon source for TerritoryKit ADM3.",
    productionEligible: false,
    provider: "Harita Genel Mudurlugu Turkiye Mulki Idare Sinirlari",
    redistribution: "unclear"
  }
];

const SOURCE_PRIORITY = [
  {
    boundarySourceClass: "official-national",
    description: "National authoritative ADM3 source with redistribution rights and lock metadata.",
    priority: "P0",
    productionDefault: true
  },
  {
    boundarySourceClass: "official-local",
    description:
      "Municipality official open dataset with vector ADM3 polygons and approved license.",
    priority: "P1",
    productionDefault: true
  },
  {
    boundarySourceClass: "official-local",
    description:
      "Municipality official GIS/API/WFS service requiring adapter, access, or license review.",
    priority: "P2",
    productionDefault: false
  },
  {
    boundarySourceClass: "official-local",
    description:
      "Other official government dataset or authority export outside the municipal open-data path.",
    priority: "P3",
    productionDefault: false
  },
  {
    boundarySourceClass: "osm-administrative",
    description: "OSM administrative polygon candidate, never authoritative for Turkey ADM3.",
    priority: "P4",
    productionDefault: false
  },
  {
    boundarySourceClass: "smart-derived",
    description: "Future smart-derived fallback class; not emitted as a Sprint 2 source.",
    priority: "P5",
    productionDefault: false
  },
  {
    boundarySourceClass: "synthetic-test",
    description: "Synthetic test/gameplay fallback class; not emitted as a Sprint 2 source.",
    priority: "P6",
    productionDefault: false
  }
];

const inventory = JSON.parse(await readFile(INVENTORY_PATH, "utf8"));
const provinces = inventory.provinces.map(createProvinceRegistryEntry);
const statusCounts = createStatusCounts(provinces);
const sourceRegistry = createSourceRegistry(provinces, statusCounts);
const coverageReport = createCoverageReport(provinces, statusCounts);
const nationalAssessments = createNationalAssessments();

await writeJson(resolve(SOURCE_DIR, "source-registry.schema.json"), createSourceRegistrySchema());
await writeJson(resolve(SOURCE_DIR, "source-registry.json"), sourceRegistry);
await writeJson(resolve(SOURCE_DIR, "national-assessments.json"), nationalAssessments);
await writeJson(resolve(REPORT_DIR, "source-coverage.json"), coverageReport);
await writeMarkdown(
  resolve(REPORT_DIR, "source-coverage.md"),
  renderCoverageMarkdown(coverageReport)
);
await writeMarkdown(resolve(DOC_DIR, "tr-adm3-source-strategy.md"), renderSourceStrategyDoc());
await writeMarkdown(resolve(DOC_DIR, "tr-adm3-source-registry.md"), renderSourceRegistryDoc());

console.log(renderCoverageConsole(coverageReport));

function createProvinceRegistryEntry(province) {
  const status = mapProvinceStatus(province.status);
  const officialSource = createOfficialSource(province, status);
  const osmSource = createOsmSource(province);

  return stableRecord({
    code: province.provinceCode,
    name: province.provinceName,
    status,
    sourceSummary: {
      officialSourceAvailable: !["osm-candidate", "research-required", "unavailable"].includes(
        status
      ),
      osmFallbackTracked: true,
      productionEligible: officialSource.productionEligible === true
    },
    sources: [officialSource, osmSource]
  });
}

function createOfficialSource(province, provinceStatus) {
  const isAuthorityRequest = province.status === "requires-authority-request";
  const geometryAvailable = inferGeometryAvailability(province);
  const format = isAuthorityRequest
    ? ["authority export format TBD"]
    : normalizeFormats(province.format, province.recommendedAdapter);
  const accessType = inferAccessType(province, format);
  const lifecycle = inferLifecycle(province);
  const license = inferLicense(province);
  const priority = inferOfficialPriority(province, accessType, provinceStatus);
  const boundarySourceClass = isAuthorityRequest ? "official-national" : "official-local";
  const authoritative = isAuthorityRequest || geometryAvailable !== false;
  const sourceId = `tr-adm3-${boundarySourceClass}-${province.provinceCode}-${slug(
    province.provider
  )}`;

  return stableRecord({
    access: {
      geometryAvailable,
      formats: format,
      type: accessType,
      urls: urlsForProvince(province)
    },
    administrative: authoritative,
    authoritative,
    boundarySourceClass,
    coverage: isAuthorityRequest
      ? "national"
      : geometryAvailable === false
        ? "partial"
        : "province",
    discoveryConfidence: inferDiscoveryConfidence(province),
    fields: {
      districtParentField: province.districtParentField,
      nameField: province.neighbourhoodNameField,
      sourceNativeIdField: province.sourceNativeIdField
    },
    id: sourceId,
    lifecycle,
    license,
    notes: [
      province.qualityRisk,
      `Original Sprint 1 inventory status: ${province.status}.`,
      ...(isAuthorityRequest
        ? [
            "Province must use the national MAKS/NVI authority request path until a local source is found."
          ]
        : [])
    ],
    priority,
    productionEligible:
      provinceStatus === "official-ready" &&
      license.state === "approved" &&
      license.redistribution === "allowed",
    provider: {
      authorityType: isAuthorityRequest ? "national-government" : "local-government",
      class: boundarySourceClass,
      name: province.provider
    },
    sourceDate: province.sourceDate,
    sourceId: sourceId,
    sourceInventoryStatus: province.status,
    verification: {
      checkedAt: GENERATED_AT,
      evidenceUrls: province.evidenceUrls,
      featureCount: province.featureCount,
      sourceDate: province.sourceDate
    }
  });
}

function createOsmSource(province) {
  const id = `tr-adm3-osm-${province.provinceCode}-geofabrik-turkey`;

  return stableRecord({
    access: {
      geometryAvailable: "unknown",
      formats: ["OSM PBF", "derived Shapefile ZIP"],
      type: "public-download",
      urls: {
        dataset: OSM_SOURCE.sourceUrl,
        download: OSM_SOURCE.downloadUrl,
        license: OSM_SOURCE.licenseUrl
      }
    },
    administrative: false,
    authoritative: false,
    boundarySourceClass: "osm-administrative",
    coverage: "unknown",
    discoveryConfidence: "verified",
    fields: {
      districtParentField: "admin_level parent relation",
      nameField: "name",
      sourceNativeIdField: "osm_type/osm_id"
    },
    id,
    lifecycle: "discovered",
    license: {
      commercialUse: "allowed",
      modification: "allowed",
      name: OSM_SOURCE.license,
      redistribution: "allowed",
      state: "review-required"
    },
    notes: [
      "OSM is tracked only as a fallback candidate.",
      "Do not promote OSM place nodes, open ways, or broken relations to ADM3 polygons.",
      "Province-level administrative boundary coverage is unknown until a bounded OSM extraction report is generated."
    ],
    priority: "P4",
    productionEligible: false,
    provider: {
      authorityType: "community",
      class: "osm-administrative",
      name: `OpenStreetMap / Geofabrik Turkey (${province.provinceName})`
    },
    sourceDate: OSM_SOURCE.sourceDate,
    sourceId: id,
    verification: {
      checkedAt: GENERATED_AT,
      evidenceUrls: [OSM_SOURCE.sourceUrl, OSM_SOURCE.licenseUrl],
      expectedByteSize: OSM_SOURCE.expectedByteSize,
      featureCount: null,
      sourceDate: OSM_SOURCE.sourceDate
    }
  });
}

function createSourceRegistry(provinceEntries, statusCounts) {
  const allSources = provinceEntries.flatMap((province) => province.sources);

  return stableRecord({
    country: "TR",
    generatedAt: GENERATED_AT,
    level: "ADM3",
    nationalSources: NATIONAL_SOURCES,
    provinces: provinceEntries,
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    sourcePriority: SOURCE_PRIORITY,
    summary: {
      officialSourceCount: allSources.filter((source) =>
        String(source.boundarySourceClass).startsWith("official")
      ).length,
      osmCandidateSourceCount: allSources.filter(
        (source) => source.boundarySourceClass === "osm-administrative"
      ).length,
      productionEligibleProvinceCount: provinceEntries.filter(
        (province) => province.sourceSummary.productionEligible
      ).length,
      productionEligibleSourceCount: allSources.filter((source) => source.productionEligible)
        .length,
      provinceCount: 81,
      sourceCount: allSources.length,
      statusCounts
    }
  });
}

function createCoverageReport(provinceEntries, statusCounts) {
  return stableRecord({
    country: "TR",
    generatedAt: GENERATED_AT,
    level: "ADM3",
    provinces: provinceEntries.map((province) =>
      stableRecord({
        code: province.code,
        name: province.name,
        productionEligible: province.sourceSummary.productionEligible,
        sources: province.sources.map((source) => source.id),
        status: province.status
      })
    ),
    schemaVersion: COVERAGE_SCHEMA_VERSION,
    summary: {
      provinceCount: 81,
      sourceCount: provinceEntries.flatMap((province) => province.sources).length,
      statusCounts
    }
  });
}

function createNationalAssessments() {
  return stableRecord({
    country: "TR",
    generatedAt: GENERATED_AT,
    level: "ADM3",
    schemaVersion: NATIONAL_SCHEMA_VERSION,
    sources: NATIONAL_SOURCES
  });
}

function createStatusCounts(provinceEntries) {
  const counts = Object.fromEntries(PROVINCE_SOURCE_STATUSES.map((status) => [status, 0]));

  for (const province of provinceEntries) {
    counts[province.status] += 1;
  }

  return counts;
}

function mapProvinceStatus(status) {
  switch (status) {
    case "approved":
      return "official-ready";
    case "candidate":
    case "license-blocked":
    case "quality-blocked":
      return "official-license-review";
    case "access-blocked":
      return "official-service-only";
    case "geometry-unavailable":
      return "partial-official";
    case "requires-authority-request":
      return "official-restricted";
    case "not-found":
      return "osm-candidate";
    default:
      return "research-required";
  }
}

function inferOfficialPriority(province, accessType, provinceStatus) {
  if (province.status === "requires-authority-request") return "P0";
  if (provinceStatus === "official-service-only" || accessType === "public-api") return "P2";
  if (provinceStatus === "official-ready" || accessType === "public-download") return "P1";
  return "P3";
}

function inferAccessType(province, formats) {
  if (province.status === "requires-authority-request") return "request-required";
  if (province.status === "access-blocked") return "public-api";
  if (formats.some((format) => /ArcGIS|WFS|WMS|KEOS|GeoServer/i.test(format))) {
    return "public-api";
  }
  if (province.downloadOrServiceUrl) return "public-download";
  if (province.status === "license-blocked") return "restricted";
  return "unknown";
}

function inferGeometryAvailability(province) {
  if (province.status === "geometry-unavailable") return false;
  if (province.status === "requires-authority-request") return "unknown";
  if (province.downloadOrServiceUrl || province.status === "license-blocked") return true;
  return "unknown";
}

function inferLifecycle(province) {
  if (province.status === "approved") return "approved";
  if (province.status === "candidate") return "verified";
  return "discovered";
}

function inferDiscoveryConfidence(province) {
  if (province.status === "approved") return "verified";
  if (
    province.status === "candidate" ||
    province.status === "license-blocked" ||
    province.status === "quality-blocked" ||
    province.status === "access-blocked"
  ) {
    return "probable";
  }

  return province.status === "geometry-unavailable" ? "unverified" : "probable";
}

function inferLicense(province) {
  if (province.status === "approved") {
    return stableRecord({
      commercialUse: permissionToRedistribution(province.commercialUsePermission),
      modification: permissionToRedistribution(province.redistributionPermission),
      name: province.license,
      redistribution: permissionToRedistribution(province.redistributionPermission),
      state: "approved"
    });
  }

  if (province.status === "requires-authority-request") {
    return stableRecord({
      commercialUse: "unclear",
      modification: "unclear",
      name: province.license,
      redistribution: "unclear",
      state: "restricted"
    });
  }

  return stableRecord({
    commercialUse: "unclear",
    modification: "unclear",
    name: province.license,
    redistribution: province.redistributionPermission === "restricted" ? "prohibited" : "unclear",
    state: province.status === "geometry-unavailable" ? "unknown" : "review-required"
  });
}

function permissionToRedistribution(permission) {
  if (permission === "allowed") return "allowed";
  if (permission === "restricted") return "prohibited";
  return "unclear";
}

function urlsForProvince(province) {
  return stableRecord({
    dataset: province.sourceUrl,
    download:
      province.downloadOrServiceUrl && !isServiceUrl(province.downloadOrServiceUrl)
        ? province.downloadOrServiceUrl
        : undefined,
    license: province.evidenceUrls.find((url) => /license|lisans|creative/i.test(String(url))),
    service:
      province.downloadOrServiceUrl && isServiceUrl(province.downloadOrServiceUrl)
        ? province.downloadOrServiceUrl
        : undefined
  });
}

function isServiceUrl(url) {
  return /MapServer|FeatureServer|\/query|wfs|wms|geoserver/i.test(String(url));
}

function normalizeFormats(format, adapter) {
  const formats = [];
  const value = `${format ?? ""} ${adapter ?? ""}`;

  if (/GeoJSON/i.test(value)) formats.push("GeoJSON");
  if (/KML/i.test(value)) formats.push("KML");
  if (/KMZ/i.test(value)) formats.push("KMZ");
  if (/SHP|Shapefile/i.test(value)) formats.push("SHP ZIP");
  if (/ArcGIS FeatureServer/i.test(value)) formats.push("ArcGIS FeatureServer");
  if (/ArcGIS MapServer|MapServer/i.test(value)) formats.push("ArcGIS MapServer");
  if (/WFS/i.test(value)) formats.push("WFS");
  if (/PDF/i.test(value)) formats.push("PDF map");
  if (/JPEG|JPG|PNG/i.test(value)) formats.push("raster map");
  if (/CSV/i.test(value)) formats.push("CSV table");
  if (/XLS|XLSX/i.test(value)) formats.push("XLSX table");
  if (/RAR/i.test(value)) formats.push("RAR archive");

  return formats.length > 0 ? [...new Set(formats)] : [];
}

function createSourceRegistrySchema() {
  return stableRecord({
    $id: "https://territory-kit.local/schemas/tr-adm3-source-registry.schema.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: {
      country: { const: "TR" },
      generatedAt: { type: "string" },
      level: { const: "ADM3" },
      nationalSources: {
        items: { $ref: "#/$defs/nationalSource" },
        minItems: 3,
        type: "array"
      },
      provinces: {
        items: { $ref: "#/$defs/province" },
        maxItems: 81,
        minItems: 81,
        type: "array"
      },
      schemaVersion: { const: REGISTRY_SCHEMA_VERSION },
      sourcePriority: {
        items: { $ref: "#/$defs/sourcePriority" },
        minItems: 7,
        type: "array"
      },
      summary: { type: "object" }
    },
    required: [
      "schemaVersion",
      "country",
      "level",
      "generatedAt",
      "summary",
      "nationalSources",
      "sourcePriority",
      "provinces"
    ],
    title: "TerritoryKit Turkey ADM3 source registry",
    type: "object",
    $defs: {
      access: {
        additionalProperties: false,
        properties: {
          formats: { items: { type: "string" }, type: "array" },
          geometryAvailable: { enum: [true, false, "unknown"] },
          type: { enum: ACCESS_TYPES },
          urls: { type: "object" }
        },
        required: ["type", "formats", "geometryAvailable", "urls"],
        type: "object"
      },
      license: {
        additionalProperties: false,
        properties: {
          commercialUse: { enum: REDISTRIBUTION_STATES },
          modification: { enum: REDISTRIBUTION_STATES },
          name: { type: "string" },
          redistribution: { enum: REDISTRIBUTION_STATES },
          state: { enum: LICENSE_STATES }
        },
        required: ["state", "redistribution", "commercialUse", "modification", "name"],
        type: "object"
      },
      nationalSource: {
        additionalProperties: false,
        properties: {
          access: { enum: ACCESS_TYPES },
          authoritative: { type: "boolean" },
          authorityType: { const: "national-government" },
          coverage: { enum: ["national", "partial", "unknown"] },
          evidenceUrls: { items: { type: "string" }, type: "array" },
          formats: { items: { type: "string" }, type: "array" },
          geometryAvailable: { enum: [true, false, "unknown"] },
          licenseState: { enum: LICENSE_STATES },
          notes: { type: "string" },
          productionEligible: { type: "boolean" },
          provider: { type: "string" },
          redistribution: { enum: ["allowed", "not-allowed", "unclear"] }
        },
        required: [
          "provider",
          "authorityType",
          "coverage",
          "geometryAvailable",
          "access",
          "formats",
          "licenseState",
          "redistribution",
          "authoritative",
          "productionEligible",
          "notes",
          "evidenceUrls"
        ],
        type: "object"
      },
      priority: { enum: ["P0", "P1", "P2", "P3", "P4", "P5", "P6"] },
      provider: {
        additionalProperties: false,
        properties: {
          authorityType: {
            enum: ["national-government", "local-government", "other-government", "community"]
          },
          class: {
            enum: [
              "official-national",
              "official-local",
              "osm-administrative",
              "smart-derived",
              "synthetic-test"
            ]
          },
          name: { type: "string" }
        },
        required: ["name", "authorityType", "class"],
        type: "object"
      },
      province: {
        additionalProperties: false,
        properties: {
          code: { pattern: "^[0-9]{2}$", type: "string" },
          name: { type: "string" },
          sourceSummary: { type: "object" },
          sources: { items: { $ref: "#/$defs/source" }, minItems: 1, type: "array" },
          status: { enum: PROVINCE_SOURCE_STATUSES }
        },
        required: ["code", "name", "status", "sourceSummary", "sources"],
        type: "object"
      },
      source: {
        additionalProperties: false,
        properties: {
          access: { $ref: "#/$defs/access" },
          administrative: { type: "boolean" },
          authoritative: { type: "boolean" },
          boundarySourceClass: {
            enum: [
              "official-national",
              "official-local",
              "osm-administrative",
              "smart-derived",
              "synthetic-test"
            ]
          },
          coverage: { enum: ["national", "province", "districts", "partial", "unknown"] },
          discoveryConfidence: { enum: DISCOVERY_CONFIDENCES },
          fields: { type: "object" },
          id: { type: "string" },
          lifecycle: { enum: LIFECYCLE_STATES },
          license: { $ref: "#/$defs/license" },
          notes: { items: { type: "string" }, type: "array" },
          priority: { $ref: "#/$defs/priority" },
          productionEligible: { type: "boolean" },
          provider: { $ref: "#/$defs/provider" },
          sourceDate: { type: ["string", "null"] },
          sourceId: { type: "string" },
          sourceInventoryStatus: { type: "string" },
          verification: { type: "object" }
        },
        required: [
          "id",
          "sourceId",
          "provider",
          "boundarySourceClass",
          "priority",
          "access",
          "license",
          "lifecycle",
          "discoveryConfidence",
          "authoritative",
          "administrative",
          "productionEligible",
          "coverage",
          "fields",
          "verification",
          "notes"
        ],
        type: "object"
      },
      sourcePriority: {
        additionalProperties: false,
        properties: {
          boundarySourceClass: { type: "string" },
          description: { type: "string" },
          priority: { $ref: "#/$defs/priority" },
          productionDefault: { type: "boolean" }
        },
        required: ["priority", "boundarySourceClass", "description", "productionDefault"],
        type: "object"
      }
    }
  });
}

function renderCoverageConsole(report) {
  const counts = report.summary.statusCounts;

  return `Turkey ADM3 Source Coverage

Provinces: ${report.summary.provinceCount}

Official ready:              ${counts["official-ready"]}
Official license review:     ${counts["official-license-review"]}
Official restricted:         ${counts["official-restricted"]}
Official service only:       ${counts["official-service-only"]}
Partial official:            ${counts["partial-official"]}
OSM candidate only:          ${counts["osm-candidate"]}
Research required:           ${counts["research-required"]}
Unavailable:                 ${counts.unavailable}
`;
}

function renderCoverageMarkdown(report) {
  const rows = report.provinces
    .map(
      (province) =>
        `| ${province.code} | ${province.name} | ${province.status} | ${province.productionEligible ? "yes" : "no"} | ${province.sources.join(", ")} |`
    )
    .join("\n");

  return `# Turkey ADM3 Source Coverage

${renderCoverageConsole(report)}
| Code | Province | Status | Production eligible | Sources |
| --- | --- | --- | --- | --- |
${rows}
`;
}

function renderSourceStrategyDoc() {
  return `# Turkey ADM3 Source Strategy

TerritoryKit models Turkey ADM3 as source discovery first. This registry does not invent mahalle polygons and does not automatically promote discovered sources into production artifacts.

## Priority

| Priority | Source class | Meaning |
| --- | --- | --- |
| P0 | official-national | National authoritative ADM3 geometry with usable redistribution rights. |
| P1 | official-local | Municipal official open vector dataset with approved license and source-lock evidence. |
| P2 | official-local | Municipal official GIS/API/WFS source that needs adapter, access, or license review. |
| P3 | official-local | Other official government source or authority export. |
| P4 | osm-administrative | OSM administrative polygon fallback candidate; never authoritative for Turkey ADM3. |
| P5 | smart-derived | Future derived fallback class; not emitted by Sprint 2. |
| P6 | synthetic-test | Synthetic test/gameplay class; not emitted by Sprint 2. |

## National Sources

- MAKS/NVI is the authority path for spatial address registry data, but no public redistributable ADM3 polygon API or download is locked.
- TUCBS is the national platform and request channel. Access is identity- and permission-mediated; source-owner approval still controls reuse.
- NVI/UAVT supplies stable address identifiers, not a public polygon distribution endpoint.
- Harita Genel Mudurlugu publishes national administrative boundary products, but the current ADM3/mahalle production fit remains license and layer-scope review work.

## Authority vs Redistribution

Authority and redistribution are separate fields. A municipality or national system may be authoritative for a boundary while its license state remains unknown, restricted, or review-required. TerritoryKit only sets \`productionEligible: true\` when the source is authoritative, license-approved, redistributable, and has enough source-lock evidence.

## License Review

License review is intentionally conservative. Public map visibility, a working REST endpoint, or an official provider name is not enough to embed geometry in a redistributable package. If terms are not explicit, the source remains review-required, restricted, or unknown.
`;
}

function renderSourceRegistryDoc() {
  return `# Turkey ADM3 Source Registry

Machine-readable files:

- \`datasets/sources/TR/adm3/source-registry.json\`
- \`datasets/sources/TR/adm3/source-registry.schema.json\`
- \`datasets/sources/TR/adm3/national-assessments.json\`
- \`reports/tr-adm3/source-coverage.json\`

## Source Status

| Status | Meaning |
| --- | --- |
| official-ready | Official vector source has approved license and enough evidence to be production-eligible after explicit ingestion approval. |
| official-license-review | Official source exists, but license, adapter, CRS, parent mapping, or field evidence still needs review. |
| official-restricted | Authority source exists only through restricted, authenticated, or request-required channels. |
| official-service-only | Official GIS/API/WFS-like service is visible, but no reviewed open download/source lock exists. |
| partial-official | Official evidence exists but is only a rendered map, table, partial district source, or otherwise not province-wide vector ADM3 geometry. |
| osm-candidate | No usable official source is known; OSM is tracked only as a fallback candidate. |
| research-required | The province needs additional discovery before even a fallback decision is reliable. |
| unavailable | No usable or candidate source is currently known. |

## Adding A Province Source

Update \`datasets/registry/tr-adm3-source-inventory.json\` with provider, source URL, access URL, format, license, rights, feature count, fields, status, and evidence URLs. Then run:

\`\`\`sh
pnpm data:tr:adm3:sources
\`\`\`

Do not add checksums for sources that have not been downloaded through an approved ingestion path. Do not set \`productionEligible\` through manual edits; the generator derives it from source status and license/redistribution evidence.

## Production Safety

The source registry is discovery infrastructure. It does not change \`datasets/sources/TR/adm3-catalog.json\`, does not download new polygon files, and does not add discovered provinces to the production Turkey V2 build.
`;
}

async function writeJson(path, input) {
  const formatted = await formatPrettier(JSON.stringify(stableRecord(input), null, 2), {
    parser: "json",
    printWidth: 100,
    semi: true,
    singleQuote: false,
    trailingComma: "none"
  });

  await writeFileEnsured(path, formatted);
}

async function writeMarkdown(path, content) {
  const formatted = await formatPrettier(content, {
    parser: "markdown",
    printWidth: 100,
    semi: true,
    singleQuote: false,
    trailingComma: "none"
  });

  await writeFileEnsured(path, formatted);
}

async function writeFileEnsured(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function slug(input) {
  return String(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function stableRecord(input) {
  if (Array.isArray(input)) {
    return input.map(stableRecord);
  }

  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, stableRecord(value)])
    );
  }

  return input;
}
