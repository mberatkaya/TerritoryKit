import { defineTerritoryAdapterCapabilities } from "@territory-kit/adapter-core";
import type { TerritoryRenderSource, TerritoryRendererAdapter } from "@territory-kit/adapter-core";
import {
  createTerritoryEngine,
  decodeTerritoryBinarySpatialIndex,
  encodeTerritoryBinarySpatialIndex
} from "@territory-kit/core";
import type { TerritoryEngine, TerritoryEngineOptions } from "@territory-kit/core";
import { createSquareZone } from "@territory-kit/shared-testkit";
import { TerritoryError } from "@territory-kit/dataset";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  createTerritoryCatalog,
  createTerritoryEnginePool,
  createMemoryTerritoryRuntimeCache,
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
        dataset: createDataset({
          datasetId: "query-a",
          country: "AA",
          west: 0,
          east: 1,
          extraLevels: [1]
        }),
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

  it("rejects catalog registrations that conflict with dataset or index invariants", () => {
    const dataset = createDataset({
      datasetId: "catalog-invariants",
      country: "AA",
      west: 0,
      east: 1
    });
    const otherDataset = createDataset({
      datasetId: "catalog-other",
      country: "AA",
      west: 0,
      east: 1
    });
    const spatialIndex = encodeTerritoryBinarySpatialIndex(dataset);
    const indexHash = decodeTerritoryBinarySpatialIndex(spatialIndex).metadata.indexHash;

    const cases: Array<[string, Parameters<typeof createTerritoryCatalog>[0]]> = [
      ["datasetId override", [{ dataset, datasetId: "other-id", level: 0 }]],
      ["datasetVersion override", [{ dataset, datasetVersion: "2.0.0", level: 0 }]],
      ["geometryHash override", [{ dataset, geometryHash: "other-geometry", level: 0 }]],
      ["country conflict", [{ dataset, country: "BB", level: 0 }]],
      ["missing level", [{ dataset, level: 2 }]],
      ["fallback outside levels", [{ dataset, level: 0, fallbackLevel: 1 }]],
      ["non-finite priority", [{ dataset, level: 0, priority: Number.NaN }]],
      [
        "non-finite bounds",
        [{ dataset, level: 0, bounds: { west: 0, south: 0, east: Number.NaN, north: 1 } }]
      ],
      [
        "reversed bounds",
        [{ dataset, level: 0, bounds: { west: 1, south: 0, east: 0, north: 1 } }]
      ],
      [
        "bounds excluding coverage",
        [{ dataset, level: 0, bounds: { west: 0.2, south: 0, east: 1, north: 1 } }]
      ],
      [
        "spatial index metadata mismatch",
        [{ dataset, level: 0, spatialIndex: encodeTerritoryBinarySpatialIndex(otherDataset) }]
      ],
      ["indexHash mismatch", [{ dataset, level: 0, spatialIndex, indexHash: "wrong-index" }]]
    ];

    for (const [label, registrations] of cases) {
      expect(() => createTerritoryCatalog(registrations), label).toThrow(TerritoryError);
    }

    const catalog = createTerritoryCatalog();
    const entry = catalog.registerDataset({ dataset, level: 0, spatialIndex });
    const revision = catalog.revision;

    expect(entry.indexHash).toBe(indexHash);
    expect(catalog.registerDataset({ dataset, level: 0, spatialIndex })).toBe(entry);
    expect(catalog.revision).toBe(revision);
    expect(() =>
      catalog.registerDataset({
        dataset,
        level: 0,
        spatialIndex,
        bounds: { west: -1, south: 0, east: 2, north: 1 }
      })
    ).toThrow(TerritoryError);
  });

  it("selects disjoint catalog shards independently and priority-wins overlapping variants", () => {
    const catalog = createTerritoryCatalog([
      {
        dataset: createDataset({ datasetId: "aa-west", country: "AA", west: 0, east: 1 }),
        country: "AA",
        level: 0,
        priority: 1
      },
      {
        dataset: createDataset({ datasetId: "aa-east", country: "AA", west: 2, east: 3 }),
        country: "AA",
        level: 0,
        priority: 1
      },
      {
        dataset: createDataset({ datasetId: "aa-overlap-low", country: "AA", west: 4, east: 6 }),
        country: "AA",
        level: 0,
        priority: 1
      },
      {
        dataset: createDataset({ datasetId: "aa-overlap-high", country: "AA", west: 5, east: 7 }),
        country: "AA",
        level: 0,
        priority: 10
      },
      {
        dataset: createDataset({ datasetId: "aa-parent-a", country: "AA", west: 8, east: 9 }),
        country: "AA",
        level: 0,
        parentId: "parent-a"
      },
      {
        dataset: createDataset({ datasetId: "aa-parent-b", country: "AA", west: 8, east: 9 }),
        country: "AA",
        level: 0,
        parentId: "parent-b"
      },
      {
        dataset: createDataset({ datasetId: "bb-country", country: "BB", west: 0, east: 1 }),
        country: "BB",
        level: 0
      }
    ]);
    const disjointPlan = catalog.resolveViewport(
      {
        bounds: { west: 0, south: 0, east: 3, north: 1 },
        level: 0
      },
      { country: "AA" }
    );
    const overlapPlan = catalog.resolveViewport({
      bounds: { west: 5.5, south: 0, east: 5.6, north: 1 },
      level: 0
    });
    const parentPlan = catalog.resolveViewport({
      bounds: { west: 8, south: 0, east: 9, north: 1 },
      level: 0
    });
    const multiCountryPlan = catalog.resolveViewport({
      bounds: { west: 0, south: 0, east: 1, north: 1 },
      level: 0
    });

    expect(disjointPlan.selectedArtifacts.map((artifact) => artifact.datasetId)).toEqual([
      "aa-east",
      "aa-west"
    ]);
    expect(overlapPlan.selectedArtifacts.map((artifact) => artifact.datasetId)).toEqual([
      "aa-overlap-high"
    ]);
    expect(overlapPlan.priorityDecisions).toEqual([
      expect.objectContaining({
        excludedEntryId: expect.stringContaining("aa-overlap-low"),
        reason: "lower-priority"
      })
    ]);
    expect(parentPlan.selectedArtifacts.map((artifact) => artifact.datasetId)).toEqual([
      "aa-parent-a",
      "aa-parent-b"
    ]);
    expect(multiCountryPlan.selectedArtifacts.map((artifact) => artifact.country)).toEqual([
      "AA",
      "BB"
    ]);
  });

  it("uses explicit selectionGroup to model mutually exclusive variants", () => {
    const catalog = createTerritoryCatalog([
      {
        dataset: createDataset({ datasetId: "variant-a", country: "AA", west: 0, east: 1 }),
        country: "AA",
        level: 0,
        selectionGroup: "aa-variant"
      },
      {
        dataset: createDataset({ datasetId: "variant-b", country: "AA", west: 2, east: 3 }),
        country: "AA",
        level: 0,
        selectionGroup: "aa-variant"
      }
    ]);
    const plan = catalog.resolveViewport({
      bounds: { west: 0, south: 0, east: 3, north: 1 },
      level: 0
    });

    expect(plan.selectedArtifacts.map((artifact) => artifact.datasetId)).toEqual(["variant-a"]);
    expect(plan.priorityDecisions).toEqual([
      expect.objectContaining({
        excludedEntryId: expect.stringContaining("variant-b"),
        groupKey: "AA::0:query:aa-variant",
        reason: "tie-breaker"
      })
    ]);
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
      adapter: sourceRecorder.adapter,
      zoneIdCollisionPolicy: "namespace"
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
      "country-a:1.0.0:AA:0:*:query::shared",
      "country-b:1.0.0:BB:0:*:query::shared"
    ]);
  });

  it("rejects catalog zone id collisions by default before adapter updates", async () => {
    const sourceRecorder = createSourceRecorder();
    const runtime = createTerritoryRuntime({
      catalog: createTerritoryCatalog([
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
      ]),
      adapter: sourceRecorder.adapter
    });

    const result = await runtime.setViewport({
      bounds: { west: 0, south: 0, east: 2, north: 1 },
      zoom: 1,
      level: 0
    });

    expect(result?.status).toBe("failed");
    expect(result?.error?.code).toBe("RUNTIME_CONFIGURATION_INVALID");
    expect(sourceRecorder.sources).toEqual([]);
  });

  it("namespaces catalog zones from the start and rewrites local references", async () => {
    const sourceRecorder = createSourceRecorder();
    const runtime = createTerritoryRuntime({
      catalog: createTerritoryCatalog([
        {
          dataset: createLinkedDataset("linked-a", "AA"),
          country: "AA",
          level: 1
        }
      ]),
      adapter: sourceRecorder.adapter,
      zoneIdCollisionPolicy: "namespace"
    });

    const result = await runtime.setViewport({
      bounds: { west: 0, south: 0, east: 1, north: 1 },
      zoom: 1,
      level: 1
    });
    const features = readFeatures(sourceRecorder.sources.at(-1));
    const parentId = "linked-a:1.0.0:AA:1:*:query::parent";
    const childId = "linked-a:1.0.0:AA:1:*:query::child";

    expect(result?.status).toBe("ready");
    expect(features.map((feature) => feature.id).sort()).toEqual([childId]);
    expect(features.find((feature) => feature.id === childId)?.properties).toMatchObject({
      parentId,
      linkedZoneId: parentId,
      siblingIds: [parentId],
      sourceZoneId: "child",
      sourceDatasetId: "linked-a",
      sourceEntryId: "linked-a:1.0.0:AA:1:*:query"
    });
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

  it("isolates catalog cache entries by zone id collision policy", async () => {
    const catalog = createTerritoryCatalog([
      {
        dataset: createDataset({ datasetId: "cache-country-a", country: "AA", west: 0, east: 1 }),
        country: "AA",
        level: 0
      },
      {
        dataset: createDataset({ datasetId: "cache-country-b", country: "BB", west: 1, east: 2 }),
        country: "BB",
        level: 0
      }
    ]);
    const viewport = {
      bounds: { west: 0, south: 0, east: 2, north: 1 },
      zoom: 1,
      level: 0
    };
    const cache = createMemoryTerritoryRuntimeCache();
    const namespaceRuntime = createTerritoryRuntime({
      catalog,
      cache,
      zoneIdCollisionPolicy: "namespace"
    });
    const firstNamespace = await namespaceRuntime.setViewport(viewport);
    const secondNamespace = await namespaceRuntime.setViewport(viewport, { force: true });
    const namespaceKey = secondNamespace?.summary?.cacheKey ?? "";
    const errorKey = namespaceKey.replace("collision=namespace", "collision=error");
    const errorRuntime = createTerritoryRuntime({ catalog, cache });

    expect(firstNamespace?.status).toBe("ready");
    expect(firstNamespace?.summary?.cached).toBe(false);
    expect(secondNamespace?.status).toBe("ready");
    expect(secondNamespace?.summary?.cached).toBe(true);
    expect(namespaceKey).toContain("collision=namespace");
    expect(errorKey).toContain("collision=error");
    expect(errorKey).not.toBe(namespaceKey);

    const errorResult = await errorRuntime.setViewport(viewport);
    expect(errorResult?.status).toBe("failed");
    expect(errorResult?.error?.code).toBe("RUNTIME_CONFIGURATION_INVALID");
    expect(errorResult?.error?.message).toContain("duplicate zone ids");

    const cacheContext = {
      requestId: "cache-policy-test",
      revision: 0,
      startedAt: new Date(0),
      viewport
    };
    const namespaceBytes = await cache.get(namespaceKey, cacheContext);
    expect(namespaceBytes).toBeDefined();

    if (!namespaceBytes) {
      throw new Error("Expected namespace cache payload.");
    }

    await cache.set(errorKey, namespaceBytes, cacheContext);
    const mismatchResult = await errorRuntime.setViewport(viewport, { force: true });
    expect(mismatchResult?.status).toBe("failed");
    expect(mismatchResult?.error?.code).toBe("RUNTIME_CONFIGURATION_INVALID");
    expect(await cache.get(errorKey, cacheContext)).toBeUndefined();

    const reverseCache = createMemoryTerritoryRuntimeCache();
    const reverseErrorRuntime = createTerritoryRuntime({ catalog, cache: reverseCache });
    const reverseNamespaceRuntime = createTerritoryRuntime({
      catalog,
      cache: reverseCache,
      zoneIdCollisionPolicy: "namespace"
    });
    const reverseError = await reverseErrorRuntime.setViewport(viewport);
    const reverseNamespaceFirst = await reverseNamespaceRuntime.setViewport(viewport);
    const reverseNamespaceSecond = await reverseNamespaceRuntime.setViewport(viewport, {
      force: true
    });

    expect(reverseError?.status).toBe("failed");
    expect(reverseError?.error?.code).toBe("RUNTIME_CONFIGURATION_INVALID");
    expect(reverseNamespaceFirst?.status).toBe("ready");
    expect(reverseNamespaceFirst?.summary?.cached).toBe(false);
    expect(reverseNamespaceSecond?.status).toBe("ready");
    expect(reverseNamespaceSecond?.summary?.cached).toBe(true);
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

  it("reuses worker binary index initialization across repeated catalog queries", async () => {
    const dataset = createDataset({ datasetId: "worker-reuse", country: "AA", west: 0, east: 1 });
    const indexBuffer = encodeTerritoryBinarySpatialIndex(dataset);
    const transport = createImmediateWorkerTransport(dataset.zones);
    const runtime = createTerritoryRuntime({
      catalog: createTerritoryCatalog([
        {
          dataset,
          country: "AA",
          level: 0,
          spatialIndex: indexBuffer
        }
      ]),
      cache: false,
      workerTransport: transport
    });

    await expect(
      runtime.setViewport({
        bounds: { west: 0, south: 0, east: 1, north: 1 },
        zoom: 1,
        level: 0
      })
    ).resolves.toMatchObject({ status: "ready" });
    await expect(
      runtime.setViewport(
        {
          bounds: { west: 0, south: 0, east: 1, north: 1 },
          zoom: 1,
          level: 0
        },
        { force: true }
      )
    ).resolves.toMatchObject({ status: "ready" });

    expect(transport.messages.filter((message) => message.type === "initialize")).toHaveLength(1);
    expect(transport.messages.filter((message) => message.type === "query")).toHaveLength(2);
    expect(transport.transferables.filter((transferables) => transferables.length > 0)).toEqual([]);
    expect(indexBuffer.byteLength).toBeGreaterThan(0);
  });

  it("deduplicates concurrent worker initialization for the same binary index", async () => {
    const dataset = createDataset({
      datasetId: "worker-concurrent",
      country: "AA",
      west: 0,
      east: 1
    });
    const indexBuffer = encodeTerritoryBinarySpatialIndex(dataset);
    const transport = createDeferredInitializeWorkerTransport(dataset.zones);
    const runtime = createTerritoryRuntime({
      catalog: createTerritoryCatalog([
        {
          dataset,
          country: "AA",
          level: 0,
          spatialIndex: indexBuffer
        }
      ]),
      cache: false,
      cancelPreviousRequest: false,
      workerTransport: transport
    });

    const first = runtime.setViewport({
      bounds: { west: 0, south: 0, east: 0.5, north: 1 },
      zoom: 1,
      level: 0
    });
    const second = runtime.setViewport({
      bounds: { west: 0.5, south: 0, east: 1, north: 1 },
      zoom: 1,
      level: 0
    });

    await transport.waitForInitialize();
    await Promise.resolve();
    expect(transport.messages.filter((message) => message.type === "initialize")).toHaveLength(1);
    transport.resolveInitialize();
    await expect(first).resolves.toMatchObject({ status: "aborted" });
    await expect(second).resolves.toMatchObject({ status: "ready" });
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

  it("deduplicates concurrent same-key engine creation", async () => {
    const dataset = createDataset({ datasetId: "concurrent", country: "AA", west: 0, east: 1 });
    const deferredEngine = createDeferred<TerritoryEngine>();
    let createCount = 0;
    const pool = createTerritoryEnginePool({
      createEngine(options) {
        createCount += 1;
        return deferredEngine.promise.then(() => createTerritoryEngine(options));
      }
    });
    const requests = Array.from({ length: 20 }, () => pool.getEngine(dataset));

    await Promise.resolve();
    expect(createCount).toBe(1);
    deferredEngine.resolve(createTerritoryEngine({ dataset }));
    const engines = await Promise.all(requests);

    expect(new Set(engines).size).toBe(1);
    expect(pool.summary).toMatchObject({
      activeEngines: 1,
      hits: 19,
      misses: 1
    });
  });

  it("cleans up rejected engine factories so later requests can retry", async () => {
    const dataset = createDataset({ datasetId: "retry", country: "AA", west: 0, east: 1 });
    let attempts = 0;
    const pool = createTerritoryEnginePool({
      createEngine(options) {
        attempts += 1;

        if (attempts === 1) {
          throw new Error("factory boom");
        }

        return createTerritoryEngine(options);
      }
    });

    await expect(pool.getEngine(dataset)).rejects.toThrow("factory boom");
    await expect(pool.getEngine(dataset)).resolves.toBeTruthy();
    expect(attempts).toBe(2);
    expect(pool.summary.activeEngines).toBe(1);
  });

  it("does not restore late in-flight engines after delete or dispose", async () => {
    const deletedDataset = createDataset({
      datasetId: "late-delete",
      country: "AA",
      west: 0,
      east: 1
    });
    const disposedDataset = createDataset({
      datasetId: "late-dispose",
      country: "BB",
      west: 1,
      east: 2
    });
    const deleteDeferred = createDeferred<TerritoryEngine>();
    const disposeDeferred = createDeferred<TerritoryEngine>();
    const disposedEngines: string[] = [];
    const pool = createTerritoryEnginePool({
      createEngine(options) {
        const engine = createTerritoryEngine(options) as TerritoryEngine & { dispose(): void };
        engine.dispose = () => {
          disposedEngines.push(options.dataset.manifest.datasetId);
        };

        return options.dataset.manifest.datasetId === "late-delete"
          ? deleteDeferred.promise.then(() => engine)
          : disposeDeferred.promise.then(() => engine);
      }
    });

    const deletedRequest = pool.getEngine(deletedDataset);
    expect(pool.delete(datasetEnginePoolKey(deletedDataset))).toBe(true);
    deleteDeferred.resolve(createTerritoryEngine({ dataset: deletedDataset }));
    await expect(deletedRequest).rejects.toMatchObject({
      code: "REQUEST_ABORTED",
      details: {
        key: datasetEnginePoolKey(deletedDataset),
        datasetId: "late-delete",
        reason: "deleted"
      }
    });
    expect(pool.summary.activeEngines).toBe(0);

    const disposedRequest = pool.getEngine(disposedDataset);
    pool.dispose();
    disposeDeferred.resolve(createTerritoryEngine({ dataset: disposedDataset }));
    await expect(disposedRequest).rejects.toThrow("disposed");
    expect(disposedEngines).toEqual(["late-delete", "late-dispose"]);
    expect(pool.summary.activeEngines).toBe(0);
  });

  it("rejects all waiters when in-flight engine creation is deleted and supports retry", async () => {
    const dataset = createDataset({
      datasetId: "delete-waiters",
      country: "AA",
      west: 0,
      east: 1
    });
    const key = datasetEnginePoolKey(dataset);
    const firstAttempt = createDeferred<void>();
    let attempts = 0;
    let disposeCount = 0;
    const pool = createTerritoryEnginePool({
      createEngine(options) {
        attempts += 1;
        const engine = createTerritoryEngine(options) as TerritoryEngine & { dispose(): void };
        engine.dispose = () => {
          disposeCount += 1;
        };

        return attempts === 1 ? firstAttempt.promise.then(() => engine) : engine;
      }
    });
    const requests = Array.from({ length: 20 }, () => pool.getEngine(dataset));

    await Promise.resolve();
    expect(attempts).toBe(1);
    expect(pool.delete(key)).toBe(true);
    firstAttempt.resolve();
    const results = await Promise.allSettled(requests);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    for (const result of results) {
      expect(result).toMatchObject({
        status: "rejected",
        reason: {
          code: "REQUEST_ABORTED",
          details: {
            key,
            datasetId: "delete-waiters",
            reason: "deleted"
          }
        }
      });
    }
    expect(disposeCount).toBe(1);
    expect(pool.summary.activeEngines).toBe(0);

    await expect(pool.getEngine(dataset)).resolves.toBeTruthy();
    expect(attempts).toBe(2);
    expect(pool.summary.activeEngines).toBe(1);
  });

  it("keeps new in-flight engine creation isolated from an older deleted completion", async () => {
    const dataset = createDataset({
      datasetId: "delete-overwrite",
      country: "AA",
      west: 0,
      east: 1
    });
    const key = datasetEnginePoolKey(dataset);
    const firstAttempt = createDeferred<void>();
    const secondAttempt = createDeferred<void>();
    const engines: TerritoryEngine[] = [];
    let attempts = 0;
    let disposedEngines = 0;
    const pool = createTerritoryEnginePool({
      createEngine(options) {
        attempts += 1;
        const engine = createTerritoryEngine(options) as TerritoryEngine & { dispose(): void };
        engine.dispose = () => {
          disposedEngines += 1;
        };
        engines.push(engine);

        if (attempts === 1) {
          return firstAttempt.promise.then(() => engine);
        }

        return secondAttempt.promise.then(() => engine);
      }
    });

    const deletedRequest = pool.getEngine(dataset);
    await Promise.resolve();
    expect(pool.delete(key)).toBe(true);
    const replacementRequest = pool.getEngine(dataset);
    await Promise.resolve();
    expect(attempts).toBe(2);

    firstAttempt.resolve();
    await expect(deletedRequest).rejects.toMatchObject({
      code: "REQUEST_ABORTED",
      details: { key, reason: "deleted" }
    });
    expect(disposedEngines).toBe(1);

    const sharedReplacementRequest = pool.getEngine(dataset);
    await Promise.resolve();
    expect(attempts).toBe(2);
    secondAttempt.resolve();
    const [replacement, sharedReplacement] = await Promise.all([
      replacementRequest,
      sharedReplacementRequest
    ]);

    expect(replacement).toBe(engines[1]);
    expect(sharedReplacement).toBe(replacement);
    expect(pool.summary.activeEngines).toBe(1);
    expect(await pool.getEngine(dataset)).toBe(replacement);
  });

  it("rejects custom engine pool key collisions across dataset signatures", async () => {
    const pool = createTerritoryEnginePool();
    const firstDataset = createDataset({ datasetId: "key-a", country: "AA", west: 0, east: 1 });
    const secondDataset = createDataset({ datasetId: "key-b", country: "BB", west: 1, east: 2 });

    await pool.getEngine(firstDataset, { key: "custom-key" });
    await expect(pool.getEngine(secondDataset, { key: "custom-key" })).rejects.toThrow(
      "different dataset"
    );
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
    ).rejects.toThrow("protocol invalid");

    const disposedResult = await disposableClient.dispose();
    expect(disposedResult).toMatchObject({ type: "disposed" });
    await expect(
      disposableClient.query({
        datasetId: "worker-dataset",
        bounds: { west: 0, south: 0, east: 1, north: 1 },
        level: 0
      })
    ).rejects.toThrow("disposed");
    await expect(disposableClient.dispose()).resolves.toEqual(disposedResult);
  });

  it("rejects worker response correlation mismatches", async () => {
    const requestMismatchClient = createTerritoryWorkerClient({
      async send(message) {
        return {
          type: "query-result",
          requestId: `${message.requestId}:stale`,
          datasetId: "worker-dataset",
          zones: []
        };
      }
    });
    const initializeDatasetMismatchClient = createTerritoryWorkerClient({
      async send(message) {
        return {
          type: "initialized",
          requestId: message.requestId,
          datasetId: "other-dataset"
        };
      }
    });
    const queryDatasetMismatchClient = createTerritoryWorkerClient({
      async send(message) {
        return {
          type: "query-result",
          requestId: message.requestId,
          datasetId: "other-dataset",
          zones: []
        };
      }
    });

    await expect(
      requestMismatchClient.query({
        datasetId: "worker-dataset",
        bounds: { west: 0, south: 0, east: 1, north: 1 },
        level: 0
      })
    ).rejects.toThrow("requestId");
    await expect(
      initializeDatasetMismatchClient.initialize({
        datasetId: "worker-dataset",
        datasetVersion: "1.0.0",
        geometryHash: "geometry"
      })
    ).rejects.toThrow("datasetId");
    await expect(
      queryDatasetMismatchClient.query({
        datasetId: "worker-dataset",
        bounds: { west: 0, south: 0, east: 1, north: 1 },
        level: 0
      })
    ).rejects.toThrow("datasetId");
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

  it("cancels worker initialize requests before and during abort signals", async () => {
    const preAbortTransport = createImmediateWorkerTransport([]);
    const preAbortClient = createTerritoryWorkerClient(preAbortTransport);
    const preAbortController = new AbortController();
    preAbortController.abort();

    await expect(
      preAbortClient.initialize(
        {
          datasetId: "worker-dataset",
          datasetVersion: "1.0.0",
          geometryHash: "geometry"
        },
        { requestId: "worker-init-pre-abort", signal: preAbortController.signal }
      )
    ).rejects.toThrow("aborted");
    expect(preAbortTransport.messages).toEqual([
      expect.objectContaining({ type: "cancel", requestId: "worker-init-pre-abort" })
    ]);

    const midAbortTransport = createHangingInitializeTransport();
    const midAbortClient = createTerritoryWorkerClient(midAbortTransport);
    const midAbortController = new AbortController();
    const request = midAbortClient.initialize(
      {
        datasetId: "worker-dataset",
        datasetVersion: "1.0.0",
        geometryHash: "geometry"
      },
      { requestId: "worker-init-mid-abort", signal: midAbortController.signal }
    );

    await Promise.resolve();
    midAbortController.abort();
    await expect(request).rejects.toThrow("aborted");
    expect(midAbortTransport.messages).toContainEqual(
      expect.objectContaining({ type: "cancel", requestId: "worker-init-mid-abort" })
    );
  });

  it("rejects new worker operations while dispose is in flight", async () => {
    const disposeDeferred = createDeferred<TerritoryWorkerResponse>();
    const client = createTerritoryWorkerClient({
      async send(message) {
        if (message.type === "dispose") {
          return disposeDeferred.promise;
        }

        return {
          type: "query-result",
          requestId: message.requestId,
          datasetId: "worker-dataset",
          zones: []
        };
      }
    });
    const dispose = client.dispose();

    await Promise.resolve();
    await expect(
      client.query({
        datasetId: "worker-dataset",
        bounds: { west: 0, south: 0, east: 1, north: 1 },
        level: 0
      })
    ).rejects.toThrow("disposed");
    disposeDeferred.resolve({ type: "disposed", requestId: "territory-worker-dispose-1" });
    await expect(dispose).resolves.toMatchObject({ type: "disposed" });
  });

  it("deduplicates concurrent worker dispose calls", async () => {
    const disposeDeferred = createDeferred<TerritoryWorkerResponse>();
    const messages: TerritoryWorkerMessage[] = [];
    const client = createTerritoryWorkerClient({
      async send(message) {
        messages.push(message);

        if (message.type === "dispose") {
          return disposeDeferred.promise;
        }

        return {
          type: "query-result",
          requestId: message.requestId,
          datasetId: "worker-dataset",
          zones: []
        };
      }
    });
    const disposeCalls = Array.from({ length: 20 }, () => client.dispose());

    await Promise.resolve();
    const disposeMessages = messages.filter((message) => message.type === "dispose");
    expect(disposeMessages).toHaveLength(1);
    await expect(
      client.query({
        datasetId: "worker-dataset",
        bounds: { west: 0, south: 0, east: 1, north: 1 },
        level: 0
      })
    ).rejects.toThrow("disposed");
    await expect(
      client.initialize({
        datasetId: "worker-dataset",
        datasetVersion: "1.0.0",
        geometryHash: "geometry"
      })
    ).rejects.toThrow("disposed");

    disposeDeferred.resolve({
      type: "disposed",
      requestId: disposeMessages[0]?.requestId ?? "dispose-missing"
    });
    const results = await Promise.all(disposeCalls);

    expect(new Set(results.map((result) => result.requestId))).toEqual(
      new Set([disposeMessages[0]?.requestId])
    );
    expect(results.every((result) => result.type === "disposed")).toBe(true);
    await expect(client.dispose()).resolves.toEqual(results[0]);
    expect(messages.filter((message) => message.type === "dispose")).toHaveLength(1);
  });

  it("clears failed worker dispose attempts so dispose can retry", async () => {
    let disposeAttempts = 0;
    const messages: TerritoryWorkerMessage[] = [];
    const client = createTerritoryWorkerClient({
      async send(message) {
        messages.push(message);

        if (message.type === "dispose") {
          disposeAttempts += 1;

          if (disposeAttempts === 1) {
            throw new Error("dispose boom");
          }

          return {
            type: "disposed",
            requestId: message.requestId
          };
        }

        return {
          type: "query-result",
          requestId: message.requestId,
          datasetId: "worker-dataset",
          zones: []
        };
      }
    });

    await expect(client.dispose()).rejects.toThrow("dispose boom");
    await expect(
      client.query({
        datasetId: "worker-dataset",
        bounds: { west: 0, south: 0, east: 1, north: 1 },
        level: 0
      })
    ).resolves.toMatchObject({ type: "query-result" });
    await expect(client.dispose()).resolves.toMatchObject({ type: "disposed" });
    await expect(client.dispose()).resolves.toMatchObject({ type: "disposed" });
    expect(disposeAttempts).toBe(2);
    expect(messages.filter((message) => message.type === "dispose")).toHaveLength(2);
  });
});

function createDataset(input: {
  datasetId: string;
  country: string;
  west: number;
  east: number;
  level?: number;
  priority?: number;
  extraLevels?: readonly number[];
}): TerritoryDataset {
  const level = input.level ?? 0;
  const levels = [level, ...(input.extraLevels ?? [])];

  return {
    manifest: {
      datasetId: input.datasetId,
      datasetVersion: "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "synthetic",
      geometryHash: `${input.datasetId}-geometry`,
      countryCodes: [input.country]
    },
    zones: levels.map((zoneLevel, index) =>
      createSquareZone({
        id: index === 0 ? "shared" : `shared-l${zoneLevel}`,
        datasetId: input.datasetId,
        countryCode: input.country,
        level: zoneLevel,
        west: input.west,
        south: 0,
        east: input.east,
        north: 1,
        properties: {
          priority: input.priority ?? 0
        }
      })
    )
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

function createLinkedDataset(datasetId: string, country: string): TerritoryDataset {
  return {
    manifest: {
      datasetId,
      datasetVersion: "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "synthetic",
      geometryHash: `${datasetId}-geometry`,
      countryCodes: [country]
    },
    zones: [
      createSquareZone({
        id: "parent",
        datasetId,
        countryCode: country,
        level: 0,
        west: 0,
        south: 0,
        east: 1,
        north: 1,
        childIds: ["child"],
        neighborIds: ["child"],
        properties: {
          linkedZoneId: "child",
          siblingIds: ["child"]
        }
      }),
      createSquareZone({
        id: "child",
        datasetId,
        countryCode: country,
        level: 1,
        west: 0.1,
        south: 0.1,
        east: 0.9,
        north: 0.9,
        parentId: "parent",
        neighborIds: ["parent"],
        properties: {
          linkedZoneId: "parent",
          siblingIds: ["parent"]
        }
      })
    ]
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

function readFeatures(
  source: TerritoryRenderSource | undefined
): Array<{ id: string; properties: Record<string, unknown> }> {
  const data = source?.data as
    { features?: Array<{ id?: string; properties?: Record<string, unknown> }> } | undefined;

  return (data?.features ?? []).map((feature) => ({
    id: String(feature.id),
    properties: feature.properties ?? {}
  }));
}

function createImmediateWorkerTransport(zones: readonly TerritoryZone[]): TestWorkerTransport {
  return createTestWorkerTransport(zones, false);
}

function createDeferredWorkerTransport(zones: readonly TerritoryZone[]): TestWorkerTransport {
  return createTestWorkerTransport(zones, true);
}

function createDeferredInitializeWorkerTransport(
  zones: readonly TerritoryZone[]
): TestWorkerTransport & {
  resolveInitialize(): void;
  waitForInitialize(): Promise<void>;
} {
  const transport = createTestWorkerTransport(zones, false);
  let initializeSeen: (() => void) | undefined;
  let initializeResolved: (() => void) | undefined;
  const initializeSeenPromise = new Promise<void>((resolve) => {
    initializeSeen = resolve;
  });
  const initializeDeferred = new Promise<void>((resolve) => {
    initializeResolved = resolve;
  });

  return {
    ...transport,
    async send(message, transferables = []) {
      if (message.type === "initialize") {
        transport.messages.push(message);
        (transport.transferables as Transferable[][]).push([...transferables]);
        initializeSeen?.();
        await initializeDeferred;
        return {
          type: "initialized",
          requestId: message.requestId,
          datasetId: message.datasetId,
          ...(message.indexHash ? { indexHash: message.indexHash } : {})
        };
      }

      return transport.send(message, transferables);
    },
    resolveInitialize() {
      initializeResolved?.();
    },
    waitForInitialize() {
      return initializeSeenPromise;
    }
  };
}

function createHangingInitializeTransport(): TestWorkerTransport {
  const messages: TerritoryWorkerMessage[] = [];
  const transferables: Transferable[][] = [];

  return {
    messages,
    transferables,
    async send(message, messageTransferables = []) {
      messages.push(message);
      transferables.push([...messageTransferables]);

      if (message.type === "initialize") {
        await new Promise(() => undefined);
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
    async waitForQuery() {
      return undefined;
    }
  };
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

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  };
}
