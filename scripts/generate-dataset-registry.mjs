import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import prettier from "prettier";

const GENERATED_AT = "2026-07-15T00:00:00.000Z";
const ROOT = resolve(import.meta.dirname, "..");
const ISO_SOURCE_PATH = resolve(ROOT, "packages/generators/src/countries/iso3166.ts");
const REGISTRY_DIR = resolve(ROOT, "datasets/registry");
const COVERAGE_DOC_PATH = resolve(ROOT, "docs/datasets/coverage.md");
const GLOBAL_ADM0_BUILD_REPORT_PATH = resolve(ROOT, "reports/global-adm0-build-all.json");
const ADMIN_LEVELS = ["ADM0", "ADM1", "ADM2", "ADM3", "ADM4", "ADM5"];
const SUB_COUNTRY_LEVELS = ADMIN_LEVELS.filter((level) => level !== "ADM0");

const PILOT_COUNTRIES = new Map([
  ["DE", { ADM1: "state", ADM2: "district" }],
  ["ID", { ADM1: "province", ADM2: "district" }],
  ["JP", { ADM1: "prefecture", ADM2: "unknown" }],
  ["TR", { ADM1: "province", ADM2: "district", ADM3: "neighbourhood" }],
  ["US", { ADM1: "state", ADM2: "county" }]
]);
const PILOT_LOCAL_TYPE_NAMES = new Map([
  ["TR", { ADM0: "Ülke", ADM1: "İl", ADM2: "İlçe", ADM3: "Mahalle" }]
]);

const PROVIDERS = [
  {
    id: "natural-earth",
    name: "Natural Earth",
    status: "implemented",
    sourceUrl:
      "https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries/",
    license: "Public Domain",
    attribution: "Made with Natural Earth",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    supportedLevels: ["ADM0"],
    notes: ["Used by the world-countries ADM0 pipeline."]
  },
  {
    id: "geoboundaries",
    name: "geoBoundaries",
    status: "implemented",
    sourceUrl: "https://www.geoboundaries.org/",
    license: "CC BY 4.0",
    attribution: "geoBoundaries",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    supportedLevels: ADMIN_LEVELS,
    notes: ["Used by pilot country source locks and country build pipeline."]
  },
  {
    id: "geojson",
    name: "Generic GeoJSON",
    status: "implemented",
    sourceUrl: "local or user supplied",
    license: "source-defined",
    attribution: "source-defined",
    redistributionAllowed: false,
    commercialUseAllowed: false,
    modificationAllowed: false,
    supportedLevels: ADMIN_LEVELS,
    notes: [
      "Redistribution and commercial-use flags must be supplied by the imported source metadata."
    ]
  }
];

const countries = parseIsoCountries(await readFile(ISO_SOURCE_PATH, "utf8"));
const countryRegistry = {
  schemaVersion: "territorykit-country-registry@1",
  generatedAt: GENERATED_AT,
  sources: [
    {
      name: "UNSD M49",
      url: "https://unstats.un.org/unsd/methodology/m49/",
      usage: "Country or area display names, numeric M49 codes, and ISO alpha-3 codes."
    },
    {
      name: "i18n-iso-countries 7.14.0",
      url: "https://www.npmjs.com/package/i18n-iso-countries",
      license: "MIT",
      usage: "ISO alpha-2 to alpha-3 code pairing seed."
    }
  ],
  countries: countries.map((country) => createCountryRegistryEntry(country))
};
const coverage = await createCoverageRegistry(countries);
const adminSemantics = createAdminSemanticsRegistry(countries);
const providers = {
  schemaVersion: "territorykit-provider-registry@1",
  generatedAt: GENERATED_AT,
  providers: PROVIDERS
};

await mkdir(REGISTRY_DIR, { recursive: true });
await mkdir(dirname(COVERAGE_DOC_PATH), { recursive: true });
await writeJson(resolve(REGISTRY_DIR, "countries.json"), countryRegistry);
await writeJson(resolve(REGISTRY_DIR, "coverage.json"), coverage);
await writeJson(resolve(REGISTRY_DIR, "admin-semantics.json"), adminSemantics);
await writeJson(resolve(REGISTRY_DIR, "providers.json"), providers);
await writeFile(
  COVERAGE_DOC_PATH,
  await formatGenerated(renderCoverageMarkdown(coverage), COVERAGE_DOC_PATH, "markdown"),
  "utf8"
);

