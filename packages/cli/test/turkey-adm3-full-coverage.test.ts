import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";

describe("territory cli Turkey ADM3 full coverage", () => {
  it("lists provider records through the Turkey ADM3 command group", async () => {
    await expect(captureCli(["tr", "adm3", "providers", "list"])).resolves.toMatchObject({
      code: 0,
      payload: {
        ok: true,
        command: "tr adm3 providers list",
        data: {
          summary: {
            provinceCount: 81,
            providerCount: 171,
            officialCount: 4,
            osmCount: 81,
            generatedCount: 81
          }
        }
      }
    });
  });

  it("validates provider and district fallback registries", async () => {
    await expect(captureCli(["tr", "adm3", "source-audit"])).resolves.toMatchObject({
      code: 0,
      payload: {
        ok: true,
        command: "tr adm3 source-audit",
        data: {
          provinceCount: 81,
          providerCount: 243,
          districtCount: 973
        }
      }
    });
  });

  it("prints national coverage report", async () => {
    const result = await captureCli(["tr", "adm3", "coverage"]);

    expect(result.code).toBe(0);
    expect(result.payload).toMatchObject({
      ok: true,
      command: "tr adm3 coverage",
      data: {
        provinceCount: 81,
        districtCount: 973
      }
    });
    expect(
      (result.payload as { data?: { finalUsableCoveragePercent?: number } }).data
        ?.finalUsableCoveragePercent
    ).toBeGreaterThanOrEqual(99.99);
    expect(
      (result.payload as { data?: { finalUsableCoveragePercent?: number } }).data
        ?.finalUsableCoveragePercent
    ).toBeLessThanOrEqual(100);
  });

  it("writes deterministic geometry build artifacts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-cli-tr-adm3-full-"));
    const outputPath = join(tempDir, "build-summary.json");
    const adm2DatasetPath = join(tempDir, "adm2-dataset.json");

    try {
      await writeFile(adm2DatasetPath, JSON.stringify(createAdm2FixtureDataset()), "utf8");

      const result = await captureCli([
        "tr",
        "adm3",
        "build",
        "--official",
        "--osm",
        "--generated",
        "--fill-gaps",
        "--output",
        outputPath,
        "--adm2-dataset",
        adm2DatasetPath,
        "--max-districts",
        "2",
        "--build-date",
        "2026-08-07T00:00:00.000Z"
      ]);

      expect(result).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "tr adm3 build",
          data: {
            districtCount: 2,
            builtDistrictCount: 2,
            generatedPolygons: expect.any(Number),
            finalCoveragePercent: expect.any(Number)
          }
        }
      });
      await expect(readFile(outputPath, "utf8")).resolves.toContain(
        "territorykit-tr-adm3-build-summary@1"
      );
      await expect(readFile(join(tempDir, "dataset.json"), "utf8")).resolves.toContain(
        "territory-kit-tr-adm3-national-build"
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("emits offline provider health", async () => {
    const result = await captureCli([
      "tr",
      "adm3",
      "providers",
      "health",
      "--build-date",
      "2026-08-07T00:00:00.000Z"
    ]);

    expect(result.code).toBe(0);
    expect(result.payload).toMatchObject({
      ok: true,
      command: "tr adm3 providers health",
      data: {
        networkMode: "offline-registry"
      }
    });
  });

  it("generates deterministic Turkey V2 game-zone artifacts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-cli-tr-adm3-game-zone-"));
    const adm2DatasetPath = join(tempDir, "adm2-dataset.json");
    const outputPath = join(tempDir, "game-zones");

    try {
      await writeFile(adm2DatasetPath, JSON.stringify(createAdm2FixtureDataset()), "utf8");

      const first = await captureCli([
        "tr",
        "adm3",
        "generate",
        "--dataset",
        adm2DatasetPath,
        "--district-id",
        "tr:adm2:54988432b39717738295698",
        "--profile",
        "urban",
        "--seed",
        "kaprota-v2",
        "--province-code",
        "01",
        "--district-code",
        "001",
        "--target-zone-count",
        "6",
        "--output",
        outputPath
      ]);

      expect(first).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "tr adm3 generate",
          data: {
            selectedProfile: "urban",
            finalCoveragePercent: 100,
            overlapCount: 0,
            parentContainmentErrorCount: 0,
            trV2ValidationOk: true
          }
        }
      });
      await expect(readFile(join(outputPath, "dataset.json"), "utf8")).resolves.toContain(
        "tr-adm3-game-zone-build"
      );
      await expect(readFile(join(outputPath, "quality-report.json"), "utf8")).resolves.toContain(
        "territorykit-tr-adm3-game-zone-quality@1"
      );
      await expect(readFile(join(outputPath, "adjacency.json"), "utf8")).resolves.toContain(
        "contentHash"
      );

      const firstSummary = JSON.parse(
        await readFile(join(outputPath, "build-summary.json"), "utf8")
      ) as { deterministicHash: string };
      const blockedOverwrite = await captureCli([
        "tr",
        "adm3",
        "generate",
        "--dataset",
        adm2DatasetPath,
        "--district-id",
        "tr:adm2:54988432b39717738295698",
        "--profile",
        "urban",
        "--province-code",
        "01",
        "--district-code",
        "001",
        "--output",
        outputPath
      ]);

      expect(blockedOverwrite.code).toBe(2);

      const secondOutputPath = join(tempDir, "game-zones-second");
      const second = await captureCli([
        "tr",
        "adm3",
        "generate",
        "--dataset",
        adm2DatasetPath,
        "--district-id",
        "tr:adm2:54988432b39717738295698",
        "--profile",
        "urban",
        "--seed",
        "kaprota-v2",
        "--province-code",
        "01",
        "--district-code",
        "001",
        "--target-zone-count",
        "6",
        "--output",
        secondOutputPath
      ]);
      const secondSummary = JSON.parse(
        await readFile(join(secondOutputPath, "build-summary.json"), "utf8")
      ) as { deterministicHash: string };

      expect(second.code).toBe(0);
      expect(secondSummary.deterministicHash).toBe(firstSummary.deterministicHash);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("generates smart fallback artifacts with manifest and legacy comparison", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-cli-tr-adm3-smart-fallback-"));
    const adm2DatasetPath = join(tempDir, "adm2-dataset.json");
    const roadsPath = join(tempDir, "roads.geojson");
    const outputPath = join(tempDir, "smart-zones");

    try {
      await writeFile(adm2DatasetPath, JSON.stringify(createAdm2FixtureDataset()), "utf8");
      await writeFile(
        roadsPath,
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "primary-v",
              properties: { highway: "primary", source: "openstreetmap" },
              geometry: {
                type: "LineString",
                coordinates: [
                  [35.1, 37],
                  [35.1, 37.2]
                ]
              }
            },
            {
              type: "Feature",
              id: "secondary-h",
              properties: { highway: "secondary", source: "openstreetmap" },
              geometry: {
                type: "LineString",
                coordinates: [
                  [35, 37.1],
                  [35.2, 37.1]
                ]
              }
            }
          ]
        }),
        "utf8"
      );

      const result = await captureCli([
        "tr",
        "adm3",
        "generate",
        "--strategy",
        "smart",
        "--dataset",
        adm2DatasetPath,
        "--district-id",
        "tr:adm2:54988432b39717738295698",
        "--profile",
        "custom",
        "--seed",
        "smart-cli",
        "--province-code",
        "01",
        "--district-code",
        "001",
        "--roads",
        roadsPath,
        "--target-zone-count",
        "4",
        "--target-area",
        "100",
        "--min-area",
        "1",
        "--max-area",
        "200",
        "--min-fragment-area",
        "1",
        "--min-quality-score",
        "0.3",
        "--min-barrier-alignment",
        "0.1",
        "--output",
        outputPath
      ]);

      expect(result).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "tr adm3 generate",
          data: {
            strategy: "smart",
            selectedProfile: "custom",
            algorithmVersion: "smart-derived-v1",
            producedZoneCount: 4,
            trV2ValidationOk: true
          }
        }
      });
      await expect(readFile(join(outputPath, "manifest.json"), "utf8")).resolves.toContain(
        "smart-derived-v1"
      );
      await expect(readFile(join(outputPath, "comparison.json"), "utf8")).resolves.toContain(
        "territorykit-tr-adm3-smart-fallback-comparison@1"
      );
      await expect(readFile(join(outputPath, "dataset.json"), "utf8")).resolves.toContain(
        "Smart derived territory"
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid Turkey V2 game-zone CLI configuration", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-cli-tr-adm3-game-zone-invalid-"));
    const adm2DatasetPath = join(tempDir, "adm2-dataset.json");

    try {
      await writeFile(adm2DatasetPath, JSON.stringify(createAdm2FixtureDataset()), "utf8");

      const result = await captureCli([
        "tr",
        "adm3",
        "generate",
        "--dataset",
        adm2DatasetPath,
        "--profile",
        "custom",
        "--province-code",
        "01",
        "--district-code",
        "001",
        "--min-area",
        "5",
        "--target-area",
        "1",
        "--max-area",
        "2",
        "--output",
        join(tempDir, "bad")
      ]);

      expect(result.code).toBe(2);
      expect(
        (result.payload as { issues?: Array<{ code: string }> }).issues?.map((issue) => issue.code)
      ).toContain("INVALID_AREA_ORDERING");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes deterministic Turkey V2 hybrid artifacts and protects output", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-cli-tr-adm3-hybrid-"));
    const adm2DatasetPath = join(tempDir, "adm2-dataset.json");
    const officialPath = join(tempDir, "official.json");
    const osmPath = join(tempDir, "osm.json");
    const outputPath = join(tempDir, "hybrid");
    const secondOutputPath = join(tempDir, "hybrid-second");
    const districtId = "tr:adm2:54988432b39717738295698";

    try {
      await writeFile(adm2DatasetPath, JSON.stringify(createAdm2FixtureDataset()), "utf8");
      await writeFile(
        officialPath,
        JSON.stringify(
          createAdm3FixtureDataset([
            createAdm3FixtureZone({
              id: "tr:adm3:hybrid-official",
              parentId: districtId,
              sourceClass: "official",
              sourceNativeId: "official-1",
              bbox: [35, 37, 35.08, 37.2]
            })
          ])
        ),
        "utf8"
      );
      await writeFile(
        osmPath,
        JSON.stringify(
          createAdm3FixtureDataset([
            createAdm3FixtureZone({
              id: "tr:adm3:hybrid-osm",
              parentId: districtId,
              sourceClass: "osm",
              sourceNativeId: "osm-way-1",
              bbox: [35.06, 37, 35.14, 37.2]
            })
          ])
        ),
        "utf8"
      );

      const args = [
        "tr",
        "adm3",
        "hybrid",
        "build",
        "--district",
        adm2DatasetPath,
        "--district-id",
        districtId,
        "--official",
        officialPath,
        "--osm",
        osmPath,
        "--profile",
        "custom",
        "--target-area",
        "500",
        "--min-area",
        "1",
        "--max-area",
        "1000",
        "--max-zones",
        "8",
        "--min-fragment-area",
        "1",
        "--seed",
        "kaprota-v2",
        "--province-code",
        "01",
        "--district-code",
        "001",
        "--build-date",
        "2026-08-13T00:00:00.000Z"
      ];
      const first = await captureCli([...args, "--output", outputPath]);

      expect(first).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "tr adm3 hybrid build",
          data: {
            officialEffectiveCount: 1,
            osmEffectiveCount: 1,
            generatedEffectiveCount: expect.any(Number),
            trV2ValidationOk: true
          }
        }
      });
      await expect(readFile(join(outputPath, "dataset.json"), "utf8")).resolves.toContain(
        "tr-adm3-v2-hybrid-build"
      );
      await expect(readFile(join(outputPath, "attribution.txt"), "utf8")).resolves.toContain(
        "OpenStreetMap contributors"
      );
      await expect(
        readFile(join(outputPath, "distribution-policy.json"), "utf8")
      ).resolves.toContain("ODbL-1.0");
      await expect(readFile(join(outputPath, "checksums.json"), "utf8")).resolves.toContain(
        "territorykit-tr-v2-hybrid-checksums@1"
      );

      const blocked = await captureCli([...args, "--output", outputPath]);
      expect(blocked.code).toBe(2);

      const second = await captureCli([...args, "--output", secondOutputPath]);
      const firstSummary = JSON.parse(
        await readFile(join(outputPath, "build-summary.json"), "utf8")
      ) as { deterministicHash: string };
      const secondSummary = JSON.parse(
        await readFile(join(secondOutputPath, "build-summary.json"), "utf8")
      ) as { deterministicHash: string };

      expect(second.code).toBe(0);
      expect(secondSummary.deterministicHash).toBe(firstSummary.deterministicHash);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns a non-zero hybrid result when generated fallback is disabled and gaps remain", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-cli-tr-adm3-hybrid-gap-"));
    const adm2DatasetPath = join(tempDir, "adm2-dataset.json");
    const officialPath = join(tempDir, "official.json");
    const districtId = "tr:adm2:54988432b39717738295698";

    try {
      await writeFile(adm2DatasetPath, JSON.stringify(createAdm2FixtureDataset()), "utf8");
      await writeFile(
        officialPath,
        JSON.stringify(
          createAdm3FixtureDataset([
            createAdm3FixtureZone({
              id: "tr:adm3:hybrid-gap-official",
              parentId: districtId,
              sourceClass: "official",
              sourceNativeId: "official-gap",
              bbox: [35, 37, 35.08, 37.2]
            })
          ])
        ),
        "utf8"
      );

      const result = await captureCli([
        "tr",
        "adm3",
        "build",
        "--hybrid",
        "--district",
        adm2DatasetPath,
        "--district-id",
        districtId,
        "--official",
        officialPath,
        "--no-generated",
        "--province-code",
        "01",
        "--district-code",
        "001",
        "--output",
        join(tempDir, "hybrid-gap")
      ]);

      expect(result.code).toBe(1);
      expect(result.payload).toMatchObject({
        ok: false,
        command: "tr adm3 hybrid build",
        data: {
          qualityOk: false
        }
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes Turkey V2 hybrid batch artifacts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-cli-tr-adm3-hybrid-batch-"));
    const adm2DatasetPath = join(tempDir, "adm2-dataset.json");
    const officialPath = join(tempDir, "official.json");
    const outputPath = join(tempDir, "hybrid-batch");
    const firstDistrictId = "tr:adm2:54988432b39717738295698";
    const secondDistrictId = "tr:adm2:54988432b85758697491434";

    try {
      await writeFile(adm2DatasetPath, JSON.stringify(createAdm2FixtureDataset()), "utf8");
      await writeFile(
        officialPath,
        JSON.stringify(
          createAdm3FixtureDataset([
            createAdm3FixtureZone({
              id: "tr:adm3:batch-first",
              parentId: firstDistrictId,
              sourceClass: "official",
              sourceNativeId: "batch-first",
              bbox: [35, 37, 35.2, 37.2],
              districtCode: "001"
            }),
            createAdm3FixtureZone({
              id: "tr:adm3:batch-second",
              parentId: secondDistrictId,
              sourceClass: "official",
              sourceNativeId: "batch-second",
              bbox: [35.3, 37, 35.4, 37.2],
              districtCode: "002"
            })
          ])
        ),
        "utf8"
      );

      const result = await captureCli([
        "tr",
        "adm3",
        "hybrid",
        "build",
        "--batch",
        "--district",
        adm2DatasetPath,
        "--district-id",
        `${firstDistrictId},${secondDistrictId}`,
        "--official",
        officialPath,
        "--profile",
        "custom",
        "--target-area",
        "500",
        "--min-area",
        "1",
        "--max-area",
        "1000",
        "--max-zones",
        "8",
        "--min-fragment-area",
        "1",
        "--output",
        outputPath,
        "--build-date",
        "2026-08-13T00:00:00.000Z"
      ]);

      expect(result).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "tr adm3 hybrid build",
          data: {
            mode: "batch",
            successfulDistrictCount: 2,
            finalCoveragePercent: expect.any(Number)
          }
        }
      });
      await expect(readFile(join(outputPath, "batch-summary.json"), "utf8")).resolves.toContain(
        "territorykit-tr-v2-hybrid-build-summary@1"
      );
      await expect(
        readFile(
          join(outputPath, "districts", "tr-adm2-54988432b39717738295698", "coverage.json"),
          "utf8"
        )
      ).resolves.toContain("territorykit-tr-v2-hybrid-coverage@1");
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

function createAdm2FixtureDataset(): unknown {
  return {
    zones: [
      createAdm2FixtureZone({
        id: "tr:adm2:54988432b39717738295698",
        name: "Aladag",
        bbox: [35, 37, 35.2, 37.2],
        center: [35.1, 37.1]
      }),
      createAdm2FixtureZone({
        id: "tr:adm2:54988432b85758697491434",
        name: "Ceyhan",
        bbox: [35.3, 37, 35.5, 37.2],
        center: [35.4, 37.1]
      })
    ]
  };
}

function createAdm2FixtureZone(input: {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  center: [number, number];
}): unknown {
  const [west, south, east, north] = input.bbox;

  return {
    id: input.id,
    datasetId: "territory-kit-test-tr-adm2",
    level: 2,
    sourceAdminLevel: "ADM2",
    name: input.name,
    localName: input.name,
    countryCode: "TR",
    bbox: input.bbox,
    center: input.center,
    neighborIds: [],
    geometry: {
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
    },
    properties: {}
  };
}

function createAdm3FixtureDataset(zones: unknown[]): unknown {
  return { zones };
}

function createAdm3FixtureZone(input: {
  id: string;
  parentId: string;
  sourceClass: "official" | "osm";
  sourceNativeId: string;
  bbox: [number, number, number, number];
  districtCode?: string;
}): unknown {
  const [west, south, east, north] = input.bbox;
  const providerId = input.sourceClass === "osm" ? "openstreetmap" : "fixture-official";
  const license = input.sourceClass === "osm" ? "ODbL-1.0" : "CC BY 4.0";
  const attribution =
    input.sourceClass === "osm"
      ? "OpenStreetMap contributors, ODbL 1.0"
      : "Fixture official source";

  return {
    id: input.id,
    datasetId: "territory-kit-test-tr-adm3",
    level: 3,
    sourceAdminLevel: "ADM3",
    name: input.id,
    localName: input.id,
    countryCode: "TR",
    parentId: input.parentId,
    bbox: input.bbox,
    center: [(west + east) / 2, (south + north) / 2],
    neighborIds: [],
    semanticType: "neighbourhood",
    geometry: {
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
    },
    properties: {
      territory: {
        adminLevel: "ADM3",
        sourceAdminLevel: "ADM3",
        semanticType: "neighbourhood",
        localType: "neighbourhood",
        localTypeName: "Mahalle",
        hierarchyDepth: 3,
        parentId: input.parentId,
        countryCode: "TR",
        provinceCode: "01",
        districtCode: input.districtCode ?? "001",
        sourceClass: input.sourceClass,
        providerClass: input.sourceClass,
        providerId,
        providerName: providerId,
        sourceProvider: providerId,
        sourceDatasetId: input.sourceClass === "osm" ? "openstreetmap" : "fixture-official",
        sourceNativeId: input.sourceNativeId,
        sourceDate: "2026-08-01",
        sourceUrl:
          input.sourceClass === "osm"
            ? "https://www.openstreetmap.org/"
            : "https://data.example.test/tr/adm3",
        license,
        attribution,
        official: input.sourceClass === "official",
        generated: false,
        semanticReviewStatus: "reviewed",
        coverageStatus: "verified",
        stableId: input.id,
        source: {
          provider: providerId,
          sourceClass: input.sourceClass,
          sourceDatasetId: input.sourceClass === "osm" ? "openstreetmap" : "fixture-official",
          sourceId: input.sourceNativeId,
          sourceNativeId: input.sourceNativeId,
          sourceDate: "2026-08-01",
          sourceUrl:
            input.sourceClass === "osm"
              ? "https://www.openstreetmap.org/"
              : "https://data.example.test/tr/adm3",
          license,
          attribution
        }
      }
    }
  };
}
