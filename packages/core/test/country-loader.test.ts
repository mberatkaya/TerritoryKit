import { createSquareZone } from "@territory-kit/shared-testkit";
import { computeTerritoryAdjacencyContentHash } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  createTerritoryCountryDatasetDescriptor,
  loadTerritoryCountryDataset
} from "../src/index.js";
import type { TerritoryAdjacencyArtifact, TerritoryDataset } from "@territory-kit/dataset";

describe("loadTerritoryCountryDataset", () => {
  it("loads resolver-backed country artifacts with checksum and adjacency validation", async () => {
    const descriptor = createTerritoryCountryDatasetDescriptor({
      datasetId: "territory-kit-tr",
      countryCodeAlpha2: "tr",
      countryCodeAlpha3: "tur",
      packageName: "@territory-kit/data-tr",
      schemaVersion: "territory-schema@1",
      supportedLevels: ["ADM0", "ADM1"],
      defaultLevels: ["ADM1"],
      manifestPath: "manifest.json",
      requiresResolver: true
    });
    const adm1 = countryLevelDataset();
    const adjacency = adjacencyArtifact(adm1);
    const artifacts = new Map<string, string>([
      ["manifest.json", JSON.stringify({ datasetId: "territory-kit-tr" })],
      ["levels/ADM1/dataset.json", JSON.stringify(adm1)],
      ["adjacency/ADM1/adjacency.json", JSON.stringify(adjacency)]
    ]);
    artifacts.set("checksums.json", JSON.stringify({ files: await checksums(artifacts) }));

    const handle = await loadTerritoryCountryDataset(descriptor, {
      resolveArtifact: (path) => Promise.resolve(artifacts.get(path) ?? "{}"),
      verifyChecksums: true,
      loadAdjacency: true
    });

    expect(handle.descriptor.countryCodeAlpha2).toBe("TR");
    expect(handle.levels.ADM1?.zones).toHaveLength(2);
    expect(handle.adjacencyIndexes.ADM1?.getNeighbors("tr:adm1:a")).toEqual(["tr:adm1:b"]);

    artifacts.set("levels/ADM1/dataset.json", JSON.stringify({ broken: true }));
    await expect(
      loadTerritoryCountryDataset(descriptor, {
        resolveArtifact: (path) => Promise.resolve(artifacts.get(path) ?? "{}"),
        verifyChecksums: true
      })
    ).rejects.toThrow("Checksum mismatch");
  });
});

function countryLevelDataset(): TerritoryDataset {
  return {
    manifest: {
      datasetId: "territory-kit-tr-adm1",
      datasetVersion: "0.1.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026",
      geometryHash: "country-loader-fixture-hash"
    },
    zones: [
      createSquareZone({
        id: "tr:adm1:a",
        datasetId: "territory-kit-tr-adm1",
        level: 1,
        west: 0,
        south: 0,
        east: 1,
        north: 1
      }),
      createSquareZone({
        id: "tr:adm1:b",
        datasetId: "territory-kit-tr-adm1",
        level: 1,
        west: 1,
        south: 0,
        east: 2,
        north: 1
      })
    ]
  };
}

function adjacencyArtifact(dataset: TerritoryDataset): TerritoryAdjacencyArtifact {
  const artifact = {
    artifactVersion: "1" as const,
    dataset: {
      id: dataset.manifest.datasetId,
      version: dataset.manifest.datasetVersion,
      contentHash: dataset.manifest.geometryHash
    },
    generatedBy: {
      package: "@territory-kit/generators",
      version: "fixture"
    },
    generatedAt: "2026-01-01T00:00:00.000Z",
    measurement: {
      sharedBoundary: "geodesic-haversine" as const,
      holeBoundaryPolicy: "outer-rings-only" as const
    },
    options: {
      sameParentOnly: true,
      sameAdminLevelOnly: true,
      includePointTouches: false,
      minimumSharedBoundaryMeters: 0,
      epsilon: 1e-9
    },
    tolerance: {
      coordinateEpsilon: 1e-9,
      collinearityEpsilon: 1e-9,
      lengthEpsilonMeters: 0
    },
    statistics: {
      zoneCount: 2,
      eligibleZoneCount: 2,
      skippedZoneCount: 0,
      candidatePairCount: 1,
      exactComparisonCount: 1,
      disjointPairCount: 0,
      sharedBorderCount: 1,
      pointTouchCount: 0,
      overlapRejectedCount: 0,
      ambiguousCount: 0,
      manualAddCount: 0,
      manualRemoveCount: 0,
      finalEdgeCount: 1,
      totalSharedBoundaryMeters: 1
    },
    overrides: {
      addCount: 0,
      removeCount: 0
    },
    edges: [
      {
        from: "tr:adm1:a",
        to: "tr:adm1:b",
        type: "shared-border" as const,
        source: "computed" as const,
        sharedBoundaryMeters: 1,
        confidence: 1
      }
    ]
  };

  return {
    ...artifact,
    contentHash: computeTerritoryAdjacencyContentHash(artifact)
  };
}

async function checksums(artifacts: Map<string, string>): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      [...artifacts.entries()].map(async ([path, content]) => [path, await sha256Hex(content)])
    )
  );
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));

  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
