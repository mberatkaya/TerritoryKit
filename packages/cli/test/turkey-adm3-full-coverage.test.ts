import { mkdtemp, readFile, rm } from "node:fs/promises";
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

    try {
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
