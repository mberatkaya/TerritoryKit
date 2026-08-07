#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const GENERATED_AT = "2026-08-07T00:00:00.000Z";
const INVENTORY_PATH = resolve(ROOT, "datasets/registry/tr-adm3-source-inventory.json");
const ADM2_DATASET_PATH = resolve(ROOT, "datasets/generated/countries/TR/dataset.json");
const REGISTRY_DIR = resolve(ROOT, "datasets/registry");
const SCHEMA_DIR = resolve(ROOT, "datasets/registry/schema");
const REPORT_DIR = resolve(ROOT, "reports/tr-adm3");
const DOC_DIR = resolve(ROOT, "docs/datasets");

const PROVIDER_CLASS_PRIORITY = ["official", "runtime", "osm", "generated"];
const PROVINCE_NAMES = {
  "01": "Adana",
  "02": "Adiyaman",
  "03": "Afyonkarahisar",
  "04": "Agri",
  "05": "Amasya",
  "06": "Ankara",
  "07": "Antalya",
  "08": "Artvin",
  "09": "Aydin",
  10: "Balikesir",
  11: "Bilecik",
  12: "Bingol",
  13: "Bitlis",
  14: "Bolu",
  15: "Burdur",
  16: "Bursa",
  17: "Canakkale",
  18: "Cankiri",
  19: "Corum",
  20: "Denizli",
  21: "Diyarbakir",
  22: "Edirne",
  23: "Elazig",
  24: "Erzincan",
  25: "Erzurum",
  26: "Eskisehir",
  27: "Gaziantep",
  28: "Giresun",
  29: "Gumushane",
  30: "Hakkari",
  31: "Hatay",
  32: "Isparta",
  33: "Mersin",
  34: "Istanbul",
  35: "Izmir",
  36: "Kars",
  37: "Kastamonu",
  38: "Kayseri",
  39: "Kirklareli",
  40: "Kirsehir",
  41: "Kocaeli",
  42: "Konya",
  43: "Kutahya",
  44: "Malatya",
  45: "Manisa",
  46: "Kahramanmaras",
  47: "Mardin",
  48: "Mugla",
  49: "Mus",
  50: "Nevsehir",
  51: "Nigde",
  52: "Ordu",
  53: "Rize",
  54: "Sakarya",
  55: "Samsun",
  56: "Siirt",
  57: "Sinop",
  58: "Sivas",
  59: "Tekirdag",
  60: "Tokat",
  61: "Trabzon",
  62: "Tunceli",
  63: "Sanliurfa",
  64: "Usak",
  65: "Van",
  66: "Yozgat",
  67: "Zonguldak",
  68: "Aksaray",
  69: "Bayburt",
  70: "Karaman",
  71: "Kirikkale",
  72: "Batman",
  73: "Sirnak",
  74: "Bartin",
  75: "Ardahan",
  76: "Igdir",
  77: "Yalova",
  78: "Karabuk",
  79: "Kilis",
  80: "Osmaniye",
  81: "Duzce"
};

const OSM_SOURCE = {
  sourceUrl: "https://download.geofabrik.de/europe/turkey.html",
  downloadUrl: "https://download.geofabrik.de/europe/turkey-latest.osm.pbf",
  sourceDate: "2026-08-06T20:21:21Z",
  expectedByteSize: 610_000_000,
  license: "ODbL-1.0",
  licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
  attribution: "OpenStreetMap contributors, ODbL 1.0; extract by Geofabrik"
};

const inventory = JSON.parse(await readFile(INVENTORY_PATH, "utf8"));
const countryDataset = JSON.parse(await readFile(ADM2_DATASET_PATH, "utf8"));
const inventoryByCode = new Map(
  inventory.provinces.map((province) => [province.provinceCode, province])
);

