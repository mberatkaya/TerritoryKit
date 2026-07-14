import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTerritoryDataset } from "@territory-kit/dataset";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultTerritorySourceRegistry,
  createSourceCacheKey,
  createTerritorySourceRegistry,
  fetchHttpSourceArtifact,
  listTerritorySourceAdapters,
  resolveFileSourceArtifact,
  runTerritorySourcePipeline,
  sha256Hex
} from "../src/index.js";
import { readCachedSourceArtifact, writeSourceCacheEntry } from "../src/sources/cache.js";
import type {
  GenericGeoJsonSourceOptions,
  GeoBoundariesSourceOptions,
  NaturalEarthSourceOptions
} from "../src/index.js";
import { createNaturalEarthValidFixture } from "./natural-earth-fixtures.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("source adapter registry", () => {
  it("lists built-in adapters deterministically and supports isolated registries", () => {
    expect(listTerritorySourceAdapters().map((adapter) => adapter.id)).toEqual([
      "geoboundaries",
      "geojson",
      "natural-earth"
    ]);

    const registry = createDefaultTerritorySourceRegistry();
    expect(registry.has("natural-earth")).toBe(true);
    expect(registry.get("geojson").describe().displayName).toBe("Generic GeoJSON");
    expect(() => registry.get("unknown")).toThrow("not registered");

    const isolated = createTerritorySourceRegistry([registry.get("geojson")]);
    expect(isolated.list().map((adapter) => adapter.id)).toEqual(["geojson"]);
    expect(() => isolated.register(registry.get("geojson"))).toThrow("already registered");
  });
});

describe("source transports and cache", () => {
  it("resolves local files with SHA-256 and rejects missing or oversized inputs", async () => {
    const tempDir = await createTempDir("territory-source-file-");
    const sourcePath = join(tempDir, "source.geojson");
    await writeFile(sourcePath, "{}", "utf8");

    const artifact = await resolveFileSourceArtifact({
      provider: "geojson",
      request: { input: sourcePath },
      cwd: tempDir,
      maxSourceSizeBytes: 10
    });

    expect(artifact.localPath.endsWith("source.geojson")).toBe(true);
    expect(artifact.sha256).toBe(sha256Hex("{}"));
    await expect(
      resolveFileSourceArtifact({
        provider: "geojson",
        request: { input: join(tempDir, "missing.geojson") },
        cwd: tempDir,
        maxSourceSizeBytes: 10
      })
    ).rejects.toThrow();
    await expect(
      resolveFileSourceArtifact({
        provider: "geojson",
        request: { input: sourcePath },
        cwd: tempDir,
        maxSourceSizeBytes: 1
      })
    ).rejects.toThrow("above");
  });

  it("downloads HTTP sources, follows redirects, records headers, and rejects unsafe protocols", async () => {
    const server = await createFixtureServer();
    const tempDir = await createTempDir("territory-source-http-");

    try {
      const artifact = await fetchHttpSourceArtifact({
        provider: "geojson",
        url: `${server.url}/redirect`,
        destinationDirectory: tempDir,
        maxSourceSizeBytes: 1024,
        now: () => "2026-01-01T00:00:00.000Z"
      });

      expect(await readFile(artifact.localPath, "utf8")).toBe('{"ok":true}');
      expect(artifact.etag).toBe('"fixture"');
      expect(artifact.lastModified).toBe("Wed, 01 Jan 2025 00:00:00 GMT");
      await expect(
        fetchHttpSourceArtifact({
          provider: "geojson",
          url: `${server.url}/missing`,
          destinationDirectory: join(tempDir, "missing"),
          maxSourceSizeBytes: 1024,
          now: () => "2026-01-01T00:00:00.000Z"
        })
      ).rejects.toThrow("HTTP 404");
      await expect(
        fetchHttpSourceArtifact({
          provider: "geojson",
          url: "ftp://example.com/source.geojson",
          destinationDirectory: join(tempDir, "ftp"),
          maxSourceSizeBytes: 1024,
          now: () => "2026-01-01T00:00:00.000Z"
        })
      ).rejects.toThrow("not supported");
      await expect(
        fetchHttpSourceArtifact({
          provider: "geojson",
          url: `${server.url}/large`,
          destinationDirectory: join(tempDir, "large"),
          maxSourceSizeBytes: 4,
          now: () => "2026-01-01T00:00:00.000Z"
        })
      ).rejects.toThrow("above");
    } finally {
      await server.close();
    }
  });

  it("reads cache hits and removes corrupt cache artifacts", async () => {
    const tempDir = await createTempDir("territory-source-cache-");
    const sourcePath = join(tempDir, "source.geojson");
    const cacheDir = join(tempDir, "cache");
    const request = { url: "https://example.test/source.geojson", expectedSha256: sha256Hex("{}") };
    const cacheKey = createSourceCacheKey("geojson", request);
    await writeFile(sourcePath, "{}", "utf8");

    const cached = await writeSourceCacheEntry({
      provider: "geojson",
      cacheDir,
      cacheKey,
      artifact: {
        provider: "geojson",
        localPath: sourcePath,
        originalUrl: request.url,
        sha256: sha256Hex("{}"),
        sizeBytes: 2,
        fetchedAt: "2026-01-01T00:00:00.000Z",
        cacheHit: false
      }
    });
    const hit = await readCachedSourceArtifact({
      provider: "geojson",
      cacheDir,
      cacheKey,
      request
    });

    expect(hit.artifact?.cacheHit).toBe(true);
    await writeFile(cached.localPath, "corrupt", "utf8");

    const corrupt = await readCachedSourceArtifact({
      provider: "geojson",
      cacheDir,
      cacheKey,
      request
    });

    expect(corrupt.artifact).toBeUndefined();
    expect(corrupt.issues.map((issue) => issue.code)).toContain("SOURCE_CACHE_CORRUPT");
  });
});

