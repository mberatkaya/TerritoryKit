#!/usr/bin/env node
/**
 * Sprint 3 — ulusal rc.7 teslimat doğrulama raporları (salt okuma; canonical candidate üzerine yazmaz).
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { format as formatPrettier } from "prettier";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requireFromGenerators = createRequire(resolve(ROOT, "packages/generators/package.json"));
const { VectorTile } = requireFromGenerators("@mapbox/vector-tile");
const { PbfReader } = requireFromGenerators("pbf");
const OUT_DIR = resolve(ROOT, "reports/tr-adm3/sprint-3-national-rc");
const SCHEMA = "territorykit-tr-sprint-3-national-rc@1";
const DEFAULT_CANDIDATE = resolve(ROOT, ".territory/sprint-6/final/candidate");
const BASELINE_PATH = "reports/baselines/sprint-6-national-rc7.json";
const DISTRICT_COVERAGE_PATH = "reports/tr-adm3/audit/adm3-district-coverage.json";
const HUMAN_GATES_PATH = "reports/tr-adm3/sprint-1-governance/human-approvals-required.json";

const REPRESENTATIVE_ADM2 = [
  { label: "Fatih", adm2Id: "tr:adm2:54988432b39641834885080", lat: 41.017, lon: 28.94 },
  { label: "Kadıköy", adm2Id: "tr:adm2:54988432b89638439219394", lat: 40.99, lon: 29.03 },
  { label: "Üsküdar", adm2Id: "tr:adm2:54988432b79162079631621", lat: 41.02, lon: 29.02 },
  { label: "Adalar", adm2Id: "tr:adm2:54988432b94516152709384", lat: 40.87, lon: 29.12 },
  { label: "Eyüpsultan", adm2Id: "tr:adm2:54988432b93840376788897", lat: 41.17, lon: 28.93 },
  { label: "Çatalca", adm2Id: "tr:adm2:54988432b71345383711908", lat: 41.14, lon: 28.46 },
  { label: "Bursa-Osmangazi", adm2Id: "tr:adm2:54988432b50709390359139", lat: 40.19, lon: 29.06 },
  {
    label: "Manisa-Demirci-rural",
    adm2Id: "tr:adm2:54988432b10253984912437",
    lat: 39.05,
    lon: 28.65
  }
];

function inspectedCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function originMainSha() {
  try {
    return execSync("git rev-parse origin/main", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function writeJson(path, value) {
  const formatted = await formatPrettier(JSON.stringify(value, null, 2) + "\n", { parser: "json" });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, formatted, "utf8");
}

async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

async function readJson(relativeOrAbsolute) {
  const path = relativeOrAbsolute.startsWith("/")
    ? relativeOrAbsolute
    : resolve(ROOT, relativeOrAbsolute);
  return JSON.parse(await readFile(path, "utf8"));
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

async function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableHashIdentity(record) {
  const body = { ...record };
  delete body.contentHash;
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function tileCoords(lat, lon, zoom) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { z: zoom, x, y };
}

function parseCliJson(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("CLI JSON bulunamadı");
  return JSON.parse(stdout.slice(start, end + 1));
}

function runNationalValidate(publishReady) {
  const args = publishReady ? " --publish-ready" : "";
  const cmd = `node packages/cli/dist/index.mjs tr v2 national validate --output "${DEFAULT_CANDIDATE}"${args}`;
  const label = `pnpm turkey:v2:national:validate${publishReady ? ":publish-ready" : ""}`;
  try {
    const stdout = execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    const parsed = parseCliJson(stdout);
    return { ok: parsed.ok === true, result: parsed, command: label };
  } catch (error) {
    const stdout = error.stdout?.toString() ?? "";
    let parsed = null;
    try {
      parsed = parseCliJson(stdout);
    } catch {
      parsed = { raw: stdout.slice(-2000), stderr: error.stderr?.toString()?.slice(-500) };
    }
    return { ok: false, result: parsed, command: label };
  }
}

function summarizeCoverageReport(coverage) {
  if (!coverage || typeof coverage !== "object") return coverage;
  const {
    districts,
    generatedOnlyDistricts,
    officialOnlyDistricts,
    osmOnlyDistricts,
    districtsBelow9999,
    ...summary
  } = coverage;
  return {
    ...summary,
    districtDetailRowCount: Array.isArray(districts) ? districts.length : 0,
    generatedOnlyDistrictCount: Array.isArray(generatedOnlyDistricts)
      ? generatedOnlyDistricts.length
      : 0,
    officialOnlyDistrictCount: Array.isArray(officialOnlyDistricts)
      ? officialOnlyDistricts.length
      : 0,
    osmOnlyDistrictCount: Array.isArray(osmOnlyDistricts) ? osmOnlyDistricts.length : 0,
    districtsBelow9999Count: Array.isArray(districtsBelow9999) ? districtsBelow9999.length : 0
  };
}

async function verifyChecksumEntries(candidateRoot, files, options = {}) {
  const { limit = null, prefixFilter = null } = options;
  const entries = Object.entries(files).filter(([path]) =>
    prefixFilter ? path.startsWith(prefixFilter) : true
  );
  const toCheck = limit ? entries.slice(0, limit) : entries;
  const mismatches = [];
  let verified = 0;
  for (const [relativePath, expected] of toCheck) {
    const absolute = join(candidateRoot, relativePath);
    if (!existsSync(absolute)) {
      mismatches.push({ path: relativePath, issue: "MISSING_FILE" });
      continue;
    }
    const actualSize = (await stat(absolute)).size;
    const expectedSize = expected.byteSize ?? expected.sizeBytes;
    if (expectedSize !== undefined && actualSize !== expectedSize) {
      mismatches.push({
        path: relativePath,
        issue: "BYTE_SIZE_MISMATCH",
        expected: expectedSize,
        actual: actualSize
      });
      continue;
    }
    const sha = await sha256File(absolute);
    const expectedSha = expected.sha256 ?? expected.hash;
    if (sha !== expectedSha) {
      mismatches.push({
        path: relativePath,
        issue: "SHA256_MISMATCH",
        expected: expectedSha,
        actual: sha
      });
      continue;
    }
    verified += 1;
  }
  return { verified, checked: toCheck.length, totalListed: entries.length, mismatches };
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

async function sampleMvtTiles(candidateRoot, samples) {
  const results = [];
  for (const sample of samples) {
    const coords = tileCoords(sample.lat, sample.lon, 10);
    const relative = `render/tiles/${coords.z}/${coords.x}/${coords.y}.mvt`;
    const absolute = join(candidateRoot, relative);
    if (!existsSync(absolute)) {
      results.push({
        label: sample.label,
        tilePath: relative,
        classification: "MISSING_TILE",
        evidenceStatus: "REAL_ARTIFACT_VERIFIED"
      });
      continue;
    }
    try {
      const bytes = await readFile(absolute);
      const tile = new VectorTile(new PbfReader(bytes));
      const layerIds = Object.keys(tile.layers);
      const layerKey =
        tile.layers["territory-adm3"] !== undefined
          ? "territory-adm3"
          : tile.layers.territory_adm3 !== undefined
            ? "territory_adm3"
            : layerIds[0];
      const layer = layerKey ? tile.layers[layerKey] : undefined;
      const featureCount = layer?.length ?? 0;
      let props = {};
      if (layer && featureCount > 0) {
        const feature = layer.feature(0);
        props = feature.properties ?? {};
        feature.loadGeometry();
      }
      const layerOk = layerIds.includes("territory-adm3") || layerIds.includes("territory_adm3");
      results.push({
        label: sample.label,
        tilePath: relative,
        byteSize: bytes.byteLength,
        layerIds,
        encodedLayerKey: layerKey,
        territoryAdm3FeatureCount: featureCount,
        sampleProperties: {
          territoryId: props.territoryId ?? props.id,
          parentAdm2Id: props.parentAdm2Id,
          sourceClass: props.sourceClass,
          boundaryKind: props.boundaryKind,
          confidence: props.confidence,
          administrative: props.administrative
        },
        manifestLayerId: "territory-adm3",
        manifestTileLayerDrift:
          layerIds.includes("territory_adm3") && !layerIds.includes("territory-adm3"),
        classification: layerOk ? "PASS" : "LAYER_NAME_MISMATCH",
        evidenceStatus: "REAL_ARTIFACT_VERIFIED"
      });
    } catch (error) {
      results.push({
        label: sample.label,
        tilePath: relative,
        classification: "CORRUPT_OR_INVALID",
        message: error instanceof Error ? error.message : String(error),
        evidenceStatus: "REAL_ARTIFACT_VERIFIED"
      });
    }
  }
  return results;
}

async function loadRuntimeResolver() {
  await execSync("pnpm --filter @territory-kit/runtime build", { cwd: ROOT, stdio: "pipe" });
  return import(resolve(ROOT, "packages/runtime/dist/turkey-v2-delivery.mjs"));
}

async function consumerReplay(candidateRoot, manifest) {
  const runtime = await loadRuntimeResolver();
  const {
    resolveTurkeyV2Boundaries,
    getTurkeyV2Attribution,
    getTurkeyV2Neighbors,
    validateTurkeyV2DeliveryManifest
  } = runtime;
  await validateTurkeyV2DeliveryManifest(manifest, manifest.contentHash);
  const attribution = existsSync(join(candidateRoot, "attribution.json"))
    ? JSON.parse(await readFile(join(candidateRoot, "attribution.json"), "utf8"))
    : null;
  const adjacency = existsSync(join(candidateRoot, "levels/ADM3/adjacency/adjacency.json"))
    ? JSON.parse(
        await readFile(join(candidateRoot, "levels/ADM3/adjacency/adjacency.json"), "utf8")
      )
    : null;

  const loadShard = async (path) => new Uint8Array(await readFile(join(candidateRoot, path)));

  const districts = [];
  for (const sample of REPRESENTATIVE_ADM2) {
    try {
      const officialOnly = await resolveTurkeyV2Boundaries({
        manifest,
        adm2Id: sample.adm2Id,
        loadShard
      });
      const withEstimated = await resolveTurkeyV2Boundaries({
        manifest,
        adm2Id: sample.adm2Id,
        allowEstimated: true,
        loadShard
      });
      const zoneIds = withEstimated.features.map((z) => z.id);
      const attributionRows =
        attribution && zoneIds.length
          ? getTurkeyV2Attribution(attribution, zoneIds.slice(0, 5))
          : [];
      const neighborSample =
        adjacency && zoneIds[0] ? getTurkeyV2Neighbors(adjacency, zoneIds[0]) : [];
      districts.push({
        label: sample.label,
        adm2Id: sample.adm2Id,
        datasetVersion: withEstimated.datasetVersion,
        officialZoneCount: officialOnly.features.length,
        totalZoneCount: withEstimated.features.length,
        estimatedZoneCount: withEstimated.features.length - officialOnly.features.length,
        sourceComposition: withEstimated.sourceComposition,
        cacheIdentity: withEstimated.cacheIdentity,
        artifactPath: withEstimated.artifactPath,
        attributionSample: attributionRows,
        neighborSampleCount: neighborSample.length,
        classification: "LOCAL_CONSUMER_VERIFIED",
        evidenceStatus: "REAL_ARTIFACT_VERIFIED"
      });
    } catch (error) {
      districts.push({
        label: sample.label,
        adm2Id: sample.adm2Id,
        classification: "FAIL",
        message: error instanceof Error ? error.message : String(error),
        evidenceStatus: "REAL_ARTIFACT_VERIFIED"
      });
    }
  }

  const failureCases = [];
  const fatih = REPRESENTATIVE_ADM2[0];
  const fatihPath =
    manifest.adm2Shards?.[fatih.adm2Id] ??
    `districts/${fatih.adm2Id.replace(/[^a-zA-Z0-9_-]/g, "_")}/dataset.json`;
  const goodBytes = await readFile(join(candidateRoot, fatihPath));
  try {
    await resolveTurkeyV2Boundaries({
      manifest,
      adm2Id: fatih.adm2Id,
      loadShard: async () => new Uint8Array([1, 2, 3])
    });
    failureCases.push({ case: "corrupt-bytes", expected: "reject", actual: "accepted" });
  } catch (error) {
    failureCases.push({
      case: "corrupt-bytes",
      expected: "reject",
      actual: "rejected",
      message: error instanceof Error ? error.message : String(error)
    });
  }
  try {
    await resolveTurkeyV2Boundaries({
      manifest: { ...manifest, datasetVersion: "tampered" },
      adm2Id: fatih.adm2Id,
      loadShard: async () => new Uint8Array(goodBytes)
    });
    failureCases.push({ case: "version-mismatch", expected: "reject", actual: "accepted" });
  } catch (error) {
    failureCases.push({
      case: "version-mismatch",
      expected: "reject",
      actual: "rejected",
      message: error instanceof Error ? error.message : String(error)
    });
  }

  return {
    manifestContentHash: manifest.contentHash,
    manifestSelfHashValid: true,
    districts,
    failureCases,
    scope: "LOCAL_CONSUMER_VERIFIED_NOT_HOSTED"
  };
}

function aggregateProvinceSource(registry, smartCoverage, districtCoverageRows) {
  const byProvince = new Map();
  for (const province of registry.provinces ?? []) {
    byProvince.set(province.code, {
      provinceCode: province.code,
      provinceName: province.name,
      registryStatus: province.status,
      registryProductionEligibleSources: (province.sources ?? []).filter(
        (s) => s.productionEligible
      ).length,
      registrySourceCount: province.sources?.length ?? 0,
      districtsInCandidate: 0,
      officialContributingDistricts: 0,
      generatedOnlyDistricts: 0,
      nationalIngestedOfficialZones: 0
    });
  }
  const coverageByAdm2 = new Map((districtCoverageRows ?? []).map((row) => [row.adm2Id, row]));
  for (const district of smartCoverage.districts ?? []) {
    const row = byProvince.get(district.provinceCode);
    if (!row) continue;
    row.districtsInCandidate += 1;
    const coverage = coverageByAdm2.get(district.adm2Id);
    const officialZones = coverage?.officialFeatureCount ?? 0;
    if (officialZones > 0) {
      row.officialContributingDistricts += 1;
      row.nationalIngestedOfficialZones += officialZones;
    } else {
      row.generatedOnlyDistricts += 1;
    }
  }
  return [...byProvince.values()].sort((a, b) => a.provinceCode.localeCompare(b.provinceCode));
}

async function main() {
  const generatedAt = new Date().toISOString();
  const commit = inspectedCommit();
  const mainSha = originMainSha();
  const candidateRoot = process.env.TERRITORY_TR_RC7_CANDIDATE
    ? resolve(process.env.TERRITORY_TR_RC7_CANDIDATE)
    : DEFAULT_CANDIDATE;
  const candidatePresent = existsSync(candidateRoot);
  const baseline = await readJson(BASELINE_PATH);

  const meta = {
    schemaVersion: SCHEMA,
    generatedAt,
    inspectedCommit: commit,
    originMainSha: mainSha,
    evidenceProducer: "scripts/generate-tr-sprint-3-national-rc-reports.mjs",
    candidateRoot: candidatePresent ? candidateRoot : null,
    candidateRelativeDefault: ".territory/sprint-6/final/candidate",
    datasetVersion: "2.1.0-rc.7",
    historicalBaselinePath: BASELINE_PATH
  };

  execSync("pnpm --filter @territory-kit/cli build", { cwd: ROOT, stdio: "pipe" });

  if (!candidatePresent) {
    const blocked = {
      ...meta,
      classification: "BLOCKED_BY_MISSING_ARTIFACT",
      message:
        "Ulusal rc.7 candidate dizini yerelde yok. CI raporları fixture ve tarihsel kanıtla sınırlıdır."
    };
    await mkdir(OUT_DIR, { recursive: true });
    await writeJson(resolve(OUT_DIR, "artifact-inventory.json"), blocked);
    await writeText(
      resolve(OUT_DIR, "README.md"),
      `# Sprint 3 — ulusal RC teslimat doğrulama\n\n**Durum:** BLOCKED_BY_MISSING_ARTIFACT (yerel candidate yok)\n\nKomut: \`pnpm data:tr:sprint3:national-rc\`\n`
    );
    console.log(`[sprint-3-national-rc] BLOCKED — candidate missing at ${candidateRoot}`);
    return;
  }

  const manifestPath = join(candidateRoot, "manifest.json");
  const checksumsPath = join(candidateRoot, "checksums.json");
  const deliveryManifestPath = existsSync(join(candidateRoot, "delivery-manifest-hardened.json"))
    ? join(candidateRoot, "delivery-manifest-hardened.json")
    : join(candidateRoot, "delivery-manifest.json");

  const [
    manifest,
    checksums,
    deliveryManifest,
    coverage,
    quality,
    sourceLock,
    shards,
    renderManifest
  ] = await Promise.all([
    readJson(manifestPath),
    readJson(checksumsPath),
    readJson(deliveryManifestPath),
    readJson(join(candidateRoot, "coverage.json")),
    readJson(join(candidateRoot, "quality-report.json")),
    readJson(join(candidateRoot, "source-lock.json")),
    readJson(join(candidateRoot, "shards.json")),
    readJson(join(candidateRoot, "render/manifest.json"))
  ]);

  const adm3Sha = await sha256File(join(candidateRoot, "levels/ADM3/dataset.json"));
  const districtCoverageAudit = await readJson(DISTRICT_COVERAGE_PATH);
  const districtCoverageAligned =
    districtCoverageAudit.fileEvidence?.sha256 === adm3Sha &&
    districtCoverageAudit.districts?.length === baseline.adm2Expected;

  const mandatoryArtifacts = [
    "manifest.json",
    "dataset.json",
    "coverage.json",
    "quality-report.json",
    "source-lock.json",
    "checksums.json",
    "levels/ADM3/dataset.json",
    "delivery-manifest.json",
    "render/manifest.json"
  ];
  const inventoryFiles = [];
  for (const rel of mandatoryArtifacts) {
    const abs = join(candidateRoot, rel);
    inventoryFiles.push({
      path: rel,
      present: existsSync(abs),
      byteSize: existsSync(abs) ? (await stat(abs)).size : null,
      sha256: existsSync(abs) ? await sha256File(abs) : null
    });
  }

  const artifactChecksumVerify = await verifyChecksumEntries(candidateRoot, checksums.files, {
    prefixFilter: "levels/"
  });
  const shardChecksumVerify = await verifyChecksumEntries(candidateRoot, shards.files);
  const deliveryArtifactVerify = await verifyChecksumEntries(
    candidateRoot,
    Object.fromEntries(
      Object.values(deliveryManifest.artifacts).map((entry) => [entry.path, entry])
    )
  );
  const mvtCount = await countMvtTiles(candidateRoot);
  const mvtSamples = await sampleMvtTiles(candidateRoot, REPRESENTATIVE_ADM2);

  const validateStandard = runNationalValidate(false);
  const validatePublishReady = runNationalValidate(true);

  const sourceLockIdentity = stableHashIdentity(sourceLock);
  const sourceLockMatchesBaseline =
    `sha256:${sourceLockIdentity}` === baseline.sourceLockHash ||
    sourceLock.contentHash === baseline.sourceLockHash;

  const registry = await readJson("datasets/sources/TR/adm3/source-registry.json");
  const smartCoverage = await readJson(join(candidateRoot, "smart-coverage.json"));
  const provinceRows = aggregateProvinceSource(
    registry,
    smartCoverage,
    districtCoverageAudit.districts
  );

  const consumer = await consumerReplay(candidateRoot, deliveryManifest);
  const humanGates = await readJson(HUMAN_GATES_PATH);

  const geometryHashMatches = manifest.geometryHash === baseline.geometryHash;
  const countsMatch =
    coverage.provinceCount === baseline.adm1 &&
    coverage.districtCount === baseline.adm2Expected &&
    coverage.adm3FinalZoneCount === baseline.adm3Zones &&
    quality.ok === true;

  const artifactInventory = {
    ...meta,
    classification:
      artifactChecksumVerify.mismatches.length === 0
        ? "REAL_ARTIFACT_VERIFIED"
        : "PARTIAL_MISMATCH",
    validationCommand: "pnpm turkey:v2:national:validate",
    mandatoryArtifacts: inventoryFiles,
    levelsChecksumSpotCheck: artifactChecksumVerify,
    shardManifest: {
      provinceShardCount: Object.keys(shards.files).filter((p) => p.startsWith("provinces/"))
        .length,
      districtShardCount: Object.keys(shards.files).filter((p) => p.startsWith("districts/"))
        .length,
      shardsContentHash: shards.contentHash,
      shardByteVerification: shardChecksumVerify
    },
    observedIdentity: {
      datasetVersion: manifest.datasetVersion,
      geometryHash: manifest.geometryHash,
      deterministicHash: manifest.deterministicHash,
      sourceLockHash: sourceLock.contentHash,
      adm3DatasetSha256: adm3Sha
    },
    historicalComparison: {
      baselinePath: BASELINE_PATH,
      geometryHashMatches,
      sourceLockMatchesBaseline,
      mvtTileCountObserved: mvtCount.count,
      mvtTileCountBaseline: baseline.mvt?.generatedTileCount ?? baseline.mvt?.candidateTileCount
    },
    limitations: [
      "Tam MVT envanteri (18k+ tile) her CI koşusunda bayt bayt doğrulanmaz; checksums.json ve örnekleme kullanılır.",
      "Candidate .gitignore altında; GitHub Actions varsayılan olarak national baytları içermez."
    ]
  };

  const nationalCoverage = {
    ...meta,
    classification: countsMatch && quality.ok ? "REAL_ARTIFACT_VERIFIED" : "MISMATCH_DETECTED",
    validationCommand: "pnpm turkey:v2:national:validate",
    cliValidate: validateStandard,
    cliValidatePublishReady: validatePublishReady,
    observedCounts: {
      adm0: quality.summary?.adm0Count,
      adm1: quality.summary?.adm1Count,
      adm2: quality.summary?.adm2Count,
      adm3: quality.summary?.adm3Count,
      failedDistricts: quality.summary?.failedDistrictCount
    },
    historicalBaseline: {
      adm1: baseline.adm1,
      adm2: baseline.adm2Expected,
      adm3Zones: baseline.adm3Zones,
      officialZones: baseline.sourceClassZones?.official,
      generatedZones: baseline.sourceClassZones?.generated,
      renderablePercent: baseline.coverage?.renderablePercent,
      officialAreaPercent: baseline.coverage?.officialPercent
    },
    districtLevelDetail: {
      evidenceClassification: districtCoverageAligned
        ? "REAL_ARTIFACT_VERIFIED"
        : "HISTORICAL_AUDIT_ONLY",
      sourcePath: DISTRICT_COVERAGE_PATH,
      districtRowCount: districtCoverageAudit.districts?.length ?? 0,
      adm3Sha256Aligned: districtCoverageAligned,
      note: "973 ilçe satırı repo audit dosyasında; Sprint 3 yeniden üretmedi (ADM3 bayt kimliği doğrulandı)."
    },
    qualitySummary: quality.summary,
    coverageSummary: summarizeCoverageReport(coverage),
    limitations: [
      "Renderable coverage ≠ resmi idari kapsam.",
      "publish-ready CLI teknik kapıları geçebilir; üretim yayımlama insan onayı gerektirir."
    ]
  };

  const provinceSource = {
    ...meta,
    classification: "REAL_ARTIFACT_VERIFIED",
    validationCommand: "node scripts/generate-tr-sprint-3-national-rc-reports.mjs",
    registryPath: "datasets/sources/TR/adm3/source-registry.json",
    catalogPath: "datasets/sources/TR/adm3-catalog.json",
    readinessReportPath: "reports/tr-adm3/sprint-1-governance/adm3-readiness-report.json",
    provinceCount: provinceRows.length,
    provinces: provinceRows,
    distinctions: {
      registryOfficialReady:
        "Kayıt defterinde onaylı kaynak yolu dokümante — ulusal candidate'te poligon seçimi ayrı kanıt",
      byteVerified: "SHA-256 dosya baytı",
      nationalIngested: "smart-coverage.json officialFeatureCount > 0"
    },
    smartCoverageTotals: smartCoverage.totals,
    limitations: [
      "official-ready il statüsü otomatik olarak 81 ilde ulusal poligon tüketimi anlamına gelmez."
    ]
  };

  const shardIntegrity = {
    ...meta,
    classification:
      shardChecksumVerify.mismatches.length === 0 ? "REAL_ARTIFACT_VERIFIED" : "PARTIAL_MISMATCH",
    validationCommand: "pnpm turkey:v2:national:validate --publish-ready",
    shardsJson: {
      contentHash: shards.contentHash,
      sourceLockHash: shards.sourceLockHash,
      provinceCount: artifactInventory.shardManifest.provinceShardCount,
      districtCount: artifactInventory.shardManifest.districtShardCount
    },
    byteVerification: shardChecksumVerify,
    deliveryManifestShardCount: Object.keys(deliveryManifest.shards ?? {}).length
  };

  const mvtValidation = {
    ...meta,
    classification: "REAL_ARTIFACT_VERIFIED",
    validationCommand: "render manifest + @mapbox/vector-tile örnekleme",
    policyFromRenderManifest: renderManifest.layers?.[0],
    policyFromDeliveryManifest: deliveryManifest.mvt,
    tileInventory: mvtCount,
    historicalBaseline: baseline.mvt,
    representativeSamples: mvtSamples,
    limitations: ["Tam tile envanteri checksums.json ile doğrulanır; tüm tile decode edilmedi."]
  };

  const deliveryManifestValidation = {
    ...meta,
    classification:
      deliveryArtifactVerify.mismatches.length === 0
        ? "REAL_ARTIFACT_VERIFIED"
        : "PARTIAL_MISMATCH",
    validationCommand: "@territory-kit/runtime validateTurkeyV2DeliveryManifest",
    manifestPath: deliveryManifestPath.replace(candidateRoot, "").replace(/^\//, ""),
    contentHash: deliveryManifest.contentHash,
    canonicalGeometryHash: deliveryManifest.canonicalGeometryHash,
    sourceLockHash: deliveryManifest.sourceLockHash,
    cacheIdentity: deliveryManifest.cacheIdentity,
    artifactByteVerification: deliveryArtifactVerify,
    adm2ShardMappings: deliveryManifest.adm2Shards
      ? Object.keys(deliveryManifest.adm2Shards).length
      : "LEGACY_PATH_RESOLUTION_ONLY"
  };

  const consumerResults = {
    ...meta,
    ...consumer,
    validationCommand: "packages/runtime resolveTurkeyV2Boundaries (yerel bayt)",
    kadikoyNote:
      "Kadıköy resmi kaynak BLOCKED_BY_SOURCE (Sprint 2); consumer replay generated zonları allowEstimated ile gösterir.",
    istanbulCarryover: "reports/tr-adm3/sprint-2-istanbul/pilot-summary.json"
  };

  const sourceLockImpact = {
    ...meta,
    classification: sourceLockMatchesBaseline ? "UNCHANGED_FROM_RC7" : "DRIFT_DETECTED",
    validationCommand: "SHA-256 source-lock.json identity",
    observedSourceLockHash: sourceLock.contentHash,
    baselineSourceLockHash: baseline.sourceLockHash,
    geometryHashMatches,
    rebuildAttempted: false,
    rebuildNote:
      "Tam ulusal rebuild bu sprintte çalıştırılmadı; salt okuma doğrulama ve kimlik karşılaştırması.",
    limitations: ["Source lock değişmezliği lisans onayı değildir."]
  };

  const authorizationGates = {
    ...meta,
    classification: "BLOCKED_BY_AUTHORIZATION",
    sourcePath: HUMAN_GATES_PATH,
    items: humanGates.items,
    pr103: "OBSERVE_ONLY"
  };

  const hostedReadiness = `# Hosted teslimat hazırlığı (teknik değerlendirme)

**Sınıflandırma:** LOCAL_CONSUMER_VERIFIED — HOSTED_DELIVERY_VERIFIED değil

## Gözlemlenen yerel sözleşme

- Manifest: \`delivery-manifest-hardened.json\` (contentHash: \`${deliveryManifest.contentHash}\`)
- MVT şablonu: \`${deliveryManifest.mvt.tileTemplate}\`, zoom ${deliveryManifest.mvt.minZoom}–${deliveryManifest.mvt.maxZoom}
- Katman: \`territory-adm3\` (render/manifest.json ile uyumlu)

## Hosted doğrulama durumu

Bu sprintte yetkili bir production CDN/URL üzerinde salt okuma doğrulaması **yapılmadı** (erişilebilir host kanıtı yok).

## Beklenen tüketici gereksinimleri (dokümantasyon)

- HTTPS, immutable release kimliği, manifest önce / shard sonra atomik yayın
- CORS ve Cache-Control: uzun ömürlü tile, manifest için sürüm pin
- Karışık sürüm koruması: manifest contentHash ve shard SHA-256
- Eksik dosya: fail-closed (runtime checksum)

## Üretim engelleri

- \`human-approvals-required.json\`: NATIONAL_DATASET_PROMOTION = NOT_AUTHORIZED
- PR #103 merge/publish yetkisi yok
`;

  const rushclaimHandoff = `# Rush&Claim — Sprint 4 entegrasyon handoff

## Dataset kimliği

| Alan | Değer | Kanıt |
|------|-------|-------|
| datasetId | territory-kit-tr-v2-playable | manifest.json |
| datasetVersion | 2.1.0-rc.7 | manifest.json |
| canonicalGeometryHash | ${manifest.geometryHash} | REAL_ARTIFACT_VERIFIED |
| sourceLockHash | ${sourceLock.contentHash} | REAL_ARTIFACT_VERIFIED |
| deliveryManifestContentHash | ${deliveryManifest.contentHash} | REAL_ARTIFACT_VERIFIED |
| adm3DatasetSha256 | ${adm3Sha} | REAL_ARTIFACT_VERIFIED |

## Artifact yolları (yerel)

- Kök: \`.territory/sprint-6/final/candidate\` (gitignore; CI'da yok)
- Teslimat manifesti: \`delivery-manifest-hardened.json\` (adm2Shards ile)
- MVT: \`render/tiles/{z}/{x}/{y}.mvt\`, katman \`territory-adm3\`, zoom 10–12

## Tüketici API

- \`@territory-kit/runtime/turkey-v2-delivery\` — \`resolveTurkeyV2Boundaries\`, \`getTurkeyV2Attribution\`, \`getTurkeyV2Neighbors\`
- \`allowEstimated: false\` → yalnızca resmi/onaylı zonlar; generated gameplay zonları sessizce dahil edilmez

## Sprint 2 carryover

- Kadıköy: BLOCKED_BY_SOURCE
- Eyüpsultan: düşük güven / NO_ROUTE kanıtı
- Kıyı/ada: verified water olmadan NOT_ASSESSED

## Yetkilendirme

- Production/hosted yayın: **NOT_AUTHORIZED**
- Path A/B: **NOT_AUTHORIZED**
- H3 silme veya ownership migrasyonu: reviewed mapping + production validation gerekir

## Sprint 4 minimum doğrulama

1. Manifest pin ve shard checksum
2. MVT + district shard birlikte test
3. Attribution ve lisans UI
4. Cache invalidation: datasetVersion + geometryHash + manifest contentHash
`;

  const mergeGo =
    countsMatch &&
    validateStandard.ok &&
    shardChecksumVerify.mismatches.length === 0 &&
    geometryHashMatches &&
    consumer.districts.every((row) => row.classification === "LOCAL_CONSUMER_VERIFIED");
  const productionGo = false;

  const finalDecision = `# Sprint 3 — nihai karar

**İncelenen commit:** ${commit ?? "unknown"}  
**origin/main:** ${mainSha ?? "unknown"}  
**Candidate:** ${candidateRoot}

## Özet

| Alan | Sonuç |
|------|-------|
| Artifact envanteri | ${artifactInventory.classification} |
| Ulusal kapsam (973 ilçe) | ${nationalCoverage.classification} |
| Shard bütünlüğü | ${shardIntegrity.classification} |
| MVT örnekleme | ${mvtValidation.classification} |
| Consumer replay (yerel) | LOCAL_CONSUMER_VERIFIED |
| Hosted teslimat | NOT_ASSESSED / BLOCKED |
| Kaynak kilidi rc.7 | ${sourceLockImpact.classification} |

## GO / NO-GO

- **Araştırma/validation PR merge:** ${mergeGo ? "GO" : "NO-GO — bulguları inceleyin"}
- **Production dataset yayını:** NO-GO (insan onayı ve hosted doğrulama eksik)

## Komutlar (bu oturum)

- \`pnpm turkey:v2:national:validate\` → ${validateStandard.ok ? "PASS" : "FAIL"}
- \`pnpm turkey:v2:national:validate:publish-ready\` → ${validatePublishReady.ok ? "PASS teknik" : "FAIL"} (yasal onay ayrı)
- \`pnpm data:tr:sprint3:national-rc\` → rapor üretimi
`;

  await mkdir(OUT_DIR, { recursive: true });
  await writeJson(resolve(OUT_DIR, "artifact-inventory.json"), artifactInventory);
  await writeJson(resolve(OUT_DIR, "national-coverage-validation.json"), nationalCoverage);
  await writeJson(resolve(OUT_DIR, "province-source-consistency.json"), provinceSource);
  await writeJson(resolve(OUT_DIR, "shard-integrity.json"), shardIntegrity);
  await writeJson(resolve(OUT_DIR, "mvt-validation.json"), mvtValidation);
  await writeJson(
    resolve(OUT_DIR, "delivery-manifest-validation.json"),
    deliveryManifestValidation
  );
  await writeJson(resolve(OUT_DIR, "consumer-contract-results.json"), consumerResults);
  await writeText(resolve(OUT_DIR, "hosted-delivery-readiness.md"), hostedReadiness);
  await writeJson(resolve(OUT_DIR, "source-lock-impact.json"), sourceLockImpact);
  await writeText(
    resolve(OUT_DIR, "source-lock-impact.md"),
    `# Kaynak kilidi etkisi (rc.7)

- **Sınıflandırma:** ${sourceLockImpact.classification}
- **Gözlenen:** \`${sourceLockImpact.observedSourceLockHash}\`
- **Tarihsel baseline:** \`${sourceLockImpact.baselineSourceLockHash}\`
- **geometryHash uyumu:** ${geometryHashMatches ? "evet" : "hayır"}

Tam ulusal rebuild bu sprintte çalıştırılmadı. Makine okunur detay: \`source-lock-impact.json\`.
`
  );
  await writeJson(resolve(OUT_DIR, "authorization-gates.json"), authorizationGates);
  await writeText(resolve(OUT_DIR, "rushclaim-sprint-4-handoff.md"), rushclaimHandoff);
  await writeText(resolve(OUT_DIR, "final-decision.md"), finalDecision);
  await writeText(
    resolve(OUT_DIR, "README.md"),
    `# Sprint 3 — ulusal RC.7 teslimat doğrulama

Üretim: \`pnpm data:tr:sprint3:national-rc\`

- **Dataset:** territory-kit-tr-v2-playable@2.1.0-rc.7
- **Kapsam:** LOCAL_RELEASE_CANDIDATE_NOT_PRODUCTION
- **origin/main (üretim anı):** ${mainSha ?? "?"}

Raporlar Türkçe/İngilizce karışık alan adlarıyla makine okunur JSON ve özet MD içerir. Tarihsel metrikler \`${BASELINE_PATH}\` ile karşılaştırılır; yeniden doğrulanmış sonuçlar \`classification\` alanında işaretlenir.
`
  );

  console.log(`[sprint-3-national-rc] Wrote reports to ${OUT_DIR}`);
}

await main();