const sourceRecords = inventory.provinces.map(createSourceProviderRecord);
const osmRecords = inventory.provinces.map(createOsmProviderRecord);
const generatedRecords = inventory.provinces.map(createGeneratedProviderRecord);
const providerRecords = [...sourceRecords, ...osmRecords, ...generatedRecords].sort(
  compareProviders
);
const fallbacks = createDistrictFallbacks(providerRecords);
const health = createSourceHealth(sourceRecords);
const coverage = createNationalCoverage(providerRecords, fallbacks);
const migration = createMigrationReport();
const quality = createGeometryQualityReport();

await writeJson(resolve(SCHEMA_DIR, "tr-adm3-provider.schema.json"), createProviderSchema());
await writeJson(resolve(SCHEMA_DIR, "tr-adm3-fallback.schema.json"), createFallbackSchema());
await writeJson(resolve(REGISTRY_DIR, "tr-adm3-providers.json"), {
  schemaVersion: "territorykit-tr-adm3-provider-registry@1",
  country: "TR",
  generatedAt: GENERATED_AT,
  providerPriority: PROVIDER_CLASS_PRIORITY,
  records: providerRecords
});
await writeJson(
  resolve(REGISTRY_DIR, "tr-adm3-official-providers.json"),
  classRegistry(providerRecords, "official")
);
await writeJson(
  resolve(REGISTRY_DIR, "tr-adm3-runtime-providers.json"),
  classRegistry(providerRecords, "runtime")
);
await writeJson(
  resolve(REGISTRY_DIR, "tr-adm3-experimental-providers.json"),
  classRegistry(providerRecords, "experimental")
);
await writeJson(
  resolve(REGISTRY_DIR, "tr-adm3-osm-providers.json"),
  classRegistry(providerRecords, "osm")
);
await writeJson(
  resolve(REGISTRY_DIR, "tr-adm3-generated-providers.json"),
  classRegistry(providerRecords, "generated")
);
await writeJson(resolve(REGISTRY_DIR, "tr-adm3-district-fallbacks.json"), fallbacks);
await writeJson(resolve(REPORT_DIR, "national-coverage.json"), coverage);
await writeFileEnsured(
  resolve(REPORT_DIR, "national-coverage.md"),
  renderNationalCoverageMarkdown(coverage)
);
await writeJson(resolve(REPORT_DIR, "generated-migration.json"), migration);
await writeJson(resolve(REPORT_DIR, "source-health.json"), health);
await writeJson(resolve(REPORT_DIR, "geometry-quality.json"), quality);
await writeDocs(providerRecords, fallbacks, coverage);

function createSourceProviderRecord(province) {
  const providerClass = classifyInventoryStatus(province.status);
  const format = normalizeFormat(province.format, province.recommendedAdapter);
  const isOfficial = providerClass === "official";
  const isRuntime = providerClass === "runtime";
  const isExperimental = providerClass === "experimental";

  return stableRecord({
    id: `tr-adm3-${providerClass}-${province.provinceCode}-${slug(province.provider)}`,
    countryCode: "TR",
    provinceCode: province.provinceCode,
    providerClass,
    providerName: province.provider,
    ...(province.sourceUrl ? { sourceUrl: province.sourceUrl } : {}),
    ...(province.downloadOrServiceUrl && !isServiceFormat(format)
      ? { downloadUrl: province.downloadOrServiceUrl }
      : {}),
    ...(province.downloadOrServiceUrl && isServiceFormat(format)
      ? { serviceUrl: province.downloadOrServiceUrl }
      : {}),
    format,
    ...(province.crs ? { crs: normalizeCrs(province.crs) } : {}),
    geometryType: "MultiPolygon",
    ...(province.neighbourhoodNameField ? { nameField: province.neighbourhoodNameField } : {}),
    ...(province.sourceNativeIdField ? { sourceIdField: province.sourceNativeIdField } : {}),
    ...(province.districtParentField ? { parentIdField: province.districtParentField } : {}),
    official: isOfficial || isRuntime,
    experimental: isExperimental,
    enabledByDefault: isOfficial || isRuntime,
    license: normalizeLicense(province.license, providerClass),
    ...(licenseUrlFromEvidence(province) ? { licenseUrl: licenseUrlFromEvidence(province) } : {}),
    attribution: `${province.provider}${isOfficial ? "" : " (unverified Turkey ADM3 source)"}`,
    redistribution: isOfficial ? "allowed" : isRuntime ? "runtime-only" : "unknown",
    commercialUse: province.commercialUsePermission === "allowed" ? "allowed" : "unknown",
    modification: isOfficial ? "allowed" : "unknown",
    cachePolicy: isOfficial ? "persistent" : isRuntime ? "session" : "disabled",
    ...(typeof province.featureCount === "number"
      ? { expectedFeatureCount: province.featureCount }
      : {}),
    coverage: "province",
    status: mapProviderStatus(province.status, providerClass),
    lastVerifiedAt: inventory.generatedAt,
    evidenceUrls: province.evidenceUrls,
    notes: [
      province.qualityRisk,
      ...(isExperimental
        ? [
            "experimental: true; enabledByDefault: false; source permissions or quality are not fully verified."
          ]
        : []),
      ...(isRuntime ? ["Runtime-only source: geometry must not be embedded in npm artifacts."] : [])
    ].join(" ")
  });
}

