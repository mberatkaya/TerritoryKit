import { createHash } from "node:crypto";

export const TURKEY_MUNICIPAL_SHAPEFILE_BUNDLE_SCHEMA_VERSION =
  "territorykit-tr-adm3-municipal-shapefile-bundle@1";

export type TurkeyMunicipalShapefileBundleStatus =
  | "VALID"
  | "BLOCKED_BY_SOURCE"
  | "BLOCKED_INCOMPLETE_COMPANIONS"
  | "BLOCKED_DUPLICATE_RESPONSE"
  | "BLOCKED_INVALID_SIGNATURE";

export type TurkeyMunicipalShapefileStructuralStatus =
  "STRUCTURALLY_VALID" | "STRUCTURALLY_INVALID" | "NOT_RUN";

export type TurkeyMunicipalShapefileProductionEligibility =
  "NOT_ELIGIBLE" | "PENDING_INDEPENDENT_VALIDATION" | "BLOCKED_BY_SOURCE";

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
  structuralStatus: TurkeyMunicipalShapefileStructuralStatus;
  productionEligibility: TurkeyMunicipalShapefileProductionEligibility;
  reasonCodes: string[];
  companions: TurkeyMunicipalShapefileCompanionFile[];
  shpRecordCount: number | null;
  shxRecordCount: number | null;
  dbfRecordCount: number | null;
  uniqueSha256Count: number;
  notes: string[];
}

const POLYGON_SHAPE_TYPES = new Set([5, 15, 18, 25, 28, 31]);

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

function readUint16Le(buffer: Uint8Array, offset: number): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return view.getUint16(offset, true);
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

function validateDeclaredFileLength(bytes: Uint8Array, role: "shp" | "shx"): string | null {
  if (bytes.byteLength < 24) {
    return `TRUNCATED_${role.toUpperCase()}_HEADER`;
  }
  const declaredWords = readInt32Be(bytes, 24);
  const expectedBytes = declaredWords * 2;
  if (expectedBytes > bytes.byteLength) {
    return `TRUNCATED_${role.toUpperCase()}_BODY`;
  }
  if (expectedBytes < bytes.byteLength) {
    return `${role.toUpperCase()}_LENGTH_EXCEEDS_DECLARED`;
  }
  return null;
}

interface ShpRecordSummary {
  count: number;
  shapeTypes: number[];
  truncated: boolean;
}

function summarizeShpRecords(bytes: Uint8Array): ShpRecordSummary {
  const summary: ShpRecordSummary = { count: 0, shapeTypes: [], truncated: false };
  if (bytes.byteLength < 100 || readInt32Be(bytes, 0) !== 9994) {
    throw new Error("Invalid Shapefile header.");
  }
  const fileShapeType = readInt32Le(bytes, 32);
  if (!POLYGON_SHAPE_TYPES.has(fileShapeType) && fileShapeType !== 0) {
    summary.shapeTypes.push(fileShapeType);
  }
  let offset = 100;
  while (offset + 8 <= bytes.byteLength) {
    const contentLengthBytes = readInt32Be(bytes, offset + 4) * 2;
    const contentOffset = offset + 8;
    const nextOffset = contentOffset + contentLengthBytes;
    if (nextOffset > bytes.byteLength || contentLengthBytes < 4) {
      summary.truncated = true;
      break;
    }
    const shapeType = readInt32Le(bytes, contentOffset);
    if (shapeType !== 0) {
      summary.count += 1;
      summary.shapeTypes.push(shapeType);
    }
    offset = nextOffset;
  }
  return summary;
}

function summarizeShxRecords(bytes: Uint8Array): {
  count: number;
  entries: Array<{ offset: number; length: number }>;
} {
  if (bytes.byteLength < 100 || readInt32Be(bytes, 0) !== 9994) {
    throw new Error("Invalid Shapefile index header.");
  }
  const entries: Array<{ offset: number; length: number }> = [];
  for (let offset = 100; offset + 8 <= bytes.byteLength; offset += 8) {
    entries.push({
      offset: readInt32Be(bytes, offset),
      length: readInt32Be(bytes, offset + 4)
    });
  }
  return { count: entries.length, entries };
}

