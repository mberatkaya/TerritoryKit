#!/usr/bin/env node
/**
 * Three-district real-data preflight via production CLI (`tr adm3 hybrid build`), aligned
 * with national OSM barrier options (maxTerritories + no legacy smart fallback).
 */
import { createHash } from "node:crypto";
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
  implementationRevision: "national-hybrid-sibling-gate-v2",
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

function isGeneratedGameplayZone(zone) {
  const territory = zone.properties?.territory ?? {};
  return (
    territory.semanticType === "generated-zone" ||
    territory.boundarySourceClass === "generated-zone" ||
    territory.boundarySourceClass === "smart-derived" ||
    territory.sourceKind === "generated"
  );
}

function validationManifest() {
  return {
    datasetId: "preflight",
    datasetVersion: LOCK.datasetVersion,
    schemaVersion: "territory-schema@1",
    sourceDate: LOCK.buildDate.slice(0, 10),
    geometryHash: "00"
  };
}

function geometryIssues(zones, checks) {
  return validateGeometryDataset(
    { manifest: validationManifest(), zones: [...zones] },
    { checks }
  ).issues.filter((issue) => issue.severity === "error");
}

function geometryHash(geometry) {
  return createHash("sha256").update(JSON.stringify(geometry)).digest("hex");
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
  const quality = JSON.parse(await fs.readFile(join(outputDir, "quality-report.json"), "utf8"));
  const dataset = JSON.parse(await fs.readFile(join(outputDir, "dataset.json"), "utf8"));
  const adm2ParentIncluded = dataset.zones.some((zone) => zone.level === 2);
  const adm3Zones = dataset.zones.filter((zone) => zone.level === 3);
  const generatedZones = adm3Zones.filter(isGeneratedGameplayZone);
  const siblingIssues = geometryIssues(adm3Zones, { siblingOverlaps: true });
  const parentIssues = geometryIssues(adm3Zones, { parentContainment: true });
  const invalidPolygonIssues = geometryIssues(adm3Zones, {
    coordinates: true,
    rings: true,
    selfIntersections: true,
    holes: true
  });
  const summary = JSON.parse(
    await fs.readFile(join(outputDir, "build-summary.json"), "utf8").catch(() => "{}")
  );

  districts.push({
    adm2Id: spec.id,
    districtName: spec.name,
    outputDir,
    cliOk: cliPayload.ok === true,
    durationMs: Math.round(performance.now() - districtStarted),
    adm2ParentInDataset: adm2ParentIncluded,
    adm3ZoneCount: adm3Zones.length,
    generatedZoneCount: generatedZones.length,
    generatedBoundaryClasses: [
      ...new Set(
        generatedZones
          .map((zone) => zone.properties?.territory?.boundarySourceClass)
          .filter(Boolean)
      )
    ],
    qualityOk: quality.ok === true,
    gates: quality.gates,
    parentContainmentErrorCount: quality.summary.parentContainmentErrorCount,
    siblingOverlapErrors: siblingIssues.length,
    siblingOverlapPairs: siblingIssues.map((issue) => ({
      zoneId: issue.zoneId,
      otherZoneId: issue.otherZoneId,
      message: issue.message
    })),
    parentContainmentErrors: parentIssues.length,
    invalidPolygonErrors: invalidPolygonIssues.length,
    deterministicHash: summary.deterministicHash ?? quality.deterministicHash,
    geometryHashes: generatedZones.map((zone) => ({
      id: zone.id,
      hash: geometryHash(zone.geometry)
    }))
  });
}

const report = {
  schemaVersion: "territorykit-tr-national-preflight-three-district@2",
  generatedAt: new Date().toISOString(),
  gitCommit: await gitHead(),
  evidencePath: "territory tr adm3 hybrid build (CLI dist, national-aligned OSM options)",
  lock: {
    ...LOCK,
    sourceLockHash: sourceLock.contentHash ?? sourceLock.sha256 ?? null,
    sourceLockSchema: sourceLock.schemaVersion ?? null
  },
  districts,
  ok:
    districts.every((row) => row.cliOk) &&
    districts.every((row) => row.siblingOverlapErrors === 0) &&
    districts.every((row) => row.parentContainmentErrors === 0) &&
    districts.every((row) => row.invalidPolygonErrors === 0) &&
    districts.every((row) => row.gates?.effectiveSiblingOverlap === true) &&
    districts.every((row) => row.qualityOk === true) &&
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
      implementationRevision: LOCK.implementationRevision,
      durationMs: Math.round(performance.now() - startedAt),
      districts: districts.map((d) => ({
        id: d.adm2Id,
        adm3: d.adm3ZoneCount,
        generated: d.generatedZoneCount,
        siblingOverlapErrors: d.siblingOverlapErrors
      }))
    },
    null,
    2
  )
);

if (!report.ok) process.exitCode = 1;