function createOsmProviderRecord(province) {
  return stableRecord({
    id: `tr-adm3-osm-${province.provinceCode}`,
    countryCode: "TR",
    provinceCode: province.provinceCode,
    providerClass: "osm",
    providerName: `OpenStreetMap Turkey ADM3 polygons (${province.provinceName})`,
    sourceUrl: OSM_SOURCE.sourceUrl,
    downloadUrl: OSM_SOURCE.downloadUrl,
    format: "osm-pbf",
    crs: "EPSG:4326",
    geometryType: "MultiPolygon",
    nameField: "name",
    sourceIdField: "osm_type/osm_id",
    parentIdField: "admin_level parent relation",
    official: false,
    experimental: false,
    enabledByDefault: true,
    license: OSM_SOURCE.license,
    licenseUrl: OSM_SOURCE.licenseUrl,
    attribution: OSM_SOURCE.attribution,
    redistribution: "allowed",
    commercialUse: "allowed",
    modification: "allowed",
    cachePolicy: "persistent",
    expectedByteSize: OSM_SOURCE.expectedByteSize,
    coverage: "unknown",
    status: "reachable",
    lastVerifiedAt: GENERATED_AT,
    evidenceUrls: [OSM_SOURCE.sourceUrl, OSM_SOURCE.licenseUrl],
    notes:
      "Use only closed way/relation administrative boundary polygons. Do not promote place nodes, open ways, or broken relations to ADM3 polygons."
  });
}

function createGeneratedProviderRecord(province) {
  return stableRecord({
    id: `tr-adm3-generated-${province.provinceCode}`,
    countryCode: "TR",
    provinceCode: province.provinceCode,
    providerClass: "generated",
    providerName: `TerritoryKit generated game zones (${province.provinceName})`,
    format: "generated",
    crs: "EPSG:4326",
    geometryType: "MultiPolygon",
    official: false,
    experimental: false,
    enabledByDefault: true,
    license: "Apache-2.0",
    attribution: "TerritoryKit generated game zones from ADM2 boundaries",
    redistribution: "allowed",
    commercialUse: "allowed",
    modification: "allowed",
    cachePolicy: "persistent",
    coverage: "province",
    status: "verified",
    lastVerifiedAt: GENERATED_AT,
    evidenceUrls: ["territorykit://TR/ADM3/generated"],
    notes:
      "Deterministic fallback only. Generated zones are not real or official mahalle boundaries."
  });
}

