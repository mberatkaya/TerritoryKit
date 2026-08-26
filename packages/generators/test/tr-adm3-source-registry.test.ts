import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format as formatPrettier } from "prettier";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const REGISTRY_PATH = resolve(ROOT, "datasets/sources/TR/adm3/source-registry.json");
const REGISTRY_SCHEMA_PATH = resolve(ROOT, "datasets/sources/TR/adm3/source-registry.schema.json");
const NATIONAL_ASSESSMENTS_PATH = resolve(
  ROOT,
  "datasets/sources/TR/adm3/national-assessments.json"
);
const COVERAGE_PATH = resolve(ROOT, "reports/tr-adm3/source-coverage.json");

const PROVINCE_STATUSES = [
  "official-ready",
  "official-license-review",
  "official-restricted",
  "official-service-only",
  "partial-official",
  "osm-candidate",
  "research-required",
  "unavailable"
] as const;

const EXPECTED_STATUS_COUNTS: Record<ProvinceStatus, number> = {
  "official-ready": 4,
  "official-license-review": 7,
  "official-restricted": 62,
  "official-service-only": 2,
  "partial-official": 6,
  "osm-candidate": 0,
  "research-required": 0,
  unavailable: 0
};

const SPECIAL_PROVINCE_STATUSES: Record<string, ProvinceStatus> = {
  "06": "official-service-only",
  "07": "official-restricted",
  "16": "official-ready",
  "27": "official-ready",
  "34": "official-license-review",
  "35": "official-license-review",
  "38": "official-ready",
  "41": "official-restricted",
  "48": "official-license-review",
  "54": "official-license-review"
};

describe("Turkey ADM3 Sprint 2 source registry", () => {
  it("keeps the schema aligned with the Sprint 2 source contract", async () => {
    const schema = JSON.parse(await readFile(REGISTRY_SCHEMA_PATH, "utf8")) as unknown;

    expect(readPath(schema, ["properties", "schemaVersion"])).toEqual({
      const: "territorykit-tr-adm3-source-registry@1"
    });
    expect(
      new Set(readStringArrayPath(schema, ["$defs", "province", "properties", "status", "enum"]))
    ).toEqual(new Set(PROVINCE_STATUSES));
    expect(new Set(readStringArrayPath(schema, ["$defs", "priority", "enum"]))).toEqual(
      new Set(["P0", "P1", "P2", "P3", "P4", "P5", "P6"])
    );
    expect(
      new Set(readStringArrayPath(schema, ["$defs", "license", "properties", "state", "enum"]))
    ).toEqual(new Set(["approved", "review-required", "restricted", "unknown"]));
  });

  it("records one deterministic province registry entry for each Turkey province", async () => {
    const registry = await readRegistry();

    expect(registry.schemaVersion).toBe("territorykit-tr-adm3-source-registry@1");
    expect(registry.country).toBe("TR");
    expect(registry.level).toBe("ADM3");
    expect(registry.provinces).toHaveLength(81);
    expect(registry.summary.provinceCount).toBe(81);

    const codes = registry.provinces.map((province) => province.code);
    expect(codes).toEqual(
      Array.from({ length: 81 }, (_value, index) => String(index + 1).padStart(2, "0"))
    );
    expect(new Set(codes).size).toBe(81);
    expect(registry.summary.statusCounts).toEqual(EXPECTED_STATUS_COUNTS);
    expect(sumStatusCounts(registry.summary.statusCounts)).toBe(81);

    const sourceIds = new Set<string>();
    for (const province of registry.provinces) {
      expect(PROVINCE_STATUSES).toContain(province.status);
      expect(province.sources.length).toBeGreaterThanOrEqual(2);
      expect(
        province.sources.some((source) => source.boundarySourceClass === "osm-administrative")
      ).toBe(true);

      for (const source of province.sources) {
        expect(source.provider.name.trim()).not.toBe("");
        expect(source.provider.class).toBe(source.boundarySourceClass);
        expect(source.provider.authorityType.trim()).not.toBe("");
        expect(source.verification.evidenceUrls.length).toBeGreaterThan(0);
        expect(source.notes.length).toBeGreaterThan(0);
        expect(sourceIds.has(source.id)).toBe(false);
        sourceIds.add(source.id);
      }
    }

    expect(sourceIds.size).toBe(registry.summary.sourceCount);
  });

  it("separates source authority from license and production eligibility", async () => {
    const registry = await readRegistry();
    const sources = allSources(registry);

    for (const { province, source } of sources) {
      if (source.productionEligible) {
        expect(source.authoritative).toBe(true);
        expect(source.boundarySourceClass).toMatch(/^official-/);
        expect(source.license.state).toBe("approved");
        expect(source.license.redistribution).toBe("allowed");
        expect(source.access.geometryAvailable).toBe(true);
        expect(province.status).toBe("official-ready");
      }

      if (source.license.redistribution === "prohibited") {
        expect(source.productionEligible).toBe(false);
      }

      if (
        source.boundarySourceClass.startsWith("official") &&
        source.license.redistribution === "allowed"
      ) {
        expect(source.license.state).toBe("approved");
        expect(source.productionEligible).toBe(true);
      }

      expect(source.boundarySourceClass).not.toBe("smart-derived");
      expect(source.boundarySourceClass).not.toBe("synthetic-test");
    }

    const officialReady = registry.provinces.filter(
      (province) => province.status === "official-ready"
    );
    expect(officialReady).toHaveLength(EXPECTED_STATUS_COUNTS["official-ready"]);

    for (const province of officialReady) {
      expect(province.sourceSummary.productionEligible).toBe(true);
      expect(province.sources.some((source) => source.productionEligible)).toBe(true);
    }
  });

  it("keeps OSM as a non-authoritative fallback candidate", async () => {
    const registry = await readRegistry();
    const osmSources = allSources(registry).filter(
      ({ source }) => source.boundarySourceClass === "osm-administrative"
    );

    expect(osmSources).toHaveLength(81);

    for (const { source } of osmSources) {
      expect(source.priority).toBe("P4");
      expect(source.authoritative).toBe(false);
      expect(source.administrative).toBe(false);
      expect(source.productionEligible).toBe(false);
      expect(source.provider.authorityType).toBe("community");
      expect(source.license.state).toBe("review-required");
    }
  });

  it("publishes national assessments for MAKS, TUCBS, and NVI/UAVT", async () => {
    const national = JSON.parse(
      await readFile(NATIONAL_ASSESSMENTS_PATH, "utf8")
    ) as NationalAssessments;
    const providers = national.sources.map((source) => source.provider);

    expect(national.schemaVersion).toBe("territorykit-tr-adm3-national-source-assessments@1");
    expect(national.country).toBe("TR");
    expect(national.level).toBe("ADM3");
    expect(providers.some((provider) => provider.includes("MAKS"))).toBe(true);
    expect(providers.some((provider) => provider.includes("TUCBS"))).toBe(true);
    expect(providers.some((provider) => provider.includes("UAVT"))).toBe(true);

    for (const source of national.sources) {
      expect(source.authorityType).toBe("national-government");
      expect(source.productionEligible).toBe(false);
      expect(source.evidenceUrls.length).toBeGreaterThan(0);
      expect(source.redistribution).not.toBe("allowed");
    }
  });

  it("writes a machine-readable coverage report matching the registry", async () => {
    const registry = await readRegistry();
    const coverage = JSON.parse(await readFile(COVERAGE_PATH, "utf8")) as CoverageReport;

    expect(coverage.schemaVersion).toBe("territorykit-tr-adm3-source-coverage@1");
    expect(coverage.country).toBe("TR");
    expect(coverage.level).toBe("ADM3");
    expect(coverage.summary.provinceCount).toBe(81);
    expect(coverage.summary.statusCounts).toEqual(registry.summary.statusCounts);
    expect(sumStatusCounts(coverage.summary.statusCounts)).toBe(81);
    expect(coverage.provinces).toHaveLength(81);

    const byCode = new Map(coverage.provinces.map((province) => [province.code, province]));
    for (const [code, status] of Object.entries(SPECIAL_PROVINCE_STATUSES)) {
      expect(byCode.get(code)?.status).toBe(status);
    }
  });

  it("keeps registry and coverage JSON serialization deterministic", async () => {
    const registryText = await readFile(REGISTRY_PATH, "utf8");
    const coverageText = await readFile(COVERAGE_PATH, "utf8");

    expect(await serializeStable(JSON.parse(registryText) as unknown)).toBe(registryText);
    expect(await serializeStable(JSON.parse(coverageText) as unknown)).toBe(coverageText);
  });
});

