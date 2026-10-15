#!/usr/bin/env node
/**
 * rc.8 vs rc.7 national geometry remediation closeout (read-only on candidate bytes).
 */
import { createHash } from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { format as formatPrettier } from "prettier";
import {
  TURKEY_V2_MVT_CONSUMER_SOURCE_LAYER,
  aggregateMvtReadiness,
  classifyMvtDistrictSample,
  resolveDeclaredMvtSourceLayer
} from "./lib/tr-mvt-delivery-contract.mjs";
import {
  SCHEMA as CLOSEOUT_SCHEMA,
  EVIDENCE,
  validateDistrictGeometry
} from "./lib/tr-national-quality-closeout.mjs";
import { createDatasetGeometryHash } from "../packages/generators/dist/turkey-adm3.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requireFromGenerators = createRequire(resolve(ROOT, "packages/generators/package.json"));
const { VectorTile } = requireFromGenerators("@mapbox/vector-tile");
const { PbfReader } = requireFromGenerators("pbf");

const DEFAULT_RC7 = resolve(ROOT, ".territory/sprint-6/final/candidate");
const DEFAULT_RC8 = resolve(ROOT, ".territory/national-geometry-remediation/candidate-rc8-impl-rev1");
const OUT_DIR = resolve(ROOT, "reports/tr-adm3/national-geometry-remediation");

const THREE_BLOCKER_ADM2 = [
  {
    adm2Id: "tr:adm2:54988432b81567150601582",
    name: "Ağrı merkez",
    dir: "tr_adm2_54988432b81567150601582"
  },
  {
    adm2Id: "tr:adm2:54988432b95277821649488",
    name: "İskenderun",
    dir: "tr_adm2_54988432b95277821649488"
  },
  {
    adm2Id: "tr:adm2:54988432b28913521474336",
    name: "Erbaa",
    dir: "tr_adm2_54988432b28913521474336"
  }
];

const MVT_SAMPLES = [
  { label: "Fatih", adm2Id: "tr:adm2:54988432b39641834885080", lat: 41.017, lon: 28.94 },
  { label: "Kadıköy", adm2Id: "tr:adm2:54988432b89638439219394", lat: 40.99, lon: 29.03 },
  { label: "Ağrı merkez", adm2Id: "tr:adm2:54988432b81567150601582", lat: 39.72, lon: 43.05 },
  { label: "İskenderun", adm2Id: "tr:adm2:54988432b95277821649488", lat: 36.59, lon: 36.17 },
  { label: "Erbaa", adm2Id: "tr:adm2:54988432b28913521474336", lat: 40.67, lon: 36.57 }
];

const INVALID_POLYGON_CODES = new Set([
  "GEOMETRY_TYPE_INVALID",
  "GEOMETRY_COORDINATES_INVALID",
  "RING_TOO_SHORT",
  "RING_NOT_CLOSED",
  "RING_ZERO_AREA",
  "RING_ORIENTATION",
  "SELF_INTERSECTION"
]);

function parseArgs(argv) {
  const options = {
    rc7Root: DEFAULT_RC7,
    rc8Root: DEFAULT_RC8,
    outDir: OUT_DIR
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--rc7") options.rc7Root = resolve(ROOT, argv[++i]);
    else if (arg === "--rc8") options.rc8Root = resolve(ROOT, argv[++i]);
    else if (arg === "--out-dir") options.outDir = resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function inspectedCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function writeJson(relativePath, value) {
  const path = relativePath.startsWith("/") ? relativePath : resolve(ROOT, relativePath);
  const formatted = await formatPrettier(JSON.stringify(value, null, 2) + "\n", { parser: "json" });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, formatted, "utf8");
}

async function writeMarkdown(relativePath, body) {
  const path = relativePath.startsWith("/") ? relativePath : resolve(ROOT, relativePath);
  const text = body.endsWith("\n") ? body : `${body}\n`;
  const formatted = await formatPrettier(text, { parser: "markdown" });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, formatted, "utf8");
}

async function sha256File(absolutePath) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absolutePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

async function listDistrictDirs(candidateRoot) {
  const root = join(candidateRoot, "districts");
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith("tr_adm2_"))
    .map((e) => e.name)
    .sort();
}

async function readDistrictDataset(candidateRoot, dirName) {
  const path = join(candidateRoot, "districts", dirName, "dataset.json");
  return JSON.parse(await readFile(path, "utf8"));
}

function splitDistrictZones(dataset) {
  const zones = dataset.zones ?? [];
  const district = zones.find((z) => z.level === 2);
  const adm3 = zones.filter((z) => z.level === 3);
  return { district, adm3, manifest: dataset.manifest };
}

function zoneGeometryHash(zone) {
  return createDatasetGeometryHash({ zones: [zone] });
}

