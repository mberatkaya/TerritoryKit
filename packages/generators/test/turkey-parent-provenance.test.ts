import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TerritoryAdminLevel, TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  inspectTurkeyParentProvenance,
  verifyTurkeyNationalCatalogHdxMemberBytes,
  verifyTurkeyParentProvenance
} from "../src/turkey-parent-provenance.js";

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures/tr-parent-provenance");

const square = {
  type: "Polygon" as const,
  coordinates: [
    [
      [28, 40],
      [29, 40],
      [29, 41],
      [28, 41],
      [28, 40]
    ]
  ]
};

function zone(input: {
  id: string;
  level: number;
  name: string;
  parentId?: string;
  provider?: string;
  provinceCode?: string;
  geometry?: TerritoryZone["geometry"];
}): TerritoryZone {
  return {
    id: input.id,
    datasetId: "fixture-tr-parent",
    countryCode: "TR",
    level: input.level,
    sourceAdminLevel: `ADM${input.level}` as TerritoryAdminLevel,
    semanticType: input.level === 0 ? "country" : input.level === 1 ? "province" : "district",
    name: input.name,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    neighborIds: [],
    geometry: input.geometry ?? square,
    center: [28.5, 40.5],
    bbox: [28, 40, 29, 41],
    properties: {
      territory: {
        ...(input.provinceCode
          ? {
              provinceCode: input.provinceCode,
              codes: { official: `TR-${input.provinceCode}` }
            }
          : {}),
        ...(input.provider ? { source: { provider: input.provider, sourceId: "fixture" } } : {})
      }
    }
  };
}

function dataset(zones: TerritoryZone[]): TerritoryDataset {
  return {
    manifest: {
      datasetId: "fixture-tr-parent",
      datasetVersion: "fixture",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-01-26",
      buildDate: "2026-01-26T00:00:00.000Z",
      geometryHash: "fixture",
      adminLevels: ["ADM0", "ADM1", "ADM2"],
      countryCodes: ["TR"],
      crs: "EPSG:4326",
      geometryDetail: "source",
      license: "fixture",
      attribution: "fixture"
    },
    zones
  };
}

const hdxCatalog = {
  provider: "hdx-cod-ab",
  levels: {
    ADM0: {
      archiveMember: "tur_admin0.geojson",
      sha256: "d346d64aa96ea0ba2b4ad1a71af1db104a10649baf04958dc90b8a36b8e1b069",
      byteSize: 1,
      actualFeatureCount: 1
    },
    ADM1: {
      archiveMember: "hdx-adm1-tiny.geojson",
      sha256: "56b330a4f7086b4f02f8ddac55ce480c24bf813a1da7e3fb93fe4619fb00f721",
      byteSize: 1,
      actualFeatureCount: 1
    },
    ADM2: {
      archiveMember: "tur_admin2.geojson",
      sha256: "91b0968125b7bf3e2eb1d682697c51154ff3384f78ecf4e5f6e9041a24a287f2",
      byteSize: 1,
      actualFeatureCount: 1
    }
  }
};

