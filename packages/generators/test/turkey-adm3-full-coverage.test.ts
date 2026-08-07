import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  buildTurkeyAdm3GeneratedZones,
  computeTurkeyAdm3DistrictCoverage,
  computeTurkeyAdm3GeometryAreaKm2,
  createTurkeyAdm3GeneratedGeometryHash,
  createTurkeyAdm3GeneratedMigrationReport,
  createTurkeyAdm3ProviderHealthReport,
  createTurkeyAdm3Registry,
  filterOsmAdministrativeBoundaryPolygons,
  resolveTurkeyAdm3Provider,
  validateTurkeyAdm3ProviderRegistry
} from "../src/turkey-adm3.js";
import type {
  TurkeyAdm3FallbackRegistry,
  TurkeyAdm3ProviderRecord,
  TurkeyAdm3ProviderRegistry
} from "../src/turkey-adm3.js";

const ROOT = resolve(__dirname, "../../..");
const PROVIDERS_PATH = resolve(ROOT, "datasets/registry/tr-adm3-providers.json");
const FALLBACKS_PATH = resolve(ROOT, "datasets/registry/tr-adm3-district-fallbacks.json");

describe("Turkey ADM3 full coverage provider registry", () => {
  it.each([
    [
      "contains all 81 provinces",
      (ctx: RegistryContext) => ctx.validation.summary.provinceCount === 81
    ],
    ["contains 243 provider records", (ctx) => ctx.validation.summary.providerCount === 243],
    ["keeps official providers separate", (ctx) => ctx.validation.summary.officialCount === 4],
    ["keeps runtime providers separate", (ctx) => ctx.validation.summary.runtimeCount === 5],
    [
      "keeps experimental providers separate",
      (ctx) => ctx.validation.summary.experimentalCount === 72
    ],
    ["keeps OSM providers for every province", (ctx) => ctx.validation.summary.osmCount === 81],
    [
      "keeps generated providers for every province",
      (ctx) => ctx.validation.summary.generatedCount === 81
    ],
    [
      "contains all 973 ADM2 district fallbacks",
      (ctx) => ctx.validation.summary.districtCount === 973
    ],
    ["validates without registry errors", (ctx) => ctx.validation.ok],
    [
      "keeps province codes unique",
      (ctx) => new Set(ctx.providers.map((provider) => provider.provinceCode)).size === 81
    ],
    [
      "gives every district a fallback chain",
      (ctx) => ctx.fallbacks.districts.every((district) => district.providerIds.length > 0)
    ],
    [
      "gives every district generated fallback",
      (ctx) =>
        ctx.fallbacks.districts.every((district) => district.providerClasses.includes("generated"))
    ],
    [
      "keeps experimental providers disabled",
      (ctx) =>
        ctx.providers
          .filter((provider) => provider.providerClass === "experimental")
          .every((provider) => provider.experimental && !provider.enabledByDefault)
    ],
    [
      "marks OSM as non-official ODbL",
      (ctx) =>
        ctx.providers
          .filter((provider) => provider.providerClass === "osm")
          .every((provider) => !provider.official && provider.license === "ODbL-1.0")
    ],
    [
      "marks generated as non-official generated",
      (ctx) =>
        ctx.providers
          .filter((provider) => provider.providerClass === "generated")
          .every((provider) => !provider.official && provider.format === "generated")
    ],
    [
      "official providers carry license metadata",
      (ctx) =>
        ctx.providers
          .filter((provider) => provider.providerClass === "official")
          .every((provider) => provider.license && provider.attribution)
    ],
    [
      "runtime providers avoid persistent embedding",
      (ctx) =>
        ctx.providers
          .filter((provider) => provider.providerClass === "runtime")
          .every(
            (provider) =>
              provider.redistribution === "runtime-only" && provider.cachePolicy === "session"
          )
    ],
    [
      "fallback priority excludes experimental by default",
      (ctx) => ctx.fallbacks.providerPriority.join(">") === "official>runtime>osm>generated"
    ],
    [
      "Adana falls back to OSM then generated",
      (ctx) =>
        ctx.fallbacks.districts
          .filter((district) => district.provinceCode === "01")
          .every((district) => district.providerClasses.join(">") === "osm>generated")
    ],
    [
      "Bursa has official before OSM generated",
      (ctx) =>
        ctx.fallbacks.districts
          .filter((district) => district.provinceCode === "16")
          .every((district) => district.providerClasses.join(">") === "official>osm>generated")
    ]
  ] satisfies Array<[string, (ctx: RegistryContext) => boolean]>)(
    "%s",
    async (_name, predicate) => {
      const ctx = await loadRegistryContext();

      expect(predicate(ctx)).toBe(true);
    }
  );

  it.each([
    ["uses official before OSM and generated", "16", false, "official", {}],
    ["skips license-blocked runtime before OSM", "34", false, "osm", {}],
    ["skips unreachable runtime before OSM", "06", false, "osm", {}],
    ["uses OSM before generated with no local source", "01", false, "osm", {}],
    ["uses generated if OSM is disabled", "01", false, "generated", { allowOsm: false }],
    ["keeps experimental disabled by default", "20", false, "osm", {}],
    ["allows experimental opt-in", "20", true, "experimental", {}],
    ["keeps official enabled in create registry", "16", false, "official", {}],
    ["filters experimental from default registry", "20", false, "osm", {}],
    [
      "allows generated-only resolution",
      "27",
      false,
      "generated",
      { allowOfficial: false, allowOsm: false }
    ],
    [
      "returns undefined when every source is disabled",
      "27",
      false,
      undefined,
      { allowOfficial: false, allowOsm: false, allowGenerated: false }
    ]
  ] satisfies Array<
    [
      string,
      string,
      boolean,
      TurkeyAdm3ProviderRecord["providerClass"] | undefined,
      Partial<Parameters<typeof resolveTurkeyAdm3Provider>[0]>?
    ]
  >)("%s", async (_name, provinceCode, allowExperimental, expectedClass, overrides) => {
    const { providers } = await loadRegistryContext();
    const registry = createTurkeyAdm3Registry({
      providers,
      experimentalSources: allowExperimental
    });
    const provider = resolveTurkeyAdm3Provider({
      countryCode: "TR",
      provinceCode,
      providers: registry.records,
      allowExperimental,
      ...(overrides ?? {})
    });

    expect(provider?.providerClass).toBe(expectedClass);
  });

  it("prefers district-specific providers over province-wide providers within a class", async () => {
    const { providers, fallbacks } = await loadRegistryContext();
    const kadikoy = fallbacks.districts.find((district) => district.districtName === "Kadıköy");
    const official = providers.find((provider) => provider.providerClass === "official");

    expect(kadikoy).toBeDefined();
    expect(official).toBeDefined();

    const { districtCodes: _districtCodes, ...provinceOfficialSource } = official!;
    const provinceOfficial: TurkeyAdm3ProviderRecord = {
      ...provinceOfficialSource,
      id: "tr-adm3-official-34-province-wide-fixture",
      provinceCode: "34",
      providerName: "Province-wide fixture"
    };
    const districtOfficial: TurkeyAdm3ProviderRecord = {
      ...provinceOfficial,
      id: "tr-adm3-official-34-kadikoy-fixture",
      providerName: "Kadıköy fixture",
      coverage: "districts",
      districtCodes: [kadikoy!.districtId]
    };
    const provider = resolveTurkeyAdm3Provider({
      countryCode: "TR",
      provinceCode: "34",
      districtCode: kadikoy!.districtId,
      providers: [provinceOfficial, districtOfficial]
    });

    expect(provider?.id).toBe(districtOfficial.id);
  });

  it("builds source health with explicit fallback provider ids", async () => {
    const { providers } = await loadRegistryContext();
    const health = createTurkeyAdm3ProviderHealthReport({
      providers,
      checkedAt: "2026-08-07T00:00:00.000Z"
    });

    expect(health.length).toBe(77);
    expect(health.every((item) => item.fallbackProviderId?.startsWith("tr-adm3-osm-"))).toBe(true);
  });

  it("detects duplicate provider ids", async () => {
    const { providers } = await loadRegistryContext();
    const validation = validateTurkeyAdm3ProviderRegistry({
      providers: [providers[0]!, providers[0]!]
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues.some((issue) => issue.code === "TR_ADM3_PROVIDER_ID_DUPLICATE")).toBe(
      true
    );
  });
});

describe("Turkey ADM3 OSM and generated fallback behavior", () => {
  it.each([
    [
      "accepts closed administrative boundary polygons",
      [
        {
          properties: { osm_type: "relation", boundary: "administrative", admin_level: "10" },
          geometry: square(0, 0, 1, 1)
        }
      ],
      1
    ],
    [
      "rejects place neighbourhood nodes",
      [
        {
          properties: {
            osm_type: "node",
            place: "neighbourhood",
            boundary: "administrative",
            admin_level: "10"
          },
          geometry: { type: "Point", coordinates: [0, 0] }
        }
      ],
      0
    ],
    [
      "rejects place suburb nodes",
      [
        {
          properties: {
            osm_type: "node",
            place: "suburb",
            boundary: "administrative",
            admin_level: "10"
          },
          geometry: { type: "Point", coordinates: [0, 0] }
        }
      ],
      0
    ],
    [
      "rejects open ways represented as lines",
      [
        {
          properties: { osm_type: "way", boundary: "administrative", admin_level: "10" },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1]
            ]
          }
        }
      ],
      0
    ],
    [
      "rejects non-administrative polygons",
      [
        {
          properties: { osm_type: "relation", boundary: "postal_code", admin_level: "10" },
          geometry: square(0, 0, 1, 1)
        }
      ],
      0
    ]
  ])("%s", (_name, features, expectedCount) => {
    expect(
      filterOsmAdministrativeBoundaryPolygons(
        features as Array<{ properties?: unknown; geometry?: unknown }>
      )
    ).toHaveLength(expectedCount);
  });

  it("fills only the missing part of a partially covered district", () => {
    const district = zone("tr:adm2:test", "District", square(0, 0, 1, 1));
    const real = zone("tr:adm3:real", "Real", square(0, 0, 0.5, 1));
    const result = buildTurkeyAdm3GeneratedZones({
      district,
      provinceCode: "01",
      realZones: [real],
      config: {
        targetAreaKm2: 2500,
        minAreaKm2: 1,
        maxAreaKm2: 3000,
        maxZonesPerDistrict: 10,
        minFragmentAreaKm2: 1
      }
    });

    expect(result.issues).toHaveLength(0);
    expect(result.coverage.realCoveragePercent).toBe(50);
    expect(result.coverage.generatedCoveragePercent).toBe(50);
    expect(result.coverage.finalCoveragePercent).toBe(100);
    expect(result.zones.every((generated) => generated.bbox[0] >= 0.5)).toBe(true);
  });

  it("generates stable IDs and geometry hashes across builds", () => {
    const district = zone("tr:adm2:deterministic", "District", square(0, 0, 1, 1));
    const first = buildTurkeyAdm3GeneratedZones({ district, provinceCode: "06" });
    const second = buildTurkeyAdm3GeneratedZones({ district, provinceCode: "06" });

    expect(first.zones.map((item) => item.id)).toEqual(second.zones.map((item) => item.id));
    expect(createTurkeyAdm3GeneratedGeometryHash(first.zones)).toBe(
      createTurkeyAdm3GeneratedGeometryHash(second.zones)
    );
  });

  it("labels generated zones as generated and non-official", () => {
    const district = zone("tr:adm2:metadata", "District", square(0, 0, 1, 1));
    const result = buildTurkeyAdm3GeneratedZones({ district, provinceCode: "34" });
    const territory = result.zones[0]?.properties.territory;

    expect(territory).toMatchObject({
      sourceClass: "generated",
      official: false,
      generated: true,
      semanticType: "generated-zone"
    });
  });

  it("computes final coverage at 100 percent when generated covers the gap", () => {
    const report = computeTurkeyAdm3DistrictCoverage({
      districtId: "tr:adm2:coverage",
      districtGeometry: square(0, 0, 1, 1),
      official: [square(0, 0, 0.5, 1)],
      generated: [square(0.5, 0, 1, 1)]
    });

    expect(report.officialAreaKm2).toBeCloseTo(report.districtAreaKm2 / 2, 3);
    expect(report.generatedAreaKm2).toBeCloseTo(report.districtAreaKm2 / 2, 3);
    expect(report.officialCoveragePercent).toBe(50);
    expect(report.generatedCoveragePercent).toBe(50);
    expect(report.finalCoveragePercent).toBe(100);
  });

  it("emits generated to official migration candidates", () => {
    const generated = zone("tr:adm3:generated-old", "Generated", square(0, 0, 1, 1));
    const official = zone("tr:adm3:official-new", "Official", square(0, 0, 1, 1));
    const report = createTurkeyAdm3GeneratedMigrationReport({
      generatedAt: "2026-08-07T00:00:00.000Z",
      oldGeneratedZones: [generated],
      newOfficialZones: [official]
    });

    expect(report.migrations).toEqual([
      {
        oldGeneratedId: generated.id,
        newOfficialTerritoryId: official.id,
        overlapPercent: 100
      }
    ]);
  });

  it("supports non-rectangular district clipping", () => {
    const district = zone("tr:adm2:triangle", "Triangle", {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [0, 1],
          [0, 0]
        ]
      ]
    });
    const result = buildTurkeyAdm3GeneratedZones({ district, provinceCode: "01" });

    expect(result.issues).toHaveLength(0);
    expect(result.zones.length).toBeGreaterThan(0);
    expect(result.coverage.generatedCoveragePercent).toBeGreaterThanOrEqual(99.99);
    expect(result.coverage.finalCoveragePercent).toBeGreaterThanOrEqual(99.99);
    expect(
      result.zones.reduce(
        (total, generated) => total + computeTurkeyAdm3GeometryAreaKm2(generated.geometry),
        0
      )
    ).toBeCloseTo(computeTurkeyAdm3GeometryAreaKm2(district.geometry), 0);
  });

  it("supports multipolygon district clipping", () => {
    const district = zone("tr:adm2:multipolygon", "Multi", {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0]
          ]
        ],
        [
          [
            [2, 0],
            [3, 0],
            [3, 1],
            [2, 1],
            [2, 0]
          ]
        ]
      ]
    });
    const result = buildTurkeyAdm3GeneratedZones({ district, provinceCode: "01" });

    expect(result.issues).toHaveLength(0);
    expect(result.zones.length).toBeGreaterThan(0);
    expect(result.coverage.finalCoveragePercent).toBe(100);
  });
});

