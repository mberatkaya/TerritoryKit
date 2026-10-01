import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createTurkeyAdm3DemoDataset } from "@territory-kit/shared-testkit";
import type { TerritoryAdminLevel, TerritoryDataset } from "@territory-kit/dataset";
import type { TerritoryRegistryClient } from "@territory-kit/registry";
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

  it("never installs national ADM3 query data during ordinary lookup", async () => {
    const calls: TerritoryAdminLevel[][] = [];
    const registry = createFakeRegistry(createTurkeyAdm3DemoDataset(), calls);
    const query = createRegistryQueryService({
      registry,
      datasetId: "territory-kit-tr",
      datasetVersion: "1.0.0",
      datasetVersionPinned: true,
      allowPrerelease: false
    });
    await expect(query.locate({ lng: 28.965, lat: 41.03 }, { level: "ADM3" })).rejects.toThrow();
    expect(calls).toEqual([["ADM2"], ["ADM3"]]);
  });
});

function createFakeRegistry(
  dataset: TerritoryDataset,
  calls: TerritoryAdminLevel[][]
): TerritoryRegistryClient {
  return {
    async resolveTerritoryArtifact(options: { level: TerritoryAdminLevel }) {
      const level = options.level;
      calls.push([level]);
      const levelDataset = {
        ...dataset,
        manifest: { ...dataset.manifest, datasetVersion: "1.0.0", adminLevels: [level] },
        zones: dataset.zones.filter((zone) => zone.level === Number(level.slice(3)))
      };
      const body = Buffer.from(JSON.stringify(levelDataset));
      const path = `levels/${level}/dataset.json`;
      return {
        dataset: { id: "territory-kit-tr", version: "1.0.0" },
        artifact: {
          id: level,
          purpose: "query",
          format: "territory-json",
          levels: [level],
          path,
          url: path,
          sha256: createHash("sha256").update(body).digest("hex"),
          sizeBytes: body.byteLength
        },
        registryHash: "fixture-registry-hash",
        requestedLevel: level,
        resolvedLevel: level,
        exactMatch: true,
        coverageStatus: "verified",
        reason: "exact-match",
        url: `data:application/json;base64,${body.toString("base64")}`
      };
    },
    installDataset() {
      throw new Error("National install must not be used by the demo.");
    }
  } as unknown as TerritoryRegistryClient;
}
