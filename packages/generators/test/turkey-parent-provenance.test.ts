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
  level: number;
  name: string;
  provider?: string;
  geometry?: TerritoryZone["geometry"];
}): TerritoryZone {
  return {
    id: `tr:adm${input.level}:${input.name}`,
    datasetId: "fixture-tr-parent",
    countryCode: "TR",
    level: input.level,
    sourceAdminLevel: `ADM${input.level}` as TerritoryAdminLevel,
    semanticType: input.level === 0 ? "country" : input.level === 1 ? "province" : "district",
    name: input.name,
    neighborIds: [],
    geometry: input.geometry ?? square,
    center: [28.5, 40.5],
    bbox: [28, 40, 29, 41],
    properties: {
      territory: input.provider
        ? {
            source: { provider: input.provider, sourceId: "fixture" }
          }
        : {}
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
        zone({ level: 0, name: "Turkey", provider: "geoboundaries" }),
        zone({ level: 1, name: "Fixture Province", provider: "geoboundaries" })
      ]),
      catalog: hdxCatalog
    });
    expect(inspection.lineageStatus).toBe("CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS");
    expect(inspection.classification).toBe("CONFIRMED_ROOT_CAUSE");
    expect(verifyTurkeyParentProvenance(inspection).ok).toBe(false);
  });

  it("accepts matching provider metadata on parent zones", async () => {
    const inspection = await inspectTurkeyParentProvenance({
      parentDataset: dataset([
        zone({ level: 0, name: "Turkey", provider: "hdx-cod-ab" }),
        zone({ level: 1, name: "Fixture Province", provider: "hdx-cod-ab" })
      ]),
      catalog: hdxCatalog
    });
    expect(inspection.lineageStatus).toBe("VERIFIED_CATALOG_PROVIDER_MATCH");
    expect(verifyTurkeyParentProvenance(inspection).ok).toBe(true);
  });

  it("detects HDX member geometry divergence from parent polygons", async () => {
    const inspection = await inspectTurkeyParentProvenance({
      parentDataset: dataset([
        zone({
          level: 1,
          name: "Fixture Province",
          provider: "hdx-cod-ab",
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
      hdxMemberPaths: { ADM1: join(FIXTURE_ROOT, "hdx-adm1-tiny.geojson") },
      readGeoJsonFeatures: async (path) => {
        const parsed = JSON.parse(await readFile(path, "utf8")) as {
          features: Array<{ properties: Record<string, unknown>; geometry: unknown }>;
        };
        return parsed.features;
      }
    });
    expect(inspection.catalogGeometryStatus).toBe("GEOMETRY_DIVERGENT_FROM_PARENT_DATASET");
    expect(inspection.geometryComparisons[0]?.geometryHashMismatches).toBe(1);
    const sample = inspection.geometryComparisons[0]?.sampleMismatches[0];
    expect(sample?.parentHash).not.toBe(sample?.hdxHash);
    expect(verifyTurkeyParentProvenance(inspection).ok).toBe(false);
  });
});
