import { defineTerritoryAdapterCapabilities } from "@territory-kit/adapter-core";
import type { TerritoryRenderSource, TerritoryRendererAdapter } from "@territory-kit/adapter-core";
import { createTerritoryEngine, encodeTerritoryBinarySpatialIndex } from "@territory-kit/core";
import type { TerritoryEngine, TerritoryEngineOptions } from "@territory-kit/core";
import { createSquareZone } from "@territory-kit/shared-testkit";
import { TerritoryError } from "@territory-kit/dataset";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  createTerritoryCatalog,
  createTerritoryEnginePool,
  createTerritoryRuntime,
  createTerritoryWorkerClient,
  datasetEnginePoolKey,
  isTerritoryCatalog
} from "../src/index.js";
import type {
  TerritoryWorkerMessage,
  TerritoryWorkerResponse,
  TerritoryWorkerTransport
} from "../src/index.js";

describe("Territory runtime catalog integration", () => {
  it("resolves catalog exact matches, fallback levels, missing coverage, and priorities", () => {
    const lowPriority = createDataset({
      datasetId: "tr-low",
      country: "TR",
      west: 28,
      east: 30,
      priority: 1
    });
    const highPriority = createDataset({
      datasetId: "tr-high",
      country: "TR",
      west: 28,
      east: 30,
      priority: 10
    });
    const fallback = createDataset({
      datasetId: "tr-adm1",
      country: "TR",
      west: 31,
      east: 32,
      level: 1
    });
    const catalog = createTerritoryCatalog([
      { dataset: lowPriority, country: "tr", level: 0, priority: 1 },
      { dataset: highPriority, country: "tr", level: 0, priority: 10 },
      { dataset: fallback, country: "tr", level: 1, fallbackLevel: 1 }
    ]);

    const exactPlan = catalog.resolveViewport({
      bounds: { west: 28.2, south: 0, east: 28.8, north: 1 },
      level: 0
    });
    const fallbackPlan = catalog.resolveViewport({
      bounds: { west: 31.2, south: 0, east: 31.8, north: 1 },
      level: 3
    });
    const missingPlan = catalog.resolveViewport({
      bounds: { west: 40, south: 0, east: 41, north: 1 },
      level: 0
    });

    expect(exactPlan.selectedArtifacts.map((artifact) => artifact.datasetId)).toEqual(["tr-high"]);
    expect(exactPlan.priorityDecisions).toEqual([
      expect.objectContaining({
        selectedEntryId: expect.stringContaining("tr-high"),
        excludedEntryId: expect.stringContaining("tr-low"),
        reason: "lower-priority"
      })
    ]);
    expect(fallbackPlan.fallbackMatches.map((match) => match.level)).toEqual([1]);
    expect(missingPlan.selectedArtifacts).toEqual([]);
    expect(missingPlan.unavailableCoverage).toEqual([
      expect.objectContaining({ reason: "no-coverage" })
    ]);
  });

  it("supports multi-country viewport plans and territory lookup", () => {
    const catalog = createTerritoryCatalog([
      {
        dataset: createDataset({ datasetId: "country-a", country: "AA", west: 0, east: 1 }),
        country: "AA",
        level: 0
      },
      {
        dataset: createDataset({ datasetId: "country-b", country: "BB", west: 1, east: 2 }),
        country: "BB",
        level: 0
      }
    ]);

    const plan = catalog.createResolutionPlan({
      bounds: { west: 0.5, south: 0, east: 1.5, north: 1 },
      level: 0
    });

    expect(plan.selectedArtifacts.map((artifact) => artifact.country)).toEqual(["AA", "BB"]);
    expect(catalog.getCoverage()).toHaveLength(2);
    expect(
      catalog.resolveTerritory("shared").matches.map((match) => match.entry.datasetId)
    ).toEqual(["country-a", "country-b"]);
  });

  it("filters catalog coverage and unregisters entries deterministically", () => {
    const catalog = createTerritoryCatalog([
      {
        dataset: createDataset({ datasetId: "query-a", country: "AA", west: 0, east: 1 }),
        country: "aa",
        levels: [0, "ADM1"],
        parentId: "parent-a",
        priority: 5
      },
      {
        dataset: createDataset({ datasetId: "render-b", country: "BB", west: 1, east: 2 }),
        country: "bb",
        level: 0,
        artifactPurpose: "render"
      }
    ]);

    expect(isTerritoryCatalog(catalog)).toBe(true);
    expect(isTerritoryCatalog({ createResolutionPlan() {} })).toBe(false);
    expect(
      catalog.getCoverage({ country: "aa", parentId: "parent-a", level: 1 }).map((coverage) => ({
        datasetId: coverage.datasetId,
        country: coverage.country,
        levels: coverage.levels
      }))
    ).toEqual([{ datasetId: "query-a", country: "AA", levels: [0, 1] }]);
    expect(
      catalog.getCoverage({ artifactPurpose: "render" }).map((entry) => entry.datasetId)
    ).toEqual(["render-b"]);

    const fallbackPlan = catalog.resolveViewport({
      bounds: { west: 0, south: 0, east: 1, north: 1 },
      zoom: 13
    });

    expect(fallbackPlan.requestedLevel).toBe(3);
    expect(fallbackPlan.selectedLevels).toEqual([1]);
    expect(fallbackPlan.fallbackMatches[0]).toMatchObject({
      level: 1,
      requestedLevel: 3,
      matchType: "fallback"
    });

    expect(catalog.unregisterDataset("missing")).toBe(false);
    expect(catalog.unregisterDataset({ datasetId: "query-a", datasetVersion: "missing" })).toBe(
      false
    );
    expect(catalog.unregisterDataset({ datasetId: "query-a" })).toBe(true);
    expect(catalog.getCoverage({ country: "aa" })).toEqual([]);

    const lateEntry = catalog.registerDataset({
      dataset: createDataset({ datasetId: "late", country: "CC", west: 2, east: 3 }),
      country: "cc",
      level: 0
    });

    expect(catalog.unregisterDataset(lateEntry.id)).toBe(true);
  });

  it("records tie-breaker decisions and empty dataset level gaps", () => {
    const catalog = createTerritoryCatalog([
      {
        dataset: createDataset({ datasetId: "alpha", country: "AA", west: 0, east: 1 }),
        country: "AA",
        level: 0
      },
      {
        dataset: createDataset({ datasetId: "beta", country: "AA", west: 0, east: 1 }),
        country: "AA",
        level: 0
      },
      {
        dataset: createEmptyDataset("empty", "EE"),
        country: "EE"
      }
    ]);

    const tiePlan = catalog.resolveViewport({
      bounds: { west: 0, south: 0, east: 1, north: 1 },
      level: 0
    });
    const emptyPlan = catalog.resolveViewport(
      {
        bounds: { west: 0, south: 0, east: 0, north: 0 },
        level: 0
      },
      { country: "EE" }
    );

    expect(tiePlan.selectedArtifacts.map((artifact) => artifact.datasetId)).toEqual(["alpha"]);
    expect(tiePlan.priorityDecisions).toEqual([expect.objectContaining({ reason: "tie-breaker" })]);
    expect(emptyPlan.selectedArtifacts).toEqual([]);
    expect(emptyPlan.unavailableCoverage).toEqual([
      expect.objectContaining({
        reason: "level-unavailable",
        datasetId: "empty",
        requestedLevel: 0,
        country: "EE"
      })
    ]);
  });

  it("rejects invalid catalog levels", () => {
    const dataset = createDataset({ datasetId: "invalid-level", country: "AA", west: 0, east: 1 });

    expect(() => createTerritoryCatalog([{ dataset, level: "ZONE" as unknown as "ADM0" }])).toThrow(
      TerritoryError
    );
    expect(() => createTerritoryCatalog([{ dataset, level: -1 }])).toThrow(TerritoryError);
  });

  it("queries multiple catalog engines and emits collision-safe deterministic adapter output", async () => {
    const sourceRecorder = createSourceRecorder();
    const catalog = createTerritoryCatalog([
      {
        dataset: createDataset({ datasetId: "country-b", country: "BB", west: 1, east: 2 }),
        country: "BB",
        level: 0
      },
      {
        dataset: createDataset({ datasetId: "country-a", country: "AA", west: 0, east: 1 }),
        country: "AA",
        level: 0
      }
    ]);
    const runtime = createTerritoryRuntime({
      catalog,
      adapter: sourceRecorder.adapter
    });

    const result = await runtime.setViewport({
      bounds: { west: 0, south: 0, east: 2, north: 1 },
      zoom: 1,
      level: 0
    });

    expect(result?.status).toBe("ready");
    expect(result?.summary?.datasets?.map((dataset) => dataset.datasetId)).toEqual([
      "country-a",
      "country-b"
    ]);
    expect(result?.summary?.zoneCount).toBe(2);
    expect(readFeatureIds(sourceRecorder.sources.at(-1))).toEqual([
      "country-a:shared",
      "country-b:shared"
    ]);
  });

  it("uses catalog cache entries across repeated viewports", async () => {
    const catalog = createTerritoryCatalog([
      {
        dataset: createDataset({ datasetId: "country-a", country: "AA", west: 0, east: 1 }),
        country: "AA",
        level: 0
      }
    ]);
    const runtime = createTerritoryRuntime({ catalog });

    const viewport = { bounds: { west: 0, south: 0, east: 1, north: 1 }, zoom: 1, level: 0 };
    const first = await runtime.setViewport(viewport);
    const second = await runtime.setViewport(viewport, { force: true });

    expect(first?.summary?.cached).toBe(false);
    expect(second?.summary?.cached).toBe(true);
    expect(second?.summary?.datasets?.[0]?.cached).toBe(true);
  });

  it("rejects stale catalog plans before commit", async () => {
    const catalog = createTerritoryCatalog([
      {
        dataset: createDataset({ datasetId: "country-a", country: "AA", west: 0, east: 1 }),
        country: "AA",
        level: 0
      }
    ]);
    let mutated = false;
    const runtime = createTerritoryRuntime({
      catalog,
      createEngine(options: TerritoryEngineOptions) {
        if (!mutated) {
          mutated = true;
          catalog.registerDataset({
            dataset: createDataset({ datasetId: "country-b", country: "BB", west: 1, east: 2 }),
            country: "BB",
            level: 0
          });
        }

        return createTerritoryEngine(options);
      }
    });

    const result = await runtime.setViewport({
      bounds: { west: 0, south: 0, east: 1, north: 1 },
      zoom: 1,
      level: 0
    });

    expect(result?.status).toBe("aborted");
    expect(runtime.state.status).toBe("idle");
  });

  it("uses worker transport for binary-index catalog artifacts and cancels worker queries", async () => {
    const dataset = createDataset({ datasetId: "country-a", country: "AA", west: 0, east: 1 });
    const indexBuffer = encodeTerritoryBinarySpatialIndex(dataset);
    const transport = createDeferredWorkerTransport(dataset.zones);
    const catalog = createTerritoryCatalog([
      {
        dataset,
        country: "AA",
        level: 0,
        indexHash: "fixture-index",
        spatialIndex: indexBuffer
      }
    ]);
    const runtime = createTerritoryRuntime({
      catalog,
      workerTransport: transport
    });

    const request = runtime.setViewport({
      bounds: { west: 0, south: 0, east: 1, north: 1 },
      zoom: 1,
      level: 0
    });

    await transport.waitForQuery();
    const cancel = runtime.cancelActiveRequest("test-cancel");
    const result = await request;

    expect(cancel.cancelled).toBe(true);
    expect(result?.status).toBe("aborted");
    expect(transport.messages.map((message) => message.type)).toContain("initialize");
    expect(transport.messages.map((message) => message.type)).toContain("query");
    expect(transport.messages.map((message) => message.type)).toContain("cancel");
  });
});

