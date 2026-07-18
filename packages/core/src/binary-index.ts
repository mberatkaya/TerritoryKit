import { TerritoryError, loadTerritoryDataset } from "@territory-kit/dataset";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import Flatbush from "flatbush";
import type { TerritoryBounds } from "./types.js";

export const TERRITORY_BINARY_SPATIAL_INDEX_MAGIC = "TKSI";
export const TERRITORY_BINARY_SPATIAL_INDEX_SCHEMA_VERSION = 1;
export const TERRITORY_BINARY_SPATIAL_INDEX_FORMAT = "territory-binary-spatial-index@1";

export type TerritoryBinarySpatialIndexByteOrder = "little-endian";

export type TerritoryBinarySpatialIndexBuffer = ArrayBuffer | ArrayBufferView;

export interface TerritoryBinarySpatialIndexLevelRecord {
  readonly level: number;
  readonly start: number;
  readonly count: number;
  readonly treeOffset: number;
  readonly treeByteLength: number;
}

export interface TerritoryBinarySpatialIndexBBoxRecord {
  readonly zoneOrdinal: number;
  readonly zoneId: string;
  readonly level: number;
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface TerritoryBinarySpatialIndexMetadata {
  readonly format: typeof TERRITORY_BINARY_SPATIAL_INDEX_FORMAT;
  readonly magic: typeof TERRITORY_BINARY_SPATIAL_INDEX_MAGIC;
  readonly schemaVersion: typeof TERRITORY_BINARY_SPATIAL_INDEX_SCHEMA_VERSION;
  readonly byteOrder: TerritoryBinarySpatialIndexByteOrder;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly geometryHash: string;
  readonly indexHash: string;
  readonly checksum: number;
  readonly byteLength: number;
  readonly zoneCount: number;
  readonly bboxRecordCount: number;
  readonly treeByteLength: number;
  readonly levels: readonly TerritoryBinarySpatialIndexLevelRecord[];
}

export interface TerritoryBinarySpatialIndex {
  readonly metadata: TerritoryBinarySpatialIndexMetadata;
  readonly zoneOrdinals: readonly string[];
  readonly records: readonly TerritoryBinarySpatialIndexBBoxRecord[];
  readonly recordsByLevel: ReadonlyMap<number, readonly TerritoryBinarySpatialIndexBBoxRecord[]>;
  getRecord(zoneId: string): TerritoryBinarySpatialIndexBBoxRecord | undefined;
  search(bounds: TerritoryBounds, level?: number): string[];
}

export interface TerritoryBinarySpatialIndexValidationOptions {
  readonly datasetId?: string;
  readonly datasetVersion?: string;
  readonly geometryHash?: string;
  readonly indexHash?: string;
}

export interface TerritoryBinarySpatialIndexValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface TerritoryBinarySpatialIndexValidationResult {
  readonly ok: boolean;
  readonly metadata?: TerritoryBinarySpatialIndexMetadata;
  readonly issues: readonly TerritoryBinarySpatialIndexValidationIssue[];
}

const HEADER_BYTES = 32;
const LEVEL_RECORD_BYTES = 20;
const BBOX_RECORD_BYTES = 40;
const CHECKSUM_OFFSET = 24;
const TREE_SECTION_LENGTH_OFFSET = 28;
const LITTLE_ENDIAN_FLAG = 1;
const MAX_BINARY_LEVEL = 32;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

interface BinaryMetadataPayload {
  readonly format: typeof TERRITORY_BINARY_SPATIAL_INDEX_FORMAT;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly geometryHash: string;
  readonly indexHash: string;
}

interface BinaryHeader {
  readonly metadataLength: number;
  readonly levelCount: number;
  readonly recordCount: number;
  readonly zoneCount: number;
  readonly checksum: number;
  readonly treeSectionLength: number;
  readonly sections: {
    readonly metadataStart: number;
    readonly metadataEnd: number;
    readonly levelStart: number;
    readonly levelEnd: number;
    readonly recordStart: number;
    readonly recordEnd: number;
    readonly treeStart: number;
    readonly treeEnd: number;
    readonly zoneTableStart: number;
    readonly zoneTableBytes: number;
  };
}

interface LevelTree {
  readonly index: Flatbush;
  readonly records: readonly TerritoryBinarySpatialIndexBBoxRecord[];
  readonly byteLength: number;
}

export function createTerritoryBinarySpatialIndex(
  datasetInput: TerritoryDataset
): TerritoryBinarySpatialIndex {
  const dataset = loadTerritoryDataset(datasetInput);
  const records = dataset.zones
    .map((zone, zoneOrdinal): TerritoryBinarySpatialIndexBBoxRecord => {
      const [west, south, east, north] = zone.bbox;

      return {
        zoneOrdinal,
        zoneId: zone.id,
        level: zone.level,
        west,
        south,
        east,
        north
      };
    })
    .sort(compareBboxRecords);
  const zoneOrdinals = dataset.zones.map((zone) => zone.id);
  const treeBuffers = buildTreeBuffersByLevel(createRecordsByLevel(records));
  const levels = createLevelRecords(records, treeBuffers);
  const metadata = freezeMetadata({
    format: TERRITORY_BINARY_SPATIAL_INDEX_FORMAT,
    magic: TERRITORY_BINARY_SPATIAL_INDEX_MAGIC,
    schemaVersion: TERRITORY_BINARY_SPATIAL_INDEX_SCHEMA_VERSION,
    byteOrder: "little-endian",
    datasetId: dataset.manifest.datasetId,
    datasetVersion: dataset.manifest.datasetVersion,
    geometryHash: dataset.manifest.geometryHash,
    indexHash: createIndexHash(dataset.zones),
    checksum: 0,
    byteLength: 0,
    zoneCount: zoneOrdinals.length,
    bboxRecordCount: records.length,
    treeByteLength: sumTreeByteLength(levels),
    levels
  });

  return createIndex(metadata, zoneOrdinals, records, treeBuffers);
}

export function encodeTerritoryBinarySpatialIndex(
  input: TerritoryDataset | TerritoryBinarySpatialIndex
): ArrayBuffer {
  const index = isTerritoryBinarySpatialIndex(input)
    ? input
    : createTerritoryBinarySpatialIndex(input);
  const recordsByLevel = createRecordsByLevel(index.records);
  const treeBuffers = buildTreeBuffersByLevel(recordsByLevel);
  const levels = createLevelRecords(index.records, treeBuffers);
  const metadataPayload: BinaryMetadataPayload = {
    format: TERRITORY_BINARY_SPATIAL_INDEX_FORMAT,
    datasetId: index.metadata.datasetId,
    datasetVersion: index.metadata.datasetVersion,
    geometryHash: index.metadata.geometryHash,
    indexHash: index.metadata.indexHash
  };
  const metadataBytes = TEXT_ENCODER.encode(JSON.stringify(metadataPayload));
  const zoneTableBytes = index.zoneOrdinals.reduce(
    (total, zoneId) => safeAdd(total, safeAdd(4, TEXT_ENCODER.encode(zoneId).byteLength)),
    0
  );
  const treeSectionLength = sumTreeByteLength(levels);
  const byteLength = safeAdd(
    safeAdd(
      safeAdd(
        safeAdd(
          safeAdd(HEADER_BYTES, metadataBytes.byteLength),
          safeMultiply(levels.length, LEVEL_RECORD_BYTES)
        ),
        safeMultiply(index.records.length, BBOX_RECORD_BYTES)
      ),
      treeSectionLength
    ),
    zoneTableBytes
  );
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);

