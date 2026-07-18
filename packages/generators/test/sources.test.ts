import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTerritoryDataset } from "@territory-kit/dataset";
import { afterEach, describe, expect, it } from "vitest";
import {
  TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS,
  buildTurkeyGaziantepAdm3Pilot,
  createDefaultTerritorySourceRegistry,
  createSourceCacheKey,
  createTurkeyGaziantepAdm3TerritoryId,
  createTerritorySourceRegistry,
  fetchHttpSourceArtifact,
  inspectTerritorySourceCapabilities,
  listTerritorySourceAdapters,
  parseTurkeyGaziantepAdm3Kml,
  resolveFileSourceArtifact,
  runTerritorySourcePipeline,
  sha256Hex,
  validateTurkeyGaziantepAdm3SourceManifest,
  validateOfficialOpenDataSourceManifest
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
    expect(registry.get("geoboundaries").describe().supportedAdminLevels).toContain("ADM5");
    expect(() => registry.get("unknown")).toThrow("not registered");

    const isolated = createTerritorySourceRegistry([registry.get("geojson")]);
    expect(isolated.list().map((adapter) => adapter.id)).toEqual(["geojson"]);
    expect(() => isolated.register(registry.get("geojson"))).toThrow("already registered");
  });

  it("inspects provider level capabilities and validates strict open-data manifests", () => {
    const registry = createDefaultTerritorySourceRegistry();
    const unavailable = inspectTerritorySourceCapabilities({
      registry,
      provider: "geoboundaries",
      country: "TR",
      level: "ADM3"
    });

    expect(unavailable.levels.ADM3).toMatchObject({
      supported: true,
      available: false,
      status: "source-unavailable"
    });

    const validManifest = validateOfficialOpenDataSourceManifest(
      {
        manifestVersion: "territory-source-manifest@1",
        provider: "official-open-data",
        countryCode: "TR",
        adminLevel: "ADM3",
        sourceUrl: "https://data.example.test/tr-adm3.geojson",
        sourceDate: "2026-01-01",
        license: "CC BY 4.0",
        attribution: "Synthetic official-open-data fixture",
        redistributionStatus: "allowed",
        commercialUseStatus: "allowed",
        expectedSha256: "0".repeat(64),
        sourceVersion: "fixture-1"
      },
      { strict: true }
    );

    expect(validManifest.ok).toBe(true);
    expect(
      inspectTerritorySourceCapabilities({
        registry,
        provider: "geojson",
        country: "TR",
        level: "ADM3",
        manifest: validManifest.manifest,
        strictManifest: true
      }).levels.ADM3
    ).toMatchObject({
      available: true,
      status: "available",
      provider: "official-open-data",
      license: "CC BY 4.0"
    });

    expect(
      validateOfficialOpenDataSourceManifest(
        {
          provider: "official-open-data",
          countryCode: "TR",
          adminLevel: "ADM3",
          sourceUrl: "https://data.example.test/tr-adm3.geojson",
          sourceDate: "2026-01-01",
          license: "unknown",
          attribution: "Fixture",
          redistributionStatus: "unknown"
        },
        { strict: true }
      )
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "SOURCE_MANIFEST_LICENSE_RESTRICTED" }),
        expect.objectContaining({ code: "SOURCE_MANIFEST_REDISTRIBUTION_RESTRICTED" }),
        expect.objectContaining({ code: "SOURCE_MANIFEST_COMMERCIAL_USE_RESTRICTED" }),
        expect.objectContaining({ code: "SOURCE_MANIFEST_CHECKSUM_MISSING" })
      ])
    });
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