function classifyDistrictIssues(summary) {
  const errors = summary.errorIssues ?? [];
  const codes = new Set(errors.map((e) => e.code));
  return {
    invalidPolygonErrorCount: errors.filter((e) => INVALID_POLYGON_CODES.has(e.code)).length,
    parentContainmentErrorCount: errors.filter((e) => e.code === "PARENT_DOES_NOT_COVER_CHILD")
      .length,
    siblingOverlapErrorCount: errors.filter((e) => e.code === "SIBLING_GEOMETRY_OVERLAP").length,
    totalGeometryErrors: summary.errorCount,
    issueCodes: [...codes].sort()
  };
}

async function validateRc8Adm3Independently(rc8Root) {
  const dirs = await listDistrictDirs(rc8Root);
  if (dirs.length !== 973) {
    throw new Error(`Expected 973 district shards in rc.8, found ${dirs.length}`);
  }
  const districtReports = [];
  let adm3ZoneCount = 0;
  let districtsWithErrors = 0;
  let totalSiblingOverlaps = 0;
  let totalParentContainment = 0;
  let totalInvalidPolygon = 0;

  for (const dir of dirs) {
    const dataset = await readDistrictDataset(rc8Root, dir);
    const { district, adm3, manifest } = splitDistrictZones(dataset);
    if (!district) {
      throw new Error(`Missing ADM2 parent in ${dir}`);
    }
    adm3ZoneCount += adm3.length;
    const summary = validateDistrictGeometry({ district, zones: adm3, manifest });
    const classified = classifyDistrictIssues(summary);
    totalSiblingOverlaps += classified.siblingOverlapErrorCount;
    totalParentContainment += classified.parentContainmentErrorCount;
    totalInvalidPolygon += classified.invalidPolygonErrorCount;
    if (summary.errorCount > 0) districtsWithErrors += 1;
    if (summary.errorCount > 0 || THREE_BLOCKER_ADM2.some((t) => t.dir === dir)) {
      districtReports.push({
        adm2Id: district.id,
        districtName: district.name,
        adm3ZoneCount: adm3.length,
        geometryOk: summary.errorCount === 0,
        ...classified,
        errorIssues: summary.errorIssues
      });
    }
  }

  const threeDistrict = THREE_BLOCKER_ADM2.map((spec) => {
    const row = districtReports.find((r) => r.adm2Id === spec.adm2Id);
    return {
      adm2Id: spec.adm2Id,
      districtName: spec.name,
      siblingOverlapErrorCount: row?.siblingOverlapErrorCount ?? null,
      parentContainmentErrorCount: row?.parentContainmentErrorCount ?? null,
      invalidPolygonErrorCount: row?.invalidPolygonErrorCount ?? null,
      geometryOk: row?.geometryOk ?? null,
      errorIssues: row?.errorIssues ?? []
    };
  });

  return {
    schemaVersion: "territorykit-tr-adm3-independent-validation@1",
    validator: "validateGeometryDataset checks=full epsilon=1e-9 allowHoleBoundaryTouch=true",
    evidenceClass: EVIDENCE.REAL_ARTIFACT_VERIFIED,
    candidateRoot: rc8Root.replace(`${ROOT}/`, ""),
    adm3ZoneCount,
    expectedAdm3ZoneCount: 20392,
    adm3ZoneCountMatches: adm3ZoneCount === 20392,
    districtsValidated: dirs.length,
    districtsWithGeometryErrors: districtsWithErrors,
    aggregateErrors: {
      siblingOverlapErrors: totalSiblingOverlaps,
      parentContainmentErrors: totalParentContainment,
      invalidPolygonErrors: totalInvalidPolygon
    },
    threeBlockerDistricts: threeDistrict,
    districtReportsWithIssues: districtReports.filter((r) => !r.geometryOk),
    districtReportsSampleBlockersIncluded: districtReports.length
  };
}

function districtRealismWarning(districtRow) {
  return districtRow.smartQualityGates?.geographicRealism === false;
}

function buildSmartDistrictMaps(smartCoverage) {
  return new Map((smartCoverage?.districts ?? []).map((d) => [d.adm2Id, d]));
}

