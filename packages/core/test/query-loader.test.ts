import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it } from "vitest";
import { loadTerritoryQueryDataset } from "../src/index.js";
import type {
  TerritoryInstalledDatasetArtifactResolver,
  TerritoryRegistryLike
} from "../src/index.js";

describe("loadTerritoryQueryDataset", () => {
  it("loads registry-installed query artifacts into multi-level lookup helpers", async () => {
    const dataset = createSampleTerritoryDataset();
    const datasetWithoutChildIds = {
      ...dataset,
      zones: dataset.zones.map((zone) =>
        zone.id === "world:europe" ? { ...zone, childIds: undefined } : zone
      )
    };
    const text = JSON.stringify(datasetWithoutChildIds);
    const registry: TerritoryRegistryLike = {
      async installDataset() {
        return createInstalledHandle(text);
      }
    };
    const query = await loadTerritoryQueryDataset({
      registry,
      datasetId: "sample",
      levels: ["ADM0"]
    });

    expect(query.datasetId).toBe("sample");
    expect(query.levels).toEqual(["ADM0"]);
    expect(query.getZoneById("world:europe")?.id).toBe("world:europe");
    expect(query.latLngToZone({ lat: 41.01, lng: 28.95 })).toBe("tr:34:fatih");
    expect(query.latLngToZone({ lat: 41.01, lng: 28.95 }, { level: 0 })).toBe("world:europe");
    expect(query.latLngToZone({ lat: 41.01, lng: 28.95 }, { level: 99 })).toBeNull();
    expect(query.getParent("world:europe")).toBeUndefined();
    expect(query.getChildren("world:europe")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "tr" })])
    );
  });

  it("rejects registry handles that do not expose installed artifacts", async () => {
    const registry: TerritoryRegistryLike = {
      async installDataset() {
        return {
          async resolveArtifact() {
            return "{}";
          }
        };
      }
    };

    await expect(
      loadTerritoryQueryDataset({
        registry,
        datasetId: "sample"
      })
    ).rejects.toThrow("Registry query loading requires an installed dataset handle.");
  });
});

function createInstalledHandle(text: string): TerritoryInstalledDatasetArtifactResolver {
  return {
    installedArtifacts: [
      {
        artifact: {}
      },
      {
        artifact: {
          path: "metadata/manifest.json"
        }
      },
      {
        artifact: {
          path: "levels//dataset.json"
        }
      },
      {
        artifact: {
          path: "levels/ADM0/dataset.json"
        }
      }
    ],
    async readText(path) {
      if (path !== "levels/ADM0/dataset.json") {
        throw new Error(`Unexpected fixture path ${path}.`);
      }

      return text;
    },
    async resolveArtifact() {
      return text;
    }
  };
}