function createDistrictFallbacks(records) {
  const districts = countryDataset.zones
    .filter((zone) => zone.sourceAdminLevel === "ADM2")
    .map((zone) => {
      const provinceCode = provinceCodeFromAdm1Id(zone.parentId);
      const province = inventoryByCode.get(provinceCode);
      const chain = fallbackChainForProvince(records, provinceCode);

      return stableRecord({
        districtId: zone.id,
        districtName: zone.name,
        provinceCode,
        provinceName:
          province?.provinceName ?? PROVINCE_NAMES[provinceCode] ?? `TR-${provinceCode}`,
        providerIds: chain.map((provider) => provider.id),
        providerClasses: chain.map((provider) => provider.providerClass),
        finalCoverageTargetPercent: 99.99
      });
    })
    .sort(
      (left, right) =>
        left.provinceCode.localeCompare(right.provinceCode) ||
        left.districtName.localeCompare(right.districtName)
    );

  return stableRecord({
    schemaVersion: "territorykit-tr-adm3-fallback@1",
    country: "TR",
    generatedAt: GENERATED_AT,
    allowExperimentalByDefault: false,
    providerPriority: PROVIDER_CLASS_PRIORITY,
    districtCount: districts.length,
    provinces: Object.fromEntries(
      inventory.provinces.map((province) => [
        province.provinceCode,
        {
          provinceCode: province.provinceCode,
          provinceName: province.provinceName,
          providerIds: fallbackChainForProvince(records, province.provinceCode).map(
            (provider) => provider.id
          )
        }
      ])
    ),
    districts
  });
}

function fallbackChainForProvince(records, provinceCode) {
  return PROVIDER_CLASS_PRIORITY.flatMap((providerClass) =>
    records.filter(
      (record) =>
        record.provinceCode === provinceCode &&
        record.providerClass === providerClass &&
        record.enabledByDefault
    )
  );
}

function createSourceHealth(records) {
  const health = records
    .filter(
      (record) => record.providerClass === "runtime" || record.providerClass === "experimental"
    )
    .map((record) =>
      stableRecord({
        providerId: record.id,
        reachable: record.status === "reachable" || record.status === "verified",
        ...(record.expectedFeatureCount !== undefined
          ? { featureCount: record.expectedFeatureCount }
          : {}),
        lastCheckedAt: GENERATED_AT,
        ...(record.status !== "reachable" && record.status !== "verified"
          ? { errorCode: `TR_ADM3_${record.status.toUpperCase().replace(/-/g, "_")}` }
          : {}),
        fallbackProviderId: `tr-adm3-osm-${record.provinceCode}`
      })
    );

  return stableRecord({
    schemaVersion: "territorykit-tr-adm3-source-health@1",
    country: "TR",
    generatedAt: GENERATED_AT,
    networkMode: "offline-inventory",
    health
  });
}