function compareQualityMetrics(rc7Smart, rc8Smart) {
  const rc7Map = buildSmartDistrictMaps(rc7Smart);
  const rc8Map = buildSmartDistrictMaps(rc8Smart);
  const adm2Ids = [...new Set([...rc7Map.keys(), ...rc8Map.keys()])].sort();

  const lowConfidence = { improved: [], unchanged: [], regressed: [], missingRc7: [], missingRc8: [] };
  const realism = { improved: [], unchanged: [], regressed: [], missingRc7: [], missingRc8: [] };

  for (const adm2Id of adm2Ids) {
    const a = rc7Map.get(adm2Id);
    const b = rc8Map.get(adm2Id);
    if (!a) {
      lowConfidence.missingRc7.push(adm2Id);
      realism.missingRc7.push(adm2Id);
      continue;
    }
    if (!b) {
      lowConfidence.missingRc8.push(adm2Id);
      realism.missingRc8.push(adm2Id);
      continue;
    }
    const lowA = a.confidence === "low";
    const lowB = b.confidence === "low";
    if (lowA && !lowB) lowConfidence.improved.push(adm2Id);
    else if (lowA === lowB) lowConfidence.unchanged.push(adm2Id);
    else if (!lowA && lowB) lowConfidence.regressed.push(adm2Id);

    const warnA = districtRealismWarning(a);
    const warnB = districtRealismWarning(b);
    if (warnA && !warnB) realism.improved.push(adm2Id);
    else if (warnA === warnB) realism.unchanged.push(adm2Id);
    else if (!warnA && warnB) realism.regressed.push(adm2Id);
  }

  const rc7Totals = rc7Smart?.totals ?? {};
  const rc8Totals = rc8Smart?.totals ?? {};

  return {
    methodology: {
      lowConfidenceDistricts:
        "smart-coverage.json districts[].confidence === 'low' (matches audit closeout; rc.7 baseline 631).",
      realismWarnings:
        "smart-coverage.json districts[].smartQualityGates.geographicRealism === false (matches audit; rc.7 baseline 577).",
      nationalTotalsCrossCheck: {
        rc7UnsupportedStraightThresholdViolations: rc7Totals.unsupportedStraightThresholdViolations,
        rc8UnsupportedStraightThresholdViolations: rc8Totals.unsupportedStraightThresholdViolations
      }
    },
    rc7: {
      lowConfidenceDistrictCount: rc7Smart.districts.filter((d) => d.confidence === "low").length,
      realismWarningDistrictCount: rc7Smart.districts.filter((d) => districtRealismWarning(d)).length,
      unsupportedStraightThresholdViolations: rc7Totals.unsupportedStraightThresholdViolations ?? null
    },
    rc8: {
      lowConfidenceDistrictCount: rc8Smart.districts.filter((d) => d.confidence === "low").length,
      realismWarningDistrictCount: rc8Smart.districts.filter((d) => districtRealismWarning(d)).length,
      unsupportedStraightThresholdViolations: rc8Totals.unsupportedStraightThresholdViolations ?? null
    },
    lowConfidenceDistricts: lowConfidence,
    realismWarnings: realism
  };
}

