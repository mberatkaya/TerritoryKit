import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSquareZone } from "@territory-kit/shared-testkit";
import type {
  TerritoryAdminLevel,
  TerritoryDataset,
  TerritorySemanticAdminType,
  TerritoryZone
} from "@territory-kit/dataset";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";

describe("territory cli Turkey V2 national build", () => {
  it("plans the canonical national ADM0-ADM2 scope", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-cli-tr-v2-plan-"));
    const datasetPath = join(tempDir, "adm0-adm2.json");
    const sourcePath = join(tempDir, "national-source.json");

    try {
      await writeFile(datasetPath, JSON.stringify(nationalFixture()), "utf8");
      await writeFile(sourcePath, JSON.stringify(nationalSourceMetadata()), "utf8");

      const result = await captureCli([
        "tr",
        "v2",
        "national",
        "plan",
        "--adm0-adm2-dataset",
        datasetPath,
        "--source-metadata",
        sourcePath,
        "--official-artifact",
        join(tempDir, "missing-official.json"),
        "--osm-artifact",
        join(tempDir, "missing-osm.json")
      ]);

      expect(result).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "tr v2 national plan",
          data: {
            datasetId: "territory-kit-tr-v2-playable",
            adm1Count: 81,
            adm2Count: 1,
            canonicalAdm2SourceCount: 973,
            officialStatus: "not-built",
            osmStatus: "not-built",
            generatedStatus: "built"
          }
        }
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("builds and validates a local national playable artifact", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-cli-tr-v2-build-"));
    const datasetPath = join(tempDir, "adm0-adm2.json");
    const sourcePath = join(tempDir, "national-source.json");
    const outputPath = join(tempDir, "national");
    const reportsPath = join(tempDir, "reports");

    try {
      await writeFile(datasetPath, JSON.stringify(nationalFixture()), "utf8");
      await writeFile(sourcePath, JSON.stringify(nationalSourceMetadata()), "utf8");

      const build = await captureCli([
        "tr",
        "v2",
        "national",
        "build",
        "--adm0-adm2-dataset",
        datasetPath,
        "--source-metadata",
        sourcePath,
        "--output",
        outputPath,
        "--reports-output",
        reportsPath,
        "--force",
        "--no-official",
        "--no-osm",
        "--no-render",
        "--no-mvt",
        "--no-adjacency",
        "--seed",
        "cli-national-seed"
      ]);

      expect(build).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "tr v2 national build",
          data: {
            datasetId: "territory-kit-tr-v2-playable",
            provinceCount: 81,
            districtCount: 1,
            officialZoneCount: 0,
            osmZoneCount: 0,
            generatedZoneCount: expect.any(Number),
            qualityOk: true
          }
        }
      });
      await expect(readFile(join(outputPath, "source-lock.json"), "utf8")).resolves.toContain(
        "cli-national-seed"
      );
      await expect(readFile(join(outputPath, "checksums.json"), "utf8")).resolves.toContain(
        "territorykit-tr-v2-national-checksums@1"
      );
      await expect(access(join(outputPath, "render", "manifest.json"))).rejects.toThrow();

      const validate = await captureCli([
        "tr",
        "v2",
        "national",
        "validate",
        "--output",
        outputPath
      ]);
      expect(validate).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "tr v2 national validate",
          data: {
            datasetId: "territory-kit-tr-v2-playable",
            finalCoveragePercent: expect.any(Number)
          }
        }
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function captureCli(args: string[]): Promise<{ code: number; payload: unknown }> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

  try {
    const code = await runCli(args);
    const payload = JSON.parse(spy.mock.calls.at(-1)?.[0] ?? "{}") as unknown;

    return { code, payload };
  } finally {
    spy.mockRestore();
  }
}

function nationalSourceMetadata() {
  return {
    country: "TR",
    provider: "hdx-cod-ab",
    sourceId: "cod-ab-tur",
    sourceUrl: "https://data.humdata.org/dataset/cod-ab-tur",
    downloadUrl: "https://data.humdata.org/dataset/cod-ab-tur/resource/fixture",
    sourceDate: "2026-01-26",
    retrievedAt: "2026-08-13T00:00:00.000Z",
    license: "CC BY-IGO",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/igo/",
    attribution: "OCHA COD-AB Türkiye",
    redistributionAllowed: true,
    commercialUseAllowed: true,
    modificationAllowed: true,
    sha256: "0".repeat(64),
    byteSize: 123,
    levels: {
      ADM0: levelLock("tur_admbnda_adm0.shp", 1, 1),
      ADM1: levelLock("tur_admbnda_adm1.shp", 81, 81),
      ADM2: levelLock("tur_admbnda_adm2.shp", 973, 973)
    }
  };
}