function parseIsoCountries(source) {
  const match = source.match(/const ISO_3166_COUNTRY_TSV = `([\s\S]*?)`\.trim\(\);/);

  if (!match?.[1]) {
    throw new Error("Could not find ISO_3166_COUNTRY_TSV in iso3166.ts.");
  }

  return match[1]
    .trim()
    .split("\n")
    .map((row) => {
      const [iso2, iso3, numeric, name] = row.split("|");

      if (!iso2 || !iso3 || !numeric || !name) {
        throw new Error(`Invalid ISO row '${row}'.`);
      }

      return { iso2, iso3, numeric, name };
    })
    .sort((left, right) => left.iso2.localeCompare(right.iso2));
}

function createCountryRegistryEntry(country) {
  const pilot = PILOT_COUNTRIES.get(country.iso2);
  const localTypeNames = PILOT_LOCAL_TYPE_NAMES.get(country.iso2) ?? {};
  const reviewRequired = !pilot;

  return {
    iso2: country.iso2,
    iso3: country.iso3,
    numeric: country.numeric,
    name: country.name,
    defaultProvider: "geoboundaries",
    reviewRequired,
    levels: ADMIN_LEVELS.map((level) =>
      createCountryRegistryLevelEntry({ level, pilot, localTypeNames })
    ),
    notes: reviewRequired
      ? ["Fallback ISO config. Sub-country semantic mappings require review before publishing."]
      : [
          "Pilot config reviewed for configured ADM semantics; coverage still depends on source availability."
        ]
  };
}

function createCountryRegistryLevelEntry({ level, pilot, localTypeNames }) {
  const depth = Number(level.slice(3));
  const semanticType = level === "ADM0" ? "country" : (pilot?.[level] ?? "unknown");
  const reviewed = level === "ADM0" || Boolean(pilot?.[level]);

  return {
    sourceLevel: level,
    territoryLevel: depth + 1,
    hierarchyDepth: depth,
    semanticType,
    ...(localTypeNames[level] ? { localTypeName: localTypeNames[level] } : {}),
    label:
      level === "ADM0"
        ? "Country"
        : reviewed
          ? `${level} administrative unit`
          : `Unreviewed ${level}`,
    ...(depth > 0 ? { parentSourceLevel: `ADM${depth - 1}` } : {}),
    provider: level === "ADM0" ? "natural-earth" : "geoboundaries",
    required: level === "ADM0" || Boolean(pilot && (level === "ADM1" || level === "ADM2")),
    reviewRequired: !reviewed
  };
}

async function createCoverageRegistry(countryRows) {
  const countries = await Promise.all(
    countryRows.map(async (country) => {
      const pilot = PILOT_COUNTRIES.get(country.iso2);
      const adm0Status = await inferGlobalAdm0Status(country.iso2);
      const levels = Object.fromEntries(
        await Promise.all(
          ADMIN_LEVELS.map(async (level) => [
            level,
            level === "ADM0"
              ? withCoverageSemantics(country.iso2, level, adm0Status)
              : withCoverageSemantics(
                  country.iso2,
                  level,
                  await inferCountryLevelStatus(country.iso2, level, pilot)
                )
          ])
        )
      );

      return {
        iso2: country.iso2,
        iso3: country.iso3,
        name: country.name,
        levels,
        lastCheckedAt: GENERATED_AT,
        reviewRequired: !pilot,
        notes: pilot
          ? ["Pilot country. Artifact status is derived from generated build outputs."]
          : [
              "Sub-country levels are intentionally not marked source-available until country mapping review."
            ]
      };
    })
  );

  return {
    schemaVersion: "territorykit-coverage@2",
    generatedAt: GENERATED_AT,
    levels: ADMIN_LEVELS,
    summary: summarizeCoverage(countries),
    countries
  };
}