  writeHeader(view, {
    metadataLength: metadataBytes.byteLength,
    levelCount: levels.length,
    recordCount: index.records.length,
    zoneCount: index.zoneOrdinals.length,
    checksum: 0,
    treeSectionLength
  });

  let offset = HEADER_BYTES;
  bytes.set(metadataBytes, offset);
  offset += metadataBytes.byteLength;

  for (const level of levels) {
    view.setInt32(offset, level.level, true);
    view.setUint32(offset + 4, level.start, true);
    view.setUint32(offset + 8, level.count, true);
    view.setUint32(offset + 12, level.treeOffset, true);
    view.setUint32(offset + 16, level.treeByteLength, true);
    offset += LEVEL_RECORD_BYTES;
  }

  for (const record of index.records) {
    view.setInt32(offset, record.level, true);
    view.setUint32(offset + 4, record.zoneOrdinal, true);
    view.setFloat64(offset + 8, record.west, true);
    view.setFloat64(offset + 16, record.south, true);
    view.setFloat64(offset + 24, record.east, true);
    view.setFloat64(offset + 32, record.north, true);
    offset += BBOX_RECORD_BYTES;
  }

  for (const level of levels) {
    const treeBytes = treeBuffers.get(level.level);

    if (!treeBytes) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index tree data is missing for a level.",
        {
          details: { level: level.level }
        }
      );
    }

    bytes.set(treeBytes, offset);
    offset += treeBytes.byteLength;
  }

  for (const zoneId of index.zoneOrdinals) {
    const zoneIdBytes = TEXT_ENCODER.encode(zoneId);
    view.setUint32(offset, zoneIdBytes.byteLength, true);
    offset += 4;
    bytes.set(zoneIdBytes, offset);
    offset += zoneIdBytes.byteLength;
  }

  const checksum = checksumBytes(bytes);
  view.setUint32(CHECKSUM_OFFSET, checksum, true);

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function decodeTerritoryBinarySpatialIndex(
  input: TerritoryBinarySpatialIndexBuffer,
  options: TerritoryBinarySpatialIndexValidationOptions = {}
): TerritoryBinarySpatialIndex {
  const bytes = toUint8Array(input);

  if (bytes.byteLength < HEADER_BYTES) {
    throw new TerritoryError("ARTIFACT_CORRUPTED", "Binary spatial index header is truncated.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assertMagic(bytes);

  const schemaVersion = view.getUint16(4, true);

  if (schemaVersion !== TERRITORY_BINARY_SPATIAL_INDEX_SCHEMA_VERSION) {
    throw new TerritoryError(
      "DATASET_SCHEMA_UNSUPPORTED",
      `Binary spatial index schema version ${schemaVersion} is not supported.`,
      {
        details: {
          expected: TERRITORY_BINARY_SPATIAL_INDEX_SCHEMA_VERSION,
          actual: schemaVersion
        }
      }
    );
  }

  const byteOrder = view.getUint8(6);

  if (byteOrder !== LITTLE_ENDIAN_FLAG) {
    throw new TerritoryError(
      "DATASET_SCHEMA_UNSUPPORTED",
      "Binary spatial index byte order is not supported.",
      {
        details: { expected: LITTLE_ENDIAN_FLAG, actual: byteOrder }
      }
    );
  }

  const header = readAndValidateHeader(bytes, view);
  const expectedChecksum = checksumBytes(bytes);

  if (header.checksum !== expectedChecksum) {
    throw new TerritoryError("CHECKSUM_MISMATCH", "Binary spatial index checksum mismatch.", {
      details: {
        expected: header.checksum,
        actual: expectedChecksum
      }
    });
  }

  const metadataPayload = readMetadataPayload(
    bytes.slice(header.sections.metadataStart, header.sections.metadataEnd)
  );
  const levels = readLevelRecords(bytes, view, header);
  const rawRecords = readRawRecords(bytes, view, header);
  const zoneOrdinals = readZoneOrdinals(bytes, view, header);
  const records = materializeRecords(rawRecords, zoneOrdinals);
  const treeBuffers = readTreeBuffers(bytes, header, levels);

  validateLevelRecords(levels, records, header.treeSectionLength);

  const metadata = freezeMetadata({
    format: TERRITORY_BINARY_SPATIAL_INDEX_FORMAT,
    magic: TERRITORY_BINARY_SPATIAL_INDEX_MAGIC,
    schemaVersion: TERRITORY_BINARY_SPATIAL_INDEX_SCHEMA_VERSION,
    byteOrder: "little-endian",
    datasetId: metadataPayload.datasetId,
    datasetVersion: metadataPayload.datasetVersion,
    geometryHash: metadataPayload.geometryHash,
    indexHash: metadataPayload.indexHash,
    checksum: header.checksum,
    byteLength: bytes.byteLength,
    zoneCount: header.zoneCount,
    bboxRecordCount: header.recordCount,
    treeByteLength: header.treeSectionLength,
    levels
  });

  assertExpectedMetadata(metadata, options);

  return createIndex(metadata, zoneOrdinals, records, treeBuffers);
}

export function normalizeTerritoryBinarySpatialIndex(
  spatialIndex: TerritoryBinarySpatialIndex | TerritoryBinarySpatialIndexBuffer,
  expectedDatasetInput: TerritoryDataset
): TerritoryBinarySpatialIndex {
  const expectedDataset = loadTerritoryDataset(expectedDatasetInput);
  if (!isTerritoryBinarySpatialIndex(spatialIndex)) {
    const decoded = decodeTerritoryBinarySpatialIndex(spatialIndex, {
      datasetId: expectedDataset.manifest.datasetId,
      datasetVersion: expectedDataset.manifest.datasetVersion,
      geometryHash: expectedDataset.manifest.geometryHash
    });

    validateIndexAgainstDataset(decoded, expectedDataset);
    return decoded;
  }

  validateIndexAgainstDataset(spatialIndex, expectedDataset);
  return rebuildTrustedIndex(spatialIndex);
}

export function inspectTerritoryBinarySpatialIndex(
  input: TerritoryBinarySpatialIndexBuffer
): TerritoryBinarySpatialIndexMetadata {
  return decodeTerritoryBinarySpatialIndex(input).metadata;
}

export function validateTerritoryBinarySpatialIndex(
  input: TerritoryBinarySpatialIndexBuffer,
  options: TerritoryBinarySpatialIndexValidationOptions = {}
): TerritoryBinarySpatialIndexValidationResult {
  try {
    const index = decodeTerritoryBinarySpatialIndex(input, options);

    return {
      ok: true,
      metadata: index.metadata,
      issues: []
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof TerritoryError ? error.code : "UNKNOWN";

    return {
      ok: false,
      issues: [
        {
          code,
          message
        }
      ]
    };
  }
}

export function isTerritoryBinarySpatialIndex(
  input: unknown
): input is TerritoryBinarySpatialIndex {
  return (
    isRecord(input) &&
    isRecord(input.metadata) &&
    input.metadata.format === TERRITORY_BINARY_SPATIAL_INDEX_FORMAT &&
    Array.isArray(input.records) &&
    Array.isArray(input.zoneOrdinals) &&
    typeof input.search === "function"
  );
}

function createIndex(
  metadata: TerritoryBinarySpatialIndexMetadata,
  zoneOrdinals: readonly string[],
  records: readonly TerritoryBinarySpatialIndexBBoxRecord[],
  treeBuffers: ReadonlyMap<number, Uint8Array>
): TerritoryBinarySpatialIndex {
  const frozenZoneOrdinals = Object.freeze([...zoneOrdinals]);
  const frozenRecords = Object.freeze([...records].map((record) => Object.freeze({ ...record })));
  const recordsByLevel = new Map<number, TerritoryBinarySpatialIndexBBoxRecord[]>();
  const recordsByZoneId = new Map<string, TerritoryBinarySpatialIndexBBoxRecord>();

  for (const record of frozenRecords) {
    const levelRecords = recordsByLevel.get(record.level) ?? [];
    levelRecords.push(record);
    recordsByLevel.set(record.level, levelRecords);
    recordsByZoneId.set(record.zoneId, record);
  }

  const frozenRecordsByLevel = new Map<number, readonly TerritoryBinarySpatialIndexBBoxRecord[]>();

  for (const [level, levelRecords] of recordsByLevel.entries()) {
    frozenRecordsByLevel.set(level, Object.freeze([...levelRecords].sort(compareBboxRecords)));
  }

  const searchTreesByLevel = new Map<number, LevelTree>();

  for (const level of metadata.levels) {
    const levelRecords = frozenRecords.slice(level.start, level.start + level.count);
    const treeBytes = treeBuffers.get(level.level);

    if (!treeBytes) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index tree data is missing for a level.",
        {
          details: { level: level.level }
        }
      );
    }

    const tree = restoreFlatbushTree(treeBytes, level);
    searchTreesByLevel.set(level.level, {
      index: tree,
      records: Object.freeze(levelRecords),
      byteLength: treeBytes.byteLength
    });
  }

  return Object.freeze({
    metadata,
    zoneOrdinals: frozenZoneOrdinals,
    records: frozenRecords,
    recordsByLevel: frozenRecordsByLevel,
    getRecord(zoneId: string) {
      return recordsByZoneId.get(zoneId);
    },
    search(bounds: TerritoryBounds, level?: number) {
      const normalizedBounds = normalizeBounds(bounds);

      if (!normalizedBounds) {
        return [];
      }

      const trees =
        level === undefined
          ? [...searchTreesByLevel.values()]
          : [searchTreesByLevel.get(level)].filter((tree): tree is LevelTree => Boolean(tree));
      const hits: TerritoryBinarySpatialIndexBBoxRecord[] = [];

      for (const tree of trees) {
        for (const recordIndex of tree.index.search(
          normalizedBounds.west,
          normalizedBounds.south,
          normalizedBounds.east,
          normalizedBounds.north
        )) {
          const record = tree.records[recordIndex];

          if (record) {
            hits.push(record);
          }
        }
      }

      return hits.sort(compareBboxRecords).map((record) => record.zoneId);
    }
  });
}

function readAndValidateHeader(bytes: Uint8Array, view: DataView): BinaryHeader {
  const metadataLength = view.getUint32(8, true);
  const levelCount = view.getUint32(12, true);
  const recordCount = view.getUint32(16, true);
  const zoneCount = view.getUint32(20, true);
  const checksum = view.getUint32(CHECKSUM_OFFSET, true);
  const treeSectionLength = view.getUint32(TREE_SECTION_LENGTH_OFFSET, true);

  if (recordCount !== zoneCount) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index record count must equal zone count.",
      {
        details: { recordCount, zoneCount }
      }
    );
  }

  const levelTableBytes = safeMultiply(levelCount, LEVEL_RECORD_BYTES);
  const recordTableBytes = safeMultiply(recordCount, BBOX_RECORD_BYTES);
  const metadataStart = HEADER_BYTES;
  const metadataEnd = safeAdd(metadataStart, metadataLength);
  const levelStart = metadataEnd;
  const levelEnd = safeAdd(levelStart, levelTableBytes);
  const recordStart = levelEnd;
  const recordEnd = safeAdd(recordStart, recordTableBytes);
  const treeStart = recordEnd;
  const treeEnd = safeAdd(treeStart, treeSectionLength);

  assertReadable(bytes, metadataEnd, "metadata");
  assertReadable(bytes, levelEnd, "levels");
  assertReadable(bytes, recordEnd, "records");
  assertReadable(bytes, treeEnd, "flatbushTrees");

  const zoneTableBytes = bytes.byteLength - treeEnd;
  const minimumZoneTableBytes = safeMultiply(zoneCount, 4);

  if (minimumZoneTableBytes > zoneTableBytes) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index zone ordinal table is too short for the declared zone count.",
      {
        details: { zoneCount, zoneTableBytes }
      }
    );
  }

  if (levelCount === 0 && recordCount > 0) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index has records without level table entries.",
      {
        details: { levelCount, recordCount }
      }
    );
  }

  if (levelCount > recordCount && recordCount > 0) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index declares more levels than records.",
      {
        details: { levelCount, recordCount }
      }
    );
  }

  return {
    metadataLength,
    levelCount,
    recordCount,
    zoneCount,
    checksum,
    treeSectionLength,
    sections: {
      metadataStart,
      metadataEnd,
      levelStart,
      levelEnd,
      recordStart,
      recordEnd,
      treeStart,
      treeEnd,
      zoneTableStart: treeEnd,
      zoneTableBytes
    }
  };
}

