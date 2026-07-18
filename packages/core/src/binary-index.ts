import { TerritoryError, loadTerritoryDataset } from "@territory-kit/dataset";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
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
const LEVEL_RECORD_BYTES = 12;
const BBOX_RECORD_BYTES = 40;
const CHECKSUM_OFFSET = 24;
const LITTLE_ENDIAN_FLAG = 1;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

interface BinaryMetadataPayload {
  readonly format: typeof TERRITORY_BINARY_SPATIAL_INDEX_FORMAT;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly geometryHash: string;
  readonly indexHash: string;
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
  const levels = createLevelRecords(records);
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
    levels
  });

  return createIndex(metadata, zoneOrdinals, records);
}

export function encodeTerritoryBinarySpatialIndex(
  input: TerritoryDataset | TerritoryBinarySpatialIndex
): ArrayBuffer {
  const index = isTerritoryBinarySpatialIndex(input)
    ? input
    : createTerritoryBinarySpatialIndex(input);
  const metadataPayload: BinaryMetadataPayload = {
    format: TERRITORY_BINARY_SPATIAL_INDEX_FORMAT,
    datasetId: index.metadata.datasetId,
    datasetVersion: index.metadata.datasetVersion,
    geometryHash: index.metadata.geometryHash,
    indexHash: index.metadata.indexHash
  };
  const metadataBytes = TEXT_ENCODER.encode(JSON.stringify(metadataPayload));
  const zoneTableBytes = index.zoneOrdinals.reduce(
    (total, zoneId) => total + 4 + TEXT_ENCODER.encode(zoneId).byteLength,
    0
  );
  const byteLength =
    HEADER_BYTES +
    metadataBytes.byteLength +
    index.metadata.levels.length * LEVEL_RECORD_BYTES +
    index.records.length * BBOX_RECORD_BYTES +
    zoneTableBytes;
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);

  writeHeader(view, {
    metadataLength: metadataBytes.byteLength,
    levelCount: index.metadata.levels.length,
    recordCount: index.records.length,
    zoneCount: index.zoneOrdinals.length,
    checksum: 0
  });

  let offset = HEADER_BYTES;
  bytes.set(metadataBytes, offset);
  offset += metadataBytes.byteLength;

  for (const level of index.metadata.levels) {
    view.setInt32(offset, level.level, true);
    view.setUint32(offset + 4, level.start, true);
    view.setUint32(offset + 8, level.count, true);
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

  const metadataLength = view.getUint32(8, true);
  const levelCount = view.getUint32(12, true);
  const recordCount = view.getUint32(16, true);
  const zoneCount = view.getUint32(20, true);
  const checksum = view.getUint32(CHECKSUM_OFFSET, true);
  const expectedChecksum = checksumBytes(bytes);

  if (checksum !== expectedChecksum) {
    throw new TerritoryError("CHECKSUM_MISMATCH", "Binary spatial index checksum mismatch.", {
      details: {
        expected: checksum,
        actual: expectedChecksum
      }
    });
  }

  let offset = HEADER_BYTES;
  const metadataEnd = offset + metadataLength;

  assertReadable(bytes, metadataEnd, "metadata");

  const metadataPayload = readMetadataPayload(bytes.slice(offset, metadataEnd));
  offset = metadataEnd;

  const levels: TerritoryBinarySpatialIndexLevelRecord[] = [];

  for (let index = 0; index < levelCount; index += 1) {
    assertReadable(bytes, offset + LEVEL_RECORD_BYTES, `levels[${index}]`);
    levels.push(
      Object.freeze({
        level: view.getInt32(offset, true),
        start: view.getUint32(offset + 4, true),
        count: view.getUint32(offset + 8, true)
      })
    );
    offset += LEVEL_RECORD_BYTES;
  }

  const partialZoneOrdinals = new Array<string>(zoneCount);
  const records: TerritoryBinarySpatialIndexBBoxRecord[] = [];
  const rawRecords: Array<Omit<TerritoryBinarySpatialIndexBBoxRecord, "zoneId">> = [];

  for (let index = 0; index < recordCount; index += 1) {
    assertReadable(bytes, offset + BBOX_RECORD_BYTES, `records[${index}]`);
    rawRecords.push({
      level: view.getInt32(offset, true),
      zoneOrdinal: view.getUint32(offset + 4, true),
      west: view.getFloat64(offset + 8, true),
      south: view.getFloat64(offset + 16, true),
      east: view.getFloat64(offset + 24, true),
      north: view.getFloat64(offset + 32, true)
    });
    offset += BBOX_RECORD_BYTES;
  }

  for (let index = 0; index < zoneCount; index += 1) {
    assertReadable(bytes, offset + 4, `zoneOrdinals[${index}].length`);
    const length = view.getUint32(offset, true);
    offset += 4;
    assertReadable(bytes, offset + length, `zoneOrdinals[${index}]`);
    partialZoneOrdinals[index] = TEXT_DECODER.decode(bytes.slice(offset, offset + length));
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

  const zoneOrdinals = partialZoneOrdinals.map((zoneId, index) => {
    if (!zoneId) {
      throw new TerritoryError("ARTIFACT_CORRUPTED", "Binary spatial index zone id is empty.", {
        details: { ordinal: index }
      });
    }

    return zoneId;
  });

  for (const [index, rawRecord] of rawRecords.entries()) {
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

    records.push(
      Object.freeze({
        ...rawRecord,
        zoneId
      })
    );
  }

  validateLevelRecords(levels, records.length);

  const metadata = freezeMetadata({
    format: TERRITORY_BINARY_SPATIAL_INDEX_FORMAT,
    magic: TERRITORY_BINARY_SPATIAL_INDEX_MAGIC,
    schemaVersion: TERRITORY_BINARY_SPATIAL_INDEX_SCHEMA_VERSION,
    byteOrder: "little-endian",
    datasetId: metadataPayload.datasetId,
    datasetVersion: metadataPayload.datasetVersion,
    geometryHash: metadataPayload.geometryHash,
    indexHash: metadataPayload.indexHash,
    checksum,
    byteLength: bytes.byteLength,
    zoneCount,
    bboxRecordCount: recordCount,
    levels
  });

  assertExpectedMetadata(metadata, options);

  return createIndex(metadata, zoneOrdinals, records);
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
  records: readonly TerritoryBinarySpatialIndexBBoxRecord[]
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

      const candidates =
        level === undefined
          ? frozenRecords
          : (frozenRecordsByLevel.get(level) ?? ([] as TerritoryBinarySpatialIndexBBoxRecord[]));

      return candidates
        .filter((record) => bboxIntersects(record, normalizedBounds))
        .sort(compareBboxRecords)
        .map((record) => record.zoneId);
    }
  });
}