describe("Territory engine pool and worker client", () => {
  it("reuses engines, evicts by LRU, and preserves pinned entries", async () => {
    let now = 0;
    const pool = createTerritoryEnginePool({
      maxActiveEngines: 2,
      clock: () => {
        now += 1;
        return now;
      }
    });
    const firstDataset = createDataset({ datasetId: "first", country: "AA", west: 0, east: 1 });
    const secondDataset = createDataset({ datasetId: "second", country: "BB", west: 1, east: 2 });
    const thirdDataset = createDataset({ datasetId: "third", country: "CC", west: 2, east: 3 });

    const first = await pool.getEngine(firstDataset, { pinned: true });
    const firstAgain = await pool.getEngine(firstDataset);
    await pool.getEngine(secondDataset);
    await pool.getEngine(thirdDataset);

    expect(firstAgain).toBe(first);
    expect(pool.summary).toMatchObject({
      activeEngines: 2,
      pinnedEngines: 1,
      hits: 1,
      misses: 3,
      evictions: 1
    });
    expect(pool.summary.entries.map((entry) => entry.datasetId)).toEqual(["first", "third"]);
  });

  it("supports uncached pools, missing-key controls, and disposed guards", async () => {
    expect(() => createTerritoryEnginePool({ maxActiveEngines: -1 })).toThrow(TerritoryError);

    const dataset = createDataset({ datasetId: "uncached", country: "AA", west: 0, east: 1 });
    const pool = createTerritoryEnginePool({ maxActiveEngines: 0 });
    const first = await pool.getEngine(dataset);
    const second = await pool.getEngine(dataset);

    expect(second).not.toBe(first);
    expect(pool.summary).toMatchObject({
      activeEngines: 0,
      hits: 0,
      misses: 2,
      evictions: 0
    });
    expect(pool.pin("missing")).toBe(false);
    expect(pool.unpin("missing")).toBe(false);
    expect(pool.delete("missing")).toBe(false);

    pool.dispose();
    await expect(pool.getEngine(dataset)).rejects.toThrow("disposed");
  });

  it("disposes pooled engines on eviction, delete, and pool disposal", async () => {
    const disposedDatasets: string[] = [];
    const pool = createTerritoryEnginePool({
      maxActiveEngines: 1,
      createEngine(options) {
        const engine = createTerritoryEngine(options) as TerritoryEngine & { dispose(): void };
        engine.dispose = () => {
          disposedDatasets.push(options.dataset.manifest.datasetId);
        };
        return engine;
      }
    });
    const firstDataset = createDataset({
      datasetId: "disposable-a",
      country: "AA",
      west: 0,
      east: 1
    });
    const secondDataset = createDataset({
      datasetId: "disposable-b",
      country: "BB",
      west: 1,
      east: 2
    });
    const thirdDataset = createDataset({
      datasetId: "disposable-c",
      country: "CC",
      west: 2,
      east: 3
    });

    await pool.getEngine(firstDataset);
    await pool.getEngine(secondDataset);
    expect(disposedDatasets).toEqual(["disposable-a"]);

    const secondKey = datasetEnginePoolKey(secondDataset);
    expect(pool.delete(secondKey)).toBe(true);
    expect(pool.delete(secondKey)).toBe(false);
    expect(disposedDatasets).toEqual(["disposable-a", "disposable-b"]);

    await pool.getEngine(thirdDataset);
    pool.dispose();
    pool.dispose();
    expect(disposedDatasets).toEqual(["disposable-a", "disposable-b", "disposable-c"]);
  });

  it("passes transferable buffers through the worker client", async () => {
    const transport = createImmediateWorkerTransport([]);
    const client = createTerritoryWorkerClient(transport);
    const buffer = new ArrayBuffer(8);

    await client.initialize({
      datasetId: "worker-dataset",
      datasetVersion: "1.0.0",
      geometryHash: "geometry",
      indexHash: "index",
      indexBuffer: buffer,
      transfer: true
    });

    expect(transport.transferables[0]).toEqual([buffer]);
  });

  it("surfaces worker protocol errors and disposal state", async () => {
    const errorClient = createTerritoryWorkerClient({
      async send(message) {
        return {
          type: "error",
          requestId: message.requestId,
          code: "WORKER_BAD",
          message: "worker boom"
        };
      }
    });
    const wrongTypeClient = createTerritoryWorkerClient({
      async send(message) {
        return {
          type: "disposed",
          requestId: message.requestId
        };
      }
    });
    const disposableClient = createTerritoryWorkerClient(createImmediateWorkerTransport([]));

    await expect(
      errorClient.query({
        datasetId: "worker-dataset",
        bounds: { west: 0, south: 0, east: 1, north: 1 },
        level: 0
      })
    ).rejects.toThrow("worker boom");
    await expect(
      wrongTypeClient.initialize({
        datasetId: "worker-dataset",
        datasetVersion: "1.0.0",
        geometryHash: "geometry"
      })
    ).rejects.toThrow("unexpected response");

    await expect(disposableClient.dispose()).resolves.toMatchObject({ type: "disposed" });
    await expect(
      disposableClient.query({
        datasetId: "worker-dataset",
        bounds: { west: 0, south: 0, east: 1, north: 1 },
        level: 0
      })
    ).rejects.toThrow("disposed");
    await expect(disposableClient.dispose()).resolves.toMatchObject({
      requestId: "territory-worker-dispose-already"
    });
  });

  it("cancels worker queries when the signal is already aborted", async () => {
    const transport = createImmediateWorkerTransport([]);
    const client = createTerritoryWorkerClient(transport);
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.query(
        {
          datasetId: "worker-dataset",
          bounds: { west: 0, south: 0, east: 1, north: 1 },
          level: 0
        },
        { requestId: "worker-query-aborted", signal: controller.signal }
      )
    ).rejects.toThrow("aborted");
    expect(transport.messages).toEqual([
      expect.objectContaining({ type: "cancel", requestId: "worker-query-aborted" })
    ]);
  });
});