function readLevelRecords(
  bytes: Uint8Array,
  view: DataView,
  header: BinaryHeader
): readonly TerritoryBinarySpatialIndexLevelRecord[] {
  const levels: TerritoryBinarySpatialIndexLevelRecord[] = [];
  const seenLevels = new Set<number>();
  let offset = header.sections.levelStart;

  for (let index = 0; index < header.levelCount; index += 1) {
    assertReadable(bytes, offset + LEVEL_RECORD_BYTES, `levels[${index}]`);

    const level = view.getInt32(offset, true);
    const start = view.getUint32(offset + 4, true);
    const count = view.getUint32(offset + 8, true);
    const treeOffset = view.getUint32(offset + 12, true);
    const treeByteLength = view.getUint32(offset + 16, true);

    assertValidLevel(level, `levels[${index}].level`);

    if (seenLevels.has(level)) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index contains duplicate level table entries.",
        {
          details: { level }
        }
      );
    }

    seenLevels.add(level);

    const recordEnd = safeAdd(start, count);

    if (recordEnd > header.recordCount) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index level record points outside the bbox record table.",
        {
          details: { level, start, count, recordCount: header.recordCount }
        }
      );
    }

    const treeEnd = safeAdd(treeOffset, treeByteLength);

    if (treeByteLength === 0 || treeEnd > header.treeSectionLength) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index level record points outside the Flatbush tree section.",
        {
          details: {
            level,
            treeOffset,
            treeByteLength,
            treeSectionLength: header.treeSectionLength
          }
        }
      );
    }

    levels.push(Object.freeze({ level, start, count, treeOffset, treeByteLength }));
    offset += LEVEL_RECORD_BYTES;
  }

  return Object.freeze(levels);
}