async function readRegistry(): Promise<SourceRegistry> {
  return JSON.parse(await readFile(REGISTRY_PATH, "utf8")) as SourceRegistry;
}

function allSources(
  registry: SourceRegistry
): Array<{ province: ProvinceRegistryEntry; source: ProvinceSource }> {
  return registry.provinces.flatMap((province) =>
    province.sources.map((source) => ({ province, source }))
  );
}

function sumStatusCounts(counts: Record<ProvinceStatus, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function readPath(input: unknown, path: readonly string[]): unknown {
  let value = input;

  for (const key of path) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }

  return value;
}

function readStringArrayPath(input: unknown, path: readonly string[]): string[] {
  const value = readPath(input, path);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function serializeStable(input: unknown): Promise<string> {
  return formatPrettier(JSON.stringify(stableRecord(input), null, 2), {
    parser: "json",
    printWidth: 100,
    semi: true,
    singleQuote: false,
    trailingComma: "none"
  });
}

function stableRecord(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(stableRecord);
  }

  if (isRecord(input)) {
    return Object.fromEntries(
      Object.entries(input)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, stableRecord(value)])
    );
  }

  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

type ProvinceStatus = (typeof PROVINCE_STATUSES)[number];

interface SourceRegistry {
  schemaVersion: string;
  country: string;
  level: string;
  summary: {
    provinceCount: number;
    sourceCount: number;
    statusCounts: Record<ProvinceStatus, number>;
  };
  provinces: ProvinceRegistryEntry[];
}

interface ProvinceRegistryEntry {
  code: string;
  name: string;
  status: ProvinceStatus;
  sourceSummary: {
    productionEligible: boolean;
  };
  sources: ProvinceSource[];
}

interface ProvinceSource {
  access: {
    geometryAvailable: boolean | "unknown";
  };
  administrative: boolean;
  authoritative: boolean;
  boundarySourceClass: string;
  id: string;
  license: {
    redistribution: string;
    state: string;
  };
  notes: string[];
  priority: string;
  productionEligible: boolean;
  provider: {
    authorityType: string;
    class: string;
    name: string;
  };
  verification: {
    evidenceUrls: string[];
  };
}

interface NationalAssessments {
  schemaVersion: string;
  country: string;
  level: string;
  sources: Array<{
    authoritative: boolean;
    authorityType: string;
    evidenceUrls: string[];
    productionEligible: boolean;
    provider: string;
    redistribution: string;
  }>;
}

interface CoverageReport {
  schemaVersion: string;
  country: string;
  level: string;
  summary: {
    provinceCount: number;
    statusCounts: Record<ProvinceStatus, number>;
  };
  provinces: Array<{
    code: string;
    name: string;
    status: ProvinceStatus;
  }>;
}
