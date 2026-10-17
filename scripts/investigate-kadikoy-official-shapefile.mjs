#!/usr/bin/env node
/**
 * Kadıköy municipal mahalle shapefile acquisition investigation (read-only).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectTurkeyMunicipalShapefileCompanionBundle } from "../packages/generators/dist/turkey-adm3.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACQUISITION_PATH = "reports/tr-adm3/audit/kadikoy-acquisition.json";
const DATASET_API =
  "https://acikveri.kadikoy.bel.tr/api/3/action/package_show?id=1f49bf03-cea5-40b9-9604-5f71c6f71e22";
const LOCAL_RAW_DIR = ".territory/source-evidence/kadikoy-official-mahalle/raw";

function sha256Buffer(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function magicLabel(bytes) {
  if (bytes.length < 4) {
    return "TOO_SHORT";
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x27 && bytes[3] === 0x0a) {
    return "ESRI_SHAPEFILE_MAIN";
  }
  if (bytes[0] === 0x03 && bytes[1] === 0x00 && bytes[2] === 0x00 && bytes[3] === 0x00) {
    return "ESRI_DBASE_III";
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return "ZIP_ARCHIVE";
  }
  return `UNKNOWN_${bytes.slice(0, 4).toString("hex")}`;
}

async function probeUrl(url) {
  try {
    const response = await fetch(url, { method: "GET", redirect: "follow" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      url,
      httpStatus: response.status,
      contentType: response.headers.get("content-type"),
      byteSize: bytes.byteLength,
      sha256: sha256Buffer(bytes),
      magic: magicLabel(bytes),
      ok: response.ok
    };
  } catch (error) {
    return {
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function loadLocalCompanions() {
  const acquisition = JSON.parse(await readFile(join(REPO_ROOT, ACQUISITION_PATH), "utf8"));
  const files = [];
  for (const entry of acquisition) {
    const fileName = entry.url.split("/").pop();
    const localPath = join(REPO_ROOT, LOCAL_RAW_DIR, fileName);
    if (!existsSync(localPath)) {
      continue;
    }
    const bytes = await readFile(localPath);
    files.push({ fileName, bytes: new Uint8Array(bytes) });
  }
  return { acquisition, files };
}

export async function investigateKadikoyOfficialShapefile(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const acquisition = JSON.parse(await readFile(join(repoRoot, ACQUISITION_PATH), "utf8"));
  const historicalSha256 = acquisition.map((row) => row.sha256);
  const uniqueHistorical = new Set(historicalSha256);

  let packageShow = null;
  try {
    const response = await fetch(DATASET_API);
    packageShow = await response.json();
  } catch (error) {
    packageShow = {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  const liveProbes = [];
  for (const entry of acquisition.slice(0, 2)) {
    liveProbes.push(await probeUrl(entry.url));
  }

  const { files } = await loadLocalCompanions();
  const bundleReport =
    files.length > 0
      ? inspectTurkeyMunicipalShapefileCompanionBundle(files)
      : {
          schemaVersion: "territorykit-tr-adm3-municipal-shapefile-bundle@1",
          status: "BLOCKED_INCOMPLETE_COMPANIONS",
          structuralStatus: "NOT_RUN",
          productionEligibility: "NOT_ELIGIBLE",
          reasonCodes: ["MISSING_LOCAL_COMPANION_FILES"],
          notes: ["No trusted local raw bundle; live probes are informational only."]
        };

  const duplicateLiveBytes =
    liveProbes.length > 1 &&
    liveProbes.every((row) => row.ok && row.sha256 === liveProbes[0].sha256);

  const decision = {
    status:
      bundleReport.status === "VALID"
        ? "REVIEW_REQUIRED"
        : duplicateLiveBytes || uniqueHistorical.size === 1
          ? "BLOCKED_BY_SOURCE"
          : "BLOCKED_BY_SOURCE",
    verificationClass: files.length > 0 ? "LOCAL_RAW_VERIFIED" : "REMOTE_PROBE_ONLY",
    structuralStatus: bundleReport.structuralStatus ?? "NOT_RUN",
    productionEligibility: "NOT_ELIGIBLE",
    licenseExplicit: false,
    redistributionRightsDocumented: false
  };

  return {
    schemaVersion: "territorykit-tr-kadikoy-official-shapefile-investigation@1",
    generatedAt: new Date().toISOString(),
    acquisitionEvidencePath: ACQUISITION_PATH,
    historicalAudit: {
      companionUrlCount: acquisition.length,
      uniqueSha256Count: uniqueHistorical.size,
      identicalBytesAcrossCompanions: uniqueHistorical.size === 1 && acquisition.length > 1,
      note: "Historical acquisition returned identical bytes for .shp/.shx/.dbf/.prj/.cpg URLs — not independent companions."
    },
    ckanPackageShow: packageShow,
    liveProbes,
    localRawDir: LOCAL_RAW_DIR,
    localCompanionCount: files.length,
    bundleReport,
    decision,
    findings: [
      duplicateLiveBytes
        ? "Live HTTP probes still return identical payloads for distinct companion URLs."
        : "Live HTTP probes differ or failed — treat as inconclusive without full bundle capture.",
      "No explicit municipal redistribution license captured in acquisition evidence.",
      "Canonical gameplay/identity datasets were not modified."
    ],
    officialPolygonIngestionEvidenceRequirements: [
      "Independent .shp/.shx/.dbf/.prj/.cpg byte streams with distinct SHA-256 per companion",
      "Valid SHP/SHX/DBF structure and CRS/PRJ metadata",
      "Mahalle name, stable ID, and parent ilçe fields extractable",
      "Documented license + redistribution approval for derivative/hosted use",
      "Human authorization gate before promoting to approved-official-polygon precedence"
    ]
  };
}

async function main() {
  const report = await investigateKadikoyOfficialShapefile();
  const outDir = join(REPO_ROOT, "reports/tr-adm3/sprint-2e-source-evidence");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, "kadikoy-official-shapefile-investigation.json");
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, outPath, decision: report.decision }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
