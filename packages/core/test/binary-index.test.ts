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
import type {
  TerritoryBinarySpatialIndex,
  TerritoryBinarySpatialIndexBBoxRecord,
  TerritoryBinarySpatialIndexMetadata
} from "../src/index.js";

const HEADER_BYTES = 32;
const LEVEL_RECORD_BYTES = 20;
const BBOX_RECORD_BYTES = 40;
const CHECKSUM_OFFSET = 24;

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
      bboxRecordCount: dataset.zones.length,
      treeByteLength: expect.any(Number)
    });
    expect(decoded.metadata.checksum).not.toBe(0);
    expect(decoded.metadata.treeByteLength).toBeGreaterThan(0);
    expect(decoded.zoneOrdinals).toContain("tr:34:fatih");
    expect(decoded.metadata.levels.map((level) => level.level)).toEqual([0, 1, 2, 3]);
    expect(decoded.metadata.levels[0]).toMatchObject({
      level: 0,
      start: 0,
      count: 1,
      treeOffset: 0,
      treeByteLength: expect.any(Number)
    });
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
      source: "binary-flatbush",
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

  it("accepts exact valid decoded object and buffer inputs with the same dataset validation", () => {
    const dataset = createSampleTerritoryDataset();
    const encoded = encodeTerritoryBinarySpatialIndex(dataset);
    const decoded = decodeTerritoryBinarySpatialIndex(encoded);
    const objectEngine = createTerritoryEngine({ dataset, spatialIndex: decoded });
    const bufferEngine = createTerritoryEngine({ dataset, spatialIndex: encoded });

    expect(objectEngine.getSpatialIndexSummary()).toMatchObject({
      source: "binary-flatbush",
      indexHash: decoded.metadata.indexHash,
      zoneCount: dataset.zones.length
    });
    expect(bufferEngine.getSpatialIndexSummary()).toMatchObject({
      source: "binary-flatbush",
      indexHash: decoded.metadata.indexHash,
      zoneCount: dataset.zones.length
    });
    expect(
      objectEngine
        .getZonesInBounds({ west: 28.94, south: 41, east: 29.02, north: 41.05, level: 3 })
        .map((zone) => zone.id)
    ).toEqual(["tr:34:fatih", "tr:34:kadikoy"]);
  });

  it("does not trust decoded object search implementations after validation", () => {
    const dataset = createSampleTerritoryDataset();
    const decoded = decodeTerritoryBinarySpatialIndex(encodeTerritoryBinarySpatialIndex(dataset));
    const forged = forgeIndex(decoded, {
      search: () => ["forged:zone"]
    });
    const engine = createTerritoryEngine({ dataset, spatialIndex: forged });

    expect(
      engine
        .getZonesInBounds({ west: 28.94, south: 41, east: 29.02, north: 41.05, level: 3 })
        .map((zone) => zone.id)
    ).toEqual(["tr:34:fatih", "tr:34:kadikoy"]);
  });

  it.each([
    [
      "wrong datasetId",
      (index: TerritoryBinarySpatialIndex) =>
        forgeIndex(index, { metadata: { datasetId: "other-dataset" } })
    ],
    [
      "wrong geometryHash",
      (index: TerritoryBinarySpatialIndex) =>
        forgeIndex(index, { metadata: { geometryHash: "other-geometry" } })
    ],
    [
      "wrong indexHash",
      (index: TerritoryBinarySpatialIndex) =>
        forgeIndex(index, { metadata: { indexHash: "other-index" } })
    ],
    [
      "missing zone",
      (index: TerritoryBinarySpatialIndex) =>
        forgeIndex(index, {
          records: index.records.slice(0, -1),
          zoneOrdinals: index.zoneOrdinals.slice(0, -1)
        })
    ],
    [
      "unknown zone id",
      (index: TerritoryBinarySpatialIndex) =>
        forgeIndex(index, {
          zoneOrdinals: ["unknown:zone", ...index.zoneOrdinals.slice(1)]
        })
    ],
    [
      "duplicate zone id",
      (index: TerritoryBinarySpatialIndex) =>
        forgeIndex(index, {
          zoneOrdinals: [index.zoneOrdinals[0] ?? "", index.zoneOrdinals[0] ?? ""]
            .concat(index.zoneOrdinals.slice(2))
            .filter(Boolean)
        })
    ],
    [
      "duplicate zone record",
      (index: TerritoryBinarySpatialIndex) => {
        const firstRecord = requireRecord(index, 0);

        return forgeIndex(index, {
          records: replaceRecord(index.records, 1, {
            zoneOrdinal: firstRecord.zoneOrdinal,
            zoneId: firstRecord.zoneId
          })
        });
      }
    ],
    [
      "wrong level",
      (index: TerritoryBinarySpatialIndex) => {
        const firstRecord = requireRecord(index, 0);

        return forgeIndex(index, {
          records: replaceRecord(index.records, 0, {
            level: firstRecord.level + 1
          })
        });
      }
    ],
    [
      "stale bbox",
      (index: TerritoryBinarySpatialIndex) => {
        const firstRecord = requireRecord(index, 0);

        return forgeIndex(index, {
          records: replaceRecord(index.records, 0, {
            west: firstRecord.west + 0.01
          })
        });
      }
    ]
  ])("rejects decoded object input with %s", (_label, forge) => {
    const dataset = createSampleTerritoryDataset();
    const decoded = decodeTerritoryBinarySpatialIndex(encodeTerritoryBinarySpatialIndex(dataset));

    expectTerritoryError(() => createTerritoryEngine({ dataset, spatialIndex: forge(decoded) }));
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
    expect(() =>
      decodeTerritoryBinarySpatialIndex(encoded, {
        datasetId: dataset.manifest.datasetId,
        datasetVersion: dataset.manifest.datasetVersion,
        geometryHash: dataset.manifest.geometryHash,
        indexHash: "different-index"
      })
    ).toThrow("does not match");
  });

  it("wraps invalid metadata JSON in a coded TerritoryError with a parse cause", () => {
    const encoded = encodeTerritoryBinarySpatialIndex(createSampleTerritoryDataset());
    const invalidMetadata = mutateWithChecksum(encoded, (bytes, view) => {
      const metadataLength = view.getUint32(8, true);
      bytes.fill("{".charCodeAt(0), HEADER_BYTES, HEADER_BYTES + metadataLength);
    });
    const error = expectTerritoryError(() => decodeTerritoryBinarySpatialIndex(invalidMetadata));

    expect(error.code).toBe("ARTIFACT_CORRUPTED");
    expect(error.message).toBe("Binary spatial index metadata JSON is invalid.");
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it.each([
    [
      "huge zoneCount in a tiny artifact",
      (buffer: ArrayBuffer) =>
        mutateWithChecksum(buffer, (_bytes, view) => {
          view.setUint32(20, 0xffffffff, true);
        })
    ],
    [
      "huge recordCount in a tiny artifact",
      (buffer: ArrayBuffer) =>
        mutateWithChecksum(buffer, (_bytes, view) => {
          view.setUint32(16, 0xffffffff, true);
          view.setUint32(20, 0xffffffff, true);
        })
    ],
    [
      "overflow-style header values",
      (buffer: ArrayBuffer) =>
        mutateWithChecksum(buffer, (_bytes, view) => {
          view.setUint32(8, 0xffffffff, true);
          view.setUint32(12, 0xffffffff, true);
          view.setUint32(16, 0xffffffff, true);
          view.setUint32(20, 0xffffffff, true);
          view.setUint32(28, 0xffffffff, true);
        })
    ],
    [
      "NaN bbox coordinate",
      (buffer: ArrayBuffer) =>
        mutateWithChecksum(buffer, (_bytes, view) => {
          view.setFloat64(readLayout(buffer).recordStart + 8, Number.NaN, true);
        })
    ],
    [
      "Infinity bbox coordinate",
      (buffer: ArrayBuffer) =>
        mutateWithChecksum(buffer, (_bytes, view) => {
          view.setFloat64(readLayout(buffer).recordStart + 16, Number.POSITIVE_INFINITY, true);
        })
    ],
    [
      "reversed bbox",
      (buffer: ArrayBuffer) =>
        mutateWithChecksum(buffer, (_bytes, view) => {
          view.setFloat64(readLayout(buffer).recordStart + 8, 100, true);
          view.setFloat64(readLayout(buffer).recordStart + 24, 99, true);
        })
    ],
    [
      "duplicate ordinal",
      (buffer: ArrayBuffer) =>
        mutateWithChecksum(buffer, (_bytes, view) => {
          const recordStart = readLayout(buffer).recordStart;
          const firstOrdinal = view.getUint32(recordStart + 4, true);
          view.setUint32(recordStart + BBOX_RECORD_BYTES + 4, firstOrdinal, true);
        })
    ],
    [
      "duplicate level table entry",
      (buffer: ArrayBuffer) =>
        mutateWithChecksum(buffer, (_bytes, view) => {
          const layout = readLayout(buffer);
          const firstLevel = view.getInt32(layout.levelStart, true);
          view.setInt32(layout.levelStart + LEVEL_RECORD_BYTES, firstLevel, true);
        })
    ],
    [
      "level table pointing at the wrong bbox level",
      (buffer: ArrayBuffer) =>
        mutateWithChecksum(buffer, (_bytes, view) => {
          const recordStart = readLayout(buffer).recordStart;
          view.setInt32(recordStart, view.getInt32(recordStart, true) + 1, true);
        })
    ],
    ["trailing bytes", (buffer: ArrayBuffer) => appendTrailingByte(buffer)],
    ["truncated zone table", (buffer: ArrayBuffer) => truncateWithChecksum(buffer, 1)]
  ])("rejects corrupt binary artifacts with stable TerritoryError for %s", (_label, corrupt) => {
    const encoded = encodeTerritoryBinarySpatialIndex(createSampleTerritoryDataset());

    expectTerritoryError(() => decodeTerritoryBinarySpatialIndex(corrupt(encoded)));
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
    expect(hundredKMetadata.treeByteLength).toBeGreaterThan(0);
    expect(hundredKMetadata.levels).toEqual([
      {
        level: 0,
        start: 0,
        count: 100_172,
        treeOffset: 0,
        treeByteLength: hundredKMetadata.treeByteLength
      }
    ]);
  }, 20_000);

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

function mutateWithChecksum(
  buffer: ArrayBuffer,
  mutateBytes: (bytes: Uint8Array, view: DataView) => void
): ArrayBuffer {
  const bytes = new Uint8Array(buffer.slice(0));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  mutateBytes(bytes, view);
  writeChecksum(bytes);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function appendTrailingByte(buffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer.byteLength + 1);
  bytes.set(new Uint8Array(buffer));
  bytes[bytes.length - 1] = 1;
  writeChecksum(bytes);
  return bytes.buffer;
}

function truncateWithChecksum(buffer: ArrayBuffer, bytesToRemove: number): ArrayBuffer {
  const bytes = new Uint8Array(buffer.slice(0, buffer.byteLength - bytesToRemove));
  writeChecksum(bytes);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function writeChecksum(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(CHECKSUM_OFFSET, checksumBytes(bytes), true);
}

function checksumBytes(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < bytes.byteLength; index += 1) {
    const value = index >= CHECKSUM_OFFSET && index < CHECKSUM_OFFSET + 4 ? 0 : (bytes[index] ?? 0);
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

function readLayout(buffer: ArrayBuffer): {
  levelStart: number;
  recordStart: number;
} {
  const view = new DataView(buffer);
  const metadataLength = view.getUint32(8, true);
  const levelCount = view.getUint32(12, true);
  const levelStart = HEADER_BYTES + metadataLength;

  return {
    levelStart,
    recordStart: levelStart + levelCount * LEVEL_RECORD_BYTES
  };
}

function expectTerritoryError(action: () => unknown): TerritoryError {
  let thrown: unknown;

  try {
    action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(TerritoryError);
  return thrown as TerritoryError;
}

function requireRecord(
  index: TerritoryBinarySpatialIndex,
  recordIndex: number
): TerritoryBinarySpatialIndexBBoxRecord {
  const record = index.records[recordIndex];

  if (!record) {
    throw new Error(`Missing test record ${recordIndex}.`);
  }

  return record;
}

function replaceRecord(
  records: readonly TerritoryBinarySpatialIndexBBoxRecord[],
  recordIndex: number,
  patch: Partial<TerritoryBinarySpatialIndexBBoxRecord>
): TerritoryBinarySpatialIndexBBoxRecord[] {
  const record = records[recordIndex];

  if (!record) {
    throw new Error(`Missing test record ${recordIndex}.`);
  }

  return records.map((candidate, index) =>
    index === recordIndex ? { ...record, ...patch } : { ...candidate }
  );
}

function forgeIndex(
  index: TerritoryBinarySpatialIndex,
  overrides: {
    metadata?: Partial<TerritoryBinarySpatialIndexMetadata>;
    records?: readonly TerritoryBinarySpatialIndexBBoxRecord[];
    zoneOrdinals?: readonly string[];
    search?: TerritoryBinarySpatialIndex["search"];
  }
): TerritoryBinarySpatialIndex {
  const records = Object.freeze(
    [...(overrides.records ?? index.records)].map((record) => Object.freeze({ ...record }))
  );
  const zoneOrdinals = Object.freeze([...(overrides.zoneOrdinals ?? index.zoneOrdinals)]);
  const metadata = Object.freeze({
    ...index.metadata,
    ...overrides.metadata,
    levels: Object.freeze(index.metadata.levels.map((level) => Object.freeze({ ...level })))
  });
  const mutableRecordsByLevel = new Map<number, TerritoryBinarySpatialIndexBBoxRecord[]>();

  for (const record of records) {
    const levelRecords = mutableRecordsByLevel.get(record.level) ?? [];
    levelRecords.push(record);
    mutableRecordsByLevel.set(record.level, levelRecords);
  }

  const recordsByLevel = new Map(
    [...mutableRecordsByLevel.entries()].map(([level, levelRecords]) => [
      level,
      Object.freeze([...levelRecords])
    ])
  );

  return Object.freeze({
    metadata,
    records,
    zoneOrdinals,
    recordsByLevel,
    getRecord(zoneId: string) {
      return records.find((record) => record.zoneId === zoneId);
    },
    search: overrides.search ?? index.search
  });
}