interface RegistryContext {
  providers: TurkeyAdm3ProviderRecord[];
  fallbacks: TurkeyAdm3FallbackRegistry;
  validation: ReturnType<typeof validateTurkeyAdm3ProviderRegistry>;
}

async function loadRegistryContext(): Promise<RegistryContext> {
  const providerRegistry = JSON.parse(
    await readFile(PROVIDERS_PATH, "utf8")
  ) as TurkeyAdm3ProviderRegistry;
  const fallbacks = JSON.parse(
    await readFile(FALLBACKS_PATH, "utf8")
  ) as TurkeyAdm3FallbackRegistry;
  const providers = providerRegistry.records;
  const validation = validateTurkeyAdm3ProviderRegistry({ providers, fallbacks });

  return { providers, fallbacks, validation };
}

function zone(id: string, name: string, geometry: TerritoryGeometry): TerritoryZone {
  return {
    id,
    datasetId: "fixture",
    countryCode: "TR",
    level: Number(id.includes(":adm2:") ? 2 : 3),
    sourceAdminLevel: id.includes(":adm2:") ? "ADM2" : "ADM3",
    semanticType: id.includes(":adm2:") ? "district" : "neighbourhood",
    name,
    neighborIds: [],
    geometry,
    center: [0.5, 0.5],
    bbox: [0, 0, 1, 1],
    properties: { territory: { adminLevel: id.includes(":adm2:") ? "ADM2" : "ADM3" } }
  };
}

function square(west: number, south: number, east: number, north: number): TerritoryGeometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south]
      ]
    ]
  };
}
