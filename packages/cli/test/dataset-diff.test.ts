import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";

describe("territory dataset diff cli", () => {
  it("emits JSON and writes Markdown, CSV, mapping, breaking, coverage, and performance outputs", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-diff-cli-"));
    const oldPath = join(tempDir, "old.json");
    const newPath = join(tempDir, "new.json");
    const markdownPath = join(tempDir, "diff.md");
    const csvPath = join(tempDir, "diff.csv");
    const mappingPath = join(tempDir, "mapping.json");
    const breakingPath = join(tempDir, "breaking.json");
    const coveragePath = join(tempDir, "coverage.json");
    const performancePath = join(tempDir, "performance.json");

    try {
      await writeFile(
        oldPath,
        JSON.stringify(
          createDataset([
            squareZone({ id: "root", level: 0, west: 0, south: 0, east: 3, north: 3 }),
            squareZone({
              id: "zone:a",
              level: 1,
              name: "Kadikoy",
              parentId: "root",
              west: 0,
              south: 0,
              east: 1,
              north: 1
            })
          ])
        ),
        "utf8"
      );
      await writeFile(
        newPath,
        JSON.stringify(
          createDataset(
            [
              squareZone({ id: "root", level: 0, west: 0, south: 0, east: 3, north: 3 }),
              squareZone({
                id: "zone:a",
                level: 1,
                name: "Kadıköy",
                parentId: "root",
                west: 0,
                south: 0,
                east: 1,
                north: 1
              }),
              squareZone({
                id: "zone:b",
                level: 1,
                name: "Fatih",
                parentId: "root",
                west: 1,
                south: 0,
                east: 2,
                north: 1
              })
            ],
            { datasetVersion: "2.0.0", geometryHash: "fixture-v2" }
          )
        ),
        "utf8"
      );

      const result = await captureCli([
        "dataset",
        "diff",
        oldPath,
        newPath,
        "--json",
        "--markdown-output",
        markdownPath,
        "--csv-output",
        csvPath,
        "--mapping-output",
        mappingPath,
        "--breaking-output",
        breakingPath,
        "--coverage-output",
        coveragePath,
        "--performance-output",
        performancePath
      ]);

      expect(result).toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "dataset diff",
          data: {
            schemaVersion: "territory-dataset-diff@1",
            summary: { newZoneCount: 3 }
          }
        }
      });
      await expect(readFile(markdownPath, "utf8")).resolves.toContain("# Territory Dataset Diff");
      await expect(readFile(csvPath, "utf8")).resolves.toContain("category,oldId,newId");
      await expect(readFile(mappingPath, "utf8")).resolves.toContain("territory-migration-plan@1");
      await expect(readFile(breakingPath, "utf8")).resolves.toContain("[");
      await expect(readFile(coveragePath, "utf8")).resolves.toContain("zoneCount");
      await expect(readFile(performancePath, "utf8")).resolves.toContain("candidatePairCount");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("uses CI-friendly non-zero exit codes for breaking changes", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-diff-cli-"));
    const oldPath = join(tempDir, "old.json");
    const newPath = join(tempDir, "new.json");

    try {
      await writeFile(
        oldPath,
        JSON.stringify(
          createDataset([
            squareZone({ id: "zone:a", level: 0, west: 0, south: 0, east: 1, north: 1 })
          ])
        ),
        "utf8"
      );
      await writeFile(
        newPath,
        JSON.stringify(createDataset([], { datasetVersion: "2.0.0", geometryHash: "fixture-v2" })),
        "utf8"
      );

      await expect(
        captureCli(["dataset", "diff", oldPath, newPath, "--json", "--fail-on-breaking"])
      ).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: true,
          data: {
            breakingChanges: [expect.objectContaining({ code: "REMOVED_ZONE" })]
          }
        }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("supports identity diff and migration-plan review output", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-diff-cli-"));
    const oldPath = join(tempDir, "old.json");
    const newPath = join(tempDir, "new.json");

    try {
      await writeFile(
        oldPath,
        JSON.stringify(
          createDataset([
            squareZone({ id: "root", level: 0, west: 0, south: 0, east: 3, north: 3 }),
            squareZone({
              id: "old:koy",
              level: 1,
              name: "Köy",
              parentId: "root",
              west: 0,
              south: 0,
              east: 1,
              north: 1
            })
          ])
        ),
        "utf8"
      );
      await writeFile(
        newPath,
        JSON.stringify(
          createDataset(
            [
              squareZone({ id: "root", level: 0, west: 0, south: 0, east: 3, north: 3 }),
              squareZone({
                id: "new:koy-1",
                level: 1,
                name: "Koy",
                parentId: "root",
                west: 0,
                south: 0,
                east: 1,
                north: 1
              }),
              squareZone({
                id: "new:koy-2",
                level: 1,
                name: "Köy",
                parentId: "root",
                west: 1,
                south: 0,
                east: 2,
                north: 1
              })
            ],
            { datasetVersion: "2.0.0", geometryHash: "fixture-v2" }
          )
        ),
        "utf8"
      );

      await expect(
        captureCli(["identity", "diff", oldPath, newPath, "--json"])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "identity diff",
          data: {
            changes: [expect.objectContaining({ category: "ambiguous-match" })]
          }
        }
      });

      await expect(
        captureCli(["dataset", "migration-plan", oldPath, newPath, "--json"])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          data: {
            mappings: [expect.objectContaining({ oldId: "root", newId: "root" })],
            reviewItems: [expect.objectContaining({ category: "ambiguous-match" })]
          }
        }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

async function captureCli(args: string[]): Promise<{ code: number; payload: unknown }> {
  const logs: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((message: unknown) => {
    logs.push(String(message));
  });

  try {
    const code = await runCli(args);
    const payload = JSON.parse(logs.at(-1) ?? "{}") as unknown;

    return { code, payload };
  } finally {
    spy.mockRestore();
  }
}

function createDataset(
  zones: TerritoryZone[],
  manifest: Partial<TerritoryDataset["manifest"]> = {}
): TerritoryDataset {
  return {
    manifest: {
      datasetId: "fixture",
      datasetVersion: "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-01-01",
      geometryHash: "fixture-v1",
      license: "Apache-2.0",
      sourceProvider: "fixture",
      ...manifest
    },
    zones: zones.map((zone) => ({ ...zone, datasetId: "fixture" }))
  };
}

function squareZone(input: {
  id: string;
  level: number;
  west: number;
  south: number;
  east: number;
  north: number;
  name?: string;
  parentId?: string;
}): TerritoryZone {
  return {
    id: input.id,
    datasetId: "fixture",
    level: input.level,
    ...(input.name ? { name: input.name } : {}),
    ...(input.parentId ? { parentId: input.parentId } : {}),
    neighborIds: [],
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [input.west, input.south],
          [input.east, input.south],
          [input.east, input.north],
          [input.west, input.north],
          [input.west, input.south]
        ]
      ]
    },
    center: [(input.west + input.east) / 2, (input.south + input.north) / 2],
    bbox: [input.west, input.south, input.east, input.north],
    properties: {}
  };
}