describe("Turkey Gaziantep ADM3 pilot source", () => {
  it("parses KML properties and keeps same-name neighbourhood ids source-code stable", () => {
    const features = parseTurkeyGaziantepAdm3Kml(createGaziantepKmlFixture());

    expect(features).toMatchObject([
      {
        neighbourhoodName: "İSTİKLAL",
        neighbourhoodCode: "100001",
        sourceDistrictId: "{CCECD7A9-7F9F-421B-9DDC-33920592CE42}"
      },
      {
        neighbourhoodName: "İSTİKLAL",
        neighbourhoodCode: "100002",
        sourceDistrictId: "{8F014A2B-53F9-4823-9FAE-E51D55B81A67}"
      }
    ]);
    expect(
      createTurkeyGaziantepAdm3TerritoryId({
        neighbourhoodCode: "100001",
        parentId: "tr:adm2:54988432b26387222249237"
      })
    ).toBe("tr:adm3:27:54988432b26387222249237:100001");
  });

  it("validates the strict official manifest and builds from network-free fixtures", async () => {
    const tempDir = await createTempDir("territory-tr-adm3-");
    const sourcePath = join(tempDir, "gaziantep.kml");
    const outputPath = join(tempDir, "out");
    const adm0Path = join(tempDir, "adm0.json");
    const adm1Path = join(tempDir, "adm1.json");
    const adm2Path = join(tempDir, "adm2.json");
    await writeFile(sourcePath, createGaziantepKmlFixture(), "utf8");
    await writeFile(adm0Path, JSON.stringify(hierarchyDataset("ADM0")), "utf8");
    await writeFile(adm1Path, JSON.stringify(hierarchyDataset("ADM1")), "utf8");
    await writeFile(adm2Path, JSON.stringify(hierarchyDataset("ADM2")), "utf8");

    expect(validateTurkeyGaziantepAdm3SourceManifest()).toMatchObject({ ok: true });

    const result = await buildTurkeyGaziantepAdm3Pilot({
      sourcePath,
      outputPath,
      adm0DatasetPath: adm0Path,
      adm1DatasetPath: adm1Path,
      adm2DatasetPath: adm2Path,
      approveUnexpectedSource: true
    });

    expect(result.ok).toBe(true);
    expect(result.featureCount).toBe(2);
    expect(result.coveredParentIds).toHaveLength(9);
    const dataset = loadTerritoryDataset(
      JSON.parse(await readFile(join(outputPath, "dataset.json"), "utf8")) as unknown
    );
    const adm3 = dataset.zones.filter((zone) => zone.sourceAdminLevel === "ADM3");

    expect(adm3.map((zone) => zone.id)).toEqual([
      "tr:adm3:27:54988432b26387222249237:100001",
      "tr:adm3:27:54988432b61004264745956:100002"
    ]);
    expect(adm3.map((zone) => zone.name)).toEqual(["İSTİKLAL", "İSTİKLAL"]);
    expect(adm3.map((zone) => zone.parentId)).toEqual([
      "tr:adm2:54988432b26387222249237",
      "tr:adm2:54988432b61004264745956"
    ]);
    await expect(readFile(join(outputPath, "coverage.json"), "utf8")).resolves.toContain(
      '"status": "partial"'
    );
    const renderManifest = JSON.parse(
      await readFile(join(outputPath, "render", "manifest.json"), "utf8")
    ) as { layers: Array<{ adminLevels: string[]; minZoom: number; maxZoom: number }> };
    const adm3Layer = renderManifest.layers.find((layer) => layer.adminLevels.includes("ADM3"));

    expect(adm3Layer).toMatchObject({ minZoom: 12, maxZoom: 12 });
    await expect(readFile(join(outputPath, "medium.geojson"), "utf8")).rejects.toThrow();
    await expect(readFile(join(outputPath, "low.geojson"), "utf8")).rejects.toThrow();
    await expect(
      readFile(join(outputPath, "simplification-report.json"), "utf8")
    ).resolves.toContain('"emitted": false');
    await expect(
      readFile(join(outputPath, "artifact-size-report.json"), "utf8")
    ).resolves.toContain("territorykit-artifact-size-report@1");
    await expect(
      readFile(join(outputPath, "production-quality-report.json"), "utf8")
    ).resolves.toContain('"checkStatuses"');
    await expect(readFile(join(outputPath, "overlap-audit.json"), "utf8")).resolves.toContain(
      "territorykit-overlap-audit@1"
    );
  }, 20_000);

  it("rejects duplicate official neighbourhood codes", async () => {
    const tempDir = await createTempDir("territory-tr-adm3-duplicate-");
    const sourcePath = join(tempDir, "gaziantep.kml");
    const adm0Path = join(tempDir, "adm0.json");
    const adm1Path = join(tempDir, "adm1.json");
    const adm2Path = join(tempDir, "adm2.json");
    await writeFile(sourcePath, createGaziantepKmlFixture({ duplicateCode: true }), "utf8");
    await writeFile(adm0Path, JSON.stringify(hierarchyDataset("ADM0")), "utf8");
    await writeFile(adm1Path, JSON.stringify(hierarchyDataset("ADM1")), "utf8");
    await writeFile(adm2Path, JSON.stringify(hierarchyDataset("ADM2")), "utf8");

    await expect(
      buildTurkeyGaziantepAdm3Pilot({
        sourcePath,
        outputPath: join(tempDir, "out"),
        adm0DatasetPath: adm0Path,
        adm1DatasetPath: adm1Path,
        adm2DatasetPath: adm2Path,
        approveUnexpectedSource: true
      })
    ).rejects.toThrow("Duplicate Gaziantep ADM3 KIMLIKNO");
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

function createGaziantepKmlFixture(options: { duplicateCode?: boolean } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    ${placemark("ID_00001", "İSTİKLAL", "100001", "{CCECD7A9-7F9F-421B-9DDC-33920592CE42}", 37, 37)}
    ${placemark(
      "ID_00002",
      "İSTİKLAL",
      options.duplicateCode ? "100001" : "100002",
      "{8F014A2B-53F9-4823-9FAE-E51D55B81A67}",
      38,
      37
    )}
  </Document>
</kml>`;
}

function placemark(
  id: string,
  name: string,
  code: string,
  districtId: string,
  west: number,
  south: number
): string {
  return `<Placemark id="${id}">
  <description><![CDATA[
    <table>
      <tr><td>FID</td><td>${id}</td></tr>
      <tr><td>AD</td><td>${name}</td></tr>
      <tr><td>KIMLIKNO</td><td>${code}</td></tr>
      <tr><td>ILCEID</td><td>${districtId}</td></tr>
    </table>
  ]]></description>
  <MultiGeometry>
    <Polygon>
      <outerBoundaryIs><LinearRing><coordinates>
        ${west},${south},0 ${west + 1},${south},0 ${west + 1},${south + 1},0 ${west},${south + 1},0 ${west},${south},0
      </coordinates></LinearRing></outerBoundaryIs>
    </Polygon>
  </MultiGeometry>
</Placemark>`;
}

function hierarchyDataset(level: "ADM0" | "ADM1" | "ADM2"): unknown {
  const zones =
    level === "ADM0"
      ? [hierarchyZone("tr", 0, "Turkey")]
      : level === "ADM1"
        ? [hierarchyZone("tr:adm1:tr-27", 1, "Gaziantep")]
        : TURKEY_GAZIANTEP_ADM3_PARENT_MAPPINGS.map((mapping, index) =>
            hierarchyZone(mapping.territoryAdm2Id, 2, mapping.districtName, index)
          );

  return {
    manifest: {
      datasetId: `fixture-${level.toLowerCase()}`,
      datasetVersion: "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "fixture",
      geometryHash: "fixture"
    },
    zones
  };
}

function hierarchyZone(
  id: string,
  level: number,
  name: string,
  offset = 0
): Record<string, unknown> {
  return {
    id,
    datasetId: "hierarchy-fixture",
    level,
    sourceAdminLevel: `ADM${level}`,
    semanticType: level === 0 ? "country" : level === 1 ? "province" : "district",
    name,
    neighborIds: [],
    geometry: square(offset, offset),
    center: [offset + 0.5, offset + 0.5],
    bbox: [offset, offset, offset + 1, offset + 1],
    properties: {
      name,
      territory: {
        adminLevel: `ADM${level}`,
        semanticType: level === 0 ? "country" : level === 1 ? "province" : "district"
      }
    }
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