async function inferGlobalAdm0Status(iso2) {
  const report = await readJsonOptional(GLOBAL_ADM0_BUILD_REPORT_PATH);
  const buildResult = report?.results?.find?.((result) => result.country === iso2);
  const artifact = await readCountryAdm0Artifact(iso2);

  if (buildResult?.outcome === "built" && artifact.built) {
    const { built: _built, ...level } = artifact;
    return level;
  }

  if (!buildResult) {
    if (artifact.built) {
      const { built: _built, ...level } = artifact;
      return level;
    }

    return {
      status: "source-available",
      provider: "geoboundaries",
      sourceStatus: "available",
      validationStatus: "not-run"
    };
  }

  if (buildResult.outcome === "source-unavailable") {
    return {
      status: "source-unavailable",
      provider: "geoboundaries",
      sourceStatus: "unavailable",
      validationStatus: "not-run",
      reason: buildResult.issues?.[0]?.message
    };
  }

  if (buildResult.outcome === "validation-failed") {
    return {
      status: "validation-failed",
      provider: "geoboundaries",
      sourceStatus: "available",
      validationStatus: "failed",
      artifactPath: buildResult.outputPath
    };
  }

  if (buildResult.outcome === "performance-deferred") {
    return {
      status: "performance-deferred",
      provider: "geoboundaries",
      sourceStatus: "available",
      validationStatus: "deferred",
      artifactPath: buildResult.outputPath,
      reason: buildResult.issues?.[0]?.message
    };
  }

  if (buildResult.outcome === "built") {
    return {
      status: "built",
      provider: "geoboundaries",
      sourceStatus: "available",
      validationStatus: "passed",
      artifactPath: `${buildResult.outputPath}/levels/ADM0`
    };
  }

  return {
    status: "source-available",
    provider: "geoboundaries",
    sourceStatus: "available",
    validationStatus: "not-run",
    reason: buildResult.issues?.[0]?.message
  };
}

async function inferCountryLevelStatus(iso2, level, pilot) {
  if (!pilot) {
    return { status: "not-reviewed", provider: "geoboundaries", sourceStatus: "not-reviewed" };
  }

  const root = resolve(ROOT, "datasets/generated/countries", iso2);
  const manifest = await readJsonOptional(join(root, "manifest.json"));
  const [dataset, index, validation, checksums, attributionJson, attributionText] =
    await Promise.all([
      fileExists(join(root, "levels", level, "dataset.json")),
      fileExists(join(root, "levels", level, "index.json")),
      fileExists(join(root, "levels", level, "validation-report.json")),
      fileExists(join(root, "checksums.json")),
      fileExists(join(root, "attribution.json")),
      fileExists(join(root, "attribution.txt"))
    ]);
  const built =
    manifest?.supportedLevels?.includes?.(level) &&
    dataset &&
    index &&
    validation &&
    checksums &&
    (attributionJson || attributionText);

  if (built) {
    return {
      status: "built",
      provider: "geoboundaries",
      license: manifest.license ?? "source-defined",
      sourceStatus: "available",
      validationStatus: "passed",
      artifactPath: `datasets/generated/countries/${iso2}/levels/${level}`,
      featureCount: manifest.featureCountByLevel?.[level]
    };
  }

  if (!pilot[level]) {
    return { status: "not-reviewed", provider: "geoboundaries", sourceStatus: "not-reviewed" };
  }

  if (level !== "ADM1" && level !== "ADM2") {
    return {
      status: "source-unavailable",
      provider: "geoboundaries",
      sourceStatus: "unavailable",
      validationStatus: "not-run"
    };
  }

  return {
    status: "source-available",
    provider: "geoboundaries",
    sourceStatus: "available",
    validationStatus: "not-run"
  };
}