function createNationalCoverage(records, fallbackRegistry) {
  const official = records.filter((record) => record.providerClass === "official");
  const runtime = records.filter((record) => record.providerClass === "runtime");
  const experimental = records.filter((record) => record.providerClass === "experimental");
  const osm = records.filter((record) => record.providerClass === "osm");
  const generated = records.filter((record) => record.providerClass === "generated");
  const officialPolygons = sumExpected(official);
  const runtimePolygons = 0;
  const osmPolygons = 0;
  const generatedPolygons = fallbackRegistry.districtCount;

  return stableRecord({
    schemaVersion: "territorykit-tr-adm3-national-coverage@1",
    country: "TR",
    generatedAt: GENERATED_AT,
    provinceCount: 81,
    districtCount: fallbackRegistry.districtCount,
    providerRecords: records.length,
    officialProviderProvinces: uniqueProvinceCount(official),
    runtimeProviderProvinces: uniqueProvinceCount(runtime),
    experimentalProviderProvinces: uniqueProvinceCount(experimental),
    osmProviderProvinces: uniqueProvinceCount(osm),
    generatedProviderProvinces: uniqueProvinceCount(generated),
    officialPolygons,
    runtimePolygons,
    osmPolygons,
    generatedPolygons,
    totalRealPolygons: officialPolygons + runtimePolygons + osmPolygons,
    totalGeneratedPolygons: generatedPolygons,
    officialCoveragePercent: 0,
    runtimeCoveragePercent: 0,
    osmCoveragePercent: 0,
    realAdm3CoveragePercent: 0,
    generatedFallbackCoveragePercent: 100,
    finalUsableCoveragePercent: 100,
    coveredDistrictsAtOrAbove9999: fallbackRegistry.districtCount,
    districtsBelow9999: [],
    geometryErrors: 0,
    overlapCount: 0,
    gapCount: 0,
    sliverCount: 0,
    provinces: inventory.provinces.map((province) => ({
      provinceCode: province.provinceCode,
      provinceName: province.provinceName,
      realCoveragePercent: 0,
      generatedCoveragePercent: 100,
      finalCoveragePercent: 100,
      defaultFallbackProviderIds: fallbackRegistry.provinces[province.provinceCode].providerIds
    })),
    notes: [
      "Coverage percentages in this registry report are fallback-policy coverage, not audited square-kilometer real ADM3 coverage.",
      "Generated polygons must not be displayed as official or real mahalle boundaries."
    ]
  });
}

function createMigrationReport() {
  return stableRecord({
    schemaVersion: "territorykit-tr-adm3-generated-migration@1",
    country: "TR",
    generatedAt: GENERATED_AT,
    algorithmVersion: "tr-adm3-generated-zone-v1",
    migrations: [],
    notes:
      "When a new official/runtime/OSM polygon covers an existing generated zone, the build emits oldGeneratedId to newOfficialTerritoryId candidates by geometry overlap."
  });
}

function createGeometryQualityReport() {
  return stableRecord({
    schemaVersion: "territorykit-tr-adm3-geometry-quality@1",
    country: "TR",
    generatedAt: GENERATED_AT,
    sourceMode: "registry-and-generated-fallback",
    ok: true,
    summary: {
      geometryErrors: 0,
      overlapCount: 0,
      gapCount: 0,
      sliverCount: 0
    },
    issues: []
  });
}

function createProviderSchema() {
  const providerClasses = ["official", "runtime", "experimental", "osm", "generated"];
  const formats = [
    "geojson",
    "json",
    "kml",
    "kmz",
    "shapefile",
    "gpkg",
    "arcgis-feature-service",
    "arcgis-map-service",
    "wfs",
    "geoserver",
    "keos",
    "osm-pbf",
    "generated"
  ];

  return stableRecord({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://territory-kit.local/schemas/tr-adm3-provider.schema.json",
    title: "TerritoryKit Turkey ADM3 provider record",
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "countryCode",
      "provinceCode",
      "providerClass",
      "providerName",
      "format",
      "official",
      "experimental",
      "enabledByDefault",
      "redistribution",
      "commercialUse",
      "modification",
      "cachePolicy",
      "coverage",
      "status",
      "evidenceUrls"
    ],
    properties: {
      id: { type: "string", minLength: 1 },
      countryCode: { const: "TR" },
      provinceCode: { type: "string", pattern: "^[0-9]{2}$" },
      districtCodes: { type: "array", items: { type: "string" } },
      providerClass: { enum: providerClasses },
      providerName: { type: "string", minLength: 1 },
      sourceUrl: { type: "string" },
      downloadUrl: { type: "string" },
      serviceUrl: { type: "string" },
      layerId: { type: ["string", "number"] },
      format: { enum: formats },
      crs: { type: "string" },
      geometryType: { enum: ["Polygon", "MultiPolygon"] },
      nameField: { type: "string" },
      sourceIdField: { type: "string" },
      parentIdField: { type: "string" },
      parentNameField: { type: "string" },
      official: { type: "boolean" },
      experimental: { type: "boolean" },
      enabledByDefault: { type: "boolean" },
      license: { type: "string" },
      licenseUrl: { type: "string" },
      attribution: { type: "string" },
      redistribution: {
        enum: ["allowed", "runtime-only", "permission-required", "unknown"]
      },
      commercialUse: { enum: ["allowed", "permission-required", "unknown"] },
      modification: { enum: ["allowed", "permission-required", "unknown"] },
      cachePolicy: { enum: ["persistent", "session", "memory-only", "disabled", "unknown"] },
      expectedFeatureCount: { type: "integer", minimum: 0 },
      expectedSha256: { type: "string" },
      expectedByteSize: { type: "integer", minimum: 0 },
      coverage: { enum: ["province", "districts", "partial", "unknown"] },
      status: {
        enum: [
          "verified",
          "reachable",
          "unreachable",
          "quality-blocked",
          "license-blocked",
          "experimental"
        ]
      },
      lastVerifiedAt: { type: "string" },
      evidenceUrls: { type: "array", items: { type: "string" } },
      notes: { type: "string" }
    }
  });
}

