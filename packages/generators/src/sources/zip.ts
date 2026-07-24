import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH_BYTES = 65_535 + 22;

export interface ZipMemberExtraction {
  filename: string;
  bytes: Uint8Array;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
}

export function extractZipMember(input: Uint8Array, requestedMember: string): ZipMemberExtraction {
  const archive = Buffer.from(input);
  const member = normalizeZipMemberName(requestedMember);
  const eocdOffset = findEndOfCentralDirectory(archive);
  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  let offset = centralDirectoryOffset;

  while (offset < centralDirectoryEnd) {
    if (archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Invalid ZIP central directory entry.");
    }

    const compressionMethod = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const filenameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const filename = archive.subarray(offset + 46, offset + 46 + filenameLength).toString("utf8");

    if (normalizeZipMemberName(filename) === member) {
      return {
        filename,
        bytes: readZipMemberBytes({
          archive,
          localHeaderOffset,
          compressedSize,
          uncompressedSize,
          compressionMethod
        }),
        compressedSize,
        uncompressedSize,
        compressionMethod
      };
    }

    offset += 46 + filenameLength + extraLength + commentLength;
  }

  throw new Error(`ZIP member '${requestedMember}' was not found.`);
}

function readZipMemberBytes(input: {
  archive: Buffer;
  localHeaderOffset: number;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
}): Uint8Array {
  if (input.archive.readUInt32LE(input.localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error("Invalid ZIP local file header.");
  }

  const filenameLength = input.archive.readUInt16LE(input.localHeaderOffset + 26);
  const extraLength = input.archive.readUInt16LE(input.localHeaderOffset + 28);
  const dataStart = input.localHeaderOffset + 30 + filenameLength + extraLength;
  const compressed = input.archive.subarray(dataStart, dataStart + input.compressedSize);
  const bytes =
    input.compressionMethod === 0
      ? compressed
      : input.compressionMethod === 8
        ? inflateRawSync(compressed)
        : undefined;

  if (!bytes) {
    throw new Error(`Unsupported ZIP compression method ${input.compressionMethod}.`);
  }

  if (bytes.byteLength !== input.uncompressedSize) {
    throw new Error("ZIP member uncompressed size does not match the central directory.");
  }

  return bytes;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const start = Math.max(0, archive.byteLength - MAX_EOCD_SEARCH_BYTES);

  for (let offset = archive.byteLength - 22; offset >= start; offset -= 1) {
    if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("ZIP end of central directory was not found.");
}

function normalizeZipMemberName(input: string): string {
  return input.replace(/^\/+/, "").replaceAll("\\", "/");
}