function withCoverageSemantics(iso2, level, coverageLevel) {
  const pilot = PILOT_COUNTRIES.get(iso2);
  const localTypeNames = PILOT_LOCAL_TYPE_NAMES.get(iso2) ?? {};
  const semanticType = level === "ADM0" ? "country" : (pilot?.[level] ?? "unknown");
  const reviewed = level === "ADM0" || Boolean(pilot?.[level]);

  return {
    ...coverageLevel,
    semanticType,
    ...(localTypeNames[level] ? { localTypeName: localTypeNames[level] } : {}),
    semanticReviewStatus: reviewed ? "reviewed" : "mapping-review-required",
    coverageScope:
      coverageLevel.status === "built"
        ? "complete"
        : coverageLevel.status === "partial"
          ? "partial"
          : coverageLevel.status === "not-applicable"
            ? "not-applicable"
            : "unknown"
  };
}

function summarizeCoverage(countryRows) {
  const adm0 = summarizeLevel(countryRows, "ADM0");
  const reviewedAdm1 = countryRows.filter(
    (country) => country.levels.ADM1?.semanticReviewStatus === "reviewed"
  ).length;
  const reviewedAdm2 = countryRows.filter(
    (country) => country.levels.ADM2?.semanticReviewStatus === "reviewed"
  ).length;
  const reviewedAdm3 = countryRows.filter(
    (country) => country.levels.ADM3?.semanticReviewStatus === "reviewed"
  ).length;
  const summary = {
    totalIsoCountriesOrAreas: countryRows.length,
    countriesWithBuiltAdm0: adm0.built ?? 0,
    countriesWithAdm0SourceAvailableNotBuilt: adm0["source-available"] ?? 0,
    countriesWithNoAdm0Source: adm0["source-unavailable"] ?? 0,
    countriesWithAdm0ValidationFailure: adm0["validation-failed"] ?? 0,
    countriesWithAdm0PerformanceDeferred: adm0["performance-deferred"] ?? 0,
    countriesWithAnyOptionalLevelUnavailable: countryRows.filter((country) =>
      SUB_COUNTRY_LEVELS.some((level) => country.levels[level]?.status === "source-unavailable")
    ).length,
    countriesWithReviewedAdm1: reviewedAdm1,
    countriesWithReviewedAdm2: reviewedAdm2,
    countriesWithReviewedAdm3: reviewedAdm3,
    totalCountries: countryRows.length,
    levels: Object.fromEntries(
      ADMIN_LEVELS.map((level) => [level, summarizeLevel(countryRows, level)])
    ),
    sourceStatus: summarizeCoverageProperty(countryRows, "sourceStatus"),
    validationStatus: summarizeCoverageProperty(countryRows, "validationStatus"),
    semanticReviewStatus: summarizeCoverageProperty(countryRows, "semanticReviewStatus"),
    hierarchyStatus: summarizeCoverageProperty(countryRows, "hierarchyStatus"),
    adjacencyStatus: summarizeCoverageProperty(countryRows, "adjacencyStatus"),
    indexStatus: summarizeCoverageProperty(countryRows, "indexStatus"),
    loaderStatus: summarizeCoverageProperty(countryRows, "loaderStatus"),
    featureCountByLevel: Object.fromEntries(
      ADMIN_LEVELS.map((level) => [
        level,
        countryRows.reduce((sum, country) => sum + (country.levels[level]?.featureCount ?? 0), 0)
      ])
    ),
    licenseRestrictedCountries: 0,
    validationFailedCountries: adm0["validation-failed"] ?? 0,
    builtCountries: countryRows.filter((country) =>
      Object.values(country.levels).some((level) => level.status === "built")
    ).length
  };

  return summary;
}

function summarizeCoverageProperty(countryRows, property) {
  return Object.fromEntries(
    ADMIN_LEVELS.map((level) => {
      const counts = {};

      for (const country of countryRows) {
        const value = country.levels[level]?.[property];

        if (typeof value === "string") {
          counts[value] = (counts[value] ?? 0) + 1;
        }
      }

      return [level, counts];
    })
  );
}

function summarizeLevel(countryRows, level) {
  const statuses = {};

  for (const country of countryRows) {
    const status = country.levels[level]?.status ?? "source-unavailable";
    statuses[status] = (statuses[status] ?? 0) + 1;
  }

  return statuses;
}

