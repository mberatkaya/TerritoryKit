import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it } from "vitest";
import {
  createLocalTerritoryRegistryPublishTarget,
  createS3CompatibleTerritoryRegistryPublishTarget,
  publishTerritoryDatasetRegistry,
  verifyTerritoryRegistryPublication
} from "../src/node.js";
import type {
  S3CompatibleRegistryObjectClient,
  S3CompatibleRegistryObjectMetadata,
  S3CompatibleRegistryPutObjectRequest,
  TerritoryRegistryObjectPutInput,
  TerritoryRegistryWritableObjectStore
} from "../src/node.js";

describe("territory hosted registry publishing", () => {
  it("publishes immutable local artifacts, writes rollback/inventory manifests, and blocks duplicate versions", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-registry-publish-"));
    const artifactRoot = join(tempDir, "artifact");
    const registryOutput = join(tempDir, "registry");

    try {
      await writeFixtureArtifactRoot(artifactRoot, {
        datasetId: "territory-kit-tr",
        version: "1.0.0"
      });

      const dryRunOutput = join(tempDir, "dry-run");
      const dryRun = await publishTerritoryDatasetRegistry({
        artifactRoot,
        target: createLocalTerritoryRegistryPublishTarget({ rootDir: dryRunOutput }),
        datasetId: "territory-kit-tr",
        version: "1.0.0",
        baseUrl: "https://datasets.example.test/tr/1.0.0/",
        artifactKeyPrefix: "tr/1.0.0",
        generatedAt: "2026-01-01T00:00:00.000Z",
        publishedAt: "2026-01-01T00:00:00.000Z",
        dryRun: true
      });

      expect(dryRun).toMatchObject({
        dryRun: true,
        artifactCount: 3,
        uploadedKeys: []
      });
      await expect(stat(dryRunOutput)).rejects.toThrow();

      const baseUrl = directoryFileUrl(join(registryOutput, "tr", "1.0.0"));
      const publish = await publishTerritoryDatasetRegistry({
        artifactRoot,
        target: createLocalTerritoryRegistryPublishTarget({ rootDir: registryOutput }),
        datasetId: "territory-kit-tr",
        version: "1.0.0",
        baseUrl,
        artifactKeyPrefix: "tr/1.0.0",
        generatedAt: "2026-01-01T00:00:00.000Z",
        publishedAt: "2026-01-01T00:00:00.000Z",
        smokeTest: true
      });

      expect(publish).toMatchObject({
        dryRun: false,
        artifactCount: 3,
        registryKey: "registry.json",
        immutableRegistryKey: "tr/1.0.0/registry.json",
        inventoryKey: "tr/1.0.0/inventory.json",
        rollbackKey: "rollback/territory-kit-tr/1.0.0.rollback.json",
        smokeTest: { ok: true, checkedArtifactCount: 3 }
      });
      await expect(
        readJson(join(registryOutput, "tr", "1.0.0", "inventory.json"))
      ).resolves.toMatchObject({
        inventoryVersion: "territorykit-artifact-inventory@1",
        datasetId: "territory-kit-tr",
        version: "1.0.0",
        artifactCount: 3
      });
      await expect(
        readJson(join(registryOutput, "rollback", "territory-kit-tr", "1.0.0.rollback.json"))
      ).resolves.toMatchObject({
        rollbackVersion: "territorykit-registry-rollback@1",
        restore: { action: "replace-active-registry" }
      });
      await expect(
        publishTerritoryDatasetRegistry({
          artifactRoot,
          target: createLocalTerritoryRegistryPublishTarget({ rootDir: registryOutput }),
          datasetId: "territory-kit-tr",
          version: "1.0.0",
          baseUrl,
          artifactKeyPrefix: "tr/1.0.0"
        })
      ).rejects.toThrow("already exists");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("verifies a generic HTTP/CDN registry and rejects corrupted artifacts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-registry-http-"));
    const artifactRoot = join(tempDir, "artifact");
    const registryOutput = join(tempDir, "registry");

    try {
      await writeFixtureArtifactRoot(artifactRoot, {
        datasetId: "territory-kit-tr",
        version: "1.0.0"
      });
      const server = await startStaticServer(registryOutput);

      try {
        await publishTerritoryDatasetRegistry({
          artifactRoot,
          target: createLocalTerritoryRegistryPublishTarget({ rootDir: registryOutput }),
          datasetId: "territory-kit-tr",
          version: "1.0.0",
          baseUrl: `${server.baseUrl}tr/1.0.0/`,
          artifactKeyPrefix: "tr/1.0.0",
          generatedAt: "2026-01-01T00:00:00.000Z",
          publishedAt: "2026-01-01T00:00:00.000Z"
        });

        await expect(
          verifyTerritoryRegistryPublication({
            registryUrl: `${server.baseUrl}registry.json`,
            datasetId: "territory-kit-tr",
            version: "1.0.0",
            verifyContentType: true,
            verifyEtags: true
          })
        ).resolves.toMatchObject({
          ok: true,
          datasetCount: 1,
          checkedArtifactCount: 3
        });

        await writeFile(join(registryOutput, "tr", "1.0.0", "manifest.json"), "broken\n", "utf8");
        const broken = await verifyTerritoryRegistryPublication({
          registryUrl: `${server.baseUrl}registry.json`,
          datasetId: "territory-kit-tr",
          version: "1.0.0"
        });

        expect(broken.ok).toBe(false);
        expect(broken.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: "ARTIFACT_CHECKSUM_MISMATCH" })])
        );
      } finally {
        await server.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("cleans partial uploads when a publish target fails before registry activation", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-registry-cleanup-"));
    const artifactRoot = join(tempDir, "artifact");
    const target = createFailingMemoryPublishTarget(1);

    try {
      await writeFixtureArtifactRoot(artifactRoot, {
        datasetId: "territory-kit-tr",
        version: "1.0.0"
      });

      await expect(
        publishTerritoryDatasetRegistry({
          artifactRoot,
          target,
          datasetId: "territory-kit-tr",
          version: "1.0.0",
          baseUrl: "https://datasets.example.test/tr/1.0.0/",
          artifactKeyPrefix: "tr/1.0.0",
          generatedAt: "2026-01-01T00:00:00.000Z",
          publishedAt: "2026-01-01T00:00:00.000Z"
        })
      ).rejects.toThrow("Injected upload failure");

      expect(target.keys()).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("maps S3-compatible object storage calls without requiring a cloud service", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-registry-s3-"));
    const artifactRoot = join(tempDir, "artifact");
    const client = createMemoryS3Client();

    try {
      await writeFixtureArtifactRoot(artifactRoot, {
        datasetId: "territory-kit-tr",
        version: "1.0.0"
      });

      await publishTerritoryDatasetRegistry({
        artifactRoot,
        target: createS3CompatibleTerritoryRegistryPublishTarget({
          client,
          bucket: "territory-fixture",
          prefix: "prod"
        }),
        datasetId: "territory-kit-tr",
        version: "1.0.0",
        baseUrl: "https://datasets.example.test/tr/1.0.0/",
        artifactKeyPrefix: "tr/1.0.0",
        generatedAt: "2026-01-01T00:00:00.000Z",
        publishedAt: "2026-01-01T00:00:00.000Z"
      });

      expect(client.puts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            bucket: "territory-fixture",
            key: "prod/tr/1.0.0/manifest.json",
            contentType: "application/json",
            cacheControl: "public, max-age=31536000, immutable",
            ifNoneMatch: "*"
          }),
          expect.objectContaining({
            bucket: "territory-fixture",
            key: "prod/registry.json",
            contentType: "application/json",
            cacheControl: "public, max-age=60"
          })
        ])
      );
      expect(client.keys()).toContain("territory-fixture/prod/tr/1.0.0/registry.json");
      expect(client.keys()).toContain("territory-fixture/prod/registry.json");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function writeFixtureArtifactRoot(
  artifactRoot: string,
  input: { datasetId: string; version: string }
): Promise<void> {
  const dataset = createSampleTerritoryDataset();
  const files = new Map([
    [
      "manifest.json",
      stableJson({
        manifestVersion: "1",
        datasetId: input.datasetId,
        datasetVersion: input.version,
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

function createFailingMemoryPublishTarget(failAfterSuccessfulPuts: number) {
  const objects = new Map<string, Uint8Array>();
  let successfulPuts = 0;
  const target: TerritoryRegistryWritableObjectStore & { keys(): string[] } = {
    kind: "failing-memory",
    async headObject(key) {
      const bytes = objects.get(key);
      return bytes ? { key, sizeBytes: bytes.byteLength, sha256: sha256(bytes) } : undefined;
    },
    async getObject(key) {
      const bytes = objects.get(key);

      if (!bytes) {
        throw new Error(`Missing object ${key}.`);
      }

      return { key, bytes, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
    },
    async putObject(input: TerritoryRegistryObjectPutInput) {
      if (successfulPuts >= failAfterSuccessfulPuts) {
        throw new Error("Injected upload failure.");
      }

      successfulPuts += 1;
      objects.set(input.key, input.bytes);
      return {
        key: input.key,
        sizeBytes: input.bytes.byteLength,
        sha256: sha256(input.bytes),
        ...(input.contentType ? { contentType: input.contentType } : {}),
        ...(input.cacheControl ? { cacheControl: input.cacheControl } : {})
      };
    },
    async deleteObject(key) {
      objects.delete(key);
    },
    keys() {
      return [...objects.keys()].sort();
    }
  };

  return target;
}

function createMemoryS3Client() {
  const objects = new Map<
    string,
    {
      body: Uint8Array;
      metadata: S3CompatibleRegistryObjectMetadata;
    }
  >();
  const puts: S3CompatibleRegistryPutObjectRequest[] = [];
  const client: S3CompatibleRegistryObjectClient & {
    puts: S3CompatibleRegistryPutObjectRequest[];
    keys(): string[];
  } = {
    puts,
    async headObject(input) {
      return objects.get(`${input.bucket}/${input.key}`)?.metadata;
    },
    async getObject(input) {
      const object = objects.get(`${input.bucket}/${input.key}`);

      if (!object) {
        throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      }

      return {
        ...object.metadata,
        body: object.body
      };
    },
    async putObject(input) {
      puts.push(input);
      const key = `${input.bucket}/${input.key}`;

      if (input.ifNoneMatch === "*" && objects.has(key)) {
        throw Object.assign(new Error("PreconditionFailed"), { name: "PreconditionFailed" });
      }

      const metadata = {
        sizeBytes: input.body.byteLength,
        sha256: sha256(input.body),
        etag: `"${sha256(input.body)}"`,
        ...(input.contentType ? { contentType: input.contentType } : {}),
        ...(input.cacheControl ? { cacheControl: input.cacheControl } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {})
      };
      objects.set(key, { body: input.body, metadata });
      return metadata;
    },
    async deleteObject(input) {
      objects.delete(`${input.bucket}/${input.key}`);
    },
    keys() {
      return [...objects.keys()].sort();
    }
  };

  return client;
}

async function startStaticServer(rootDir: string): Promise<{
  baseUrl: string;
  close(): Promise<void>;
}> {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const pathname = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");

      if (!pathname || pathname.split("/").includes("..")) {
        response.writeHead(404);
        response.end();
        return;
      }

      const file = join(rootDir, pathname);
      const bytes = await readFile(file);
      response.setHeader("etag", `"${sha256(bytes)}"`);

      if (pathname.endsWith(".json")) {
        response.setHeader("content-type", "application/json");
      }

      response.writeHead(200);
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to bind fixture HTTP server.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    close() {
      return new Promise((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      });
    }
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
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