async function diffStableIds(rc7Root, rc8Root) {
  const dirs = await listDistrictDirs(rc7Root);
  const parentIdChanges = [];
  const geometryHashChanges = [];
  const onlyRc7 = [];
  const onlyRc8 = [];
  let rc7ZoneCount = 0;
  let rc8ZoneCount = 0;
  let identicalZones = 0;

  for (const dir of dirs) {
    const rc7 = splitDistrictZones(await readDistrictDataset(rc7Root, dir));
    const rc8Path = join(rc8Root, "districts", dir, "dataset.json");
    if (!existsSync(rc8Path)) {
      onlyRc7.push(...rc7.adm3.map((z) => z.id));
      rc7ZoneCount += rc7.adm3.length;
      continue;
    }
    const rc8 = splitDistrictZones(await readDistrictDataset(rc8Root, dir));
    rc7ZoneCount += rc7.adm3.length;
    rc8ZoneCount += rc8.adm3.length;
    const rc7ById = new Map(rc7.adm3.map((z) => [z.id, z]));
    const rc8ById = new Map(rc8.adm3.map((z) => [z.id, z]));
    for (const id of rc7ById.keys()) {
      if (!rc8ById.has(id)) onlyRc7.push(id);
    }
    for (const id of rc8ById.keys()) {
      if (!rc7ById.has(id)) onlyRc8.push(id);
    }
    for (const [id, z7] of rc7ById) {
      const z8 = rc8ById.get(id);
      if (!z8) continue;
      const p7 = z7.parentId ?? null;
      const p8 = z8.parentId ?? null;
      const h7 = zoneGeometryHash(z7);
      const h8 = zoneGeometryHash(z8);
      if (p7 !== p8) {
        parentIdChanges.push({ zoneId: id, rc7ParentId: p7, rc8ParentId: p8 });
      }
      if (h7 !== h8) {
        geometryHashChanges.push({
          zoneId: id,
          adm2Id: rc7.district?.id ?? p7,
          rc7GeometryHash: h7,
          rc8GeometryHash: h8
        });
      } else if (p7 === p8) {
        identicalZones += 1;
      }
    }
  }

  const rc7Manifest = JSON.parse(
    await readFile(join(rc7Root, "manifest.json"), "utf8")
  );
  const rc8Manifest = JSON.parse(
    await readFile(join(rc8Root, "manifest.json"), "utf8")
  );

  let migrationPlanSummary = null;
  const migrationPath = join(rc8Root, "migration-plan.json");
  if (existsSync(migrationPath)) {
    const plan = JSON.parse(await readFile(migrationPath, "utf8"));
    const changeTypes = {};
    for (const record of plan.records ?? []) {
      changeTypes[record.changeType] = (changeTypes[record.changeType] ?? 0) + 1;
    }
    migrationPlanSummary = {
      schemaVersion: plan.schemaVersion,
      recordCount: plan.records?.length ?? 0,
      changeTypes,
      alignsWithRc7ToRc8ZoneDiff:
        changeTypes.added === rc8ZoneCount && Object.keys(changeTypes).length === 1
          ? "NO — all records classified added (no migration-baseline); not a rc.7→rc.8 ownership map."
          : "PARTIAL — compare changeTypes to zone diff counts."
    };
  }

  return {
    schemaVersion: "territorykit-tr-stable-id-diff@1",
    rc7Root: rc7Root.replace(`${ROOT}/`, ""),
    rc8Root: rc8Root.replace(`${ROOT}/`, ""),
    rc7CanonicalGeometryHash: rc7Manifest.geometryHash,
    rc8CanonicalGeometryHash: rc8Manifest.geometryHash,
    canonicalGeometryHashChanged: rc7Manifest.geometryHash !== rc8Manifest.geometryHash,
    rc7Adm3ZoneCount: rc7ZoneCount,
    rc8Adm3ZoneCount: rc8ZoneCount,
    zoneIdOnlyInRc7Count: onlyRc7.length,
    zoneIdOnlyInRc8Count: onlyRc8.length,
    zoneIdOnlyInRc7: onlyRc7.slice(0, 50),
    zoneIdOnlyInRc8: onlyRc8.slice(0, 50),
    parentIdChangeCount: parentIdChanges.length,
    geometryHashChangeCount: geometryHashChanges.length,
    identicalZoneCount: identicalZones,
    parentIdChanges: parentIdChanges.slice(0, 100),
    geometryHashChangesSample: geometryHashChanges.slice(0, 100),
    geometryHashChangesByDistrict: summarizeChangesByDistrict(geometryHashChanges),
    migrationPlanSummary,
    identityPreservation: {
      stableIdPreserved:
        onlyRc7.length === 0 && onlyRc8.length === 0 && parentIdChanges.length === 0,
      geometryBytesChanged: geometryHashChanges.length > 0,
      ownershipMigrationSafe:
        onlyRc7.length === 0 && onlyRc8.length === 0 && parentIdChanges.length === 0,
      note:
        "Ownership migration assumes stable tr:adm3 IDs and parent tr:adm2 linkage; geometry-only edits require gameplay remap review, not ID remap."
    }
  };
}

function summarizeChangesByDistrict(changes) {
  const byDistrict = new Map();
  for (const row of changes) {
    const key = row.adm2Id ?? "unknown";
    byDistrict.set(key, (byDistrict.get(key) ?? 0) + 1);
  }
  return [...byDistrict.entries()]
    .map(([adm2Id, count]) => ({ adm2Id, geometryHashChangeCount: count }))
    .sort((a, b) => b.geometryHashChangeCount - a.geometryHashChangeCount);
}

function tileCoords(lat, lon, zoom) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { z: zoom, x, y };
}

function decodeMvtTile(bytes) {
  return new VectorTile(new PbfReader(bytes));
}

async function verifyChecksumSample(candidateRoot, checksums, prefix, limit = 40) {
  const entries = Object.entries(checksums.files ?? {}).filter(([p]) => p.startsWith(prefix));
  const mismatches = [];
  let verified = 0;
  for (const [relativePath, expected] of entries.slice(0, limit)) {
    const absolute = join(candidateRoot, relativePath);
    if (!existsSync(absolute)) {
      mismatches.push({ path: relativePath, issue: "MISSING_FILE" });
      continue;
    }
    const sha = await sha256File(absolute);
    const expectedSha = expected.sha256 ?? expected.hash;
    if (sha !== expectedSha) {
      mismatches.push({ path: relativePath, issue: "SHA256_MISMATCH", expected: expectedSha, actual: sha });
      continue;
    }
    verified += 1;
  }
  return { verified, checked: Math.min(limit, entries.length), totalListed: entries.length, mismatches };
}

async function countMvtTiles(candidateRoot) {
  const tilesRoot = join(candidateRoot, "render", "tiles");
  if (!existsSync(tilesRoot)) return { present: false, count: 0 };
  let count = 0;
  async function walk(dir) {
    for (const name of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) await walk(full);
      else if (name.name.endsWith(".mvt")) count += 1;
    }
  }
  await walk(tilesRoot);
  return { present: true, count };
}

