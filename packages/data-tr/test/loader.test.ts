import { describe, expect, it } from "vitest";
import {
  defaultTurkeyAdminLevels,
  isTurkeyAdm3ParentCovered,
  loadTurkeyDataset,
  loadTurkeyV2NationalDataset,
  resolveTurkeyDataset,
  supportedTurkeyAdminLevels,
  turkeyAdm3NeighbourhoodCoverage,
  turkeyDatasetDescriptor,
  turkeyNationalCoverage,
  turkeyV2DataContract,
  turkeyV2NationalDatasetDescriptor,
  turkeyV2NationalPlayableCoverage
} from "../src/index.js";

describe("@territory-kit/data-tr", () => {
  it("describes a thin resolver-driven country loader", async () => {
    expect(turkeyDatasetDescriptor).toMatchObject({
      countryCodeAlpha2: "TR",
      countryCodeAlpha3: "TUR",
      packageName: "@territory-kit/data-tr",
      requiresResolver: true
    });
    expect(supportedTurkeyAdminLevels).toEqual(["ADM0", "ADM1", "ADM2", "ADM3", "ADM4"]);
    expect(defaultTurkeyAdminLevels).toEqual(["ADM0", "ADM1", "ADM2"]);
    expect(turkeyNationalCoverage.levels.ADM2).toMatchObject({
      status: "verified",
      featureCount: 973
    });
    await expect(loadTurkeyDataset({})).rejects.toThrow("does not embed geometry artifacts");
  });

  it("describes the Turkey V2 national playable resolver target", () => {
    expect(turkeyV2NationalDatasetDescriptor).toMatchObject({
      datasetId: "territory-kit-tr-v2-playable",
      supportedLevels: ["ADM0", "ADM1", "ADM2", "ADM3"],
      defaultLevels: ["ADM0", "ADM1", "ADM2"],
      requiresResolver: true
    });
    expect(turkeyV2DataContract).toMatchObject({
      targetDatasetVersion: "2.0.0-rc.1",
      generatedZonesAreOfficialAdministrativeAreas: false,
      nationalAdm3PolygonBuildIncluded: true
    });
    expect(turkeyV2NationalPlayableCoverage).toMatchObject({
      datasetId: "territory-kit-tr-v2-playable",
      releaseChannel: "prerelease",
      adm3: {
        status: "playable-national-hybrid",
        generatedFallback: true,
        minimumDistrictCoveragePercent: 99.99
      },
      packaging: {
        embedsGeometry: false,
        requiresResolver: true
      }
    });
    expect(resolveTurkeyDataset().variant).toBe("legacy");
    expect(resolveTurkeyDataset({ includePlayableAdm3: true })).toMatchObject({
      variant: "v2-national-playable",
      descriptor: { datasetId: "territory-kit-tr-v2-playable" }
    });
  });

  it("exposes partial Gaziantep ADM3 availability without bundling geometry", () => {
    expect(turkeyAdm3NeighbourhoodCoverage).toMatchObject({
      level: "ADM3",
      semanticType: "neighbourhood",
      localTypeName: "Mahalle",
      status: "partial",
      license: "CC BY 4.0"
    });
    expect(turkeyAdm3NeighbourhoodCoverage.coveredParentIds).toHaveLength(9);
    expect(isTurkeyAdm3ParentCovered("tr:adm2:54988432b26387222249237")).toBe(true);
    expect(isTurkeyAdm3ParentCovered("tr:adm2:not-covered")).toBe(false);
  });

  it("loads through a registry-style artifact resolver with checksum verification", async () => {
    const dataset = createMinimalTurkeyDataset();
    const files = new Map([
      [
        "manifest.json",
        stableJson({
          manifestVersion: "1",
          datasetId: "territory-kit-tr",
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

    const handle = await loadTurkeyDataset({
      levels: ["ADM0"],
      verifyChecksums: true,
      registry: {
        async installDataset(request) {
          expect(request).toMatchObject({
            datasetId: "territory-kit-tr",
            levels: ["ADM0"]
          });

          return {
            async resolveArtifact(path: string) {
              const content = files.get(path);

              if (!content) {
                throw new Error(`Missing fixture artifact ${path}.`);
              }

              return content;
            }
          };
        }
      }
    });

    expect(handle.levels.ADM0?.manifest.datasetId).toBe("territory-kit-tr");
  });

  it("loads the Turkey V2 national dataset with rich checksum entries", async () => {
    const dataset = createMinimalTurkeyDataset({ datasetId: "territory-kit-tr-v2-playable" });
    const files = new Map([
      [
        "manifest.json",
        stableJson({
          manifestVersion: "1",
          datasetId: "territory-kit-tr-v2-playable",
          datasetVersion: "2.0.0-rc.1",
          schemaVersion: "territory-schema@1",
          supportedLevels: ["ADM0"]
        })
      ],
      ["levels/ADM0/dataset.json", stableJson(dataset)]
    ]);
    files.set(
      "checksums.json",
      stableJson({
        schemaVersion: "territorykit-tr-v2-national-checksums@1",
        files: Object.fromEntries(
          await Promise.all(
            [...files.entries()].map(async ([path, content]) => [
              path,
              {
                sha256: await sha256(content),
                byteSize: new TextEncoder().encode(content).byteLength
              }
            ])
          )
        )
      })
    );

    const handle = await loadTurkeyV2NationalDataset({
      levels: ["ADM0"],
      verifyChecksums: true,
      resolveArtifact: async (path) => {
        const content = files.get(path);

        if (!content) {
          throw new Error(`Missing fixture artifact ${path}.`);
        }

        return content;
      }
    });

    expect(handle.descriptor.datasetId).toBe("territory-kit-tr-v2-playable");
    expect(handle.levels.ADM0?.manifest.datasetVersion).toBe("2.0.0-rc.1");
  });
});

function createMinimalTurkeyDataset(input: { datasetId?: string } = {}): unknown {
  const datasetId = input.datasetId ?? "territory-kit-tr";
  return {
    manifest: {
      datasetId,
      datasetVersion: datasetId === "territory-kit-tr-v2-playable" ? "2.0.0-rc.1" : "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-01-01",
      geometryHash: "territory-kit-tr-fixture-v1",
      adminLevels: ["ADM0"],
      license: "Apache-2.0",
      attribution: "fixture"
    },
    zones: [
      {
        id: "tr",
        datasetId,
        countryCode: "TR",
        level: 0,
        sourceAdminLevel: "ADM0",
        semanticType: "country",
        name: "Turkiye",
        neighborIds: [],
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [25, 35],
              [45, 35],
              [45, 42],
              [25, 42],
              [25, 35]
            ]
          ]
        },
        center: [35, 38.5],
        bbox: [25, 35, 45, 42],
        properties: {}
      }
    ]
  };
}

function stableJson(input: unknown): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buffer =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