function writeHeader(
  view: DataView,
  input: {
    readonly metadataLength: number;
    readonly levelCount: number;
    readonly recordCount: number;
    readonly zoneCount: number;
    readonly checksum: number;
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
  view.setUint32(28, 0, true);
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
  const input = JSON.parse(TEXT_DECODER.decode(bytes)) as unknown;

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
  records: readonly TerritoryBinarySpatialIndexBBoxRecord[]
): readonly TerritoryBinarySpatialIndexLevelRecord[] {
  const levels: TerritoryBinarySpatialIndexLevelRecord[] = [];
  let currentLevel: number | undefined;
  let start = 0;
  let count = 0;

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

    levels.push(Object.freeze({ level: currentLevel, start, count }));
    currentLevel = record.level;
    start = index;
    count = 1;
  }

  if (currentLevel !== undefined) {
    levels.push(Object.freeze({ level: currentLevel, start, count }));
  }

  return Object.freeze(levels);
}

function validateLevelRecords(
  levels: readonly TerritoryBinarySpatialIndexLevelRecord[],
  recordCount: number
): void {
  let expectedStart = 0;

  for (const level of levels) {
    if (level.start !== expectedStart || level.start + level.count > recordCount) {
      throw new TerritoryError(
        "ARTIFACT_CORRUPTED",
        "Binary spatial index level records are not contiguous.",
        {
          details: { level: level.level, start: level.start, count: level.count, recordCount }
        }
      );
    }

    expectedStart += level.count;
  }

  if (expectedStart !== recordCount) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Binary spatial index level records do not cover all bbox records.",
      {
        details: { expectedStart, recordCount }
      }
    );
  }
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

function bboxIntersects(
  record: TerritoryBinarySpatialIndexBBoxRecord,
  bounds: TerritoryBounds
): boolean {
  return (
    record.west <= bounds.east &&
    record.east >= bounds.west &&
    record.south <= bounds.north &&
    record.north >= bounds.south
  );
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
  if (endOffset > bytes.byteLength) {
    throw new TerritoryError("ARTIFACT_CORRUPTED", "Binary spatial index is truncated.", {
      details: { path, byteLength: bytes.byteLength, endOffset }
    });
  }
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