function renderCoverageMarkdown(coverage) {
  const metricRows = [
    ["totalIsoCountriesOrAreas", coverage.summary.totalIsoCountriesOrAreas],
    ["countriesWithBuiltAdm0", coverage.summary.countriesWithBuiltAdm0],
    [
      "countriesWithAdm0SourceAvailableNotBuilt",
      coverage.summary.countriesWithAdm0SourceAvailableNotBuilt
    ],
    ["countriesWithNoAdm0Source", coverage.summary.countriesWithNoAdm0Source],
    ["countriesWithAdm0ValidationFailure", coverage.summary.countriesWithAdm0ValidationFailure],
    [
      "countriesWithAnyOptionalLevelUnavailable",
      coverage.summary.countriesWithAnyOptionalLevelUnavailable
    ],
    ["countriesWithReviewedAdm1", coverage.summary.countriesWithReviewedAdm1],
    ["countriesWithReviewedAdm2", coverage.summary.countriesWithReviewedAdm2],
    ["countriesWithReviewedAdm3", coverage.summary.countriesWithReviewedAdm3]
  ]
    .map(([label, count]) => `| ${label.padEnd(44)} | ${String(count).padStart(5)} |`)
    .join("\n");
  const rows = Object.entries(coverage.summary.levels)
    .map(([level, statuses]) => {
      const built = statuses.built ?? 0;
      const sourceAvailable = statuses["source-available"] ?? 0;
      const sourceUnavailable = statuses["source-unavailable"] ?? 0;
      const validationFailed = statuses["validation-failed"] ?? 0;
      const performanceDeferred = statuses["performance-deferred"] ?? 0;
      const notReviewed = statuses["not-reviewed"] ?? 0;
      const licenseRestricted = statuses["license-restricted"] ?? 0;

      return `| ${level.padEnd(13)} | ${String(built).padStart(5)} | ${String(sourceAvailable).padStart(16)} | ${String(sourceUnavailable).padStart(18)} | ${String(validationFailed).padStart(17)} | ${String(performanceDeferred).padStart(20)} | ${String(notReviewed).padStart(12)} | ${String(licenseRestricted).padStart(18)} |`;
    })
    .join("\n");

  return `# Dataset Coverage

Generated: ${coverage.generatedAt}

This registry reports explicit source/artifact lifecycle state, not a claim that every level has a committed artifact.
Administrative availability is represented with ADM0 through ADM5 only. Municipality, neighbourhood, and similar meanings are stored as semantic metadata on the corresponding ADM record.

| Metric                                       | Count |
| -------------------------------------------- | ----: |
${metricRows}

| Level         | Built | Source available | Source unavailable | Validation failed | Performance deferred | Not reviewed | License restricted |
| ------------- | ----: | ---------------: | -----------------: | ----------------: | -------------------: | -----------: | -----------------: |
${rows}

Pilot countries with reviewed ADM1/ADM2 mappings: DE, ID, JP, TR, US. Turkey also has reviewed ADM3 semantics for neighbourhood / Mahalle, without claiming nationwide ADM3 source coverage.

Sources:

- Natural Earth ADM0 source metadata is tracked as Public Domain with attribution.
- geoBoundaries source metadata is tracked as CC BY 4.0.
- Non-pilot ADM1-ADM5 mappings require country-specific review before publishing artifacts.
`;
}

function createAdminSemanticsRegistry(countryRows) {
  const countries = countryRows.map((country) => {
    const pilot = PILOT_COUNTRIES.get(country.iso2);
    const localTypeNames = PILOT_LOCAL_TYPE_NAMES.get(country.iso2) ?? {};
    const levels = Object.fromEntries(
      ADMIN_LEVELS.map((level) => [
        level,
        createAdminSemanticsLevel({ level, pilot, localTypeNames })
      ])
    );

    return {
      iso2: country.iso2,
      iso3: country.iso3,
      name: country.name,
      reviewRequired: !pilot,
      levels,
      notes: pilot
        ? [
            "Reviewed semantic mappings are country-specific and do not imply source coverage for every configured level."
          ]
        : [
            "Fallback ISO country config. Sub-country semantic mappings are not reviewed for this country."
          ]
    };
  });

  return {
    schemaVersion: "territorykit-admin-semantics@2",
    generatedAt: GENERATED_AT,
    levels: ADMIN_LEVELS,
    summary: Object.fromEntries(
      ADMIN_LEVELS.map((level) => [level, summarizeSemanticReviewStatus(countries, level)])
    ),
    countries
  };
}

