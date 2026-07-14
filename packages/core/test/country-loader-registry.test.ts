import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it } from "vitest";
import {
  createTerritoryCountryDatasetDescriptor,
  loadTerritoryCountryDataset
} from "../src/country-loader.js";
import { createTerritoryRegistryClient } from "../src/index.js";
import type { TerritoryDatasetRegistry, TerritoryRegistryTransport } from "@territory-kit/registry";

describe("country loader registry integration", () => {
  it("loads a country dataset through a registry-backed artifact resolver", async () => {
    const dataset = createSampleTerritoryDataset();
    const files = new Map([
      [
        "manifest.json",
        stableJson({
          manifestVersion: "1",
          datasetId: "sample-country",
          datasetVersion: "1.0.0",
          schemaVersion: "territory-schema@1",
          supportedLevels: ["ADM0"]
        })
      ],
      ["levels/ADM0/dataset.json", stableJson(dataset)]
    ]);
    files.set(
      "checksums.json",
      stableJson({
        files: Object.fromEntries(
          await Promise.all(
            [...files.entries()].map(async ([path, content]) => [path, await sha256(content)])
          )
        )
      })
    );

    const registry: TerritoryDatasetRegistry = {
      registryVersion: "1",
      generatedAt: "2026-01-01T00:00:00.000Z",
      baseUrl: "https://registry.example.test/artifacts/",
      datasets: [
        {
          id: "sample-country",
          displayName: "Sample Country",
          version: "1.0.0",
          schemaVersion: "territory-schema@1",
          levels: ["ADM0"],
          source: { provider: "fixture" },
          license: { id: "Apache-2.0", attribution: "fixture" },
          artifacts: await Promise.all(
            [...files.entries()].map(async ([path, content]) => ({
              id: path
                .replace(/[^a-z0-9]+/gi, "-")
                .replace(/^-|-$/g, "")
                .toLowerCase(),
              purpose: path.startsWith("levels/") ? ("query" as const) : ("metadata" as const),
              format: "territory-json" as const,
              ...(path.startsWith("levels/") ? { levels: ["ADM0" as const] } : {}),
              path,
              url: path,
              sha256: await sha256(content),
              sizeBytes: textToBytes(content).byteLength,
              compression: "none" as const,
              contentType: "application/json"
            }))
          )
        }
      ]
    };

    const registryClient = createTerritoryRegistryClient({
      registry,
      transport: createMemoryTransport(files)
    });
    const descriptor = createTerritoryCountryDatasetDescriptor({
      datasetId: "sample-country",
      countryCodeAlpha2: "SC",
      countryCodeAlpha3: "SCP",
      packageName: "@territory-kit/data-sample",
      schemaVersion: "territory-schema@1",
      supportedLevels: ["ADM0"],
      defaultLevels: ["ADM0"],
      manifestPath: "manifest.json",
      requiresResolver: true
    });
    const handle = await loadTerritoryCountryDataset(descriptor, {
      registry: registryClient,
      levels: ["ADM0"],
      verifyChecksums: true
    });

    expect(handle.levels.ADM0?.manifest.datasetId).toBe("territorykit-sample");
  });
});

function createMemoryTransport(files: ReadonlyMap<string, string>): TerritoryRegistryTransport {
  return {
    async fetch(request) {
      const path = new URL(request.url).pathname.replace(/^\/artifacts\//, "");
      const content = files.get(path);

      if (!content) {
        throw new Error(`Missing fixture artifact ${path}.`);
      }

      const bytes = textToBytes(content);

      return {
        bytes,
        url: request.url,
        sizeBytes: bytes.byteLength,
        contentType: "application/json"
      };
    }
  };
}

function stableJson(input: unknown): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

async function sha256(input: string): Promise<string> {
  const bytes = textToBytes(input);
  const buffer =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function textToBytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}
