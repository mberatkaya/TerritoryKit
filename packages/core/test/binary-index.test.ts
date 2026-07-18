import {
  createSampleTerritoryDataset,
  createSyntheticGridDataset
} from "@territory-kit/shared-testkit";
import { TerritoryError } from "@territory-kit/dataset";
import type { TerritoryDataset } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  createTerritoryBinarySpatialIndex,
  createTerritoryEngine,
  decodeTerritoryBinarySpatialIndex,
  encodeTerritoryBinarySpatialIndex,
  inspectTerritoryBinarySpatialIndex,
  validateTerritoryBinarySpatialIndex
} from "../src/index.js";

describe("territory binary spatial index", () => {
  it("encodes and decodes a versioned index with level and zone tables", () => {
    const dataset = createSampleTerritoryDataset();
    const encoded = encodeTerritoryBinarySpatialIndex(dataset);
    const decoded = decodeTerritoryBinarySpatialIndex(encoded, {
      datasetId: dataset.manifest.datasetId,
      datasetVersion: dataset.manifest.datasetVersion,
      geometryHash: dataset.manifest.geometryHash
    });

    expect(decoded.metadata).toMatchObject({
      format: "territory-binary-spatial-index@1",
      magic: "TKSI",
      schemaVersion: 1,
      byteOrder: "little-endian",
      datasetId: "territorykit-sample",
      zoneCount: dataset.zones.length,
      bboxRecordCount: dataset.zones.length
    });
    expect(decoded.metadata.checksum).not.toBe(0);
    expect(decoded.zoneOrdinals).toContain("tr:34:fatih");
    expect(decoded.metadata.levels.map((level) => level.level)).toEqual([0, 1, 2, 3]);
    expect(decoded.search({ west: 28.94, south: 41, east: 29.02, north: 41.05 }, 3)).toEqual([
      "tr:34:fatih",
      "tr:34:kadikoy"
    ]);
  });

  it("lets the core engine use a prebuilt binary spatial index", () => {
    const dataset = createSampleTerritoryDataset();
    const encoded = encodeTerritoryBinarySpatialIndex(dataset);
    const indexedEngine = createTerritoryEngine({ dataset, spatialIndex: encoded });
    const fallbackEngine = createTerritoryEngine({ dataset });

    expect(indexedEngine.getSpatialIndexSummary()).toMatchObject({
      source: "binary",
      zoneCount: dataset.zones.length
    });
    expect(
      indexedEngine
        .getZonesInBounds({ west: 28.94, south: 41, east: 29.02, north: 41.05, level: 3 })
        .map((zone) => zone.id)
    ).toEqual(
      fallbackEngine
        .getZonesInBounds({ west: 28.94, south: 41, east: 29.02, north: 41.05, level: 3 })
        .map((zone) => zone.id)
    );
  });

  it("rejects unsupported versions and corrupt headers", () => {
    const encoded = encodeTerritoryBinarySpatialIndex(createSampleTerritoryDataset());
    const corruptMagic = mutate(encoded, (bytes) => {
      bytes[0] = 0;
    });
    const unsupportedVersion = mutate(encoded, (bytes) => {
      bytes[4] = 2;
      bytes[5] = 0;
    });

    expect(() => decodeTerritoryBinarySpatialIndex(corruptMagic)).toThrow(TerritoryError);
    expect(() => decodeTerritoryBinarySpatialIndex(corruptMagic)).toThrow("magic");
    expect(() => decodeTerritoryBinarySpatialIndex(unsupportedVersion)).toThrow("schema version 2");
  });

  it("rejects checksum and geometry hash mismatches", () => {
    const dataset = createSampleTerritoryDataset();
    const encoded = encodeTerritoryBinarySpatialIndex(dataset);
    const checksumMismatch = mutate(encoded, (bytes) => {
      bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    });

    expect(() => decodeTerritoryBinarySpatialIndex(checksumMismatch)).toThrow("checksum mismatch");
    expect(() =>
      decodeTerritoryBinarySpatialIndex(encoded, {
        datasetId: dataset.manifest.datasetId,
        datasetVersion: dataset.manifest.datasetVersion,
        geometryHash: "different-geometry"
      })
    ).toThrow("does not match");
  });

  it("validates empty indexes deterministically", () => {
    const dataset: TerritoryDataset = {
      manifest: {
        datasetId: "empty-index",
        datasetVersion: "0.0.0",
        schemaVersion: "territory-schema@1",
        sourceDate: "synthetic",
        geometryHash: "empty"
      },
      zones: []
    };
    const encoded = encodeTerritoryBinarySpatialIndex(dataset);
    const decoded = decodeTerritoryBinarySpatialIndex(encoded);

    expect(decoded.metadata.zoneCount).toBe(0);
    expect(decoded.metadata.levels).toEqual([]);
    expect(decoded.search({ west: 0, south: 0, east: 1, north: 1 })).toEqual([]);
    expect(validateTerritoryBinarySpatialIndex(encoded).ok).toBe(true);
  });

  it("handles 10K and 100K generated index fixtures", () => {
    const tenK = createSyntheticGridDataset({ rows: 100, columns: 100, cellSize: 0.001 });
    const hundredK = createSyntheticGridDataset({ rows: 316, columns: 317, cellSize: 0.001 });
    const tenKIndex = decodeTerritoryBinarySpatialIndex(encodeTerritoryBinarySpatialIndex(tenK));
    const hundredKMetadata = inspectTerritoryBinarySpatialIndex(
      encodeTerritoryBinarySpatialIndex(hundredK)
    );

    expect(tenKIndex.metadata.zoneCount).toBe(10_000);
    expect(
      tenKIndex.search({ west: 0.0005, south: 0.0005, east: 0.0015, north: 0.0015 }, 0)
    ).toHaveLength(4);
    expect(hundredKMetadata.zoneCount).toBe(100_172);
    expect(hundredKMetadata.levels).toEqual([{ level: 0, start: 0, count: 100_172 }]);
  });

  it("creates in-memory index objects without requiring an ArrayBuffer round trip", () => {
    const index = createTerritoryBinarySpatialIndex(createSampleTerritoryDataset());

    expect(index.metadata.checksum).toBe(0);
    expect(index.search({ west: 28.94, south: 41, east: 29.02, north: 41.05 }, 3)).toEqual([
      "tr:34:fatih",
      "tr:34:kadikoy"
    ]);
  });
});

function mutate(buffer: ArrayBuffer, mutateBytes: (bytes: Uint8Array) => void): ArrayBuffer {
  const bytes = new Uint8Array(buffer.slice(0));
  mutateBytes(bytes);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