function readRawRecords(
  bytes: Uint8Array,
  view: DataView,
  header: BinaryHeader
): readonly Omit<TerritoryBinarySpatialIndexBBoxRecord, "zoneId">[] {
  const records: Array<Omit<TerritoryBinarySpatialIndexBBoxRecord, "zoneId">> = [];
  const seenOrdinals = new Set<number>();
  let offset = header.sections.recordStart;

  for (let index = 0; index < header.recordCount; index += 1) {
    assertReadable(bytes, offset + BBOX_RECORD_BYTES, `records[${index}]`);

    const record = {
      level: view.getInt32(offset, true),
      zoneOrdinal: view.getUint32(offset + 4, true),
      west: view.getFloat64(offset + 8, true),
      south: view.getFloat64(offset + 16, true),
      east: view.getFloat64(offset + 24, true),
      north: view.getFloat64(offset + 32, true)
    };

    assertValidLevel(record.level, `records[${index}].level`);
    assertValidOrdinal(record.zoneOrdinal, header.zoneCount, index);
    assertValidBbox(record, `records[${index}]`);

    if (seenOrdinals.has(record.zoneOrdinal)) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index contains duplicate zone ordinals.",
        {
          details: { record: index, zoneOrdinal: record.zoneOrdinal }
        }
      );
    }

    seenOrdinals.add(record.zoneOrdinal);
    records.push(Object.freeze(record));
    offset += BBOX_RECORD_BYTES;
  }

  return Object.freeze(records);
}