function countDbfRecords(bytes: Uint8Array): {
  recordCount: number;
  headerLength: number;
  recordLength: number;
} {
  if (bytes.byteLength < 12 || bytes[0] !== 0x03) {
    throw new Error("Invalid DBF header.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const recordCount = view.getUint32(4, true);
  const headerLength = readUint16Le(bytes, 8);
  const recordLength = readUint16Le(bytes, 10);
  const expectedSize = headerLength + recordCount * recordLength + 1;
  if (expectedSize > bytes.byteLength) {
    throw new Error("Truncated DBF records.");
  }
  return { recordCount, headerLength, recordLength };
}

function validatePrjSyntax(bytes: Uint8Array): boolean {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
  if (!/^(PROJCS|GEOGCS)\s*\[/i.test(text)) {
    return false;
  }
  let depth = 0;
  for (const char of text) {
    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

export function inspectTurkeyMunicipalShapefileCompanionBundle(
  files: ReadonlyArray<{ fileName: string; bytes: Uint8Array }>
): TurkeyMunicipalShapefileBundleReport {
  const reasonCodes: string[] = [];
  const notes: string[] = [];
  const companions: TurkeyMunicipalShapefileCompanionFile[] = files.map((file) => {
    const lower = file.fileName.toLowerCase();
    const role = lower.endsWith(".shp")
      ? "shp"
      : lower.endsWith(".shx")
        ? "shx"
        : lower.endsWith(".dbf")
          ? "dbf"
          : lower.endsWith(".prj")
            ? "prj"
            : lower.endsWith(".cpg")
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

  for (const role of ["shp", "shx", "dbf", "prj"] as const) {
    if (companions.filter((file) => file.role === role).length > 1) {
      reasonCodes.push(`DUPLICATE_${role.toUpperCase()}_COMPANION`);
    }
  }

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
    if (file.role === "shp" || file.role === "shx") {
      const lengthIssue = validateDeclaredFileLength(
        files.find((entry) => entry.fileName === file.fileName)!.bytes,
        file.role
      );
      if (lengthIssue) {
        reasonCodes.push(lengthIssue);
      }
    }
  }

  const shpFile = files.find((file) => file.fileName.toLowerCase().endsWith(".shp"));
  const shxFile = files.find((file) => file.fileName.toLowerCase().endsWith(".shx"));
  const dbfFile = files.find((file) => file.fileName.toLowerCase().endsWith(".dbf"));
  const prjFile = files.find((file) => file.fileName.toLowerCase().endsWith(".prj"));

  let shpRecordCount: number | null = null;
  let shxRecordCount: number | null = null;
  let dbfRecordCount: number | null = null;
  let structuralStatus: TurkeyMunicipalShapefileStructuralStatus = "NOT_RUN";

  try {
    if (shpFile) {
      const summary = summarizeShpRecords(shpFile.bytes);
      shpRecordCount = summary.count;
      if (summary.truncated) {
        reasonCodes.push("SHP_RECORD_TRUNCATED");
      }
      for (const shapeType of summary.shapeTypes) {
        if (!POLYGON_SHAPE_TYPES.has(shapeType)) {
          reasonCodes.push(`UNSUPPORTED_SHAPE_TYPE_${shapeType}`);
        }
      }
    }
  } catch {
    reasonCodes.push("SHP_PARSE_FAILED");
  }
  try {
    if (shxFile && shpFile) {
      const shx = summarizeShxRecords(shxFile.bytes);
      shxRecordCount = shx.count;
      const shpSummary = summarizeShpRecords(shpFile.bytes);
      if (shx.count !== shpSummary.count) {
        reasonCodes.push("SHP_SHX_RECORD_COUNT_MISMATCH");
      }
      let shpOffset = 100;
      for (const entry of shx.entries) {
        const expectedWordOffset = shpOffset / 2;
        if (entry.offset !== expectedWordOffset) {
          reasonCodes.push("SHP_SHX_OFFSET_MISMATCH");
          break;
        }
        const contentLengthBytes = entry.length * 2;
        shpOffset += 8 + contentLengthBytes;
      }
    } else if (shxFile) {
      shxRecordCount = summarizeShxRecords(shxFile.bytes).count;
    }
  } catch {
    reasonCodes.push("SHX_PARSE_FAILED");
  }
  try {
    if (dbfFile) {
      const dbf = countDbfRecords(dbfFile.bytes);
      dbfRecordCount = dbf.recordCount;
    }
  } catch {
    reasonCodes.push("DBF_PARSE_FAILED");
  }

  if (prjFile && !validatePrjSyntax(prjFile.bytes)) {
    reasonCodes.push("INVALID_PRJ_SYNTAX");
  }

  if (shpRecordCount !== null && dbfRecordCount !== null && shpRecordCount !== dbfRecordCount) {
    reasonCodes.push("SHP_DBF_RECORD_COUNT_MISMATCH");
  }

  const blockingStructural = reasonCodes.some(
    (code) =>
      code.startsWith("MISSING_") ||
      code.startsWith("INVALID_") ||
      code.startsWith("SHP_") ||
      code.startsWith("SHX_") ||
      code.startsWith("DBF_") ||
      code.startsWith("TRUNCATED_") ||
      code.startsWith("UNSUPPORTED_") ||
      code.startsWith("DUPLICATE_") ||
      code.includes("_LENGTH_")
  );

  if (reasonCodes.length === 0 && shp && shx && dbf && prj) {
    structuralStatus = "STRUCTURALLY_VALID";
  } else if (blockingStructural) {
    structuralStatus = "STRUCTURALLY_INVALID";
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

  const productionEligibility: TurkeyMunicipalShapefileProductionEligibility =
    status === "VALID" && structuralStatus === "STRUCTURALLY_VALID"
      ? "PENDING_INDEPENDENT_VALIDATION"
      : "NOT_ELIGIBLE";

  if (structuralStatus === "STRUCTURALLY_VALID") {
    notes.push(
      "Yapısal companion doğrulama geçti; tam geometri, CRS, lisans ve kaynak kimliği onayı ayrıdır."
    );
  }

  return {
    schemaVersion: TURKEY_MUNICIPAL_SHAPEFILE_BUNDLE_SCHEMA_VERSION,
    status,
    structuralStatus,
    productionEligibility,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    companions: companions.sort((left, right) => left.fileName.localeCompare(right.fileName)),
    shpRecordCount,
    shxRecordCount,
    dbfRecordCount,
    uniqueSha256Count,
    notes
  };
}
