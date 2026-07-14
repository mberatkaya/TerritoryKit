import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import prettier from "prettier";

const GENERATED_AT = "2026-07-14T00:00:00.000Z";
const ROOT = resolve(import.meta.dirname, "..");
const ISO_SOURCE_PATH = resolve(ROOT, "packages/generators/src/countries/iso3166.ts");
const REGISTRY_DIR = resolve(ROOT, "datasets/registry");
const COVERAGE_DOC_PATH = resolve(ROOT, "docs/datasets/coverage.md");

const PILOT_COUNTRIES = new Map([
  ["DE", { ADM1: "state", ADM2: "district" }],
  ["ID", { ADM1: "province", ADM2: "district" }],
  ["JP", { ADM1: "prefecture", ADM2: "unknown" }],
  ["TR", { ADM1: "province", ADM2: "district" }],
  ["US", { ADM1: "state", ADM2: "county" }]
]);

const PROVIDERS = [
  {
    id: "natural-earth",
    name: "Natural Earth",
    status: "implemented",
    sourceUrl:
      "https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/",
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
    supportedLevels: ["ADM0", "ADM1", "ADM2", "ADM3", "ADM4"],
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
    supportedLevels: ["ADM0", "ADM1", "ADM2", "ADM3", "ADM4"],
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
const providers = {
  schemaVersion: "territorykit-provider-registry@1",
  generatedAt: GENERATED_AT,
  providers: PROVIDERS
};

await mkdir(REGISTRY_DIR, { recursive: true });
await mkdir(dirname(COVERAGE_DOC_PATH), { recursive: true });
await writeJson(resolve(REGISTRY_DIR, "countries.json"), countryRegistry);
await writeJson(resolve(REGISTRY_DIR, "coverage.json"), coverage);
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
  const reviewRequired = !pilot;

  return {
    iso2: country.iso2,
    iso3: country.iso3,
    numeric: country.numeric,
    name: country.name,
    defaultProvider: "geoboundaries",
    reviewRequired,
    levels: [
      {
        sourceLevel: "ADM0",
        territoryLevel: 1,
        semanticType: "country",
        label: "Country",
        provider: "natural-earth",
        required: true,
        reviewRequired: false
      },
      {
        sourceLevel: "ADM1",
        territoryLevel: 2,
        semanticType: pilot?.ADM1 ?? "unknown",
        label: pilot ? "First-level administrative unit" : "Unreviewed ADM1",
        parentSourceLevel: "ADM0",
        provider: "geoboundaries",
        required: Boolean(pilot),
        reviewRequired
      },
      {
        sourceLevel: "ADM2",
        territoryLevel: 3,
        semanticType: pilot?.ADM2 ?? "unknown",
        label: pilot ? "Second-level administrative unit" : "Unreviewed ADM2",
        parentSourceLevel: "ADM1",
        provider: "geoboundaries",
        required: Boolean(pilot),
        reviewRequired
      }
    ],
    notes: reviewRequired
      ? ["Fallback ISO config. Sub-country semantic mappings require review before publishing."]
      : ["Pilot config reviewed for ADM0/ADM1/ADM2 semantic mapping."]
  };
}

async function createCoverageRegistry(countryRows) {
  const countries = await Promise.all(
    countryRows.map(async (country) => {
      const pilot = PILOT_COUNTRIES.has(country.iso2);
      const adm0Status = await inferGlobalAdm0Status(country.iso2);
      const adm1 = await inferCountryLevelStatus(country.iso2, "ADM1", pilot);
      const adm2 = await inferCountryLevelStatus(country.iso2, "ADM2", pilot);

      return {
        iso2: country.iso2,
        iso3: country.iso3,
        name: country.name,
        levels: {
          ADM0: {
            status: adm0Status,
            provider: "natural-earth",
            license: "Public Domain",
            sourceStatus: "available",
            validationStatus: adm0Status === "built" ? "passed" : "not-run"
          },
          ADM1: adm1,
          ADM2: adm2,
          ADM3: { status: "not-reviewed" },
          municipality: { status: "source-unavailable" },
          neighbourhood: { status: "source-unavailable" }
        },
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
    summary: summarizeCoverage(countries),
    countries
  };
}

async function inferGlobalAdm0Status(iso2) {
  const root = resolve(ROOT, "datasets/generated/global/ADM0");
  const [manifest, checksums, validation, attribution, dataset] = await Promise.all([
    readJsonOptional(join(root, "manifest.json")),
    fileExists(join(root, "checksums.json")),
    fileExists(join(root, "validation-report.json")),
    fileExists(join(root, "attribution.json")),
    readJsonOptional(join(root, "dataset.json"))
  ]);
  const hasCountry = dataset?.zones?.some?.((zone) => zone.countryCode === iso2);

  return manifest?.artifactStatus === "built" &&
    checksums &&
    validation &&
    attribution &&
    hasCountry
    ? "built"
    : "source-available";
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

  return {
    status: "source-available",
    provider: "geoboundaries",
    sourceStatus: "available",
    validationStatus: "not-run"
  };
}

function summarizeCoverage(countryRows) {
  const levels = ["ADM0", "ADM1", "ADM2", "ADM3", "municipality", "neighbourhood"];
  const summary = {
    totalCountries: countryRows.length,
    levels: Object.fromEntries(levels.map((level) => [level, summarizeLevel(countryRows, level)])),
    licenseRestrictedCountries: 0,
    sourceMissingCountries: countCountriesWithStatus(countryRows, "source-unavailable"),
    validationFailedCountries: countCountriesWithStatus(countryRows, "validation-failed"),
    builtCountries: countryRows.filter((country) =>
      Object.values(country.levels).some((level) => level.status === "built")
    ).length
  };

  return summary;
}

function summarizeLevel(countryRows, level) {
  const statuses = {};

  for (const country of countryRows) {
    const status = country.levels[level]?.status ?? "source-unavailable";
    statuses[status] = (statuses[status] ?? 0) + 1;
  }

  return statuses;
}

function countCountriesWithStatus(countryRows, status) {
  return countryRows.filter((country) =>
    Object.values(country.levels).some((level) => level.status === status)
  ).length;
}

function renderCoverageMarkdown(coverage) {
  const metricRows = [
    ["Total ISO countries/areas", coverage.summary.totalCountries],
    ["License-restricted countries", coverage.summary.licenseRestrictedCountries],
    ["Countries with missing source", coverage.summary.sourceMissingCountries],
    ["Countries with validation failures", coverage.summary.validationFailedCountries]
  ]
    .map(([label, count]) => `| ${label.padEnd(34)} | ${String(count).padStart(5)} |`)
    .join("\n");
  const rows = Object.entries(coverage.summary.levels)
    .map(([level, statuses]) => {
      const built = statuses.built ?? 0;
      const sourceAvailable = statuses["source-available"] ?? 0;
      const sourceUnavailable = statuses["source-unavailable"] ?? 0;
      const validationFailed = statuses["validation-failed"] ?? 0;
      const notReviewed = statuses["not-reviewed"] ?? 0;
      const licenseRestricted = statuses["license-restricted"] ?? 0;

      return `| ${level.padEnd(13)} | ${String(built).padStart(5)} | ${String(sourceAvailable).padStart(16)} | ${String(sourceUnavailable).padStart(18)} | ${String(validationFailed).padStart(17)} | ${String(notReviewed).padStart(12)} | ${String(licenseRestricted).padStart(18)} |`;
    })
    .join("\n");

  return `# Dataset Coverage

Generated: ${coverage.generatedAt}

This registry reports explicit source/artifact lifecycle state, not a claim that every level has a committed artifact.
Missing municipality and neighbourhood data is marked unavailable rather than substituted with ADM2.

| Metric                             | Count |
| ---------------------------------- | ----: |
${metricRows}

| Level         | Built | Source available | Source unavailable | Validation failed | Not reviewed | License restricted |
| ------------- | ----: | ---------------: | -----------------: | ----------------: | -----------: | -----------------: |
${rows}

Pilot countries with reviewed ADM1/ADM2 mappings: DE, ID, JP, TR, US.

Sources:

- Natural Earth ADM0 source metadata is tracked as Public Domain with attribution.
- geoBoundaries source metadata is tracked as CC BY 4.0.
- Non-pilot ADM1/ADM2 mappings require country-specific review before publishing artifacts.
`;
}

async function readJsonOptional(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
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