describe("turkey parent provenance", () => {
  it("flags geoboundaries parent polygons against an HDX catalog lock", async () => {
    const inspection = await inspectTurkeyParentProvenance({
      parentDataset: dataset([
        zone({ id: "tr", level: 0, name: "Turkey", provider: "geoboundaries" }),
        zone({
          id: "tr:adm1:01",
          level: 1,
          name: "Adana",
          provider: "geoboundaries",
          provinceCode: "01"
        })
      ]),
      catalog: hdxCatalog,
      requireFullParentInventory: false
    });
    expect(inspection.providerMetadataStatus).toBe("CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS");
    expect(inspection.classification).toBe("CONFIRMED_ROOT_CAUSE");
    expect(inspection.geoBoundariesUpstreamBytesVerified).toBe(false);
    expect(verifyTurkeyParentProvenance(inspection).authorizedForNationalBuild).toBe(false);
  });

  it("does not authorize national build on provider metadata match without verified bytes", async () => {
    const inspection = await inspectTurkeyParentProvenance({
      parentDataset: dataset([
        zone({ id: "tr", level: 0, name: "Turkey", provider: "hdx-cod-ab" }),
        zone({
          id: "tr:adm1:01",
          level: 1,
          name: "Fixture Province",
          provider: "hdx-cod-ab",
          provinceCode: "01"
        })
      ]),
      catalog: hdxCatalog,
      requireFullParentInventory: false
    });
    expect(inspection.providerMetadataStatus).toBe("PROVIDER_METADATA_MATCHES_CATALOG");
    expect(inspection.sourceByteVerificationStatus).toBe("NOT_RUN");
    expect(verifyTurkeyParentProvenance(inspection).authorizedForNationalBuild).toBe(false);
  });

  it("rejects partially undeclared parent providers", async () => {
    const inspection = await inspectTurkeyParentProvenance({
      parentDataset: dataset([
        zone({ id: "tr", level: 0, name: "Turkey", provider: "hdx-cod-ab" }),
        zone({ id: "tr:adm1:01", level: 1, name: "Mixed", provinceCode: "01" })
      ]),
      catalog: hdxCatalog,
      requireFullParentInventory: false
    });
    expect(inspection.providerMetadataStatus).toBe("PARENT_SOURCE_PARTIALLY_UNDECLARED");
    expect(verifyTurkeyParentProvenance(inspection).authorizedForNationalBuild).toBe(false);
  });

  it("reports serialized geometry differences without claiming geographic change", async () => {
    const inspection = await inspectTurkeyParentProvenance({
      parentDataset: dataset([
        zone({
          id: "tr:adm1:01",
          level: 1,
          name: "Fixture Province",
          provider: "hdx-cod-ab",
          provinceCode: "01",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [30, 40],
                [31, 40],
                [31, 41],
                [30, 41],
                [30, 40]
              ]
            ]
          }
        })
      ]),
      catalog: hdxCatalog,
      requireFullParentInventory: false,
      verifiedHdxMembers: {
        ADM1: {
          status: "LOCKED_BYTES_VERIFIED",
          sha256: hdxCatalog.levels.ADM1.sha256,
          byteSize: 1
        }
      },
      hdxMemberPaths: { ADM1: join(FIXTURE_ROOT, "hdx-adm1-tiny.geojson") },
      readGeoJsonFeatures: async (path) => {
        const parsed = JSON.parse(await readFile(path, "utf8")) as {
          features: Array<{ properties: Record<string, unknown>; geometry: unknown }>;
        };
        return parsed.features;
      }
    });
    expect(inspection.serializedGeometryStatus).toBe("COMPARED");
    const adm1 = inspection.geometryComparisons.find((row) => row.level === "ADM1");
    expect(adm1?.serializedGeometryHashMismatches).toBe(1);
    expect(adm1?.geographicEquivalenceStatus).toBe("NOT_ASSESSED");
  });

  it("matches duplicate district names using province-scoped identity keys", async () => {
    const inspection = await inspectTurkeyParentProvenance({
      parentDataset: dataset([
        zone({
          id: "tr:adm1:16",
          level: 1,
          name: "Bursa",
          provider: "hdx-cod-ab",
          provinceCode: "16"
        }),
        zone({
          id: "tr:adm1:34",
          level: 1,
          name: "Istanbul",
          provider: "hdx-cod-ab",
          provinceCode: "34"
        }),
        zone({
          id: "tr:adm2:bursa-yesil",
          level: 2,
          name: "Yesilyurt",
          parentId: "tr:adm1:16",
          provider: "hdx-cod-ab",
          provinceCode: "16"
        }),
        zone({
          id: "tr:adm2:istanbul-yesil",
          level: 2,
          name: "Yesilyurt",
          parentId: "tr:adm1:34",
          provider: "hdx-cod-ab",
          provinceCode: "34"
        })
      ]),
      catalog: hdxCatalog,
      requireFullParentInventory: false,
      hdxMemberPaths: { ADM2: join(FIXTURE_ROOT, "hdx-adm2-duplicate-names.geojson") },
      readGeoJsonFeatures: async (path) => {
        const parsed = JSON.parse(await readFile(path, "utf8")) as {
          features: Array<{ properties: Record<string, unknown>; geometry: unknown }>;
        };
        return parsed.features;
      }
    });
    const adm2 = inspection.geometryComparisons.find((row) => row.level === "ADM2");
    expect(adm2?.identityMatchedPairs).toBe(2);
    expect(adm2?.identityMatchMethod).toBe("province-scoped-name");
  });

  it("allows dev bypass for provider mismatch but not publish-ready", () => {
    const inspection = {
      providerMetadataStatus: "CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS",
      parentInventoryStatus: "COMPLETE",
      sourceByteVerificationStatus: "NOT_RUN",
      serializedGeometryStatus: "NOT_RUN",
      catalogProvider: "hdx-cod-ab",
      observedDominantProvider: "geoboundaries"
    } as Awaited<ReturnType<typeof inspectTurkeyParentProvenance>>;

    const national = verifyTurkeyParentProvenance(inspection, {
      allowProvenanceMismatchBypass: true,
      purpose: "national-build"
    });
    expect(national.authorizedForNationalBuild).toBe(true);
    expect(national.authorizedForPublishReady).toBe(false);

    const publish = verifyTurkeyParentProvenance(inspection, {
      allowProvenanceMismatchBypass: true,
      purpose: "publish-ready"
    });
    expect(publish.authorizedForNationalBuild).toBe(false);
    expect(publish.authorizedForPublishReady).toBe(false);
  });

  it("never authorizes publish-ready when only provider metadata and bytes match", () => {
    const inspection = {
      providerMetadataStatus: "PROVIDER_METADATA_MATCHES_CATALOG",
      parentInventoryStatus: "COMPLETE",
      sourceByteVerificationStatus: "ALL_LOCKED_MEMBERS_VERIFIED",
      serializedGeometryStatus: "COMPARED",
      catalogProvider: "hdx-cod-ab",
      observedDominantProvider: "hdx-cod-ab"
    } as Awaited<ReturnType<typeof inspectTurkeyParentProvenance>>;

    const result = verifyTurkeyParentProvenance(inspection, { purpose: "publish-ready" });
    expect(result.authorizedForPublishReady).toBe(false);
    expect(result.authorizedForNationalBuild).toBe(true);
  });

  it("rejects partial national inventory unless explicitly allowed", async () => {
    const zones = [
      zone({ id: "tr", level: 0, name: "Turkey", provider: "hdx-cod-ab" }),
      zone({
        id: "tr:adm1:01",
        level: 1,
        name: "Only",
        provider: "hdx-cod-ab",
        provinceCode: "01"
      }),
      zone({
        id: "tr:adm2:01-a",
        level: 2,
        name: "District",
        parentId: "tr:adm1:01",
        provider: "hdx-cod-ab",
        provinceCode: "01"
      })
    ];
    const inspection = await inspectTurkeyParentProvenance({
      parentDataset: dataset(zones),
      catalog: hdxCatalog,
      requireFullParentInventory: true
    });
    expect(inspection.parentInventoryStatus).toBe("INCOMPLETE");
    expect(
      verifyTurkeyParentProvenance(inspection, { purpose: "national-build" })
        .authorizedForNationalBuild
    ).toBe(false);
    expect(
      verifyTurkeyParentProvenance(inspection, {
        purpose: "national-build",
        allowPartialParentInventory: true
      }).authorizedForNationalBuild
    ).toBe(false);
  });

  it("flags duplicate zone ids as incomplete inventory", async () => {
    const inspection = await inspectTurkeyParentProvenance({
      parentDataset: dataset([
        zone({ id: "tr", level: 0, name: "Turkey", provider: "hdx-cod-ab" }),
        zone({ id: "dup", level: 1, name: "A", provider: "hdx-cod-ab", provinceCode: "01" }),
        zone({ id: "dup", level: 1, name: "B", provider: "hdx-cod-ab", provinceCode: "02" }),
        zone({
          id: "tr:adm2:01-a",
          level: 2,
          name: "District",
          parentId: "dup",
          provider: "hdx-cod-ab",
          provinceCode: "01"
        })
      ]),
      catalog: hdxCatalog,
      requireFullParentInventory: false
    });
    expect(inspection.parentInventoryStatus).toBe("INCOMPLETE");
  });

  it("verifies HDX member bytes against catalog pins", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-hdx-bytes-"));
    const memberPath = join(tempDir, "tur_admin0.geojson");
    const payload = '{"type":"FeatureCollection","features":[]}';
    await writeFile(memberPath, payload, "utf8");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const byteSize = Buffer.byteLength(payload, "utf8");
    try {
      const catalog = {
        ...hdxCatalog,
        levels: {
          ...hdxCatalog.levels,
          ADM0: {
            ...hdxCatalog.levels.ADM0,
            archiveMember: "tur_admin0.geojson",
            sha256,
            byteSize
          }
        }
      };
      const verified = await verifyTurkeyNationalCatalogHdxMemberBytes(catalog, {
        ADM0: memberPath
      });
      expect(verified.verifiedHdxMembers.ADM0?.status).toBe("LOCKED_BYTES_VERIFIED");
      await writeFile(memberPath, `${payload}x`, "utf8");
      const corrupted = await verifyTurkeyNationalCatalogHdxMemberBytes(catalog, {
        ADM0: memberPath
      });
      expect(corrupted.verifiedHdxMembers.ADM0?.status).toBe("CHECKSUM_MISMATCH");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("authorizes national build when bytes are verified and metadata matches", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-hdx-auth-"));
    try {
      const writeMember = async (name: string) => {
        const memberPath = join(tempDir, name);
        const payload = `{"type":"FeatureCollection","features":[],"member":"${name}"}`;
        await writeFile(memberPath, payload, "utf8");
        return {
          memberPath,
          sha256: createHash("sha256").update(payload).digest("hex"),
          byteSize: Buffer.byteLength(payload, "utf8")
        };
      };
      const adm0 = await writeMember("tur_admin0.geojson");
      const adm1 = await writeMember(hdxCatalog.levels.ADM1.archiveMember);
      const adm2 = await writeMember("tur_admin2.geojson");
      const catalog = {
        ...hdxCatalog,
        levels: {
          ADM0: {
            ...hdxCatalog.levels.ADM0,
            archiveMember: "tur_admin0.geojson",
            sha256: adm0.sha256,
            byteSize: adm0.byteSize
          },
          ADM1: {
            ...hdxCatalog.levels.ADM1,
            sha256: adm1.sha256,
            byteSize: adm1.byteSize
          },
          ADM2: {
            ...hdxCatalog.levels.ADM2,
            archiveMember: "tur_admin2.geojson",
            sha256: adm2.sha256,
            byteSize: adm2.byteSize
          }
        }
      };
      const byteVerification = await verifyTurkeyNationalCatalogHdxMemberBytes(catalog, {
        ADM0: adm0.memberPath,
        ADM1: adm1.memberPath,
        ADM2: adm2.memberPath
      });
      const inspection = await inspectTurkeyParentProvenance({
        parentDataset: dataset([
          zone({ id: "tr", level: 0, name: "Turkey", provider: "hdx-cod-ab" }),
          zone({
            id: "tr:adm1:01",
            level: 1,
            name: "Fixture Province",
            provider: "hdx-cod-ab",
            provinceCode: "01"
          })
        ]),
        catalog,
        requireFullParentInventory: false,
        verifiedHdxMembers: byteVerification.verifiedHdxMembers
      });
      expect(inspection.sourceByteVerificationStatus).toBe("ALL_LOCKED_MEMBERS_VERIFIED");
      const verification = verifyTurkeyParentProvenance(inspection, {
        purpose: "national-build",
        allowPartialParentInventory: true
      });
      expect(
        verification.issues.some(
          (issue) => issue.code === "PARENT_PROVENANCE_SOURCE_BYTES_UNVERIFIED"
        )
      ).toBe(false);
      expect(verification.authorizedForNationalBuild).toBe(true);
      expect(verification.authorizedForPublishReady).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