function levelLock(
  archiveMember: string,
  expectedFeatureCount: number,
  actualFeatureCount: number
) {
  return {
    archiveMember,
    expectedFeatureCount,
    actualFeatureCount,
    sha256: "1".repeat(64),
    byteSize: expectedFeatureCount
  };
}

function nationalFixture(): TerritoryDataset {
  const datasetId = "test-tr-national-cli";
  const provinceIds = Array.from({ length: 81 }, (_, index) => provinceId(index + 1));
  const districtId = "tr:adm2:01-a";
  const adm0 = admZone({
    id: "tr",
    datasetId,
    level: 0,
    sourceAdminLevel: "ADM0",
    semanticType: "country",
    name: "Turkiye",
    west: 0,
    south: 0,
    east: 90,
    north: 90,
    childIds: provinceIds,
    territory: {
      adminLevel: "ADM0",
      sourceAdminLevel: "ADM0",
      semanticType: "country",
      hierarchyDepth: 0,
      countryCode: "TR",
      localTypeName: "Ulke"
    }
  });
  const provinces = provinceIds.map((id, index) => {
    const code = String(index + 1).padStart(2, "0");
    const west = (index % 9) * 10;
    const south = Math.floor(index / 9) * 10;

    return admZone({
      id,
      datasetId,
      level: 1,
      sourceAdminLevel: "ADM1",
      semanticType: "province",
      name: `Province ${code}`,
      west,
      south,
      east: west + 10,
      north: south + 10,
      parentId: "tr",
      childIds: code === "01" ? [districtId] : [],
      territory: {
        adminLevel: "ADM1",
        sourceAdminLevel: "ADM1",
        semanticType: "province",
        hierarchyDepth: 1,
        parentId: "tr",
        countryCode: "TR",
        provinceCode: code,
        localTypeName: "Il",
        codes: { source: `TR${code}` }
      }
    });
  });
  const district = admZone({
    id: districtId,
    datasetId,
    level: 2,
    sourceAdminLevel: "ADM2",
    semanticType: "district",
    name: "District A",
    west: 0,
    south: 0,
    east: 1,
    north: 1,
    parentId: "tr:adm1:tr-01",
    territory: {
      adminLevel: "ADM2",
      sourceAdminLevel: "ADM2",
      semanticType: "district",
      hierarchyDepth: 2,
      parentId: "tr:adm1:tr-01",
      countryCode: "TR",
      provinceCode: "01",
      districtCode: "001",
      localTypeName: "Ilce",
      codes: { source: "TR01001" }
    }
  });

  return {
    manifest: {
      datasetId,
      datasetVersion: "fixture",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-01-26",
      buildDate: "2026-08-13T00:00:00.000Z",
      geometryHash: "fixture-tr-national-cli",
      adminLevels: ["ADM0", "ADM1", "ADM2"],
      countryCodes: ["TR"],
      crs: "EPSG:4326",
      geometryDetail: "source",
      license: "CC BY-IGO",
      attribution: "Fixture"
    },
    zones: [adm0, ...provinces, district]
  };
}

function admZone(input: {
  id: string;
  datasetId: string;
  level: number;
  sourceAdminLevel: TerritoryAdminLevel;
  semanticType: TerritorySemanticAdminType;
  name: string;
  west: number;
  south: number;
  east: number;
  north: number;
  parentId?: string;
  childIds?: string[];
  territory: Record<string, unknown>;
}): TerritoryZone {
  return createSquareZone({
    id: input.id,
    datasetId: input.datasetId,
    countryCode: "TR",
    level: input.level,
    sourceAdminLevel: input.sourceAdminLevel,
    semanticType: input.semanticType,
    name: input.name,
    west: input.west,
    south: input.south,
    east: input.east,
    north: input.north,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    ...(input.childIds ? { childIds: input.childIds } : {}),
    properties: {
      territory: {
        semanticReviewStatus: "reviewed",
        coverageStatus: "verified",
        ...input.territory
      }
    }
  });
}

function provinceId(index: number): string {
  return `tr:adm1:tr-${String(index).padStart(2, "0")}`;
}