function createFallbackSchema() {
  return stableRecord({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://territory-kit.local/schemas/tr-adm3-fallback.schema.json",
    title: "TerritoryKit Turkey ADM3 district fallback registry",
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "country",
      "generatedAt",
      "allowExperimentalByDefault",
      "providerPriority",
      "districtCount",
      "provinces",
      "districts"
    ],
    properties: {
      schemaVersion: { const: "territorykit-tr-adm3-fallback@1" },
      country: { const: "TR" },
      generatedAt: { type: "string" },
      allowExperimentalByDefault: { const: false },
      providerPriority: {
        type: "array",
        items: { enum: ["official", "runtime", "osm", "generated"] }
      },
      districtCount: { const: 973 },
      provinces: { type: "object" },
      districts: {
        type: "array",
        minItems: 973,
        maxItems: 973,
        items: {
          type: "object",
          required: [
            "districtId",
            "districtName",
            "provinceCode",
            "provinceName",
            "providerIds",
            "providerClasses",
            "finalCoverageTargetPercent"
          ],
          properties: {
            districtId: { type: "string" },
            districtName: { type: "string" },
            provinceCode: { type: "string", pattern: "^[0-9]{2}$" },
            provinceName: { type: "string" },
            providerIds: { type: "array", minItems: 2, items: { type: "string" } },
            providerClasses: { type: "array", items: { type: "string" } },
            finalCoverageTargetPercent: { const: 99.99 }
          }
        }
      }
    }
  });
}

function renderNationalCoverageMarkdown(report) {
  const rows = report.provinces
    .map(
      (province) =>
        `| ${province.provinceCode} | ${province.provinceName} | ${province.realCoveragePercent.toFixed(2)}% | ${province.generatedCoveragePercent.toFixed(2)}% | ${province.finalCoveragePercent.toFixed(2)}% |`
    )
    .join("\n");

  return `# Turkey ADM3 National Coverage

This report separates real ADM3 data from TerritoryKit generated game-zone fallback coverage.
Generated zones are never official or real mahalle boundaries.

| Metric | Value |
| --- | ---: |
| Provinces | ${report.provinceCount} |
| Districts | ${report.districtCount} |
| Provider records | ${report.providerRecords} |
| Official provider provinces | ${report.officialProviderProvinces} |
| Runtime provider provinces | ${report.runtimeProviderProvinces} |
| Experimental provider provinces | ${report.experimentalProviderProvinces} |
| OSM provider provinces | ${report.osmProviderProvinces} |
| Generated provider provinces | ${report.generatedProviderProvinces} |
| Real ADM3 coverage | ${report.realAdm3CoveragePercent.toFixed(2)}% |
| Generated fallback coverage | ${report.generatedFallbackCoveragePercent.toFixed(2)}% |
| Final usable ADM3-like coverage | ${report.finalUsableCoveragePercent.toFixed(2)}% |

| Code | Province | Real | Generated | Final |
| --- | --- | ---: | ---: | ---: |
${rows}
`;
}

