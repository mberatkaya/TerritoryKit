import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TerritoryAdminLevel, TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import {
  inspectTurkeyParentProvenance,
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

    expect(
      verifyTurkeyParentProvenance(inspection, {
        allowProvenanceMismatchBypass: true,
        purpose: "national-build"
      }).authorizedForNationalBuild
    ).toBe(true);
    expect(
      verifyTurkeyParentProvenance(inspection, {
        allowProvenanceMismatchBypass: true,
        purpose: "publish-ready"
      }).authorizedForNationalBuild
    ).toBe(false);
  });
});
