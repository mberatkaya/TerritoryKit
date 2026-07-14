import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTerritoryEngine } from "@territory-kit/core";
import { loadTerritoryDataset } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  buildWorldCountriesDataset,
  createWorldCountriesAdm0ArtifactPlan,
  normalizeNaturalEarthDetails,
  parseNaturalEarthAdm0FeatureCollection,
  resolveBuildDate,
  serializeJsonStable,
  sha256Hex
} from "../src/index.js";
import {
  createNaturalEarthMixedIssueFixture,
  createNaturalEarthSourceDescriptor,
  createNaturalEarthValidFixture
} from "./natural-earth-fixtures.js";

describe("Natural Earth ADM0 importer", () => {
  it("parses FeatureCollections with Polygon, MultiPolygon, holes, antimeridian-near geometry, and fallback ids", () => {
    const result = parseNaturalEarthAdm0FeatureCollection(
      createNaturalEarthValidFixture(),
      createNaturalEarthSourceDescriptor()
    );

    expect(result.inputFeatureCount).toBe(6);
    expect(result.acceptedFeatureCount).toBe(6);
    expect(result.fallbackIdCount).toBe(1);
    expect(result.records.map((record) => record.id)).toEqual(["de", "fj", "is", "qb", "tr", "xa"]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "FALLBACK_COUNTRY_CODE",
        severity: "warning"
      })
    );
  });

  it("reports invalid Natural Earth records without mutating the input", () => {
    const input = createNaturalEarthMixedIssueFixture();
    const before = serializeJsonStable(input);
    const result = parseNaturalEarthAdm0FeatureCollection(
      input,
      createNaturalEarthSourceDescriptor()
    );

    expect(serializeJsonStable(input)).toBe(before);
    expect(result.duplicateCodeCount).toBe(1);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_COUNTRY_CODE",
        "GEOMETRY_NULL",
        "GEOMETRY_TYPE",
        "COUNTRY_CODE_MISSING",
        "UNSUPPORTED_PROPERTIES",
        "GEOMETRY_COORDINATES_EMPTY",
        "NAME_MISSING"
      ])
    );
  });

  it("creates valid low, medium, and high TerritoryKit datasets with stable ids", () => {
    const plan = createWorldCountriesAdm0ArtifactPlan(createNaturalEarthValidFixture(), {
      buildDate: "2026-01-01T00:00:00.000Z",
      source: createNaturalEarthSourceDescriptor()
    });
    const idsByDetail = ["low", "medium", "high"].map((detail) => {
      const datasetJson = plan.files.get(`${detail}/dataset.json`);
      expect(datasetJson).toBeDefined();
      const dataset = loadTerritoryDataset(JSON.parse(datasetJson ?? "{}"));
      const engine = createTerritoryEngine({ dataset });

      expect(engine.getZoneById("tr")?.properties.name).toBe("Turkiye");
      expect(engine.getZoneById("is")?.geometry.type).toBe("MultiPolygon");
      expect(engine.getZoneById("de")?.bbox).toEqual([5, 47, 15, 55]);
      expect(engine.getZoneById("fj")?.center[0]).toBeGreaterThanOrEqual(178);

      return dataset.zones.map((zone) => zone.id);
    });

    expect(idsByDetail[0]).toEqual(idsByDetail[1]);
    expect(idsByDetail[1]).toEqual(idsByDetail[2]);
    expect(plan.buildReport.details.map((detail) => detail.detail)).toEqual([
      "low",
      "medium",
      "high"
    ]);
    expect(plan.buildReport.details[0]?.coordinateCount).toBeLessThanOrEqual(
      plan.buildReport.details[2]?.coordinateCount ?? 0
    );
  });

  it("generates manifest, attribution, checksums, and build reports deterministically", () => {
    const left = createWorldCountriesAdm0ArtifactPlan(createNaturalEarthValidFixture(), {
      buildDate: "2026-01-01T00:00:00.000Z",
      source: createNaturalEarthSourceDescriptor()
    });
    const right = createWorldCountriesAdm0ArtifactPlan(createNaturalEarthValidFixture(), {
      buildDate: "2026-01-01T00:00:00.000Z",
      source: createNaturalEarthSourceDescriptor()
    });

    expect(left.files.get("manifest.json")).toBe(right.files.get("manifest.json"));
    expect(left.files.get("checksums.json")).toBe(right.files.get("checksums.json"));
    expect(left.files.get("attribution.txt")).toContain("Made with Natural Earth");
    expect(left.buildReport.outputChecksums["manifest.json"]).toBe(
      sha256Hex(left.files.get("manifest.json") ?? "")
    );
    expect(left.manifest.geometryDetail).toBe("source");
    expect(left.manifest.adminLevels).toEqual(["ADM0"]);
  });

  it("supports SOURCE_DATE_EPOCH and rejects invalid details", () => {
    expect(resolveBuildDate(undefined, { SOURCE_DATE_EPOCH: "1767225600" })).toBe(
      "2026-01-01T00:00:00.000Z"
    );
    expect(() => normalizeNaturalEarthDetails(["tiny" as never])).toThrow("Invalid detail");
  });

  it("builds local artifacts, verifies source checksums, and produces byte-stable output", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-ne-"));
    const sourcePath = join(tempDir, "source.geojson");
    const outputA = join(tempDir, "world-countries-a");
    const outputB = join(tempDir, "world-countries-b");
    const source = JSON.stringify(createNaturalEarthValidFixture());
    const sourceSha256 = sha256Hex(source);

    await writeFile(sourcePath, source, "utf8");

    try {
      const first = await buildWorldCountriesDataset({
        sourcePath,
        outputPath: outputA,
        sourceSha256,
        sourceVersion: "fixture-1",
        buildDate: "2026-01-01T00:00:00.000Z"
      });
      const second = await buildWorldCountriesDataset({
        sourcePath,
        outputPath: outputB,
        sourceSha256,
        sourceVersion: "fixture-1",
        buildDate: "2026-01-01T00:00:00.000Z"
      });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      await expect(readFile(join(outputA, "manifest.json"), "utf8")).resolves.toBe(
        await readFile(join(outputB, "manifest.json"), "utf8")
      );
      await expect(readFile(join(outputA, "checksums.json"), "utf8")).resolves.toBe(
        await readFile(join(outputB, "checksums.json"), "utf8")
      );
      await expect(readFile(join(outputA, "low", "dataset.json"), "utf8")).resolves.toBe(
        await readFile(join(outputB, "low", "dataset.json"), "utf8")
      );
      expect(first.checksums?.files["low/dataset.json"]).toBe(
        sha256Hex(await readFile(join(outputA, "low", "dataset.json"), "utf8"))
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("stops before writing output on source checksum mismatch", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "territory-ne-"));
    const sourcePath = join(tempDir, "source.geojson");
    const outputPath = join(tempDir, "world-countries");

    await writeFile(sourcePath, JSON.stringify(createNaturalEarthValidFixture()), "utf8");

    try {
      const result = await buildWorldCountriesDataset({
        sourcePath,
        outputPath,
        sourceSha256: "wrong",
        buildDate: "2026-01-01T00:00:00.000Z"
      });

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "SOURCE_CHECKSUM_MISMATCH",
          expectedSha256: "wrong"
        })
      );
      await expect(readFile(join(outputPath, "manifest.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
