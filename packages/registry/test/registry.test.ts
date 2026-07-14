import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it } from "vitest";
import { createNodeTerritoryRegistryClient } from "../src/node.js";
import { validateTerritoryDatasetRegistry } from "../src/schema.js";
import type { TerritoryDatasetRegistry } from "../src/types.js";

describe("territory dataset registry", () => {
  it("validates registry schema and rejects unsafe artifact urls", () => {
    const validation = validateTerritoryDatasetRegistry({
      registryVersion: "1",
      generatedAt: "2026-01-01T00:00:00.000Z",
      datasets: [
        {
          id: "sample",
          displayName: "Sample",
          version: "1.0.0",
          schemaVersion: "territory-schema@1",
          levels: ["ADM0"],
          source: { provider: "fixture" },
          license: { id: "Apache-2.0", attribution: "fixture" },
          artifacts: [
            {
              id: "bad",
              purpose: "query",
              format: "territory-json",
              levels: ["ADM0"],
              path: "levels/ADM0/dataset.json",
              url: "javascript:alert(1)",
              sha256: "0".repeat(64),
              sizeBytes: 1
            }
          ]
        }
      ]
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "ARTIFACT_URL_INVALID" })])
    );
  });

  it("installs file-backed artifacts, reuses cache offline, and resolves paths", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-registry-"));
    const artifactRoot = join(tempDir, "artifacts");
    const cacheDir = join(tempDir, "cache");
    const registryPath = join(tempDir, "registry.json");

    try {
      await mkdir(join(artifactRoot, "levels", "ADM0"), { recursive: true });
      const manifest = {
        manifestVersion: "1",
        datasetId: "sample",
        datasetVersion: "1.0.0",
        schemaVersion: "territory-schema@1",
        supportedLevels: ["ADM0"]
      };
      const dataset = createSampleTerritoryDataset();
      const files = new Map([
        ["manifest.json", stableJson(manifest)],
        ["levels/ADM0/dataset.json", stableJson(dataset)]
      ]);
      const checksums = {
        files: Object.fromEntries(
          [...files.entries()].map(([path, content]) => [path, sha256(content)])
        )
      };
      files.set("checksums.json", stableJson(checksums));

      for (const [relativePath, content] of files) {
        const target = join(artifactRoot, relativePath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      }

      const registry: TerritoryDatasetRegistry = {
        registryVersion: "1",
        generatedAt: "2026-01-01T00:00:00.000Z",
        baseUrl: pathToFileURL(artifactRoot).toString(),
        datasets: [
          {
            id: "sample",
            displayName: "Sample",
            version: "1.0.0",
            schemaVersion: "territory-schema@1",
            levels: ["ADM0"],
            source: { provider: "fixture" },
            license: { id: "Apache-2.0", attribution: "fixture" },
            artifacts: [...files.entries()].map(([path, content]) => ({
              id: path
                .replace(/[^a-z0-9]+/gi, "-")
                .replace(/^-|-$/g, "")
                .toLowerCase(),
              purpose: path.startsWith("levels/") ? "query" : "metadata",
              format: "territory-json",
              ...(path.startsWith("levels/") ? { levels: ["ADM0" as const] } : {}),
              path,
              url: path,
              sha256: sha256(content),
              sizeBytes: Buffer.byteLength(content),
              compression: "none",
              contentType: "application/json"
            }))
          }
        ]
      };
      await writeFile(registryPath, stableJson(registry), "utf8");

      const client = createNodeTerritoryRegistryClient({ registryUrl: registryPath, cacheDir });
      const installed = await client.installDataset({ datasetId: "sample", levels: ["ADM0"] });

      expect(JSON.parse(await installed.readText("manifest.json"))).toMatchObject({
        datasetId: "sample"
      });
      expect(JSON.parse(await installed.readText("levels/ADM0/dataset.json"))).toMatchObject({
        manifest: { datasetId: "territorykit-sample" }
      });

      const offlineClient = createNodeTerritoryRegistryClient({
        registryUrl: registryPath,
        cacheDir,
        offline: true
      });
      const offlineInstalled = await offlineClient.installDataset({
        datasetId: "sample",
        levels: ["ADM0"]
      });
      await expect(offlineInstalled.readText("manifest.json")).resolves.toContain("sample");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function stableJson(input: unknown): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