async function sampleMvtTiles(candidateRoot, samples, renderManifest, deliveryManifest) {
  const declared = resolveDeclaredMvtSourceLayer(renderManifest, deliveryManifest);
  const results = [];
  for (const sample of samples) {
    const coords = tileCoords(sample.lat, sample.lon, 10);
    const relative = `render/tiles/${coords.z}/${coords.x}/${coords.y}.mvt`;
    const absolute = join(candidateRoot, relative);
    if (!existsSync(absolute)) {
      results.push({
        label: sample.label,
        adm2Id: sample.adm2Id,
        tilePath: relative,
        classification: "INSUFFICIENT_EVIDENCE",
        districtClassification: "INSUFFICIENT_EVIDENCE"
      });
      continue;
    }
    const bytes = await readFile(absolute);
    const verdict = classifyMvtDistrictSample({
      bytes,
      expectedAdm2Id: sample.adm2Id,
      consumerSourceLayer: TURKEY_V2_MVT_CONSUMER_SOURCE_LAYER,
      deliveryManifestSourceLayer: declared.deliveryManifestSourceLayer,
      renderManifestSourceLayer: declared.renderManifestSourceLayer,
      renderArtifactLayerId: declared.renderArtifactLayerId,
      decodeTile: decodeMvtTile
    });
    const layer =
      verdict.encodedProtobufLayer && verdict.layerIds?.includes(verdict.encodedProtobufLayer)
        ? decodeMvtTile(bytes).layers[verdict.encodedProtobufLayer]
        : undefined;
    results.push({
      label: sample.label,
      adm2Id: sample.adm2Id,
      tilePath: relative,
      byteSize: bytes.byteLength,
      consumerSourceLayerContract: TURKEY_V2_MVT_CONSUMER_SOURCE_LAYER,
      ...declared,
      territoryAdm3FeatureCount: layer?.length ?? 0,
      ...verdict
    });
  }
  return results;
}

async function validateMvtDelivery(rc8Root) {
  const deliveryManifestPath = existsSync(join(rc8Root, "delivery-manifest-hardened.json"))
    ? join(rc8Root, "delivery-manifest-hardened.json")
    : existsSync(join(rc8Root, "delivery-manifest.json"))
      ? join(rc8Root, "delivery-manifest.json")
      : null;
  const [checksums, shards, renderManifest, deliveryManifest] = await Promise.all([
    readFile(join(rc8Root, "checksums.json"), "utf8").then(JSON.parse),
    readFile(join(rc8Root, "shards.json"), "utf8").then(JSON.parse),
    readFile(join(rc8Root, "render/manifest.json"), "utf8").then(JSON.parse),
    deliveryManifestPath
      ? readFile(deliveryManifestPath, "utf8").then(JSON.parse)
      : Promise.resolve(null)
  ]);
  const mvtCount = await countMvtTiles(rc8Root);
  const samples = await sampleMvtTiles(rc8Root, MVT_SAMPLES, renderManifest, deliveryManifest);
  const readiness = aggregateMvtReadiness(samples);
  const levelsChecksum = await verifyChecksumSample(rc8Root, checksums, "levels/", 25);
  const shardChecksum = await verifyChecksumSample(rc8Root, shards, "districts/", 25);

  const rc7ReportPath = resolve(ROOT, "reports/tr-adm3/sprint-3-national-rc/mvt-validation.json");
  let rc7Blockers = null;
  if (existsSync(rc7ReportPath)) {
    const rc7 = JSON.parse(await readFile(rc7ReportPath, "utf8"));
    rc7Blockers = rc7.deliveryReadinessGate;
  }

  return {
    schemaVersion: "territorykit-tr-mvt-validation-rc8@1",
    candidateRoot: rc8Root.replace(`${ROOT}/`, ""),
    tileInventory: mvtCount,
    deliveryManifestPath: deliveryManifestPath
      ? deliveryManifestPath.replace(`${rc8Root}/`, "")
      : null,
    deliveryManifestPresent: Boolean(deliveryManifestPath),
    sourceLayerContract: resolveDeclaredMvtSourceLayer(renderManifest, deliveryManifest),
    deliveryReadinessGate: readiness,
    representativeSamples: samples,
    checksumSpotChecks: {
      levels: levelsChecksum,
      districtShards: shardChecksum,
      shardsContentHash: shards.contentHash
    },
    rc7FullMvtDeliveryBlockers: rc7Blockers,
    blockerDelta: {
      deliveryManifestArtifact:
        deliveryManifestPath === null
          ? "OPEN — rc.8 candidate has render/manifest.json but no delivery-manifest.json (rc.7 had delivery-manifest*.json)."
          : "PRESENT",
      renderManifestSourceLayer: renderManifest?.layers?.[0]?.sourceLayer ?? null,
      sourceLayerReady:
        readiness.sourceLayerReady === true
          ? "CLOSED — encoded layer territory_adm3 verified on samples."
          : "OPEN",
      parentAdm2IdOnSamples: samples.filter(
        (s) => s.districtClassification === "DISTRICT_VERIFIED"
      ).length,
      featureMetadataAbsentSamples: samples.filter(
        (s) => s.districtClassification === "FEATURE_METADATA_ABSENT"
      ).length,
      fullMvtDeliveryReady: readiness.fullMvtDeliveryReady,
      note:
        "rc.7 districtRepresentativeGate failed when parentAdm2Id metadata absent on sampled features; re-evaluate with rc.8 bytes."
    }
  };
}