function readZoneOrdinals(
  bytes: Uint8Array,
  view: DataView,
  header: BinaryHeader
): readonly string[] {
  const zoneOrdinals: string[] = [];
  const seenZoneIds = new Set<string>();
  let offset = header.sections.zoneTableStart;

  for (let index = 0; index < header.zoneCount; index += 1) {
    assertReadable(bytes, offset + 4, `zoneOrdinals[${index}].length`);
    const length = view.getUint32(offset, true);
    offset += 4;
    assertReadable(bytes, offset + length, `zoneOrdinals[${index}]`);

    const zoneId = TEXT_DECODER.decode(bytes.slice(offset, offset + length));

    if (!zoneId) {
      throw new TerritoryError("ARTIFACT_CORRUPTED", "Binary spatial index zone id is empty.", {
        details: { ordinal: index }
      });
    }

    if (seenZoneIds.has(zoneId)) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index contains duplicate zone ids.",
        {
          details: { zoneId }
        }
      );
    }

    seenZoneIds.add(zoneId);
    zoneOrdinals.push(zoneId);
    offset += length;
  }

  if (offset !== bytes.byteLength) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index has trailing bytes after the zone ordinal table.",
      {
        details: { byteLength: bytes.byteLength, readOffset: offset }
      }
    );
  }

  return Object.freeze(zoneOrdinals);
}

function materializeRecords(
  rawRecords: readonly Omit<TerritoryBinarySpatialIndexBBoxRecord, "zoneId">[],
  zoneOrdinals: readonly string[]
): readonly TerritoryBinarySpatialIndexBBoxRecord[] {
  return Object.freeze(
    rawRecords.map((rawRecord, index) => {
      const zoneId = zoneOrdinals[rawRecord.zoneOrdinal];

      if (!zoneId) {
        throw new TerritoryError(
          "ARTIFACT_CORRUPTED",
          "Binary spatial index record references an unknown zone ordinal.",
          {
            details: { record: index, zoneOrdinal: rawRecord.zoneOrdinal }
          }
        );
      }

      return Object.freeze({
        ...rawRecord,
        zoneId
      });
    })
  );
}

function readTreeBuffers(
  bytes: Uint8Array,
  header: BinaryHeader,
  levels: readonly TerritoryBinarySpatialIndexLevelRecord[]
): ReadonlyMap<number, Uint8Array> {
  const treeBuffers = new Map<number, Uint8Array>();

  for (const level of levels) {
    const start = safeAdd(header.sections.treeStart, level.treeOffset);
    const end = safeAdd(start, level.treeByteLength);
    assertReadable(bytes, end, `flatbushTrees[${level.level}]`);
    treeBuffers.set(level.level, bytes.slice(start, end));
  }

  return treeBuffers;
}

function writeHeader(
  view: DataView,
  input: {
    readonly metadataLength: number;
    readonly levelCount: number;
    readonly recordCount: number;
    readonly zoneCount: number;
    readonly checksum: number;
    readonly treeSectionLength: number;
  }
): void {
  const magic = TEXT_ENCODER.encode(TERRITORY_BINARY_SPATIAL_INDEX_MAGIC);

  for (let index = 0; index < magic.length; index += 1) {
    view.setUint8(index, magic[index] ?? 0);
  }

  view.setUint16(4, TERRITORY_BINARY_SPATIAL_INDEX_SCHEMA_VERSION, true);
  view.setUint8(6, LITTLE_ENDIAN_FLAG);
  view.setUint8(7, 0);
  view.setUint32(8, input.metadataLength, true);
  view.setUint32(12, input.levelCount, true);
  view.setUint32(16, input.recordCount, true);
  view.setUint32(20, input.zoneCount, true);
  view.setUint32(CHECKSUM_OFFSET, input.checksum, true);
  view.setUint32(TREE_SECTION_LENGTH_OFFSET, input.treeSectionLength, true);
}

function assertMagic(bytes: Uint8Array): void {
  const magic = TEXT_DECODER.decode(bytes.slice(0, 4));

  if (magic !== TERRITORY_BINARY_SPATIAL_INDEX_MAGIC) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index magic bytes are invalid.",
      {
        details: { expected: TERRITORY_BINARY_SPATIAL_INDEX_MAGIC, actual: magic }
      }
    );
  }
}

function readMetadataPayload(bytes: Uint8Array): BinaryMetadataPayload {
  let input: unknown;

  try {
    input = JSON.parse(TEXT_DECODER.decode(bytes)) as unknown;
  } catch (cause) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index metadata JSON is invalid.",
      {
        cause
      }
    );
  }

  if (!isRecord(input)) {
    throw new TerritoryError("ARTIFACT_CORRUPTED", "Binary spatial index metadata is invalid.");
  }

  const payload = {
    format: input.format,
    datasetId: input.datasetId,
    datasetVersion: input.datasetVersion,
    geometryHash: input.geometryHash,
    indexHash: input.indexHash
  };

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        `Binary spatial index metadata field '${key}' is invalid.`,
        {
          details: { field: key }
        }
      );
    }
  }

  if (payload.format !== TERRITORY_BINARY_SPATIAL_INDEX_FORMAT) {
    throw new TerritoryError(
      "DATASET_SCHEMA_UNSUPPORTED",
      "Binary spatial index format is not supported.",
      {
        details: { expected: TERRITORY_BINARY_SPATIAL_INDEX_FORMAT, actual: payload.format }
      }
    );
  }

  return payload as BinaryMetadataPayload;
}

