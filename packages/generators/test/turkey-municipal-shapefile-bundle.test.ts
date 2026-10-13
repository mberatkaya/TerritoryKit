import { describe, expect, it } from "vitest";
import { inspectTurkeyMunicipalShapefileCompanionBundle } from "../src/turkey-municipal-shapefile-bundle.js";

function shpHeaderOnly(recordCount = 1): Uint8Array {
  const recordBytes = recordCount * (8 + 44);
  const totalBytes = 100 + recordBytes;
  const bytes = new Uint8Array(totalBytes);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 9994, false);
  view.setInt32(24, totalBytes / 2, false);
  view.setInt32(32, 5, true);
  let offset = 100;
  for (let index = 0; index < recordCount; index += 1) {
    view.setInt32(offset + 4, 22, false);
    view.setInt32(offset + 8, 5, true);
    view.setInt32(offset + 44, 1, true);
    offset += 8 + 44;
  }
  return bytes;
}

function validCompanionBundle(recordCount = 2) {
  const shp = shpHeaderOnly(recordCount);
  const shx = new Uint8Array(100 + recordCount * 8);
  const shxView = new DataView(shx.buffer);
  shxView.setInt32(0, 9994, false);
  shxView.setInt32(24, shx.byteLength / 2, false);
  let shxOffset = 100;
  let shpOffset = 100;
  for (let index = 0; index < recordCount; index += 1) {
    shxView.setInt32(shxOffset, shpOffset / 2, false);
    shxView.setInt32(shxOffset + 4, 22, false);
    shxOffset += 8;
    shpOffset += 8 + 44;
  }
  const dbf = new Uint8Array(32);
  const dbfView = new DataView(dbf.buffer);
  dbf[0] = 0x03;
  dbfView.setUint32(4, recordCount, true);
  const prj = new TextEncoder().encode('GEOGCS["WGS 84"]');
  return [
    { fileName: "mahalle.shp", bytes: shp },
    { fileName: "mahalle.shx", bytes: shx },
    { fileName: "mahalle.dbf", bytes: dbf },
    { fileName: "mahalle.prj", bytes: prj }
  ];
}

describe("municipal shapefile companion bundle validation", () => {
  it("rejects identical companion byte hashes like Kadıköy acquisition evidence", () => {
    const duplicate = shpHeaderOnly(21);
    const report = inspectTurkeyMunicipalShapefileCompanionBundle([
      { fileName: "mahalle_sinir.shp", bytes: duplicate },
      { fileName: "mahalle_sinir.shx", bytes: duplicate },
      { fileName: "mahalle_sinir.dbf", bytes: duplicate },
      { fileName: "mahalle_sinir.prj", bytes: duplicate }
    ]);
    expect(report.status).toBe("BLOCKED_DUPLICATE_RESPONSE");
    expect(report.reasonCodes).toContain("IDENTICAL_COMPANION_BYTES");
    expect(report.uniqueSha256Count).toBe(1);
  });

  it("accepts distinct companion signatures with matching record counts", () => {
    const report = inspectTurkeyMunicipalShapefileCompanionBundle(validCompanionBundle(2));
    expect(report.status).toBe("VALID");
    expect(report.structuralStatus).toBe("STRUCTURALLY_VALID");
    expect(report.productionEligibility).toBe("PENDING_INDEPENDENT_VALIDATION");
    expect(report.shpRecordCount).toBe(2);
    expect(report.shxRecordCount).toBe(2);
    expect(report.dbfRecordCount).toBe(2);
  });

  it("rejects truncated SHP records and invalid DBF headers", () => {
    const shp = shpHeaderOnly(1).slice(0, 120);
    const shx = new Uint8Array(108);
    const shxView = new DataView(shx.buffer);
    shxView.setInt32(0, 9994, false);
    shxView.setInt32(24, shx.byteLength / 2, false);
    shxView.setInt32(100, 50, false);
    shxView.setInt32(104, 22, false);
    const report = inspectTurkeyMunicipalShapefileCompanionBundle([
      { fileName: "mahalle.shp", bytes: shp },
      { fileName: "mahalle.shx", bytes: shx },
      { fileName: "mahalle.dbf", bytes: new Uint8Array([0x00]) },
      { fileName: "mahalle.prj", bytes: new TextEncoder().encode('GEOGCS["WGS 84"]') }
    ]);
    expect(report.structuralStatus).toBe("STRUCTURALLY_INVALID");
    expect(report.reasonCodes).toContain("SHP_RECORD_TRUNCATED");
    expect(report.reasonCodes).toContain("INVALID_DBF_SIGNATURE");
  });
});
