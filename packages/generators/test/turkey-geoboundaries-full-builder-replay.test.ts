import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import { parseTerritoryCountrySourceFeatures } from "../src/countries/builder.js";
import {
  createTurkeyGeoBoundariesHistoricalCountryConfig,
  verifyTurkeyGeoBoundariesFullBuilderReplay
} from "../src/turkey-geoboundaries-full-builder-replay.js";
import { analyzeGeoBoundariesFeatureCollection } from "../src/turkey-geoboundaries-parent-lineage.js";
import { auditGeometryHash } from "../src/turkey-parent-provenance.js";
import { repairTerritoryGeometries } from "../src/geometry-repair.js";

const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/tr-geoboundaries-parent"
);

describe("turkey-geoboundaries-full-builder-replay", () => {
  it("uses shapeID adapter mapping in historical config", () => {
    const config = createTurkeyGeoBoundariesHistoricalCountryConfig();
    expect(config.levelMappings.ADM0?.sourceIdProperty).toBe("shapeID");
  });

  it("parses fixture geojson through country adapter", async () => {
    const sourcePath = join(FIXTURE_ROOT, "gb-adm0-tiny.geojson");
    const collection = JSON.parse(await readFile(sourcePath, "utf8"));
    const config = createTurkeyGeoBoundariesHistoricalCountryConfig();
    const features = parseTerritoryCountrySourceFeatures(collection, {
      config,
      level: "ADM0"
    });
    expect(features).toHaveLength(1);
    expect(features[0]?.sourceId).toBeTruthy();
  });

  it("repairs serialization-only fixture to stable audit hash", async () => {
    const serialization = JSON.parse(
      await readFile(join(FIXTURE_ROOT, "gb-adm0-serialization-only.geojson"), "utf8")
    );
    const parentGeom = serialization.features[0].geometry;
    const repairedSerialization = await repairTerritoryGeometries([
      { id: "0", geometry: serialization.features[0].geometry }
    ]);
    const parentHash = auditGeometryHash(parentGeom);
    expect(auditGeometryHash(repairedSerialization.results[0]!.geometry!)).toBe(parentHash);
  });

  it("does not authorize production migration from replay helper", () => {
    const verification = verifyTurkeyGeoBoundariesFullBuilderReplay({
      schemaVersion: "territorykit-tr-geoboundaries-full-builder-replay@1",
      classification: "FULL_REPLAY_VERIFIED",
      pathBTechnicalRecommendation: "PARTIAL",
      legalReviewStatus: "PENDING_REVIEW",
      migrationAuthorizationStatus: "NOT_AUTHORIZED",
      replayConfiguration: {},
      inputChecksums: {},
      replaySummary: {
        ADM0: { identityMatched: 1, geometryHashMatches: 1, geometryHashMismatches: 0 },
        ADM1: { identityMatched: 0, geometryHashMatches: 0, geometryHashMismatches: 0 },
        ADM2: { identityMatched: 0, geometryHashMatches: 0, geometryHashMismatches: 0 }
      },
      determinism: {
        firstRunDatasetSha256: null,
        secondRunDatasetSha256: null,
        byteIdentical: false,
        skipped: true
      },
      reportPaths: {}
    });
    expect(verification.ok).toBe(true);
  });

  it("verifies fixture source lock SHA-256 when bytes match", async () => {
    const artifactPath = join(
      FIXTURE_ROOT,
      "cache/af72983854237239724ecee55a93936764dc349689e1486b5f53cccd2069f9ac/artifact"
    );
    const bytes = await readFile(artifactPath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const lock = JSON.parse(await readFile(join(FIXTURE_ROOT, "source-lock.json"), "utf8"));
    expect(lock.levels.ADM0.sha256).toBe(sha256);
  });

  it("analyzeGeoBoundariesFeatureCollection matches adapter feature count on fixture", async () => {
    const collection = JSON.parse(
      await readFile(join(FIXTURE_ROOT, "gb-adm0-tiny.geojson"), "utf8")
    );
    const analyzed = analyzeGeoBoundariesFeatureCollection(collection);
    const config = createTurkeyGeoBoundariesHistoricalCountryConfig();
    const adapted = parseTerritoryCountrySourceFeatures(collection, { config, level: "ADM0" });
    expect(analyzed.parsedFeatureCount).toBe(adapted.length);
  });
});

function zone(input: {
  id: string;
  level: number;
  sourceId: string;
  geometry: TerritoryZone["geometry"];
}): TerritoryZone {
  return {
    id: input.id,
    datasetId: "fixture",
    countryCode: "TR",
    level: input.level,
    sourceAdminLevel: "ADM0",
    semanticType: "country",
    name: "Test",
    neighborIds: [],
    geometry: input.geometry,
    center: [0, 0],
    bbox: [0, 0, 1, 1],
    properties: {
      territory: { source: { provider: "geoboundaries", sourceId: input.sourceId } }
    }
  };
}

describe("turkey-geoboundaries-full-builder-replay fixtures", () => {
  it("keeps stable id comparison shape for parent zones", () => {
    const dataset: TerritoryDataset = {
      manifest: {
        datasetId: "x",
        datasetVersion: "1",
        schemaVersion: "territory-schema@1",
        sourceDate: "2026-01-01",
        buildDate: "2026-01-01T00:00:00.000Z",
        geometryHash: "x",
        adminLevels: ["ADM0"],
        countryCodes: ["TR"],
        crs: "EPSG:4326",
        geometryDetail: "source",
        license: "x",
        attribution: "x"
      },
      zones: [
        zone({
          id: "tr:adm0:tr",
          level: 0,
          sourceId: "shape-1",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0]
              ]
            ]
          }
        })
      ]
    };
    expect(dataset.zones[0]?.id).toMatch(/^tr:adm0:/);
  });
});
