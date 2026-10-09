import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TerritoryDataset, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import { geometryToClippingMultiPolygon } from "../src/turkey-adm3-full-coverage.js";
import { parseTerritoryCountrySourceFeatures } from "../src/countries/builder.js";
import {
  assessGeographicPair,
  assessMismatchRootCause,
  classifyFullBuilderReplay,
  createTurkeyGeoBoundariesHistoricalCountryConfig,
  validateReplayCoverageGate,
  verifyTurkeyGeoBoundariesFullBuilderReplay
} from "../src/turkey-geoboundaries-full-builder-replay.js";
import { analyzeGeoBoundariesFeatureCollection } from "../src/turkey-geoboundaries-parent-lineage.js";
import {
  TURKEY_PARENT_INVENTORY_EXPECTED,
  auditGeometryHash
} from "../src/turkey-parent-provenance.js";
import { repairTerritoryGeometries } from "../src/geometry-repair.js";

const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/tr-geoboundaries-parent"
);

const square: TerritoryGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [28, 40],
      [29, 40],
      [29, 41],
      [28, 41],
      [28, 40]
    ]
  ]
};

const squareWithHole: TerritoryGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [28, 40],
      [29, 40],
      [29, 41],
      [28, 41],
      [28, 40]
    ],
    [
      [28.2, 40.2],
      [28.8, 40.2],
      [28.8, 40.8],
      [28.2, 40.8],
      [28.2, 40.2]
    ]
  ]
};

const multi: TerritoryGeometry = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [27, 39],
        [27.5, 39],
        [27.5, 39.5],
        [27, 39.5],
        [27, 39]
      ]
    ],
    [
      [
        [28, 40],
        [28.5, 40],
        [28.5, 40.5],
        [28, 40.5],
        [28, 40]
      ]
    ]
  ]
};

function completeReplaySummary(
  overrides: Partial<{
    ADM0: { identityMatched: number; geometryHashMatches: number; geometryHashMismatches: number };
    ADM1: { identityMatched: number; geometryHashMatches: number; geometryHashMismatches: number };
    ADM2: { identityMatched: number; geometryHashMatches: number; geometryHashMismatches: number };
  }> = {}
) {
  return {
    ADM0: {
      identityMatched: TURKEY_PARENT_INVENTORY_EXPECTED.ADM0,
      geometryHashMatches: TURKEY_PARENT_INVENTORY_EXPECTED.ADM0,
      geometryHashMismatches: 0,
      ...overrides.ADM0
    },
    ADM1: {
      identityMatched: TURKEY_PARENT_INVENTORY_EXPECTED.ADM1,
      geometryHashMatches: TURKEY_PARENT_INVENTORY_EXPECTED.ADM1,
      geometryHashMismatches: 0,
      ...overrides.ADM1
    },
    ADM2: {
      identityMatched: TURKEY_PARENT_INVENTORY_EXPECTED.ADM2,
      geometryHashMatches: TURKEY_PARENT_INVENTORY_EXPECTED.ADM2,
      geometryHashMismatches: 0,
      ...overrides.ADM2
    }
  };
}

function completeCoverageGate(
  overrides: Partial<Parameters<typeof validateReplayCoverageGate>[0]> = {}
): ReturnType<typeof validateReplayCoverageGate> {
  const expected =
    TURKEY_PARENT_INVENTORY_EXPECTED.ADM0 +
    TURKEY_PARENT_INVENTORY_EXPECTED.ADM1 +
    TURKEY_PARENT_INVENTORY_EXPECTED.ADM2;
  return validateReplayCoverageGate({
    replaySummary: completeReplaySummary(),
    canonicalParentZoneCount: expected,
    replayParentZoneCount: expected,
    missingReplayZones: 0,
    missingCanonicalSourceIds: 0,
    duplicateReplaySourceNativeIds: 0,
    geometryComparisonsExpected: 0,
    geometryComparisonsPerformed: 0,
    geographicComparisonSkipped: false,
    buildDatasetAvailable: true,
    determinismSkipped: false,
    determinismByteIdentical: true,
    allBytesVerified: true,
    ...overrides
  });
}

