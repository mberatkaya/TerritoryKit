import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const INVENTORY_PATH = resolve(ROOT, "datasets/registry/tr-adm3-source-inventory.json");
const SCHEMA_PATH = resolve(ROOT, "datasets/registry/tr-adm3-source-inventory.schema.json");
const ALLOWED_STATUSES = new Set([
  "approved",
  "candidate",
  "license-blocked",
  "access-blocked",
  "geometry-unavailable",
  "quality-blocked",
  "not-found",
  "requires-authority-request"
]);
const REQUIRED_PROVINCE_FIELDS = [
  "provinceCode",
  "provinceName",
  "provider",
  "sourceUrl",
  "downloadOrServiceUrl",
  "format",
  "crs",
  "sourceDate",
  "license",
  "redistributionPermission",
  "commercialUsePermission",
  "neighbourhoodNameField",
  "sourceNativeIdField",
  "districtParentField",
  "featureCount",
  "recommendedAdapter",
  "qualityRisk",
  "status",
  "evidenceUrls"
] as const;

describe("Turkey ADM3 national source inventory", () => {
  it("keeps the JSON schema aligned with the inventory contract", async () => {
    const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8")) as {
      properties?: Record<string, unknown>;
      $defs?: { province?: { required?: string[] }; status?: { enum?: string[] } };
    };

    expect(schema.properties?.schemaVersion).toEqual({
      const: "territorykit-tr-adm3-source-inventory@1"
    });
    expect(schema.$defs?.province?.required).toEqual([...REQUIRED_PROVINCE_FIELDS]);
    expect(new Set(schema.$defs?.status?.enum)).toEqual(ALLOWED_STATUSES);
  });

  it("records one valid source decision for each Turkey province", async () => {
    const inventory = JSON.parse(await readFile(INVENTORY_PATH, "utf8")) as Inventory;

    expect(inventory.schemaVersion).toBe("territorykit-tr-adm3-source-inventory@1");
    expect(inventory.country).toBe("TR");
    expect(inventory.provinces).toHaveLength(81);

    const sortedCodes = inventory.provinces.map((province) => province.provinceCode);
    expect(sortedCodes).toEqual(
      Array.from({ length: 81 }, (_value, index) => String(index + 1).padStart(2, "0"))
    );
    expect(new Set(sortedCodes).size).toBe(81);

    for (const province of inventory.provinces) {
      for (const field of REQUIRED_PROVINCE_FIELDS) {
        expect(province).toHaveProperty(field);
      }

      expect(ALLOWED_STATUSES.has(province.status)).toBe(true);
      expect(province.provider.trim()).not.toBe("");
      expect(province.qualityRisk.trim()).not.toBe("");
      expect(province.evidenceUrls.length).toBeGreaterThan(0);
    }
  });

  it("does not approve sources without usable geometry, license, and field evidence", async () => {
    const inventory = JSON.parse(await readFile(INVENTORY_PATH, "utf8")) as Inventory;
    const approved = inventory.provinces.filter((province) => province.status === "approved");

    expect(approved.map((province) => province.provinceCode).sort()).toEqual([
      "16",
      "27",
      "38",
      "52"
    ]);

    for (const province of approved) {
      expect(province.downloadOrServiceUrl).toEqual(expect.any(String));
      expect(province.format).toEqual(expect.any(String));
      expect(province.crs).toEqual(expect.any(String));
      expect(province.featureCount).toEqual(expect.any(Number));
      expect(province.redistributionPermission).toBe("allowed");
      expect(province.commercialUsePermission).toBe("allowed");
      expect(province.license.toLowerCase()).not.toContain("unknown");
      expect(province.neighbourhoodNameField).toEqual(expect.any(String));
      expect(province.sourceNativeIdField).toEqual(expect.any(String));
      expect(province.districtParentField).toEqual(expect.any(String));
    }
  });

  it("keeps summary counts and implementation batches deterministic", async () => {
    const inventory = JSON.parse(await readFile(INVENTORY_PATH, "utf8")) as Inventory;
    const approvedCount = inventory.provinces.filter(
      (province) => province.status === "approved"
    ).length;
    const candidateCount = inventory.provinces.filter(
      (province) => province.status === "candidate"
    ).length;
    const blockedCount = inventory.provinces.length - approvedCount - candidateCount;

    expect(inventory.summary).toMatchObject({
      provinceCount: 81,
      approvedCount,
      candidateCount,
      blockedCount,
      nationalProductionCatalogChanged: false
    });

    expect(inventory.batches.length).toBeGreaterThanOrEqual(4);
    for (const batch of inventory.batches) {
      expect(batch.provinceCodes.length).toBeGreaterThanOrEqual(3);
      expect(batch.provinceCodes.length).toBeLessThanOrEqual(5);
      expect(batch.provinceCodes).toHaveLength(batch.provinces.length);
      expect(batch.branchName.startsWith("audit/tr-adm3-")).toBe(true);
    }
  });
});

interface Inventory {
  schemaVersion: string;
  country: string;
  summary: {
    provinceCount: number;
    approvedCount: number;
    candidateCount: number;
    blockedCount: number;
    nationalProductionCatalogChanged: boolean;
  };
  provinces: Province[];
  batches: Batch[];
}

interface Province {
  provinceCode: string;
  provinceName: string;
  provider: string;
  sourceUrl: string | null;
  downloadOrServiceUrl: string | null;
  format: string | null;
  crs: string | null;
  sourceDate: string | null;
  license: string;
  redistributionPermission: "allowed" | "restricted" | "unknown";
  commercialUsePermission: "allowed" | "restricted" | "unknown";
  neighbourhoodNameField: string | null;
  sourceNativeIdField: string | null;
  districtParentField: string | null;
  featureCount: number | null;
  recommendedAdapter: string;
  qualityRisk: string;
  status: string;
  evidenceUrls: string[];
}

interface Batch {
  branchName: string;
  provinceCodes: string[];
  provinces: string[];
}