function createLevelRecords(
  records: readonly TerritoryBinarySpatialIndexBBoxRecord[],
  treeBuffers: ReadonlyMap<number, Uint8Array>
): readonly TerritoryBinarySpatialIndexLevelRecord[] {
  const levels: TerritoryBinarySpatialIndexLevelRecord[] = [];
  let currentLevel: number | undefined;
  let start = 0;
  let count = 0;
  let treeOffset = 0;

  for (const [index, record] of records.entries()) {
    if (currentLevel === undefined) {
      currentLevel = record.level;
      start = index;
      count = 1;
      continue;
    }

    if (record.level === currentLevel) {
      count += 1;
      continue;
    }

    const treeByteLength = requireTreeBytes(treeBuffers, currentLevel).byteLength;
    levels.push(Object.freeze({ level: currentLevel, start, count, treeOffset, treeByteLength }));
    treeOffset += treeByteLength;
    currentLevel = record.level;
    start = index;
    count = 1;
  }

  if (currentLevel !== undefined) {
    const treeByteLength = requireTreeBytes(treeBuffers, currentLevel).byteLength;
    levels.push(Object.freeze({ level: currentLevel, start, count, treeOffset, treeByteLength }));
  }

  return Object.freeze(levels);
}

function validateLevelRecords(
  levels: readonly TerritoryBinarySpatialIndexLevelRecord[],
  records: readonly TerritoryBinarySpatialIndexBBoxRecord[],
  expectedTreeByteLength: number
): void {
  if (records.length === 0 && levels.length > 0) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index has level table entries without bbox records."
    );
  }

  let expectedStart = 0;
  let expectedTreeOffset = 0;

  for (const level of levels) {
    if (
      !Number.isInteger(level.start) ||
      !Number.isInteger(level.count) ||
      !Number.isInteger(level.treeOffset) ||
      !Number.isInteger(level.treeByteLength) ||
      level.start < 0 ||
      level.count <= 0 ||
      level.treeOffset < 0 ||
      level.treeByteLength <= 0
    ) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index level record is invalid.",
        {
          details: {
            level: level.level,
            start: level.start,
            count: level.count,
            treeOffset: level.treeOffset,
            treeByteLength: level.treeByteLength
          }
        }
      );
    }

    const levelRecordEnd = safeAdd(level.start, level.count);

    if (level.start !== expectedStart || levelRecordEnd > records.length) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index level records are not contiguous.",
        {
          details: {
            level: level.level,
            start: level.start,
            count: level.count,
            records: records.length
          }
        }
      );
    }

    if (level.treeOffset !== expectedTreeOffset) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index level tree records are not contiguous.",
        {
          details: { level: level.level, treeOffset: level.treeOffset, expectedTreeOffset }
        }
      );
    }

    for (let index = level.start; index < levelRecordEnd; index += 1) {
      const record = records[index];

      if (!record || record.level !== level.level) {
        throw new TerritoryError(
          "ARTIFACT_CORRUPTED",
          "Binary spatial index level table does not match the bbox record partition.",
          {
            details: { level: level.level, recordIndex: index, actualLevel: record?.level }
          }
        );
      }
    }

    expectedStart = levelRecordEnd;
    expectedTreeOffset = safeAdd(expectedTreeOffset, level.treeByteLength);
  }

  if (expectedStart !== records.length) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index level records do not cover all bbox records.",
      {
        details: { expectedStart, records: records.length }
      }
    );
  }

  if (expectedTreeOffset !== expectedTreeByteLength) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index level tree records do not cover the Flatbush tree section.",
      {
        details: { expectedTreeOffset, treeByteLength: expectedTreeByteLength }
      }
    );
  }
}