describe("turkey-geoboundaries-full-builder-replay", () => {
  it("uses shapeID adapter mapping in historical config", () => {
    const config = createTurkeyGeoBoundariesHistoricalCountryConfig();
    expect(config.levelMappings.ADM0?.sourceIdProperty).toBe("shapeID");
  });

  it("converts valid Polygon and MultiPolygon for clipping", () => {
    expect(geometryToClippingMultiPolygon(square).length).toBe(1);
    expect(geometryToClippingMultiPolygon(multi).length).toBe(2);
    expect(geometryToClippingMultiPolygon(squareWithHole)[0]?.length).toBe(2);
  });

  it("rejects invalid coordinate dimensions for clipping conversion", () => {
    const invalid: TerritoryGeometry = {
      type: "Polygon",
      coordinates: [[[28, 40, 0, 1]]]
    };
    expect(geometryToClippingMultiPolygon(invalid).length).toBe(0);
    const geo = assessGeographicPair(square, invalid);
    expect(geo.clippingConversionOk).toBe(false);
    expect(geo.equivalenceClass).toBe("NOT_ASSESSABLE");
  });

  it("does not classify similar-area different boundaries as topologically equivalent", () => {
    const shifted: TerritoryGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [28.01, 40.01],
          [29.01, 40.01],
          [29.01, 41.01],
          [28.01, 41.01],
          [28.01, 40.01]
        ]
      ]
    };
    const geo = assessGeographicPair(square, shifted);
    expect(geo.equivalenceClass).not.toBe("TOPOLOGICALLY_EQUIVALENT");
  });

  it("classifyFullBuilderReplay rejects empty geographic equivalence arrays with mismatches", () => {
    const classification = classifyFullBuilderReplay({
      replaySummary: completeReplaySummary({
        ADM1: {
          identityMatched: 81,
          geometryHashMatches: 80,
          geometryHashMismatches: 1
        }
      }),
      geometryDifferenceCount: 1,
      coverageGate: completeCoverageGate({
        geometryComparisonsExpected: 1,
        geometryComparisonsPerformed: 0
      }),
      geographicEquivalence: []
    });
    expect(classification).toBe("BLOCKED_BY_MISSING_EVIDENCE");
  });

  it("does not treat empty geographicEquivalence as full geographic match", () => {
    const classification = classifyFullBuilderReplay({
      replaySummary: completeReplaySummary({
        ADM1: {
          identityMatched: 81,
          geometryHashMatches: 57,
          geometryHashMismatches: 24
        }
      }),
      geometryDifferenceCount: 24,
      coverageGate: completeCoverageGate({
        geometryComparisonsExpected: 24,
        geometryComparisonsPerformed: 0,
        geographicComparisonSkipped: true
      }),
      geographicEquivalence: []
    });
    expect(classification).not.toBe("GEOGRAPHICALLY_EQUIVALENT_WITH_DIFFERENCES");
  });

  it("validateReplayCoverageGate flags incomplete ADM inventory", () => {
    const gate = validateReplayCoverageGate({
      replaySummary: completeReplaySummary({
        ADM2: { identityMatched: 900, geometryHashMatches: 900, geometryHashMismatches: 0 }
      }),
      canonicalParentZoneCount: 1055,
      replayParentZoneCount: 972,
      missingReplayZones: 3,
      missingCanonicalSourceIds: 0,
      duplicateReplaySourceNativeIds: 0,
      geometryComparisonsExpected: 0,
      geometryComparisonsPerformed: 0,
      geographicComparisonSkipped: false,
      buildDatasetAvailable: true,
      determinismSkipped: false,
      determinismByteIdentical: true,
      allBytesVerified: true
    });
    expect(gate.complete).toBe(false);
    expect(gate.issues.length).toBeGreaterThan(0);
  });

  it("assessMismatchRootCause does not confirm dependency-version without historical runtime evidence", () => {
    const assessment = assessMismatchRootCause({
      firstObservedHashMismatchStage: "parsed-upstream",
      geographic: "NOT_ASSESSABLE",
      parsedMatchesCanonical: false,
      adapterMatchesCanonical: false,
      repairMatchesCanonical: false,
      builderMatchesCanonical: false,
      replayPipelineSelfConsistent: true,
      missingReplayZone: false
    });
    expect(assessment.confirmedRootCause).toBeNull();
    expect(assessment.evidenceTier).toBe("unresolved");
    expect(assessment.probableExplanation).toContain("Pinned upstream bytes");
  });

  it("verifyTurkeyGeoBoundariesFullBuilderReplay rejects GO recommendation", () => {
    const verification = verifyTurkeyGeoBoundariesFullBuilderReplay({
      schemaVersion: "territorykit-tr-geoboundaries-full-builder-replay@1",
      classification: "FULL_REPLAY_VERIFIED",
      pathBTechnicalRecommendation: "GO",
      legalReviewStatus: "PENDING_REVIEW",
      migrationAuthorizationStatus: "NOT_AUTHORIZED",
      replayConfiguration: {},
      inputChecksums: {},
      replaySummary: completeReplaySummary(),
      determinism: {
        firstRunDatasetSha256: "a",
        secondRunDatasetSha256: "a",
        byteIdentical: true,
        skipped: false
      },
      reportPaths: {}
    });
    expect(verification.ok).toBe(false);
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
        {
          id: "tr:adm0:tr",
          datasetId: "fixture",
          countryCode: "TR",
          level: 0,
          sourceAdminLevel: "ADM0",
          semanticType: "country",
          name: "Test",
          neighborIds: [],
          geometry: square,
          center: [0, 0],
          bbox: [0, 0, 1, 1],
          properties: {
            territory: { source: { provider: "geoboundaries", sourceId: "shape-1" } }
          }
        } satisfies TerritoryZone
      ]
    };
    expect(dataset.zones[0]?.id).toMatch(/^tr:adm0:/);
  });
});
