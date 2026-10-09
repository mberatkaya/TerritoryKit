import { createHash } from "node:crypto";

export const TURKEY_MUNICIPAL_SHAPEFILE_BUNDLE_SCHEMA_VERSION =
  "territorykit-tr-adm3-municipal-shapefile-bundle@1";

export type TurkeyMunicipalShapefileBundleStatus =
  | "VALID"
  | "BLOCKED_BY_SOURCE"
  | "BLOCKED_INCOMPLETE_COMPANIONS"
  | "BLOCKED_DUPLICATE_RESPONSE"
  | "BLOCKED_INVALID_SIGNATURE";

export interface TurkeyMunicipalShapefileCompanionFile {
  role: "shp" | "shx" | "dbf" | "prj" | "cpg" | "other";
  fileName: string;
  byteSize: number;
  sha256: string;
  detectedKind: string;
}

export interface TurkeyMunicipalShapefileBundleReport {
  schemaVersion: typeof TURKEY_MUNICIPAL_SHAPEFILE_BUNDLE_SCHEMA_VERSION;
  status: TurkeyMunicipalShapefileBundleStatus;
  reasonCodes: string[];
  companions: TurkeyMunicipalShapefileCompanionFile[];
  shpRecordCount: number | null;
  shxRecordCount: number | null;
  dbfRecordCount: number | null;
  uniqueSha256Count: number;
  notes: string[];
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readInt32Be(buffer: Uint8Array, offset: number): number {
  return (
    (buffer[offset]! << 24) |
    (buffer[offset + 1]! << 16) |
    (buffer[offset + 2]! << 8) |
    buffer[offset + 3]!
  );
}

function readInt32Le(buffer: Uint8Array, offset: number): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return view.getInt32(offset, true);
}

function detectFileKind(fileName: string, bytes: Uint8Array): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".shp")) {
    return readInt32Be(bytes, 0) === 9994 ? "esri-shapefile-main" : "invalid-shp-header";
  }
  if (lower.endsWith(".shx")) {
    return readInt32Be(bytes, 0) === 9994 ? "esri-shapefile-index" : "invalid-shx-header";
  }
  if (lower.endsWith(".dbf")) {
    return bytes[0] === 0x03 ? "xbase-dbf" : "invalid-dbf-header";
  }
  if (lower.endsWith(".prj")) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 256));
    return /PROJCS|GEOGCS|EPSG/i.test(text) ? "wkt-prj" : "non-wkt-prj";
  }
  if (lower.endsWith(".cpg")) {
    return "codepage-sidecar";
  }
  return "unknown";
}

function countShpPolygonRecords(bytes: Uint8Array): number {
  if (bytes.byteLength < 100 || readInt32Be(bytes, 0) !== 9994) {
    throw new Error("Invalid Shapefile header.");
  }
  let offset = 100;
  let count = 0;
  while (offset + 8 <= bytes.byteLength) {
    const contentLengthBytes = readInt32Be(bytes, offset + 4) * 2;
    const contentOffset = offset + 8;
    const nextOffset = contentOffset + contentLengthBytes;
    if (nextOffset > bytes.byteLength || contentLengthBytes < 4) {
      break;
    }
    const shapeType = readInt32Le(bytes, contentOffset);
    if (shapeType !== 0) {
      count += 1;
    }
    offset = nextOffset;
  }
  return count;
}

function countShxRecords(bytes: Uint8Array): number {
  if (bytes.byteLength < 100 || readInt32Be(bytes, 0) !== 9994) {
    throw new Error("Invalid Shapefile index header.");
  }
  return Math.floor((bytes.byteLength - 100) / 8);
}