function createDataset(input: {
  datasetId: string;
  country: string;
  west: number;
  east: number;
  level?: number;
  priority?: number;
}): TerritoryDataset {
  const level = input.level ?? 0;

  return {
    manifest: {
      datasetId: input.datasetId,
      datasetVersion: "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "synthetic",
      geometryHash: `${input.datasetId}-geometry`,
      countryCodes: [input.country]
    },
    zones: [
      createSquareZone({
        id: "shared",
        datasetId: input.datasetId,
        countryCode: input.country,
        level,
        west: input.west,
        south: 0,
        east: input.east,
        north: 1,
        properties: {
          priority: input.priority ?? 0
        }
      })
    ]
  };
}

function createEmptyDataset(datasetId: string, country: string): TerritoryDataset {
  return {
    manifest: {
      datasetId,
      datasetVersion: "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "synthetic",
      geometryHash: `${datasetId}-geometry`,
      countryCodes: [country]
    },
    zones: []
  };
}

function createSourceRecorder(): {
  readonly adapter: TerritoryRendererAdapter<unknown>;
  readonly sources: TerritoryRenderSource[];
} {
  const sources: TerritoryRenderSource[] = [];

  return {
    sources,
    adapter: {
      capabilities: defineTerritoryAdapterCapabilities({
        geoJson: true,
        sourceReplacement: true
      }),
      lifecycleState: "attached",
      managedSourceId: "runtime-test-source",
      attach() {
        return undefined;
      },
      detach() {
        return undefined;
      },
      setSource(source) {
        sources.push(source);
      },
      updateState() {
        return undefined;
      },
      updateTheme() {
        return undefined;
      }
    }
  };
}