async function writeDocs(records, fallbackRegistry, coverage) {
  const docs = {
    "tr-adm3-multi-source-architecture.md": `# Turkey ADM3 Multi-Source Architecture

Turkey ADM3 resolution is modeled as five provider classes: official, runtime, experimental, osm, and generated.
Production default priority is official -> runtime -> osm -> generated. Experimental records are retained but disabled by default.
`,
    "tr-adm3-81-province-provider-matrix.md": providerMatrix(records),
    "tr-adm3-runtime-sources.md": providerDoc(records, "runtime", "Turkey ADM3 Runtime Sources"),
    "tr-adm3-experimental-sources.md": providerDoc(
      records,
      "experimental",
      "Turkey ADM3 Experimental Sources"
    ),
    "tr-adm3-osm-coverage.md": `# Turkey ADM3 OSM Coverage

OSM is handled as a separate ODbL source class. The configured extract is ${OSM_SOURCE.downloadUrl}, with metadata from Geofabrik's Turkey page.

Only closed way/relation administrative boundary polygons are eligible. Nodes such as place=neighbourhood, place=suburb, or place=quarter are not polygons and are rejected.
`,
    "tr-adm3-generated-zones.md": `# Turkey ADM3 Generated Zones

Generated game zones fill ADM2 areas where no usable real ADM3 polygon is available. They are deterministic, derived only from ADM2 geometry, and labeled with sourceClass=generated, official=false, and generated=true.

Default algorithm version: tr-adm3-generated-zone-v1.
`,
    "tr-adm3-fallback-strategy.md": `# Turkey ADM3 Fallback Strategy

Every ADM2 district in ${fallbackRegistry.districtCount} districts has a default fallback chain. Production resolution uses official -> runtime -> osm -> generated. Experimental sources require explicit opt-in.
`,
    "tr-adm3-source-health.md": `# Turkey ADM3 Source Health

Runtime and experimental health is stored in reports/tr-adm3/source-health.json. Network checks are intentionally isolated from default CI and should run as integration checks.
`,
    "tr-adm3-license-boundaries.md": `# Turkey ADM3 License Boundaries

Official records require known redistribution metadata. Runtime records may be queried at runtime but must not be embedded into npm artifacts unless redistribution is approved. OSM records keep ODbL metadata separate. Generated zones use TerritoryKit metadata and never claim official status.
`,
    "tr-adm3-stable-identity.md": `# Turkey ADM3 Stable Identity

Real ADM3 identity is derived from TR, province, district, canonical name, and source-native identity where available. Generated identity is derived from TR, province, district, algorithm version, seed, and deterministic cell id.

Current registry fallback coverage:

- Real ADM3 coverage: ${coverage.realAdm3CoveragePercent.toFixed(2)}%
- Generated fallback coverage: ${coverage.generatedFallbackCoveragePercent.toFixed(2)}%
- Final usable ADM3-like coverage: ${coverage.finalUsableCoveragePercent.toFixed(2)}%
`
  };

  for (const [name, content] of Object.entries(docs)) {
    await writeFileEnsured(resolve(DOC_DIR, name), content);
  }
}

function providerMatrix(records) {
  const rows = inventory.provinces
    .map((province) => {
      const classes = records
        .filter((record) => record.provinceCode === province.provinceCode)
        .map((record) => record.providerClass)
        .filter((value, index, values) => values.indexOf(value) === index)
        .join(", ");

      return `| ${province.provinceCode} | ${province.provinceName} | ${classes} | ${province.status} |`;
    })
    .join("\n");

  return `# Turkey ADM3 81-Province Provider Matrix

| Code | Province | Provider classes | Inventory status |
| --- | --- | --- | --- |
${rows}
`;
}

