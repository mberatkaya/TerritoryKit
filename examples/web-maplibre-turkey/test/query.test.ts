import { describe, expect, it } from "vitest";
import { createTurkeyAdm3DemoDataset } from "@territory-kit/shared-testkit";
import type { TerritoryAdminLevel, TerritoryDataset } from "@territory-kit/dataset";
import type {
  TerritoryRegistryClient,
  TerritoryRegistryInstallOptions
} from "@territory-kit/registry";
import { createFixtureQueryService, createRegistryQueryService } from "../src/query.js";

describe("turkey live demo query service", () => {
  it("searches fixture provinces and districts without loading a nationwide GeoJSON upfront", async () => {
    const query = createFixtureQueryService();
    const cacheBefore = await query.getCacheTelemetry();
    const results = await query.search("fatih", { levels: ["ADM1", "ADM2"], limit: 10 });

    expect(cacheBefore.loadedLevels).toEqual(["ADM0", "ADM1", "ADM2", "ADM3"]);
    expect(results.map((result) => result.id)).toContain("tr:adm2:fatih");
  });

  it("returns coordinate lookup details with parent, children and neighbors", async () => {
    const query = createFixtureQueryService();
    const details = await query.locate({ lng: 28.965, lat: 41.03 }, { level: "ADM3" });

    expect(details?.zone.id).toBe("tr:adm3:demo-neighbourhood-b");
    expect(details?.parent?.id).toBe("tr:adm2:fatih");
    expect(details?.neighbors.map((zone) => zone.id)).toEqual([
      "tr:adm3:demo-neighbourhood-a",
      "tr:adm3:demo-neighbourhood-c"
    ]);
  });

  it("loads registry query artifacts only for requested levels", async () => {
    const dataset = createTurkeyAdm3DemoDataset();
    const calls: TerritoryAdminLevel[][] = [];
    const registry = createFakeRegistry(dataset, calls);
    const query = createRegistryQueryService({
      registry,
      datasetId: "territory-kit-tr",
      datasetVersion: "1.0.0",
      datasetVersionPinned: true,
      allowPrerelease: false
    });

    const results = await query.search("istanbul", { levels: ["ADM1"], limit: 10 });

    expect(results.map((result) => result.id)).toEqual(["tr:adm1:istanbul"]);
    expect(calls).toEqual([["ADM1"]]);
  });
});

function createFakeRegistry(
  dataset: TerritoryDataset,
  calls: TerritoryAdminLevel[][]
): TerritoryRegistryClient {
  return {
    async installDataset(options: TerritoryRegistryInstallOptions) {
      const levels = options.levels ?? ["ADM0", "ADM1", "ADM2", "ADM3"];
      calls.push([...levels]);

      return {
        dataset: {
          id: "territory-kit-tr",
          displayName: "Turkey",
          version: "1.0.0",
          schemaVersion: "territory-schema@1",
          levels,
          source: { provider: "fixture-registry" },
          license: { id: "Apache-2.0", attribution: "Fixture registry" },
          artifacts: []
        },
        registryHash: "fixture-registry-hash",
        installedArtifacts: levels.map((level) => ({
          key: { datasetId: "territory-kit-tr", version: "1.0.0", artifactId: level },
          artifact: {
            id: level,
            purpose: "query",
            format: "territory-json",
            levels: [level],
            path: `levels/${level}/dataset.json`,
            url: `levels/${level}/dataset.json`,
            sha256: "fixture",
            sizeBytes: 1
          },
          metadata: {
            datasetId: "territory-kit-tr",
            version: "1.0.0",
            artifactId: level,
            sha256: "fixture",
            sizeBytes: 1,
            installedAt: "2026-01-01T00:00:00.000Z",
            sourceUrl: `https://datasets.example.test/levels/${level}/dataset.json`,
            registryHash: "fixture-registry-hash",
            compression: "none",
            path: `levels/${level}/dataset.json`
          },
          bytes: new Uint8Array()
        })),
        manifest: {
          datasetId: "territory-kit-tr",
          version: "1.0.0",
          artifactCount: levels.length,
          installedAt: "2026-01-01T00:00:00.000Z",
          verified: true,
          registryHash: "fixture-registry-hash"
        },
        readText(path: string) {
          const level = path.split("/")[1] as TerritoryAdminLevel;
          const levelDataset = {
            ...dataset,
            manifest: { ...dataset.manifest, adminLevels: [level] },
            zones: dataset.zones.filter((zone) => zone.level === Number(level.slice(3)))
          };
          return Promise.resolve(JSON.stringify(levelDataset));
        },
        readBytes() {
          return Promise.resolve(new Uint8Array());
        },
        resolveArtifact(path: string) {
          return this.readText(path);
        }
      };
    },
    loadRegistry: notImplemented,
    listDatasets: notImplemented,
    searchDatasets: notImplemented,
    getDatasetInfo: notImplemented,
    resolveArtifact: notImplemented,
    resolveTerritoryArtifact: notImplemented,
    resolveDeepestAvailableTerritoryArtifact: notImplemented,
    updateDataset: notImplemented,
    verifyInstalledDataset: notImplemented,
    removeInstalledDataset: notImplemented,
    listInstalledDatasets: notImplemented
  };
}

function notImplemented(): never {
  throw new Error("Not implemented in query test fake.");
}