function readFeatureIds(source: TerritoryRenderSource | undefined): string[] {
  const data = source?.data as { features?: Array<{ id?: string }> } | undefined;
  return (data?.features ?? []).map((feature) => String(feature.id)).sort();
}

function createImmediateWorkerTransport(zones: readonly TerritoryZone[]): TestWorkerTransport {
  return createTestWorkerTransport(zones, false);
}

function createDeferredWorkerTransport(zones: readonly TerritoryZone[]): TestWorkerTransport {
  return createTestWorkerTransport(zones, true);
}

interface TestWorkerTransport extends TerritoryWorkerTransport {
  readonly messages: TerritoryWorkerMessage[];
  readonly transferables: readonly Transferable[][];
  waitForQuery(): Promise<void>;
}

function createTestWorkerTransport(
  zones: readonly TerritoryZone[],
  deferQuery: boolean
): TestWorkerTransport {
  const messages: TerritoryWorkerMessage[] = [];
  const transferables: Transferable[][] = [];
  let querySeen: (() => void) | undefined;
  const querySeenPromise = new Promise<void>((resolve) => {
    querySeen = resolve;
  });

  return {
    messages,
    transferables,
    async send(
      message: TerritoryWorkerMessage,
      messageTransferables: readonly Transferable[] = []
    ): Promise<TerritoryWorkerResponse> {
      messages.push(message);
      transferables.push([...messageTransferables]);

      if (message.type === "initialize") {
        return {
          type: "initialized",
          requestId: message.requestId,
          datasetId: message.datasetId,
          ...(message.indexHash ? { indexHash: message.indexHash } : {})
        };
      }

      if (message.type === "query") {
        querySeen?.();

        if (deferQuery) {
          await new Promise(() => undefined);
        }

        return {
          type: "query-result",
          requestId: message.requestId,
          datasetId: message.datasetId,
          zones
        };
      }

      if (message.type === "cancel") {
        return {
          type: "cancelled",
          requestId: message.requestId
        };
      }

      return {
        type: "disposed",
        requestId: message.requestId
      };
    },
    waitForQuery() {
      return querySeenPromise;
    }
  };
}
