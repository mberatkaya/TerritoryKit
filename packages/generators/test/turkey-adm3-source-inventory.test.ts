import { writeFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTurkeyAdm3SourceInventoryCoverageSummary,
  createTurkeyAdm3SourceInventoryLock,
  readTurkeyAdm3SourceInventory,
  sha256Hex,
  validateTurkeyAdm3SourceInventory,
  verifyTurkeyAdm3SourceInventoryArtifacts
} from "../src/index.js";
import type { TurkeyAdm3SourceInventory, TurkeyAdm3SourceInventoryProvince } from "../src/index.js";

const INVENTORY_PATH = "../../datasets/registry/tr-adm3-sources.json";
const INVENTORY_LOCK_FIXTURE_PATH =
  "../../datasets/registry/fixtures/tr-adm3-source-inventory.lock.json";

describe("Turkey ADM3 source inventory", () => {
  it("validates the 81-province source matrix and coverage summary", async () => {
    const inventory = await readTurkeyAdm3SourceInventory({
      inventoryPath: INVENTORY_PATH,
      cwd: process.cwd()
    });
    const summary = createTurkeyAdm3SourceInventoryCoverageSummary(inventory);

    expect(inventory.provinces).toHaveLength(81);
    expect(summary).toMatchObject({
      totalProvinceCount: 81,
      approvedProvinceCount: 0,
      candidateProvinceCount: 3,
      blockedProvinceCount: 78,
      nationalCoverageClaim: false,
      builtProvinceCount: 0,
      metadataOnlyProvinceCount: 5
    });
    expect(summary.statusCounts).toMatchObject({
      approved: 0,
      candidate: 3,
      inaccessible: 1,
      "license-unclear": 1,
      "geometry-unavailable": 76
    });
  });

  it("detects duplicate source ids across provinces", async () => {
    const inventory = await readInventoryFixture();
    const bursa = cloneProvince(inventory, "16");
    const sakarya = cloneProvince(inventory, "54");
    const firstSource = bursa.sources?.[0];
    const secondSource = sakarya.sources?.[0];

    if (!firstSource || !secondSource) {
      throw new Error("Candidate source fixtures are missing.");
    }

    const duplicate: TurkeyAdm3SourceInventory = {
      ...inventory,
      provinces: inventory.provinces.map((province) =>
        province.provinceCode === "54"
          ? {
              ...sakarya,
              sources: [
                {
                  ...secondSource,
                  sourceId: firstSource.sourceId
                }
              ]
            }
          : province
      )
    };

    expect(validateTurkeyAdm3SourceInventory(duplicate).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TR_ADM3_INVENTORY_DUPLICATE_SOURCE" })
      ])
    );
  });

  it("requires license and catalog metadata before production eligibility", async () => {
    const inventory = await readInventoryFixture();
    const bursa = cloneProvince(inventory, "16");
    const source = bursa.sources?.[0];
    if (!source) {
      throw new Error("Bursa source fixture is missing.");
    }
    const sourceWithoutLicense = { ...source };
    delete (sourceWithoutLicense as { license?: string }).license;

    const promoted: TurkeyAdm3SourceInventory = {
      ...inventory,
      provinces: inventory.provinces.map((province) =>
        province.provinceCode === "16"
          ? {
              ...bursa,
              status: "approved",
              productionEligible: true,
              sources: [
                {
                  ...sourceWithoutLicense,
                  productionEligible: true,
                  reviewStatus: "approved",
                  catalogEntry: true
                }
              ]
            }
          : province
      )
    };

    expect(validateTurkeyAdm3SourceInventory(promoted).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TR_ADM3_INVENTORY_APPROVED_METADATA_MISSING" })
      ])
    );
  });

  it("verifies checksum and byte size through an injected artifact resolver", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "tr-adm3-inventory-"));
    const artifactPath = join(tempDir, "source.geojson");
    const content = JSON.stringify({ type: "FeatureCollection", features: [] });
    await writeFile(artifactPath, content, "utf8");

    try {
      const inventory = await readInventoryFixture();
      const checksum = sha256Hex(content);
      const fixture = inventoryWithOneApprovedSource(inventory, {
        checksumSha256: checksum,
        byteSize: Buffer.byteLength(content)
      });
      const issues = await verifyTurkeyAdm3SourceInventoryArtifacts(fixture, async (source) =>
        source.sourceId === "bursa-mahalle-sinirlari"
          ? {
              sha256: checksum,
              sizeBytes: Buffer.byteLength(await readFile(artifactPath))
            }
          : {
              sha256: source.checksumSha256 ?? "",
              sizeBytes: source.byteSize ?? 0
            }
      );

      expect(issues).toEqual([]);

      await expect(
        verifyTurkeyAdm3SourceInventoryArtifacts(fixture, async (source) =>
          source.sourceId === "bursa-mahalle-sinirlari"
            ? {
                sha256: "0".repeat(64),
                sizeBytes: 1
              }
            : {
                sha256: source.checksumSha256 ?? "",
                sizeBytes: source.byteSize ?? 0
              }
        )
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "TR_ADM3_INVENTORY_CHECKSUM_MISMATCH" }),
          expect.objectContaining({ code: "TR_ADM3_INVENTORY_BYTE_SIZE_MISMATCH" })
        ])
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("requires parent attribute mapping metadata for approved sources", async () => {
    const inventory = await readInventoryFixture();
    const fixture = inventoryWithOneApprovedSource(inventory, { districtParentField: undefined });

    expect(validateTurkeyAdm3SourceInventory(fixture).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TR_ADM3_INVENTORY_APPROVED_METADATA_MISSING" })
      ])
    );
  });

  it("creates deterministic locks without fetching inaccessible source URLs", async () => {
    const inventory = await readInventoryFixture();
    const first = createTurkeyAdm3SourceInventoryLock(inventory);
    const second = createTurkeyAdm3SourceInventoryLock(inventory);
    const fixture = JSON.parse(
      await readFile(join(process.cwd(), INVENTORY_LOCK_FIXTURE_PATH), "utf8")
    ) as unknown;

    expect(first).toEqual(second);
    expect(first).toEqual(fixture);
    expect(first.summary.statusCounts.inaccessible).toBe(1);
    expect(first.provinces.find((province) => province.provinceCode === "27")).toMatchObject({
      sourceIds: ["gaziantep-mahalle-sinir-alanlari"],
      status: "inaccessible",
      productionEligible: false
    });
  });
});