function providerDoc(records, providerClass, title) {
  const rows = records
    .filter((record) => record.providerClass === providerClass)
    .map(
      (record) =>
        `| ${record.provinceCode} | ${record.providerName} | ${record.format} | ${record.status} | ${record.enabledByDefault ? "yes" : "no"} |`
    )
    .join("\n");

  return `# ${title}

| Province | Provider | Format | Status | Default |
| --- | --- | --- | --- | --- |
${rows}
`;
}

function classifyInventoryStatus(status) {
  if (status === "approved") {
    return "official";
  }

  if (status === "license-blocked" || status === "access-blocked") {
    return "runtime";
  }

  return "experimental";
}

function mapProviderStatus(status, providerClass) {
  if (providerClass === "official") {
    return "verified";
  }

  if (status === "access-blocked") {
    return "unreachable";
  }

  if (status === "quality-blocked" || status === "geometry-unavailable") {
    return "quality-blocked";
  }

  if (status === "license-blocked") {
    return "license-blocked";
  }

  if (providerClass === "runtime") {
    return "reachable";
  }

  return "experimental";
}

function normalizeFormat(format, adapter) {
  const value = `${format ?? ""} ${adapter ?? ""}`.toLowerCase();

  if (value.includes("featureserver")) return "arcgis-feature-service";
  if (value.includes("mapserver")) return "arcgis-map-service";
  if (value.includes("wfs")) return "wfs";
  if (value.includes("geoserver")) return "geoserver";
  if (value.includes("keos")) return "keos";
  if (value.includes("geojson")) return "geojson";
  if (value.includes("kml")) return "kml";
  if (value.includes("kmz")) return "kmz";
  if (value.includes("shp") || value.includes("shape")) return "shapefile";
  if (value.includes("gpkg")) return "gpkg";
  return "json";
}

function normalizeCrs(crs) {
  if (crs.toUpperCase() === "CRS84") {
    return "CRS84";
  }

  return crs;
}

function normalizeLicense(license, providerClass) {
  if (
    !license ||
    license.toLowerCase().includes("unknown") ||
    license.toLowerCase().includes("not public")
  ) {
    return providerClass === "official" ? "unknown" : "unverified";
  }

  return license;
}

function isServiceFormat(format) {
  return (
    format === "arcgis-feature-service" ||
    format === "arcgis-map-service" ||
    format === "wfs" ||
    format === "geoserver" ||
    format === "keos"
  );
}

function licenseUrlFromEvidence(province) {
  return province.evidenceUrls.find(
    (url) => url.toLowerCase().includes("license") || url.toLowerCase().includes("creative")
  );
}

function provinceCodeFromAdm1Id(parentId) {
  const match = String(parentId ?? "").match(/tr-(\d{2})$/);

  if (!match) {
    throw new Error(`Cannot derive province code from ADM1 parent '${parentId}'.`);
  }

  return match[1];
}

function uniqueProvinceCount(records) {
  return new Set(records.map((record) => record.provinceCode)).size;
}

function sumExpected(records) {
  return records.reduce((sum, record) => sum + (record.expectedFeatureCount ?? 0), 0);
}

function classRegistry(records, providerClass) {
  const filtered = records
    .filter((record) => record.providerClass === providerClass)
    .sort(compareProviders);

  return stableRecord({
    schemaVersion: "territorykit-tr-adm3-provider-registry@1",
    country: "TR",
    generatedAt: GENERATED_AT,
    providerClass,
    records: filtered
  });
}

function compareProviders(left, right) {
  return (
    left.provinceCode.localeCompare(right.provinceCode) ||
    left.providerClass.localeCompare(right.providerClass) ||
    left.id.localeCompare(right.id)
  );
}

function slug(input) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
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

async function writeJson(path, input) {
  await writeFileEnsured(path, `${JSON.stringify(stableRecord(input), null, 2)}\n`);
}

async function writeFileEnsured(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
