import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAllTerritoryCountryDatasets,
  buildTerritoryCountryDatasetPath,
  createTerritoryCountryIdentity,
  createTerritoryCountrySourceLock,
  getTerritoryCountryConfig,
  inspectTerritoryCountryDatasetPath,
  listTerritoryCountryConfigs,
  validateTerritoryCountryDatasetPath,
  verifyTerritoryCountrySourceLock
} from "../src/index.js";
import type { TerritoryAdminLevel } from "@territory-kit/dataset";
import type { ParsedCountryFeature } from "../src/index.js";

const FIXTURE_BUILD_DATE = "2026-01-01T00:00:00.000Z";

describe("pilot country dataset pipeline", () => {
  it("registers the Sprint 5 pilot country configs deterministically", () => {
    const configs = listTerritoryCountryConfigs();

    expect(configs).toHaveLength(249);
    expect(configs.map((config) => config.countryCodeAlpha2)).toEqual(
      [...configs.map((config) => config.countryCodeAlpha2)].sort()
    );
    expect(configs.map((config) => config.countryCodeAlpha2)).toEqual(
      expect.arrayContaining(["DE", "ID", "JP", "TR", "US"])
    );
    expect(getTerritoryCountryConfig("USA").loaderPackageName).toBe("@territory-kit/data-us");
    expect(getTerritoryCountryConfig("tr").requestedLevels).toEqual(["ADM0", "ADM1", "ADM2"]);
    expect(getTerritoryCountryConfig("FR")).toMatchObject({
      reviewRequired: true,
      levelMappings: {
        ADM1: { semanticType: "unknown", reviewRequired: true },
        ADM2: { semanticType: "unknown", reviewRequired: true }
      }
    });
  });

  it("creates reproducible source locks and builds publish-ready country artifacts", async () => {
    const fixture = await createCountrySourceFixture("TR");
    const sourceLockPath = join(fixture.tempDir, "sources.lock.json");
    const outputPath = join(fixture.tempDir, "artifact");

    try {
      const firstLock = await createTerritoryCountrySourceLock({
        country: "TR",
        levels: ["ADM0", "ADM1", "ADM2"],
        metadataPath: fixture.metadataPath,
        outputPath: sourceLockPath,
        buildDate: FIXTURE_BUILD_DATE
      });
      const secondLock = await createTerritoryCountrySourceLock({
        country: "TR",
        levels: ["ADM0", "ADM1", "ADM2"],
        metadataPath: fixture.metadataPath,
        buildDate: FIXTURE_BUILD_DATE
      });

      expect(firstLock.issues).toEqual([]);
      expect(firstLock.lock?.contentHash).toBe(secondLock.lock?.contentHash);
      expect(firstLock.lock?.levels.ADM1?.sha256).toHaveLength(64);
      expect(firstLock.lock && (await verifyTerritoryCountrySourceLock(firstLock.lock)).ok).toBe(
        true
      );

      const build = await buildTerritoryCountryDatasetPath({
        country: "TR",
        sourceLockPath,
        outputPath,
        buildAdjacency: true,
        strict: true,
        buildDate: FIXTURE_BUILD_DATE
      });

      expect(build.issues).toEqual([]);
      expect(build.manifest).toMatchObject({
        country: { alpha2: "TR", alpha3: "TUR" },
        publishReady: true,
        supportedLevels: ["ADM0", "ADM1", "ADM2"],
        featureCountByLevel: {
          ADM0: 1,
          ADM1: 2,
          ADM2: 4
        }
      });
      expect(build.buildReport.statistics.adjacencyEdgeCountByLevel).toEqual({
        ADM1: 1,
        ADM2: 2
      });

      await expect(
        validateTerritoryCountryDatasetPath(outputPath, { strict: true })
      ).resolves.toMatchObject({
        ok: true,
        issues: []
      });
      await expect(inspectTerritoryCountryDatasetPath(outputPath)).resolves.toMatchObject({
        country: "TR",
        publishReady: true,
        adjacency: {
          ADM1: 1,
          ADM2: 2
        }
      });
    } finally {
      await rm(fixture.tempDir, { force: true, recursive: true });
    }
  });

  it("handles a pilot country source with MultiPolygon ADM0 geometry", async () => {
    const fixture = await createCountrySourceFixture("ID", { adm0MultiPolygon: true });
    const sourceLockPath = join(fixture.tempDir, "sources.lock.json");
    const outputPath = join(fixture.tempDir, "artifact");

    try {
      await createTerritoryCountrySourceLock({
        country: "ID",
        levels: ["ADM0", "ADM1", "ADM2"],
        metadataPath: fixture.metadataPath,
        outputPath: sourceLockPath,
        buildDate: FIXTURE_BUILD_DATE
      });

      const build = await buildTerritoryCountryDatasetPath({
        country: "ID",
        sourceLockPath,
        outputPath,
        strict: true,
        buildDate: FIXTURE_BUILD_DATE
      });

      expect(build.issues).toEqual([]);
      expect(build.buildReport.statistics.multiPolygonCount).toBe(1);
      expect(build.manifest.publishReady).toBe(true);
    } finally {
      await rm(fixture.tempDir, { force: true, recursive: true });
    }
  });

  it("keeps same-name fallback identities stable under different parents", () => {
    const config = getTerritoryCountryConfig("US");
    const left = createTerritoryCountryIdentity({
      config,
      adminLevel: "ADM2",
      feature: fallbackFeature("Central", 0),
      parentKey: "state-left"
    });
    const right = createTerritoryCountryIdentity({
      config,
      adminLevel: "ADM2",
      feature: fallbackFeature("Central", 1),
      parentKey: "state-right"
    });

    expect(left.stability).toBe("name-parent-fallback");
    expect(right.stability).toBe("name-parent-fallback");
    expect(left.territoryId).not.toBe(right.territoryId);
  });

  it("classifies a built country with an unavailable sibling level as partial", async () => {
    const fixture = await createCountrySourceFixture("TR", {
      omittedMetadataLevels: ["ADM2"]
    });
    const outputRoot = join(fixture.tempDir, "generated");
    const sourceLockPath = join(outputRoot, "TR", "sources.lock.json");

    try {
      await createTerritoryCountrySourceLock({
        country: "TR",
        levels: ["ADM0", "ADM1", "ADM2"],
        metadataPath: fixture.metadataPath,
        outputPath: sourceLockPath,
        buildDate: FIXTURE_BUILD_DATE
      });

      const report = await buildAllTerritoryCountryDatasets({
        countries: ["TR"],
        levels: ["ADM1", "ADM2"],
        outputRoot,
        offline: true,
        concurrency: 1,
        buildDate: FIXTURE_BUILD_DATE,
        cwd: fixture.tempDir,
        force: true
      });

      expect(report).toMatchObject({
        countriesAttempted: 1,
        countriesSucceeded: 0,
        countriesFailed: 1,
        outcomes: {
          partial: 1
        }
      });
      expect(report.results[0]).toMatchObject({
        country: "TR",
        outcome: "partial",
        levels: [
          {
            level: "ADM1",
            outcome: "built",
            lifecycle: {
              sourceStatus: "available",
              artifactStatus: "built",
              loaderStatus: "passed"
            }
          },
          {
            level: "ADM2",
            outcome: "source-unavailable",
            lifecycle: {
              sourceStatus: "unavailable",
              artifactStatus: "not-attempted",
              loaderStatus: "not-run"
            }
          }
        ]
      });
    } finally {
      await rm(fixture.tempDir, { force: true, recursive: true });
    }
  });
});