async function readInventoryFixture(): Promise<TurkeyAdm3SourceInventory> {
  return readTurkeyAdm3SourceInventory({
    inventoryPath: INVENTORY_PATH,
    cwd: process.cwd()
  });
}

function cloneProvince(
  inventory: TurkeyAdm3SourceInventory,
  provinceCode: string
): TurkeyAdm3SourceInventoryProvince {
  const province = inventory.provinces.find((entry) => entry.provinceCode === provinceCode);

  if (!province) {
    throw new Error(`Missing province ${provinceCode}`);
  }

  return JSON.parse(JSON.stringify(province)) as TurkeyAdm3SourceInventoryProvince;
}

function inventoryWithOneApprovedSource(
  inventory: TurkeyAdm3SourceInventory,
  sourceOverrides: Record<string, unknown>
): TurkeyAdm3SourceInventory {
  const bursa = cloneProvince(inventory, "16");
  const source = bursa.sources?.[0];

  if (!source) {
    throw new Error("Bursa source fixture is missing.");
  }

  return {
    ...inventory,
    provinces: inventory.provinces.map((province) =>
      province.provinceCode === "16"
        ? {
            ...bursa,
            status: "approved",
            productionEligible: true,
            sources: [
              {
                ...source,
                license: "Fixture License",
                licenseUrl: "https://example.test/license",
                sourceDate: "2026-07-30T00:00:00.000Z",
                checksumSha256: "0".repeat(64),
                byteSize: 1,
                districtParentField: "ILCEID",
                productionEligible: true,
                reviewStatus: "approved",
                catalogEntry: true,
                ...sourceOverrides
              }
            ]
          }
        : province
    )
  } as TurkeyAdm3SourceInventory;
}