describe("source pipeline adapters", () => {
  it("builds Natural Earth artifacts through the common pipeline", async () => {
    const tempDir = await createTempDir("territory-ne-pipeline-");
    const inputPath = join(tempDir, "natural-earth.geojson");
    const outputPath = join(tempDir, "world-countries");
    await writeFile(inputPath, JSON.stringify(createNaturalEarthValidFixture()), "utf8");

    const result = await runTerritorySourcePipeline<NaturalEarthSourceOptions>({
      adapter: "natural-earth",
      request: { input: inputPath, expectedSha256: sha256Hex(await readFile(inputPath, "utf8")) },
      options: {
        buildDate: "2026-01-01T00:00:00.000Z",
        sourceVersion: "fixture-1",
        details: ["low", "high"]
      },
      outputPath,
      now: () => "2026-01-01T00:00:00.000Z"
    });

    expect(result.ok).toBe(true);
    expect(result.events.map((event) => event.stage)).toContain("validate");
    await expect(readFile(join(outputPath, "checksums.json"), "utf8")).resolves.toContain(
      "low/dataset.json"
    );
    const dataset = loadTerritoryDataset(
      JSON.parse(await readFile(join(outputPath, "high", "dataset.json"), "utf8")) as unknown
    );
    expect(dataset.zones.map((zone) => zone.id)).toContain("tr");
  });

  it("imports generic GeoJSON with property mapping, parent warnings, and strict warning failures", async () => {
    const tempDir = await createTempDir("territory-geojson-pipeline-");
    const inputPath = join(tempDir, "regions.geojson");
    const outputPath = join(tempDir, "regions");
    await writeFile(inputPath, JSON.stringify(createGenericGeoJsonFixture()), "utf8");

    const options: GenericGeoJsonSourceOptions = {
      countryCode: "TR",
      adminLevel: "ADM2",
      idProperty: "region.code",
      nameProperty: "region.name",
      parentProperty: "region.parent",
      codeProperty: "region.code",
      localType: "district",
      license: "CC BY 4.0",
      attribution: "Synthetic municipality fixture",
      buildDate: "2026-01-01T00:00:00.000Z"
    };
    const result = await runTerritorySourcePipeline<GenericGeoJsonSourceOptions>({
      adapter: "geojson",
      request: { input: inputPath },
      options,
      outputPath,
      now: () => "2026-01-01T00:00:00.000Z"
    });

    expect(result.ok).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toContain("SOURCE_PARENT_MISSING");
    expect(result.transform?.geometryQuality?.dataset).toMatchObject({
      ok: true,
      checks: expect.objectContaining({ bbox: true, siblingOverlaps: false })
    });
    const dataset = loadTerritoryDataset(
      JSON.parse(await readFile(join(outputPath, "dataset.json"), "utf8")) as unknown
    );
    expect(dataset.zones.map((zone) => zone.id)).toEqual(["tr:adm2:kadikoy", "tr:adm2:uskudar"]);
    const buildReport = JSON.parse(
      await readFile(join(outputPath, "build-report.json"), "utf8")
    ) as {
      geometryQuality?: Record<string, unknown>;
    };
    expect(buildReport.geometryQuality?.dataset).toMatchObject({
      ok: true,
      summary: expect.objectContaining({ zoneCount: 2 })
    });

    const fullQuality = await runTerritorySourcePipeline<GenericGeoJsonSourceOptions>({
      adapter: "geojson",
      request: { input: inputPath },
      options,
      outputPath: join(tempDir, "regions-full-quality"),
      geometryQuality: "full",
      now: () => "2026-01-01T00:00:00.000Z"
    });

    expect(fullQuality.ok).toBe(false);
    expect(fullQuality.issues.map((issue) => issue.code)).toContain(
      "GEOMETRY_SIBLING_GEOMETRY_OVERLAP"
    );

    const strict = await runTerritorySourcePipeline<GenericGeoJsonSourceOptions>({
      adapter: "geojson",
      request: { input: inputPath },
      options: {
        countryCode: "TR",
        adminLevel: "ADM2",
        idProperty: "missing",
        nameProperty: "region.name",
        buildDate: "2026-01-01T00:00:00.000Z"
      },
      outputPath: join(tempDir, "strict"),
      strict: true,
      now: () => "2026-01-01T00:00:00.000Z"
    });

    expect(strict.ok).toBe(false);
    expect(strict.issues.map((issue) => issue.code)).toContain("STRICT_SOURCE_ID_FALLBACK");
  });

  it("imports geoBoundaries fixtures with release type and deterministic ids", async () => {
    const tempDir = await createTempDir("territory-gb-pipeline-");
    const inputPath = join(tempDir, "geoBoundaries-TUR-ADM1.geojson");
    const outputPath = join(tempDir, "tr-adm1");
    await writeFile(inputPath, JSON.stringify(createGeoBoundariesFixture()), "utf8");

    const result = await runTerritorySourcePipeline<GeoBoundariesSourceOptions>({
      adapter: "geoboundaries",
      request: { input: inputPath },
      options: {
        countryCode: "TR",
        adminLevel: "ADM1",
        releaseType: "gbOpen",
        sourceDate: "fixture-1",
        buildDate: "2026-01-01T00:00:00.000Z"
      },
      outputPath,
      now: () => "2026-01-01T00:00:00.000Z"
    });

    expect(result.ok).toBe(true);
    const dataset = loadTerritoryDataset(
      JSON.parse(await readFile(join(outputPath, "dataset.json"), "utf8")) as unknown
    );
    expect(dataset.manifest.license).toBe("CC BY 4.0");
    expect(dataset.zones.map((zone) => zone.id)).toEqual([
      "tr:adm1:tur-adm1-1-40264422",
      "tr:adm1:tur-adm1-2-fd15314d"
    ]);
  });
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createGenericGeoJsonFixture(): unknown {
  return {
    type: "FeatureCollection",
    features: [
      genericFeature("b", "USKUDAR", "Uskudar", "IST"),
      genericFeature("a", "KADIKOY", "Kadikoy", "IST")
    ]
  };
}

function genericFeature(id: string, code: string, name: string, parent: string): unknown {
  return {
    type: "Feature",
    id,
    properties: {
      region: { code, name, parent }
    },
    geometry: square(29, 40)
  };
}

function createGeoBoundariesFixture(): unknown {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "gb-2",
        properties: {
          shapeID: "TUR-ADM1-2",
          shapeName: "Ankara",
          shapeGroup: "TR",
          shapeType: "ADM1"
        },
        geometry: square(32, 39)
      },
      {
        type: "Feature",
        id: "gb-1",
        properties: {
          shapeID: "TUR-ADM1-1",
          shapeName: "Istanbul",
          shapeGroup: "TR",
          shapeType: "ADM1"
        },
        geometry: square(28, 40)
      }
    ]
  };
}

function square(west: number, south: number): unknown {
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [west + 1, south],
        [west + 1, south + 1],
        [west, south + 1],
        [west, south]
      ]
    ]
  };
}

async function createFixtureServer(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/ok" });
      response.end();
      return;
    }

    if (request.url === "/ok") {
      response.writeHead(200, {
        "content-type": "application/json",
        etag: '"fixture"',
        "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT"
      });
      response.end('{"ok":true}');
      return;
    }

    if (request.url === "/large") {
      response.writeHead(200, {
        "content-length": "100"
      });
      response.end("too large");
      return;
    }

    response.writeHead(404);
    response.end("missing");
  });

  await new Promise<void>((resolveServer) => {
    server.listen(0, "127.0.0.1", resolveServer);
  });
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
          } else {
            resolveClose();
          }
        });
      })
  };
}