async function createCountrySourceFixture(
  country: string,
  options: { adm0MultiPolygon?: boolean; omittedMetadataLevels?: TerritoryAdminLevel[] } = {}
): Promise<{ tempDir: string; metadataPath: string }> {
  const config = getTerritoryCountryConfig(country);
  const tempDir = await mkdtemp(
    join(tmpdir(), `territory-kit-country-${config.countryCodeAlpha2}-`)
  );
  const files: Record<TerritoryAdminLevel, string> = {
    ADM0: join(tempDir, "adm0.geojson"),
    ADM1: join(tempDir, "adm1.geojson"),
    ADM2: join(tempDir, "adm2.geojson"),
    ADM3: join(tempDir, "adm3.geojson"),
    ADM4: join(tempDir, "adm4.geojson")
  };
  const sourceVersion = `${config.countryCodeAlpha2.toLowerCase()}-fixture-1`;

  await writeFile(
    files.ADM0,
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        sourceFeature({
          id: `${config.countryCodeAlpha2}-ADM0`,
          shapeID: config.countryCodeAlpha2,
          name: config.displayName,
          type: "country",
          officialCode: config.countryCodeAlpha2,
          geometry: options.adm0MultiPolygon ? adm0MultiPolygon() : square(0, 0, 10, 10)
        })
      ]
    }),
    "utf8"
  );
  await writeFile(
    files.ADM1,
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        sourceFeature({
          id: `${config.countryCodeAlpha2}-ADM1-1`,
          shapeID: `${config.countryCodeAlpha2}-01`,
          parentShapeID: config.countryCodeAlpha2,
          name: "Alpha",
          type: "province",
          officialCode: `${config.countryCodeAlpha2}-01`,
          geometry: square(0, 0, 5, 10)
        }),
        sourceFeature({
          id: `${config.countryCodeAlpha2}-ADM1-2`,
          shapeID: `${config.countryCodeAlpha2}-02`,
          parentShapeID: config.countryCodeAlpha2,
          name: "Beta",
          type: "province",
          officialCode: `${config.countryCodeAlpha2}-02`,
          geometry: square(5, 0, 10, 10)
        })
      ]
    }),
    "utf8"
  );
  await writeFile(
    files.ADM2,
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        sourceFeature({
          id: `${config.countryCodeAlpha2}-ADM2-1`,
          shapeID: `${config.countryCodeAlpha2}-01-A`,
          parentShapeID: `${config.countryCodeAlpha2}-01`,
          name: "Alpha North",
          type: "district",
          officialCode: `${config.countryCodeAlpha2}-01-A`,
          geometry: square(0, 0, 5, 5)
        }),
        sourceFeature({
          id: `${config.countryCodeAlpha2}-ADM2-2`,
          shapeID: `${config.countryCodeAlpha2}-01-B`,
          parentShapeID: `${config.countryCodeAlpha2}-01`,
          name: "Alpha South",
          type: "district",
          officialCode: `${config.countryCodeAlpha2}-01-B`,
          geometry: square(0, 5, 5, 10)
        }),
        sourceFeature({
          id: `${config.countryCodeAlpha2}-ADM2-3`,
          shapeID: `${config.countryCodeAlpha2}-02-A`,
          parentShapeID: `${config.countryCodeAlpha2}-02`,
          name: "Beta North",
          type: "district",
          officialCode: `${config.countryCodeAlpha2}-02-A`,
          geometry: square(5, 0, 10, 5)
        }),
        sourceFeature({
          id: `${config.countryCodeAlpha2}-ADM2-4`,
          shapeID: `${config.countryCodeAlpha2}-02-B`,
          parentShapeID: `${config.countryCodeAlpha2}-02`,
          name: "Beta South",
          type: "district",
          officialCode: `${config.countryCodeAlpha2}-02-B`,
          geometry: square(5, 5, 10, 10)
        })
      ]
    }),
    "utf8"
  );

  const metadataPath = join(tempDir, "metadata.json");
  await writeFile(
    metadataPath,
    JSON.stringify(
      (["ADM0", "ADM1", "ADM2"] as TerritoryAdminLevel[])
        .filter((adminLevel) => !(options.omittedMetadataLevels ?? []).includes(adminLevel))
        .map((adminLevel) => ({
          countryCodeAlpha3: config.countryCodeAlpha3,
          adminLevel,
          releaseType: "gbOpen",
          sourceUrl: files[adminLevel],
          sourceVersion,
          boundaryYearRepresented: "2026",
          license: "CC BY 4.0",
          licenseDetail: "fixture://license",
          attribution: `Synthetic ${config.countryCodeAlpha2} ${adminLevel} fixture`
        }))
    ),
    "utf8"
  );

  return { tempDir, metadataPath };
}

function sourceFeature(input: {
  id?: string;
  shapeID: string;
  parentShapeID?: string;
  name: string;
  type: string;
  officialCode: string;
  geometry: unknown;
}): unknown {
  return {
    type: "Feature",
    ...(input.id ? { id: input.id } : {}),
    properties: {
      shapeID: input.shapeID,
      ...(input.parentShapeID ? { parentShapeID: input.parentShapeID } : {}),
      shapeName: input.name,
      shapeType: input.type,
      officialCode: input.officialCode
    },
    geometry: input.geometry
  };
}

function fallbackFeature(name: string, offset: number): ParsedCountryFeature {
  return {
    name,
    localType: "district",
    geometry: square(offset, offset, offset + 1, offset + 1) as ParsedCountryFeature["geometry"],
    rawProperties: {}
  };
}

function square(west: number, south: number, east: number, north: number): unknown {
  return {
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
  };
}

function adm0MultiPolygon(): unknown {
  return {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0]
        ]
      ],
      [
        [
          [20, 0],
          [21, 0],
          [21, 1],
          [20, 1],
          [20, 0]
        ]
      ]
    ]
  };
}
