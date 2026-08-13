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