function countDbfRecords(bytes: Uint8Array): number {
  if (bytes.byteLength < 12 || bytes[0] !== 0x03) {
    throw new Error("Invalid DBF header.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(4, true);
}

export function inspectTurkeyMunicipalShapefileCompanionBundle(
  files: ReadonlyArray<{ fileName: string; bytes: Uint8Array }>
): TurkeyMunicipalShapefileBundleReport {
  const reasonCodes: string[] = [];
  const notes: string[] = [];
  const companions: TurkeyMunicipalShapefileCompanionFile[] = files.map((file) => {
    const role = file.fileName.toLowerCase().endsWith(".shp")
      ? "shp"
      : file.fileName.toLowerCase().endsWith(".shx")
        ? "shx"
        : file.fileName.toLowerCase().endsWith(".dbf")
          ? "dbf"
          : file.fileName.toLowerCase().endsWith(".prj")
            ? "prj"
            : file.fileName.toLowerCase().endsWith(".cpg")
              ? "cpg"
              : "other";
    return {
      role,
      fileName: file.fileName,
      byteSize: file.bytes.byteLength,
      sha256: sha256Hex(file.bytes),
      detectedKind: detectFileKind(file.fileName, file.bytes)
    };
  });
  const uniqueSha256Count = new Set(companions.map((file) => file.sha256)).size;
  const shp = companions.find((file) => file.role === "shp");
  const shx = companions.find((file) => file.role === "shx");
  const dbf = companions.find((file) => file.role === "dbf");
  const prj = companions.find((file) => file.role === "prj");

  if (!shp) {
    reasonCodes.push("MISSING_SHP");
  }
  if (!shx) {
    reasonCodes.push("MISSING_SHX");
  }
  if (!dbf) {
    reasonCodes.push("MISSING_DBF");
  }
  if (!prj) {
    reasonCodes.push("MISSING_PRJ");
  }

  if (uniqueSha256Count === 1 && companions.length > 1) {
    reasonCodes.push("IDENTICAL_COMPANION_BYTES");
    notes.push(
      "Tüm companion dosyalar aynı SHA-256 ve boyuta sahip; bağımsız SHP bundle doğrulanamaz."
    );
  }

  for (const file of companions) {
    if (file.detectedKind.startsWith("invalid-")) {
      reasonCodes.push(`INVALID_${file.role.toUpperCase()}_SIGNATURE`);
    }
  }

  let shpRecordCount: number | null = null;
  let shxRecordCount: number | null = null;
  let dbfRecordCount: number | null = null;
  const shpFile = files.find((file) => file.fileName.toLowerCase().endsWith(".shp"));
  const shxFile = files.find((file) => file.fileName.toLowerCase().endsWith(".shx"));
  const dbfFile = files.find((file) => file.fileName.toLowerCase().endsWith(".dbf"));
  try {
    if (shpFile) {
      shpRecordCount = countShpPolygonRecords(shpFile.bytes);
    }
  } catch {
    reasonCodes.push("SHP_PARSE_FAILED");
  }
  try {
    if (shxFile) {
      shxRecordCount = countShxRecords(shxFile.bytes);
    }
  } catch {
    reasonCodes.push("SHX_PARSE_FAILED");
  }
  try {
    if (dbfFile) {
      dbfRecordCount = countDbfRecords(dbfFile.bytes);
    }
  } catch {
    reasonCodes.push("DBF_PARSE_FAILED");
  }

  if (shpRecordCount !== null && shxRecordCount !== null && shpRecordCount !== shxRecordCount) {
    reasonCodes.push("SHP_SHX_RECORD_COUNT_MISMATCH");
  }
  if (shpRecordCount !== null && dbfRecordCount !== null && shpRecordCount !== dbfRecordCount) {
    reasonCodes.push("SHP_DBF_RECORD_COUNT_MISMATCH");
  }

  let status: TurkeyMunicipalShapefileBundleStatus = "VALID";
  if (reasonCodes.includes("IDENTICAL_COMPANION_BYTES")) {
    status = "BLOCKED_DUPLICATE_RESPONSE";
  } else if (reasonCodes.some((code) => code.startsWith("INVALID_"))) {
    status = "BLOCKED_INVALID_SIGNATURE";
  } else if (reasonCodes.some((code) => code.startsWith("MISSING_"))) {
    status = "BLOCKED_INCOMPLETE_COMPANIONS";
  } else if (reasonCodes.length > 0) {
    status = "BLOCKED_BY_SOURCE";
  }

  return {
    schemaVersion: TURKEY_MUNICIPAL_SHAPEFILE_BUNDLE_SCHEMA_VERSION,
    status,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    companions: companions.sort((left, right) => left.fileName.localeCompare(right.fileName)),
    shpRecordCount,
    shxRecordCount,
    dbfRecordCount,
    uniqueSha256Count,
    notes
  };
}
