#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { validateGeometryDataset } from "../packages/dataset/dist/index.mjs";

const execFileAsync = promisify(execFile);

const LOCK = {
  datasetVersion: "2.1.0-rc.8",
  buildDate: "2026-10-14T00:00:00.000Z",
  implementationRevision: "national-hybrid-sibling-gate-v1",
  barrierRoot: ".territory/sprint-6/calibration/barriers",
  osmSourceLockPath: ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json",
  adm0Adm2Dataset: "datasets/generated/countries/TR/dataset.json",
  cliEntry: "packages/cli/dist/index.mjs"
};

const DISTRICTS = [
  { id: "tr:adm2:54988432b81567150601582", name: "Ağrı merkez" },
  { id: "tr:adm2:54988432b95277821649488", name: "İskenderun" },
  { id: "tr:adm2:54988432b28913521474336", name: "Erbaa" }
];

const PREFLIGHT_ROOT = ".territory/national-geometry-remediation/preflight-rc8-impl-rev1";

function adm2OutputSlug(adm2Id) {
  return adm2Id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function siblingOverlapErrorCount(zones) {
  return validateGeometryDataset(
    {
      manifest: {
        datasetId: "preflight",
        datasetVersion: LOCK.datasetVersion,
        schemaVersion: "territory-schema@1",
        sourceDate: LOCK.buildDate.slice(0, 10),
        geometryHash: "00"
      },
      zones: [...zones]
    },
    { checks: { siblingOverlaps: true, parentContainment: true } }
  ).issues.filter((issue) => issue.severity === "error").length;
}

function siblingOverlapErrors(zones) {
  return validateGeometryDataset(
    {
      manifest: {
        datasetId: "preflight",
        datasetVersion: LOCK.datasetVersion,
        schemaVersion: "territory-schema@1",
        sourceDate: LOCK.buildDate.slice(0, 10),
        geometryHash: "00"
      },
      zones: [...zones]
    },
    { checks: { siblingOverlaps: true, parentContainment: true } }
  ).issues.filter((issue) => issue.severity === "error");
}

async function gitHead() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"]);
    return stdout.trim();
  } catch {
    return null;
  }
}

if (!existsSync(LOCK.cliEntry)) {
  console.error(`Missing CLI build at ${LOCK.cliEntry}. Run pnpm build first.`);
  process.exitCode = 1;
  process.exit(1);
}

const sourceLock = JSON.parse(await fs.readFile(LOCK.osmSourceLockPath, "utf8"));
await fs.mkdir(PREFLIGHT_ROOT, { recursive: true });
const startedAt = performance.now();
const districts = [];

for (const spec of DISTRICTS) {
  const outputDir = join(PREFLIGHT_ROOT, adm2OutputSlug(spec.id));
  await fs.rm(outputDir, { recursive: true, force: true });
  const districtStarted = performance.now();
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      LOCK.cliEntry,
      "tr",
      "adm3",
      "hybrid",
      "build",
      "--district",
      LOCK.adm0Adm2Dataset,
      "--district-id",
      spec.id,
      "--osm-barriers",
      LOCK.barrierRoot,
      "--build-date",
      LOCK.buildDate,
      "--output",
      outputDir,
      "--force"
    ],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  const cliPayload = JSON.parse(stdout);
  const durationMs = performance.now() - districtStarted;
  const quality = JSON.parse(await fs.readFile(join(outputDir, "quality-report.json"), "utf8"));
  const dataset = JSON.parse(await fs.readFile(join(outputDir, "dataset.json"), "utf8"));
  const generatedZones = dataset.zones.filter((zone) => {
    const territory = zone.properties?.territory ?? {};
    return (
      territory.sourceKind === "generated" || territory.boundarySourceClass === "generated-zone"
    );
  });
  const overlapIssues = siblingOverlapErrors(dataset.zones);

  districts.push({
    adm2Id: spec.id,
    districtName: spec.name,
    outputDir,
    cliOk: cliPayload.ok === true,
    durationMs: Math.round(durationMs),
    adm3ZoneCount: dataset.zones.length,
    generatedZoneCount: generatedZones.length,
    qualityOk: quality.ok === true,
    gates: quality.gates,
    parentContainmentErrorCount: quality.summary.parentContainmentErrorCount,
    siblingOverlapErrors: overlapIssues.length,
    siblingOverlapIssueCodes: [...new Set(overlapIssues.map((issue) => issue.code))],
    geometryValidationErrors: siblingOverlapErrorCount(dataset.zones)
  });
}

const report = {
  schemaVersion: "territorykit-tr-national-preflight-three-district@1",
  generatedAt: new Date().toISOString(),
  gitCommit: await gitHead(),
  evidencePath: "territory tr adm3 hybrid build (CLI dist)",
  lock: {
    ...LOCK,
    sourceLockHash: sourceLock.contentHash ?? sourceLock.sha256 ?? null,
    sourceLockSchema: sourceLock.schemaVersion ?? null
  },
  districts,
  ok:
    districts.every((row) => row.cliOk) &&
    districts.every((row) => row.siblingOverlapErrors === 0) &&
    districts.every((row) => row.gates?.effectiveSiblingOverlap === true) &&
    districts.every((row) => row.parentContainmentErrorCount === 0) &&
    districts.every((row) => row.adm3ZoneCount > 0)
};

const outPath =
  "reports/tr-adm3/national-geometry-remediation/preflight-real-hybrid-rc8-impl-rev1.json";
await fs.mkdir("reports/tr-adm3/national-geometry-remediation", { recursive: true });
await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      ok: report.ok,
      outPath,
      durationMs: Math.round(performance.now() - startedAt),
      districts: districts.map((d) => ({
        id: d.adm2Id,
        adm3ZoneCount: d.adm3ZoneCount,
        siblingOverlapErrors: d.siblingOverlapErrors,
        qualityOk: d.qualityOk
      }))
    },
    null,
    2
  )
);

if (!report.ok) process.exitCode = 1;