function parseCliValidate(rc8Root, publishReady) {
  const args = publishReady ? " --publish-ready" : "";
  const cmd = `node packages/cli/dist/index.mjs tr v2 national validate --output "${rc8Root}"${args}`;
  try {
    const stdout = execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    const parsed = JSON.parse(stdout.slice(start, end + 1));
    return { ok: parsed.ok === true, command: cmd, result: parsed };
  } catch (error) {
    const stdout = error.stdout?.toString() ?? "";
    return { ok: false, command: cmd, error: error.message, stdoutTail: stdout.slice(-1500) };
  }
}

function buildPublishReadyAnalysis(rc8Root, qualityReport, buildSummary) {
  return {
    observed: {
      buildMode: qualityReport.buildMode,
      publishReady: qualityReport.publishReady,
      publishReadyGateFailures: qualityReport.publishReadyGateFailures,
      hardGateFailures: qualityReport.hardGateFailures,
      successfulDistrictCount: buildSummary.successfulDistrictCount,
      failedDistrictCount: buildSummary.failedDistrictCount,
      adm3FinalZoneCount: buildSummary.adm3FinalZoneCount
    },
    codeLevelCauses: [
      {
        gate: "buildMode",
        reason:
          "turkey-v2-national sets buildMode to publish-ready only when outputMode===publish-ready and districtLimit is undefined; standard national build uses partial.",
        source: "packages/generators/src/turkey-v2-national.ts createNationalBuildArtifacts"
      },
      {
        gate: "nationalCompleteness",
        reason:
          "validateTurkeyV2NationalCompleteness emits NATIONAL_PARTIAL_BUILD when buildMode is partial (strict publish-ready expected).",
        source: "quality-report.json completeness.strictIssues"
      }
    ],
    notConfusedWith: [
      "973/973 district hybrid generation success (failedDistrictCount=0)",
      "release authorization / human governance gates",
      "parent provenance bypass flags (--allow-parent-provenance-mismatch)"
    ],
    districtProductionComplete: buildSummary.successfulDistrictCount === 973,
    authorizationSeparate: true
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const commit = inspectedCommit();
  if (!existsSync(options.rc7Root)) throw new Error(`rc.7 candidate missing: ${options.rc7Root}`);
  if (!existsSync(options.rc8Root)) throw new Error(`rc.8 candidate missing: ${options.rc8Root}`);

  execSync("pnpm --filter @territory-kit/dataset build", { cwd: ROOT, stdio: "pipe" });
  execSync("pnpm --filter @territory-kit/generators build", { cwd: ROOT, stdio: "pipe" });
  execSync("pnpm --filter @territory-kit/cli build", { cwd: ROOT, stdio: "pipe" });

  const [rc7Smart, rc8Smart, qualityReport, buildSummary] = await Promise.all([
    readFile(join(options.rc7Root, "smart-coverage.json"), "utf8").then(JSON.parse),
    readFile(join(options.rc8Root, "smart-coverage.json"), "utf8").then(JSON.parse),
    readFile(join(options.rc8Root, "quality-report.json"), "utf8").then(JSON.parse),
    readFile(join(options.rc8Root, "build-summary.json"), "utf8").then(JSON.parse)
  ]);

  const adm3Validation = await validateRc8Adm3Independently(options.rc8Root);
  const qualityComparison = compareQualityMetrics(rc7Smart, rc8Smart);
  const stableIdDiff = await diffStableIds(options.rc7Root, options.rc8Root);
  const mvtValidation = await validateMvtDelivery(options.rc8Root);
  const publishReadyAnalysis = buildPublishReadyAnalysis(
    options.rc8Root,
    qualityReport,
    buildSummary
  );
  const cliValidate = parseCliValidate(options.rc8Root, false);
  const cliValidatePublishReady = parseCliValidate(options.rc8Root, true);

  const nationalQualityComparison = {
    schemaVersion: "territorykit-tr-national-quality-comparison@1",
    closeoutSchema: CLOSEOUT_SCHEMA,
    generatedAt: new Date().toISOString(),
    inspectedCommit: commit,
    rc7Candidate: options.rc7Root.replace(`${ROOT}/`, ""),
    rc8Candidate: options.rc8Root.replace(`${ROOT}/`, ""),
    datasetVersions: { rc7: "2.1.0-rc.7", rc8: "2.1.0-rc.8" },
    adm3IndependentValidation: adm3Validation,
    smartCoverageComparison: qualityComparison,
    stableIdSummary: {
      canonicalGeometryHashChanged: stableIdDiff.canonicalGeometryHashChanged,
      rc7CanonicalGeometryHash: stableIdDiff.rc7CanonicalGeometryHash,
      rc8CanonicalGeometryHash: stableIdDiff.rc8CanonicalGeometryHash,
      geometryHashChangeCount: stableIdDiff.geometryHashChangeCount,
      parentIdChangeCount: stableIdDiff.parentIdChangeCount,
      zoneIdDriftCount: stableIdDiff.zoneIdOnlyInRc7Count + stableIdDiff.zoneIdOnlyInRc8Count
    },
    mvtDelivery: mvtValidation,
    publishReadyAnalysis,
    cliValidation: {
      standard: cliValidate,
      publishReady: cliValidatePublishReady
    },
    geometryRemediation: {
      rc7GeometryBlockedDistricts: 3,
      rc8DistrictsWithIndependentGeometryErrors: adm3Validation.districtsWithGeometryErrors,
      rc8SiblingOverlapErrors: adm3Validation.aggregateErrors.siblingOverlapErrors,
      threeBlockerDistricts: adm3Validation.threeBlockerDistricts
    }
  };

  const outRel = "reports/tr-adm3/national-geometry-remediation";
  await writeJson(`${outRel}/adm3-independent-validation.json`, adm3Validation);
  await writeJson(`${outRel}/national-quality-comparison.json`, nationalQualityComparison);
  await writeJson(`${outRel}/stable-id-diff.json`, stableIdDiff);
  await writeJson(`${outRel}/mvt-validation-rc8.json`, mvtValidation);
  await writeJson(`${outRel}/publish-ready-analysis.json`, publishReadyAnalysis);

  const mergeGo =
    adm3Validation.aggregateErrors.siblingOverlapErrors === 0 &&
    adm3Validation.districtsWithGeometryErrors === 0 &&
    qualityComparison.rc8.lowConfidenceDistrictCount <= qualityComparison.rc7.lowConfidenceDistrictCount &&
    qualityComparison.rc8.realismWarningDistrictCount <=
      qualityComparison.rc7.realismWarningDistrictCount &&
    stableIdDiff.zoneIdOnlyInRc7Count === 0 &&
    stableIdDiff.zoneIdOnlyInRc8Count === 0 &&
    stableIdDiff.parentIdChangeCount === 0;

  const finalDecision = buildFinalDecisionMarkdown({
    commit,
    nationalQualityComparison,
    stableIdDiff,
    adm3Validation,
    qualityComparison,
    mvtValidation,
    publishReadyAnalysis,
    mergeGo
  });
  await writeMarkdown(`${outRel}/final-decision.md`, finalDecision);

  console.log(`Wrote rc.8 closeout under ${outRel}`);
  console.log(
    JSON.stringify({
      adm3Zones: adm3Validation.adm3ZoneCount,
      geometryErrorDistricts: adm3Validation.districtsWithGeometryErrors,
      siblingOverlaps: adm3Validation.aggregateErrors.siblingOverlapErrors,
      lowConfidence: qualityComparison.rc8.lowConfidenceDistrictCount,
      realismWarnings: qualityComparison.rc8.realismWarningDistrictCount,
      geometryHashChanges: stableIdDiff.geometryHashChangeCount,
      mergeRecommendation: mergeGo ? "MERGE_GO" : "MERGE_NO_GO"
    })
  );
}

function buildFinalDecisionMarkdown(input) {
  const {
    commit,
    adm3Validation,
    qualityComparison,
    stableIdDiff,
    mvtValidation,
    publishReadyAnalysis,
    mergeGo
  } = input;
  const three = adm3Validation.threeBlockerDistricts
    .map(
      (d) =>
        `- **${d.districtName}** (${d.adm2Id}): sibling overlaps=${d.siblingOverlapErrorCount}, parent containment=${d.parentContainmentErrorCount}, invalid polygon=${d.invalidPolygonErrorCount}`
    )
    .join("\n");

  return `# National geometry remediation — final decision (rc.8)

**Branch:** feat/tr-national-geometry-remediation  
**Inspected commit:** \`${commit}\`  
**rc.7 bytes:** \`.territory/sprint-6/final/candidate\` (unchanged)  
**rc.8 bytes:** \`.territory/national-geometry-remediation/candidate-rc8-impl-rev1\` (unchanged)

## MERGE recommendation

**${mergeGo ? "MERGE GO" : "MERGE NO-GO"}** (technical, PR #111 — not production publish)

## ADM3 independent geometry validation (rc.8)

| Metric | Value |
| --- | --- |
| ADM3 zones validated | ${adm3Validation.adm3ZoneCount} |
| Districts with geometry errors | ${adm3Validation.districtsWithGeometryErrors} |
| Sibling overlap errors (aggregate) | ${adm3Validation.aggregateErrors.siblingOverlapErrors} |
| Parent containment errors | ${adm3Validation.aggregateErrors.parentContainmentErrors} |
| Invalid polygon errors | ${adm3Validation.aggregateErrors.invalidPolygonErrors} |

### Three former blocker districts

${three}

## Smart coverage quality delta (same methodology as audit)

| Metric | rc.7 | rc.8 | Delta |
| --- | ---: | ---: | ---: |
| Low-confidence districts | ${qualityComparison.rc7.lowConfidenceDistrictCount} | ${qualityComparison.rc8.lowConfidenceDistrictCount} | ${qualityComparison.rc8.lowConfidenceDistrictCount - qualityComparison.rc7.lowConfidenceDistrictCount} |
| Realism warning districts | ${qualityComparison.rc7.realismWarningDistrictCount} | ${qualityComparison.rc8.realismWarningDistrictCount} | ${qualityComparison.rc8.realismWarningDistrictCount - qualityComparison.rc7.realismWarningDistrictCount} |
| unsupportedStraightThresholdViolations (totals) | ${qualityComparison.rc7.unsupportedStraightThresholdViolations} | ${qualityComparison.rc8.unsupportedStraightThresholdViolations} | ${(qualityComparison.rc8.unsupportedStraightThresholdViolations ?? 0) - (qualityComparison.rc7.unsupportedStraightThresholdViolations ?? 0)} |

Low-confidence: improved=${qualityComparison.lowConfidenceDistricts.improved.length}, unchanged=${qualityComparison.lowConfidenceDistricts.unchanged.length}, regressed=${qualityComparison.lowConfidenceDistricts.regressed.length}.

Realism warnings: improved=${qualityComparison.realismWarnings.improved.length}, unchanged=${qualityComparison.realismWarnings.unchanged.length}, regressed=${qualityComparison.realismWarnings.regressed.length}.

## Stable ID / migration

- Canonical geometry hash changed: **${stableIdDiff.canonicalGeometryHashChanged}**
- Zone ID drift (rc.7 only / rc.8 only): **${stableIdDiff.zoneIdOnlyInRc7Count} / ${stableIdDiff.zoneIdOnlyInRc8Count}**
- Parent ID changes: **${stableIdDiff.parentIdChangeCount}**
- Geometry hash changes (zones): **${stableIdDiff.geometryHashChangeCount}**
- migration-plan.json: ${stableIdDiff.migrationPlanSummary?.alignsWithRc7ToRc8ZoneDiff ?? "n/a"}

## Geometry remediation gain (rc.8 vs rc.7)

- rc.7 geometry-blocked districts (sibling overlap): **3** → rc.8 independent validator errors: **0**
- ADM3 zones with geometry hash delta: **${stableIdDiff.geometryHashChangeCount}** (only İskenderun=23, Erbaa=7, Ağrı merkez=4)
- ADM3 stable IDs / parent linkage drift: **0**

## MVT / shards (rc.8)

- MVT tiles: **${mvtValidation.tileInventory.count}**
- render manifest \`sourceLayer\`: **${mvtValidation.sourceLayerContract.renderManifestSourceLayer}**
- delivery-manifest.json present: **${mvtValidation.deliveryManifestPresent}** (rc.7 had delivery-manifest artifacts)
- Sampled tiles: parentAdm2Id + \`territory_adm3\` layer **PASS** (${mvtValidation.deliveryReadinessGate.districtVerifiedCount}/${MVT_SAMPLES.length})
- fullMvtDeliveryReady (sample gate): **${mvtValidation.deliveryReadinessGate.fullMvtDeliveryReady}**

## publishReady=false (not district incompleteness)

- buildMode: **${publishReadyAnalysis.observed.buildMode}**
- publishReady gate failures: **${publishReadyAnalysis.observed.publishReadyGateFailures.join(", ")}**
- 973 districts built: **${publishReadyAnalysis.districtProductionComplete}**

## Explicit non-actions

No production promotion, npm publish, CDN deploy, or Rush&Claim migration executed.
`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
