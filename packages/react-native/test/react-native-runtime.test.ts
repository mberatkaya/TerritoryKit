import { describe, expect, it } from "vitest";
import { encodeTerritoryBinarySpatialIndex } from "@territory-kit/core";
import type { TerritoryAdminLevel, TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import type {
  TerritoryDatasetRegistry,
  TerritoryRegistryArtifact,
  TerritoryRegistryDataset
} from "@territory-kit/registry";
import {
  createMobileMemoryCache,
  createMobileTerritoryRuntime,
  jsonToBytes,
  joinMobilePath,
  normalizeMobilePath,
  sha256Hex
} from "../src/index.js";
import {
  createTerritoryMapLibreNativeMvtBundle,
  createTerritoryMapLibreNativeRendererAdapter
} from "../src/maplibre.js";
import type {
  MobileTerritoryFetchAdapter,
  MobileTerritoryFetchRequest,
  MobileTerritoryFetchResponse,
  MobileTerritoryStorageAdapter,
  MobileTerritoryStorageStat
} from "../src/index.js";

describe("@territory-kit/react-native runtime", () => {
  it("installs query and binary index artifacts, then queries offline after startup", async () => {
    const fixture = await createRegistryFixture(["1.0.0"]);
    const storage = new FakeMobileStorage();
    const runtime = createMobileTerritoryRuntime({
      registryUrl: fixture.registryUrl,
      storageAdapter: storage,
      fetchAdapter: new FakeFetch(fixture.responses),
      cachePolicy: { memoryMaxEntries: 4 }
    });

    await runtime.installDataset({
      datasetId: "territory-kit-test",
      version: "1.0.0",
      levels: ["ADM1"]
    });

    const installed = await runtime.loadInstalledDataset({ datasetId: "territory-kit-test" });
    expect(installed.engines[0]?.getSpatialIndexSummary()).toMatchObject({
      source: "binary-flatbush",
      zoneCount: 2
    });

    const restarted = createMobileTerritoryRuntime({
      registryUrl: fixture.registryUrl,
      storageAdapter: storage,
      offline: true
    });
    const result = await restarted.queryViewport({
      datasetId: "territory-kit-test",
      viewport: {
        bounds: { west: 0, south: 0, east: 6, north: 6 },
        zoom: 6
      }
    });

    expect(result.zones.map((zone) => zone.id)).toEqual(["test:adm1:a"]);
  });

  it("falls back to registry snapshot when the network is unavailable", async () => {
    const fixture = await createRegistryFixture(["1.0.0"]);
    const storage = new FakeMobileStorage();
    const online = createMobileTerritoryRuntime({
      registryUrl: fixture.registryUrl,
      storageAdapter: storage,
      fetchAdapter: new FakeFetch(fixture.responses)
    });
    await online.installDataset({ datasetId: "territory-kit-test", version: "1.0.0" });
    const events: string[] = [];
    const offlineFetch = new FakeFetch(fixture.responses);
    offlineFetch.failAll = true;
    const fallback = createMobileTerritoryRuntime({
      registryUrl: fixture.registryUrl,
      storageAdapter: storage,
      fetchAdapter: offlineFetch
    });
    fallback.subscribe((event) => events.push(event.type));

    await fallback.installDataset({ datasetId: "territory-kit-test", version: "1.0.0" });

    expect(events).toContain("network-fallback");
  });

  it("keeps the active dataset intact after interrupted downloads and checksum mismatch", async () => {
    const fixture = await createRegistryFixture(["1.0.0", "1.1.0"]);
    const storage = new FakeMobileStorage();
    const runtime = createMobileTerritoryRuntime({
      registryUrl: fixture.registryUrl,
      storageAdapter: storage,
      fetchAdapter: new FakeFetch(fixture.responses)
    });
    await runtime.installDataset({ datasetId: "territory-kit-test", version: "1.0.0" });

    const interruptedFetch = new FakeFetch(fixture.responses);
    interruptedFetch.failForUrl = "https://datasets.example/test/1.1.0/adm1.json";
    const interrupted = createMobileTerritoryRuntime({
      registryUrl: fixture.registryUrl,
      storageAdapter: storage,
      fetchAdapter: interruptedFetch
    });

    await expect(
      interrupted.installDataset({ datasetId: "territory-kit-test", version: "1.1.0" })
    ).rejects.toThrow();
    expect(await interrupted.cleanupPartialDownloads()).toBe(0);
    expect((await interrupted.listInstalledDatasets())[0]?.version).toBe("1.0.0");

    const badFixture = await createRegistryFixture(["1.1.0"], { corruptChecksum: true });
    const mismatch = createMobileTerritoryRuntime({
      registryUrl: badFixture.registryUrl,
      registry: badFixture.registry,
      storageAdapter: storage,
      fetchAdapter: new FakeFetch(badFixture.responses)
    });

    await expect(
      mismatch.installDataset({ datasetId: "territory-kit-test", version: "1.1.0" })
    ).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
    expect((await mismatch.listInstalledDatasets())[0]?.version).toBe("1.0.0");
  });

  it("upgrades a pinned version and rolls back through the active pointer", async () => {
    const fixture = await createRegistryFixture(["1.0.0", "1.1.0"]);
    const runtime = createMobileTerritoryRuntime({
      registryUrl: fixture.registryUrl,
      storageAdapter: new FakeMobileStorage(),
      fetchAdapter: new FakeFetch(fixture.responses)
    });

    await runtime.installDataset({ datasetId: "territory-kit-test", version: "1.0.0" });
    await runtime.installDataset({ datasetId: "territory-kit-test", version: "1.1.0" });
    expect((await runtime.listInstalledDatasets())[0]?.version).toBe("1.1.0");

    const rollback = await runtime.rollbackDataset({ datasetId: "territory-kit-test" });

    expect(rollback.version).toBe("1.0.0");
    expect(rollback.previous?.version).toBe("1.1.0");
  });

  it("cleans partial artifacts and cancels active requests", async () => {
    const fixture = await createRegistryFixture(["1.0.0"]);
    const storage = new FakeMobileStorage();
    await storage.writeFile(
      joinMobilePath(storage.rootDirectory, [".partial", "stale", "artifact"]),
      new Uint8Array([1])
    );
    const runtime = createMobileTerritoryRuntime({
      registryUrl: fixture.registryUrl,
      storageAdapter: storage,
      fetchAdapter: new FakeFetch(fixture.responses)
    });

    expect(await runtime.cleanupPartialDownloads()).toBe(1);

    const blockingFetch = new FakeFetch(fixture.responses);
    blockingFetch.blockForUrl = "https://datasets.example/test/1.0.0/adm1.json";
    const blockingRuntime = createMobileTerritoryRuntime({
      registryUrl: fixture.registryUrl,
      storageAdapter: storage,
      fetchAdapter: blockingFetch
    });
    const install = blockingRuntime.installDataset({
      datasetId: "territory-kit-test",
      version: "1.0.0",
      force: true
    });

    await blockingFetch.waitUntilBlocked();
    expect(blockingRuntime.cancelActiveRequests("test")).toBe(1);
    await expect(install).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
  });

  it("evicts memory cache entries on capacity, background, and low-memory events", async () => {
    const cache = createMobileMemoryCache<string>({
      maxEntries: 1,
      estimateBytes: (value) => value.length
    });
    cache.set("a", "aaa");
    cache.set("b", "bbb");
    expect(cache.getSummary()).toMatchObject({ entries: 1, evictions: 1 });

    const fixture = await createRegistryFixture(["1.0.0"]);
    const runtime = createMobileTerritoryRuntime({
      registryUrl: fixture.registryUrl,
      storageAdapter: new FakeMobileStorage(),
      fetchAdapter: new FakeFetch(fixture.responses),
      cachePolicy: {
        memoryMaxEntries: 4,
        backgroundMemoryMaxBytes: 0,
        lowMemoryMaxBytes: 0
      }
    });
    await runtime.installDataset({ datasetId: "territory-kit-test", version: "1.0.0" });
    await runtime.queryViewport({
      datasetId: "territory-kit-test",
      viewport: { bounds: { west: 0, south: 0, east: 6, north: 6 }, zoom: 6 }
    });
    expect(runtime.getState().memoryCache.entries).toBe(1);

    runtime.setAppState("background");
    expect(runtime.getState().memoryCache.entries).toBe(0);
    runtime.setAppState("active");
    await runtime.queryViewport({
      datasetId: "territory-kit-test",
      viewport: { bounds: { west: 0, south: 0, east: 6, north: 6 }, zoom: 6 }
    });
    runtime.handleLowMemory();
    expect(runtime.getState().memoryCache.entries).toBe(0);
  });

  it("normalizes Android and iOS paths without leaking platform separators", () => {
    expect(
      joinMobilePath("file:///data/user/0/com.example/files", ["datasets", "territory-kit-test"])
    ).toBe("file:///data/user/0/com.example/files/datasets/territory-kit-test");
    expect(
      joinMobilePath("file:///var/mobile/Containers/Data/Application/app/Documents", [
        "datasets",
        "territory-kit-test"
      ])
    ).toBe(
      "file:///var/mobile/Containers/Data/Application/app/Documents/datasets/territory-kit-test"
    );
    expect(() => normalizeMobilePath("file:///tmp/../bad")).toThrow();
  });

  it("creates MapLibre Native MVT props and disposes renderer state", () => {
    const bundle = createTerritoryMapLibreNativeMvtBundle({
      tileUrlTemplate: "https://tiles.example/{z}/{x}/{y}.mvt"
    });
    expect(bundle.source.tiles).toEqual(["https://tiles.example/{z}/{x}/{y}.mvt"]);
    expect(bundle.fillLayers.map((layer) => layer.id)).toEqual([
      "territory-kit-adm1-fill",
      "territory-kit-adm2-fill"
    ]);

    const adapter = createTerritoryMapLibreNativeRendererAdapter();
    expect(
      adapter.handlePress({
        nativeEvent: {
          payload: { features: [{ properties: { territoryId: "test:adm1:a" } }] }
        }
      })?.territoryId
    ).toBe("test:adm1:a");
    expect(adapter.selectedTerritoryId).toBe("test:adm1:a");
    adapter.dispose();
    expect(adapter.disposed).toBe(true);
    expect(() => adapter.setSelectedTerritoryId("x")).toThrow();
  });
});

class FakeMobileStorage implements MobileTerritoryStorageAdapter {
  readonly rootDirectory = "file:///app/Documents/territory-kit";
  readonly platform = "ios";
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>([normalizeMobilePath(this.rootDirectory)]);

  async readFile(path: string): Promise<Uint8Array | undefined> {
    return this.files.get(normalizeMobilePath(path))?.slice();
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const normalized = normalizeMobilePath(path);
    this.directories.add(parentPath(normalized));
    this.files.set(normalized, bytes.slice());
  }

  async makeDirectory(path: string): Promise<void> {
    const normalized = normalizeMobilePath(path);
    const parts = normalized.split("/");
    let current = parts[0] ?? "";

    for (const part of parts.slice(1)) {
      current = `${current}/${part}`;
      this.directories.add(current);
    }

    this.directories.add(normalized);
  }

  async moveFile(fromPath: string, toPath: string): Promise<void> {
    const from = normalizeMobilePath(fromPath);
    const to = normalizeMobilePath(toPath);
    const direct = this.files.get(from);

    if (direct) {
      this.files.delete(from);
      this.files.set(to, direct);
      return;
    }

    for (const [path, bytes] of [...this.files.entries()]) {
      if (path === from || path.startsWith(`${from}/`)) {
        this.files.delete(path);
        this.files.set(`${to}${path.slice(from.length)}`, bytes);
      }
    }

    for (const path of [...this.directories]) {
      if (path === from || path.startsWith(`${from}/`)) {
        this.directories.delete(path);
        this.directories.add(`${to}${path.slice(from.length)}`);
      }
    }
  }

  async deleteFile(path: string, options: { readonly recursive?: boolean } = {}): Promise<void> {
    const normalized = normalizeMobilePath(path);
    this.files.delete(normalized);

    if (options.recursive) {
      for (const key of [...this.files.keys()]) {
        if (key.startsWith(`${normalized}/`)) {
          this.files.delete(key);
        }
      }

      for (const key of [...this.directories]) {
        if (key === normalized || key.startsWith(`${normalized}/`)) {
          this.directories.delete(key);
        }
      }
    }
  }

  async listDirectory(path: string): Promise<readonly string[]> {
    const normalized = normalizeMobilePath(path);
    const entries = new Set<string>();

    for (const file of this.files.keys()) {
      collectDirectoryEntry(normalized, file, entries);
    }

    for (const directory of this.directories) {
      collectDirectoryEntry(normalized, directory, entries);
    }

    return [...entries].sort();
  }

  async stat(path: string): Promise<MobileTerritoryStorageStat> {
    const normalized = normalizeMobilePath(path);

    if (this.files.has(normalized)) {
      const sizeBytes = this.files.get(normalized)!.byteLength;
      return {
        exists: true,
        isDirectory: false,
        sizeBytes
      };
    }

    return {
      exists: this.directories.has(normalized),
      isDirectory: this.directories.has(normalized)
    };
  }
}

class FakeFetch implements MobileTerritoryFetchAdapter {
  failAll = false;
  failForUrl: string | undefined;
  blockForUrl: string | undefined;
  private blockedResolver: (() => void) | undefined;
  private readonly blocked = new Promise<void>((resolve) => {
    this.blockedResolver = resolve;
  });

  constructor(readonly responses: ReadonlyMap<string, Uint8Array>) {}

  async fetch(request: MobileTerritoryFetchRequest): Promise<MobileTerritoryFetchResponse> {
    if (this.failAll || this.failForUrl === request.url) {
      throw new Error(`Network unavailable for ${request.url}`);
    }

    if (this.blockForUrl === request.url) {
      this.blockedResolver?.();
      await new Promise<never>((_, reject) => {
        const listener = () => reject(Object.assign(new Error("aborted"), { code: "aborted" }));
        request.signal?.addEventListener("abort", listener, { once: true });
      });
    }

    if (request.signal?.aborted) {
      throw new Error("aborted");
    }

    const bytes = this.responses.get(request.url);

    if (!bytes) {
      throw new Error(`Missing fake response for ${request.url}`);
    }

    return {
      bytes: bytes.slice(),
      url: request.url,
      sizeBytes: bytes.byteLength,
      contentType: request.url.endsWith(".json") ? "application/json" : "application/octet-stream"
    };
  }

  waitUntilBlocked(): Promise<void> {
    return this.blocked;
  }
}

async function createRegistryFixture(
  versions: readonly string[],
  options: { readonly corruptChecksum?: boolean } = {}
): Promise<{
  readonly registryUrl: string;
  readonly registry: TerritoryDatasetRegistry;
  readonly responses: ReadonlyMap<string, Uint8Array>;
}> {
  const responses = new Map<string, Uint8Array>();
  const datasets: TerritoryRegistryDataset[] = [];

  for (const version of versions) {
    const dataset = createDataset(version);
    const datasetBytes = jsonBytes(dataset);
    const indexBytes = new Uint8Array(encodeTerritoryBinarySpatialIndex(dataset));
    const queryUrl = `https://datasets.example/test/${version}/adm1.json`;
    const indexUrl = `https://datasets.example/test/${version}/adm1.tksi`;
    responses.set(queryUrl, datasetBytes);
    responses.set(indexUrl, indexBytes);
    datasets.push({
      id: "territory-kit-test",
      displayName: "TerritoryKit Test",
      version,
      schemaVersion: "territory-schema@1",
      country: { alpha2: "TT", alpha3: "TST", name: "Testland" },
      levels: ["ADM1"],
      source: { provider: "fixture", version: "2026-01-01" },
      license: { id: "CC0-1.0", attribution: "fixture" },
      artifacts: [
        await createArtifact({
          id: `query-adm1-${version}`,
          purpose: "query",
          format: "territory-json",
          levels: ["ADM1"],
          url: queryUrl,
          bytes: datasetBytes,
          ...(options.corruptChecksum !== undefined
            ? { corruptChecksum: options.corruptChecksum }
            : {})
        }),
        await createArtifact({
          id: `index-adm1-${version}`,
          purpose: "index",
          format: "tksi",
          levels: ["ADM1"],
          url: indexUrl,
          bytes: indexBytes
        })
      ]
    });
  }

  const registry: TerritoryDatasetRegistry = {
    registryVersion: "1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    baseUrl: "https://datasets.example/",
    datasets
  };
  const registryUrl = "https://datasets.example/registry.json";
  responses.set(registryUrl, jsonBytes(registry));
  return { registryUrl, registry, responses };
}

async function createArtifact(input: {
  readonly id: string;
  readonly purpose: TerritoryRegistryArtifact["purpose"];
  readonly format: TerritoryRegistryArtifact["format"];
  readonly levels: readonly TerritoryAdminLevel[];
  readonly url: string;
  readonly bytes: Uint8Array;
  readonly corruptChecksum?: boolean;
}): Promise<TerritoryRegistryArtifact> {
  return {
    id: input.id,
    purpose: input.purpose,
    format: input.format,
    levels: input.levels,
    url: input.url,
    sha256: input.corruptChecksum ? "0".repeat(64) : sha256Hex(input.bytes),
    sizeBytes: input.bytes.byteLength,
    compression: "none",
    contentType: input.format === "tksi" ? "application/octet-stream" : "application/json"
  };
}

function createDataset(version: string): TerritoryDataset {
  return {
    manifest: {
      datasetId: "territory-kit-test",
      datasetVersion: version,
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-01-01",
      geometryHash: `geometry-${version}`,
      adminLevels: ["ADM1"]
    },
    zones: [
      createZone({ id: "test:adm1:a", bbox: [0, 0, 5, 5] }),
      createZone({ id: "test:adm1:b", bbox: [10, 10, 15, 15] })
    ]
  };
}

function createZone(input: {
  readonly id: string;
  readonly bbox: [number, number, number, number];
}): TerritoryZone {
  const [west, south, east, north] = input.bbox;

  return {
    id: input.id,
    datasetId: "territory-kit-test",
    countryCode: "TT",
    level: 1,
    sourceAdminLevel: "ADM1",
    semanticType: "province",
    name: input.id,
    neighborIds: [],
    bbox: input.bbox,
    center: [(west + east) / 2, (south + north) / 2],
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
    properties: { territory: { adminLevel: "ADM1" } }
  };
}

function jsonBytes(input: unknown): Uint8Array {
  return jsonToBytes(input);
}

function parentPath(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function collectDirectoryEntry(root: string, path: string, entries: Set<string>): void {
  if (path === root || !path.startsWith(`${root}/`)) {
    return;
  }

  const entry = path.slice(root.length + 1).split("/")[0];

  if (entry) {
    entries.add(entry);
  }
}
