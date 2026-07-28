import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";

describe("territory registry publish CLI", () => {
  it("publishes, verifies, blocks duplicate immutable versions, and keeps dry-run read-only", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-cli-publish-"));
    const artifactRoot = join(tempDir, "artifact");
    const registryOutput = join(tempDir, "registry");
    const dryRunOutput = join(tempDir, "dry-run");

    try {
      await writeFixtureArtifactRoot(artifactRoot);

      await expect(
        captureCli([
          "registry",
          "publish",
          "--artifact-root",
          artifactRoot,
          "--registry-output",
          dryRunOutput,
          "--dataset",
          "territory-kit-tr",
          "--version",
          "1.0.0",
          "--base-url",
          "https://datasets.example.test/tr/1.0.0/",
          "--artifact-prefix",
          "tr/1.0.0",
          "--dry-run"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "registry publish",
          data: {
            dryRun: true,
            artifactCount: 3,
            uploadedKeys: []
          }
        }
      });
      await expect(stat(dryRunOutput)).rejects.toThrow();

      const baseUrl = directoryFileUrl(join(registryOutput, "tr", "1.0.0"));
      await expect(
        captureCli([
          "registry",
          "publish",
          "--artifact-root",
          artifactRoot,
          "--registry-output",
          registryOutput,
          "--dataset",
          "territory-kit-tr",
          "--version",
          "1.0.0",
          "--base-url",
          baseUrl,
          "--artifact-prefix",
          "tr/1.0.0",
          "--build-date",
          "2026-01-01T00:00:00.000Z",
          "--smoke-test"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "registry publish",
          data: {
            dryRun: false,
            artifactCount: 3,
            registryKey: "registry.json",
            immutableRegistryKey: "tr/1.0.0/registry.json",
            smokeTest: { ok: true, checkedArtifactCount: 3 }
          }
        }
      });

      await expect(
        captureCli([
          "registry",
          "verify",
          "--registry",
          pathToFileURL(join(registryOutput, "registry.json")).toString(),
          "--dataset",
          "territory-kit-tr",
          "--version",
          "1.0.0"
        ])
      ).resolves.toMatchObject({
        code: 0,
        payload: {
          ok: true,
          command: "registry verify",
          data: { datasetCount: 1, checkedArtifactCount: 3 }
        }
      });

      await expect(
        captureCli([
          "registry",
          "publish",
          "--artifact-root",
          artifactRoot,
          "--registry-output",
          registryOutput,
          "--dataset",
          "territory-kit-tr",
          "--version",
          "1.0.0",
          "--base-url",
          baseUrl,
          "--artifact-prefix",
          "tr/1.0.0"
        ])
      ).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: false,
          issues: [expect.objectContaining({ message: expect.stringContaining("already exists") })]
        }
      });

      await writeFile(join(registryOutput, "tr", "1.0.0", "manifest.json"), "broken\n", "utf8");
      await expect(
        captureCli([
          "registry",
          "verify",
          "--registry",
          pathToFileURL(join(registryOutput, "registry.json")).toString(),
          "--dataset",
          "territory-kit-tr",
          "--version",
          "1.0.0"
        ])
      ).resolves.toMatchObject({
        code: 1,
        payload: {
          ok: false,
          command: "registry verify",
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: "ARTIFACT_CHECKSUM_MISMATCH"
            })
          ])
        }
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function writeFixtureArtifactRoot(artifactRoot: string): Promise<void> {
  const dataset = createSampleTerritoryDataset();
  const files = new Map([
    [
      "manifest.json",
      stableJson({
        manifestVersion: "1",
        datasetId: "territory-kit-tr",
        datasetVersion: "1.0.0",
        schemaVersion: "territory-schema@1",
        country: { alpha2: "TR", alpha3: "TUR", name: "Turkiye" },
        sourceProvider: "fixture",
        supportedLevels: ["ADM0"],
        licenseId: "Apache-2.0",
        attribution: "fixture"
      })
    ],
    ["levels/ADM0/dataset.json", stableJson(dataset)]
  ]);
  files.set(
    "checksums.json",
    stableJson({
      algorithm: "sha256",
      files: Object.fromEntries(
        [...files.entries()].map(([path, content]) => [path, sha256(content)])
      )
    })
  );

  for (const [relativePath, content] of files) {
    const target = join(artifactRoot, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

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

function directoryFileUrl(path: string): string {
  return pathToFileURL(`${path}/`).toString();
}

function stableJson(input: unknown): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}