function validateIndexAgainstDataset(
  index: TerritoryBinarySpatialIndex,
  expectedDataset: TerritoryDataset
): void {
  assertExpectedMetadata(index.metadata, {
    datasetId: expectedDataset.manifest.datasetId,
    datasetVersion: expectedDataset.manifest.datasetVersion,
    geometryHash: expectedDataset.manifest.geometryHash,
    indexHash: createIndexHash(expectedDataset.zones)
  });

  const zonesById = new Map<string, TerritoryZone>();

  for (const zone of expectedDataset.zones) {
    if (zonesById.has(zone.id)) {
      throw new TerritoryError("ARTIFACT_CORRUPTED", "Dataset contains duplicate zone ids.", {
        details: { zoneId: zone.id }
      });
    }

    zonesById.set(zone.id, zone);
  }

  if (index.metadata.zoneCount !== expectedDataset.zones.length) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index zone count does not match the dataset.",
      {
        details: {
          expected: expectedDataset.zones.length,
          actual: index.metadata.zoneCount
        }
      }
    );
  }

  if (
    index.metadata.bboxRecordCount !== index.records.length ||
    index.records.length !== index.zoneOrdinals.length ||
    index.zoneOrdinals.length !== expectedDataset.zones.length
  ) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index record tables do not match the dataset zone count.",
      {
        details: {
          expected: expectedDataset.zones.length,
          metadataRecords: index.metadata.bboxRecordCount,
          records: index.records.length,
          zoneOrdinals: index.zoneOrdinals.length
        }
      }
    );
  }

  const seenZoneIds = new Set<string>();
  const seenOrdinals = new Set<number>();

  for (const [ordinal, zoneId] of index.zoneOrdinals.entries()) {
    if (seenZoneIds.has(zoneId)) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index contains duplicate zone ids.",
        {
          details: { zoneId }
        }
      );
    }

    if (!zonesById.has(zoneId)) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index references a zone that is not present in the dataset.",
        {
          details: { zoneId, ordinal }
        }
      );
    }

    seenZoneIds.add(zoneId);
  }

  for (const [recordIndex, record] of index.records.entries()) {
    assertValidLevel(record.level, `records[${recordIndex}].level`);
    assertValidOrdinal(record.zoneOrdinal, index.zoneOrdinals.length, recordIndex);
    assertValidBbox(record, `records[${recordIndex}]`);

    if (seenOrdinals.has(record.zoneOrdinal)) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index contains duplicate zone ordinals.",
        {
          details: { record: recordIndex, zoneOrdinal: record.zoneOrdinal }
        }
      );
    }

    seenOrdinals.add(record.zoneOrdinal);

    const ordinalZoneId = index.zoneOrdinals[record.zoneOrdinal];

    if (ordinalZoneId !== record.zoneId) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index record does not match its zone ordinal.",
        {
          details: { record: recordIndex, zoneOrdinal: record.zoneOrdinal, zoneId: record.zoneId }
        }
      );
    }

    const zone = zonesById.get(record.zoneId);

    if (!zone) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index record references a zone that is not present in the dataset.",
        {
          details: { zoneId: record.zoneId }
        }
      );
    }

    if (zone.level !== record.level) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index record level does not match the dataset zone.",
        {
          details: { zoneId: zone.id, expected: zone.level, actual: record.level }
        }
      );
    }

    const [west, south, east, north] = zone.bbox;

    if (
      record.west !== west ||
      record.south !== south ||
      record.east !== east ||
      record.north !== north
    ) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index record bbox does not match the dataset zone.",
        {
          details: {
            zoneId: zone.id,
            expected: zone.bbox,
            actual: [record.west, record.south, record.east, record.north]
          }
        }
      );
    }
  }

  for (const zone of expectedDataset.zones) {
    if (!seenZoneIds.has(zone.id)) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index is missing a dataset zone.",
        {
          details: { zoneId: zone.id }
        }
      );
    }

    if (!index.getRecord(zone.id)) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index is missing a bbox record for a dataset zone.",
        {
          details: { zoneId: zone.id }
        }
      );
    }
  }

  const treeBuffers = buildTreeBuffersByLevel(createRecordsByLevel(index.records));
  const canonicalLevels = createLevelRecords(index.records, treeBuffers);
  const canonicalTreeByteLength = sumTreeByteLength(canonicalLevels);

  validateLevelRecords(index.metadata.levels, index.records, index.metadata.treeByteLength);

  if (index.metadata.treeByteLength !== canonicalTreeByteLength) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index tree byte length does not match its bbox records.",
      {
        details: { expected: canonicalTreeByteLength, actual: index.metadata.treeByteLength }
      }
    );
  }

  if (index.metadata.levels.length !== canonicalLevels.length) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index level table does not match canonical bbox partitions.",
      {
        details: { expected: canonicalLevels.length, actual: index.metadata.levels.length }
      }
    );
  }

  for (const [levelIndex, canonicalLevel] of canonicalLevels.entries()) {
    const actualLevel = index.metadata.levels[levelIndex];

    if (
      !actualLevel ||
      actualLevel.level !== canonicalLevel.level ||
      actualLevel.start !== canonicalLevel.start ||
      actualLevel.count !== canonicalLevel.count ||
      actualLevel.treeOffset !== canonicalLevel.treeOffset ||
      actualLevel.treeByteLength !== canonicalLevel.treeByteLength
    ) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index level table does not match canonical bbox partitions.",
        {
          details: { expected: canonicalLevel, actual: actualLevel }
        }
      );
    }
  }
}

function rebuildTrustedIndex(index: TerritoryBinarySpatialIndex): TerritoryBinarySpatialIndex {
  const treeBuffers = buildTreeBuffersByLevel(createRecordsByLevel(index.records));
  const levels = createLevelRecords(index.records, treeBuffers);

  return createIndex(
    freezeMetadata({
      ...index.metadata,
      levels,
      treeByteLength: sumTreeByteLength(levels)
    }),
    index.zoneOrdinals,
    index.records,
    treeBuffers
  );
}

function assertExpectedMetadata(
  metadata: TerritoryBinarySpatialIndexMetadata,
  expected: TerritoryBinarySpatialIndexValidationOptions
): void {
  const mismatches = [
    ["datasetId", expected.datasetId, metadata.datasetId],
    ["datasetVersion", expected.datasetVersion, metadata.datasetVersion],
    ["geometryHash", expected.geometryHash, metadata.geometryHash],
    ["indexHash", expected.indexHash, metadata.indexHash]
  ].filter(
    ([, expectedValue, actualValue]) => expectedValue !== undefined && expectedValue !== actualValue
  );

  if (mismatches.length === 0) {
    return;
  }

  throw new TerritoryError(
    "CHECKSUM_MISMATCH",
    "Binary spatial index metadata does not match the expected dataset.",
    {
      details: Object.fromEntries(
        mismatches.map(([field, expectedValue, actualValue]) => [
          String(field),
          {
            expected: String(expectedValue),
            actual: String(actualValue)
          }
        ])
      )
    }
  );
}

function buildTreeBuffersByLevel(
  recordsByLevel: ReadonlyMap<number, readonly TerritoryBinarySpatialIndexBBoxRecord[]>
): ReadonlyMap<number, Uint8Array> {
  const trees = new Map<number, Uint8Array>();

  for (const [level, levelRecords] of recordsByLevel.entries()) {
    const tree = buildFlatbushTree(levelRecords);
    trees.set(level, new Uint8Array(tree.data).slice());
  }

  return trees;
}

function createRecordsByLevel(
  records: readonly TerritoryBinarySpatialIndexBBoxRecord[]
): ReadonlyMap<number, readonly TerritoryBinarySpatialIndexBBoxRecord[]> {
  const recordsByLevel = new Map<number, TerritoryBinarySpatialIndexBBoxRecord[]>();

  for (const record of records) {
    const levelRecords = recordsByLevel.get(record.level) ?? [];
    levelRecords.push(record);
    recordsByLevel.set(record.level, levelRecords);
  }

  return new Map(
    [...recordsByLevel.entries()]
      .sort(([left], [right]) => left - right)
      .map(([level, levelRecords]) => [
        level,
        Object.freeze([...levelRecords].sort(compareBboxRecords))
      ])
  );
}