function createAdminSemanticsLevel({ level, pilot, localTypeNames }) {
  const depth = Number(level.slice(3));
  const semanticType = level === "ADM0" ? "country" : (pilot?.[level] ?? "unknown");
  const reviewed = level === "ADM0" || Boolean(pilot?.[level]);
  const localTypes = new Set([
    semanticType === "unknown" ? "administrative-unit" : semanticType,
    ...(localTypeNames[level] ? [localTypeNames[level]] : []),
    ...(level === "ADM0" ? [] : ["administrative-unit"])
  ]);

  return {
    label:
      level === "ADM0"
        ? "Country"
        : reviewed
          ? `${level} administrative unit`
          : `Unreviewed ${level}`,
    semanticType,
    ...(localTypeNames[level] ? { localTypeName: localTypeNames[level] } : {}),
    hierarchyDepth: depth,
    expectedLocalTypes: [...localTypes],
    reviewStatus: reviewed ? "reviewed" : "mapping-review-required",
    semanticReviewStatus: reviewed ? "reviewed" : "review-required",
    required: level === "ADM0" || Boolean(pilot && (level === "ADM1" || level === "ADM2")),
    sourceNameProperty: "shapeName",
    sourceIdProperty: "shapeID",
    sourceCodeProperties: ["officialCode", "shapeISO", "shapeID"],
    sourceParentProperties:
      depth === 0
        ? []
        : ["parentShapeID", "shapeParentID", "parentSourceId", "parentCode", "shapeParent"]
  };
}

function summarizeSemanticReviewStatus(countries, level) {
  const counts = {};

  for (const country of countries) {
    const status = country.levels[level]?.semanticReviewStatus ?? "review-required";
    counts[status] = (counts[status] ?? 0) + 1;
  }

  return counts;
}

async function readJsonOptional(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function readCountryAdm0Artifact(iso2) {
  for (const root of [
    resolve(ROOT, "datasets/generated/global-adm0-countries", iso2),
    resolve(ROOT, "datasets/generated/countries", iso2)
  ]) {
    const [manifest, dataset, index, validation, checksums, attributionJson, attributionText] =
      await Promise.all([
        readJsonOptional(join(root, "manifest.json")),
        fileExists(join(root, "levels", "ADM0", "dataset.json")),
        fileExists(join(root, "levels", "ADM0", "index.json")),
        fileExists(join(root, "levels", "ADM0", "validation-report.json")),
        fileExists(join(root, "checksums.json")),
        fileExists(join(root, "attribution.json")),
        fileExists(join(root, "attribution.txt"))
      ]);
    const built =
      manifest?.supportedLevels?.includes?.("ADM0") &&
      dataset &&
      index &&
      validation &&
      checksums &&
      (attributionJson || attributionText);

    if (built) {
      return {
        built: true,
        status: "built",
        provider: "geoboundaries",
        license: manifest.license ?? "source-defined",
        sourceStatus: "available",
        validationStatus: "passed",
        artifactPath: `datasets/generated/${root.includes("global-adm0-countries") ? "global-adm0-countries" : "countries"}/${iso2}/levels/ADM0`,
        featureCount: manifest.featureCountByLevel?.ADM0
      };
    }
  }

  return { built: false };
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(path, value) {
  await writeFile(path, await formatGenerated(JSON.stringify(value), path, "json"), "utf8");
}

async function formatGenerated(content, path, parser) {
  const config = (await prettier.resolveConfig(path)) ?? {};

  return prettier.format(content, {
    ...config,
    filepath: path,
    parser
  });
}