function buildFlatbushTree(records: readonly TerritoryBinarySpatialIndexBBoxRecord[]): Flatbush {
  const tree = new Flatbush(records.length);

  for (const record of records) {
    tree.add(record.west, record.south, record.east, record.north);
  }

  tree.finish();
  return tree;
}

function restoreFlatbushTree(
  treeBytes: Uint8Array,
  level: TerritoryBinarySpatialIndexLevelRecord
): Flatbush {
  try {
    const tree = Flatbush.from(
      treeBytes.buffer.slice(treeBytes.byteOffset, treeBytes.byteOffset + treeBytes.byteLength)
    );

    if (tree.numItems !== level.count) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index Flatbush tree item count does not match its level record.",
        {
          details: { level: level.level, expected: level.count, actual: tree.numItems }
        }
      );
    }

    return tree;
  } catch (cause) {
    if (cause instanceof TerritoryError) {
      throw cause;
    }

    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index Flatbush tree data is invalid.",
      {
        cause,
        details: { level: level.level }
      }
    );
  }
}

function requireTreeBytes(treeBuffers: ReadonlyMap<number, Uint8Array>, level: number): Uint8Array {
  const treeBytes = treeBuffers.get(level);

  if (!treeBytes) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index tree data is missing for a level.",
      {
        details: { level }
      }
    );
  }

  return treeBytes;
}

function sumTreeByteLength(
  levels: readonly Pick<TerritoryBinarySpatialIndexLevelRecord, "treeByteLength">[]
): number {
  return levels.reduce((total, level) => safeAdd(total, level.treeByteLength), 0);
}

function assertValidLevel(level: number, path: string): void {
  if (!Number.isInteger(level) || level < 0 || level > MAX_BINARY_LEVEL) {
    throw new TerritoryError("ARTIFACT_CORRUPTED", "Binary spatial index level is invalid.", {
      details: { path, level, min: 0, max: MAX_BINARY_LEVEL }
    });
  }
}

function assertValidOrdinal(ordinal: number, zoneCount: number, record: number): void {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= zoneCount) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index record references an invalid zone ordinal.",
      {
        details: { record, zoneOrdinal: ordinal, zoneCount }
      }
    );
  }
}

function assertValidBbox(
  record: Pick<TerritoryBinarySpatialIndexBBoxRecord, "west" | "south" | "east" | "north">,
  path: string
): void {
  const fields = [
    ["west", record.west],
    ["south", record.south],
    ["east", record.east],
    ["north", record.north]
  ] as const;

  for (const [field, value] of fields) {
    if (!Number.isFinite(value)) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index bbox coordinate must be finite.",
        {
          details: { path, field, value }
        }
      );
    }
  }

  if (record.west > record.east || record.south > record.north) {
    throw new TerritoryError("ARTIFACT_CORRUPTED", "Binary spatial index bbox is reversed.", {
      details: { path, bbox: [record.west, record.south, record.east, record.north] }
    });
  }

  if (record.west < -180 || record.east > 180 || record.south < -90 || record.north > 90) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index bbox is outside the supported longitude/latitude domain.",
      {
        details: {
          path,
          bbox: [record.west, record.south, record.east, record.north],
          longitude: [-180, 180],
          latitude: [-90, 90]
        }
      }
    );
  }
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

function createIndexHash(zones: readonly TerritoryZone[]): string {
  const hashInput = zones
    .map((zone) => `${zone.level}:${zone.id}:${zone.bbox.join(",")}`)
    .sort()
    .join("|");

  return checksumString(hashInput).toString(16).padStart(8, "0");
}

function checksumString(input: string): number {
  return checksumBytes(TEXT_ENCODER.encode(input));
}

function compareBboxRecords(
  left: TerritoryBinarySpatialIndexBBoxRecord,
  right: TerritoryBinarySpatialIndexBBoxRecord
): number {
  return left.level - right.level || left.zoneId.localeCompare(right.zoneId);
}

function normalizeBounds(bounds: TerritoryBounds): TerritoryBounds | undefined {
  if (
    !Number.isFinite(bounds.west) ||
    !Number.isFinite(bounds.south) ||
    !Number.isFinite(bounds.east) ||
    !Number.isFinite(bounds.north)
  ) {
    return undefined;
  }

  return {
    west: Math.min(bounds.west, bounds.east),
    south: Math.min(bounds.south, bounds.north),
    east: Math.max(bounds.west, bounds.east),
    north: Math.max(bounds.south, bounds.north)
  };
}

function freezeMetadata(
  metadata: TerritoryBinarySpatialIndexMetadata
): TerritoryBinarySpatialIndexMetadata {
  return Object.freeze({
    ...metadata,
    levels: Object.freeze(metadata.levels.map((level) => Object.freeze({ ...level })))
  });
}

function assertReadable(bytes: Uint8Array, endOffset: number, path: string): void {
  if (!Number.isSafeInteger(endOffset) || endOffset > bytes.byteLength) {
    throw new TerritoryError("ARTIFACT_CORRUPTED", "Binary spatial index is truncated.", {
      details: { path, byteLength: bytes.byteLength, endOffset }
    });
  }
}

function safeAdd(left: number, right: number): number {
  const value = left + right;

  if (!Number.isSafeInteger(value)) {
    throw new TerritoryError("ARTIFACT_CORRUPTED", "Binary spatial index size overflow.");
  }

  return value;
}

function safeMultiply(left: number, right: number): number {
  const value = left * right;

  if (!Number.isSafeInteger(value)) {
    throw new TerritoryError("ARTIFACT_CORRUPTED", "Binary spatial index size overflow.");
  }

  return value;
}

function toUint8Array(input: TerritoryBinarySpatialIndexBuffer): Uint8Array {
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }

  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}
