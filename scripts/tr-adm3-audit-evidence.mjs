import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  computeTerritoryAreaM2,
  validateGeometryDataset
} from "../packages/dataset/dist/index.mjs";
import { parseTurkeyAdm3ProviderSource } from "../packages/generators/dist/index.mjs";
import {
  createDatasetGeometryHash,
  createTurkeyAdm3GeometryHash
} from "../packages/generators/dist/turkey-adm3.mjs";
import { inspectFile, metadata, parentId } from "./tr-adm3-quality-source-audit.mjs";

const root = process.argv[2] ?? ".territory/sprint-6/final/candidate";
const output = process.argv[3] ?? "reports/tr-adm3/audit";
await mkdir(output, { recursive: true });
const json = async (p) => JSON.parse(await readFile(p, "utf8"));
const hash = (v) => createHash("sha256").update(v).digest("hex");
const stable = (v) =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, stable(x)])
        )
      : v;
const checksum = await json(`${root}/checksums.json`);
const adm3 = await json(`${root}/levels/ADM3/dataset.json`);
const adm2 = await json(`${root}/levels/ADM2/dataset.json`);
const adm1 = await json(`${root}/levels/ADM1/dataset.json`);
const lock = await json(`${root}/source-lock.json`);
const smart = await json(`${root}/smart-coverage.json`);
const files = [];
for (const p of [
  "manifest.json",
  "source-lock.json",
  "levels/ADM0/dataset.json",
  "levels/ADM1/dataset.json",
  "levels/ADM2/dataset.json",
  "levels/ADM3/dataset.json",
  "render/manifest.json",
  "coverage.json",
  "smart-coverage.json",
  "quality-report.json",
  "delivery-manifest.json"
])
  files.push(await inspectFile(`${root}/${p}`, checksum.files[p]));
const { contentHash, ...lockBody } = lock;
const lockHashRecomputed = `sha256:${hash(JSON.stringify(stable(lockBody), null, 2) + "\n")}`;
const officialPath = ".territory/build/TR/ADM3/official/levels/ADM3/dataset.json";
const official = await json(officialPath);
const officialLockPath = ".territory/build/TR/ADM3/official/sources.lock.json";
const officialLock = await json(officialLockPath);
files.push(await inspectFile(officialPath), await inspectFile(officialLockPath));
const effective = adm3.zones.filter((z) => metadata(z).sourceClass === "official");
const byId = new Map(effective.map((z) => [z.id, z]));
const rawChanges = [],
  stableSerializedChanges = [],
  parentCorrections = [];
let areaChangesAboveOneM2 = 0;
for (const raw of official.zones) {
  const final = byId.get(raw.id);
  if (!final) continue;
  if (JSON.stringify(raw.geometry) !== JSON.stringify(final.geometry)) rawChanges.push(raw.id);
  if (Math.abs(computeTerritoryAreaM2(raw.geometry) - computeTerritoryAreaM2(final.geometry)) > 1)
    areaChangesAboveOneM2++;
  if (createTurkeyAdm3GeometryHash(raw.geometry) !== createTurkeyAdm3GeometryHash(final.geometry))
    stableSerializedChanges.push(raw.id);
  const before = parentId(raw),
    after = parentId(final);
  if (before !== after)
    parentCorrections.push({
      id: raw.id,
      name: raw.name,
      reportedParent: before,
      effectiveParent: after,
      rawAreaKm2: computeTerritoryAreaM2(raw.geometry) / 1e6,
      effectiveAreaKm2: computeTerritoryAreaM2(final.geometry) / 1e6,
      retainedShare: computeTerritoryAreaM2(final.geometry) / computeTerritoryAreaM2(raw.geometry)
    });
}
const sources = [];
for (const source of Object.values(officialLock.extensions.turkeyAdm3.provinces)) {
  const evidence = await inspectFile(source.sourcePath, {
    sha256: source.sha256,
    byteSize: source.sizeBytes
  });
  let parsed = null;
  if (evidence.status === "LOCKED_BYTES_VERIFIED")
    parsed = parseTurkeyAdm3ProviderSource(source, await readFile(source.sourcePath));
  const cohort = effective.filter((z) => metadata(z).provinceCode === source.provinceCode);
  const native = new Map();
  for (const z of cohort) {
    const id = metadata(z).sourceNativeId;
    native.set(id, (native.get(id) ?? 0) + 1);
  }
  sources.push({
    provinceCode: source.provinceCode,
    providerId: source.providerId,
    expectedFeatureCount: source.sourceFeatureCount,
    evidence,
    sourceDate: source.sourceDate,
    retrievedAt: source.retrievedAt,
    sourceVersion: source.sourceVersion,
    crs: source.crs,
    license: source.license,
    licenseUrl: source.licenseUrl,
    redistributionStatus: source.redistributionStatus,
    parseReport: parsed?.report ?? null,
    parseIssues: parsed?.issues ?? null,
    importedCount: official.zones.filter(
      (z) =>
        metadata(z).adm3?.provinceCode === source.provinceCode ||
        metadata(z).provinceCode === source.provinceCode
    ).length,
    effectiveCount: cohort.length,
    duplicatedEffectiveNativeIds: [...native].filter(([, count]) => count > 1),
    missingEffectiveNativeIds: parsed
      ? parsed.features.filter((f) => !native.has(f.sourceId)).map((f) => f.sourceId)
      : null
  });
}
const fidelity = {
  rawImportedArtifactPath: officialPath,
  effectiveArtifactPath: `${root}/levels/ADM3/dataset.json`,
  caveat:
    "Imported raw geometry is an adapter-normalized snapshot, not an assurance of exact upstream coordinate serialization. Changes below compare parsed geometry; no legal boundary is overwritten.",
  rawImportedCount: official.zones.length,
  effectiveCount: effective.length,
  missingIds: official.zones.filter((z) => !byId.has(z.id)).map((z) => z.id),
  rawToEffectiveParsedGeometryChanges: rawChanges.length,
  stableSerializedGeometryChanges: stableSerializedChanges.length,
  rawChangedIdsHash: hash(JSON.stringify(rawChanges.sort())),
  parentClippedMetadataCount: effective.filter((z) => metadata(z).clippedByParent).length,
  positiveInternalRemovalMetadataCount: effective.filter((z) => metadata(z).removedAreaKm2 > 0)
    .length,
  areaChangesAboveOneM2,
  originalEffectiveMetadataHashChanges: effective.filter(
    (z) => metadata(z).originalGeometryHash !== metadata(z).effectiveGeometryHash
  ).length,
  parentCorrections,
  sources
};
await writeFile(
  `${output}/official-source-fidelity.json`,
  JSON.stringify(fidelity, null, 2) + "\n"
);
const names = [
  "Fatih",
  "Kadıköy",
  "Üsküdar",
  "Eyüpsultan",
  "Başakşehir",
  "Prince Islands",
  "Büyükçekmece",
  "Çatalca",
  "Silivri",
  "Şile"
];
const districts = [];
for (const district of adm2.zones.filter(
  (d) => metadata(d).provinceCode === "34" && names.includes(d.name)
)) {
  const zones = adm3.zones.filter((z) => parentId(z) === district.id);
  // Supply the canonical parent explicitly to the existing quality backend. No mutation of source bytes.
  const report = validateGeometryDataset(
    {
      manifest: adm3.manifest,
      zones: [district, ...zones.map((z) => ({ ...z, parentId: district.id }))]
    },
    { checks: "full", epsilon: 1e-9, allowHoleBoundaryTouch: true }
  );
  const duplicateGeometries = new Map();
  for (const z of zones) {
    const h = createTurkeyAdm3GeometryHash(z.geometry);
    duplicateGeometries.set(h, [...(duplicateGeometries.get(h) ?? []), z.id]);
  }
  districts.push({
    adm2Id: district.id,
    districtName: district.name,
    geometryHash: createDatasetGeometryHash({ zones }),
    sourceLockHash: contentHash,
    executedGeometryQuality: report,
    multiPolygonZones: zones.filter((z) => z.geometry.type === "MultiPolygon").length,
    duplicateExactGeometryIds: [...duplicateGeometries.values()].filter((ids) => ids.length > 1),
    recordedSmartQuality: smart.districts.find((d) => d.adm2Id === district.id),
    evidenceScope:
      "Geometry QA rerun; smart/network realism diagnostics are recorded, not regenerated; no mobile observation."
  });
}
await writeFile(
  `${output}/istanbul-district-diagnostics.json`,
  JSON.stringify(
    { thresholds: { epsilon: 1e-9, checks: "full", allowHoleBoundaryTouch: true }, districts },
    null,
    2
  ) + "\n"
);
const require = createRequire(new URL("../packages/generators/package.json", import.meta.url));
const { VectorTile } = await import(require.resolve("@mapbox/vector-tile"));
const { PbfReader } = await import(require.resolve("pbf"));
const tiles = [];
for (const base of [root, ".territory/rushclaim-adm3-visibility-20261008"]) {
  const manifest = await json(`${base}/render/manifest.json`);
  const tilePath = `${base}/render/tiles/12/2377/1535.mvt`;
  const evidence = await inspectFile(
    tilePath,
    base === root ? checksum.files["render/tiles/12/2377/1535.mvt"] : undefined
  );
  if (evidence.status === "ARTIFACT_NOT_AVAILABLE") {
    tiles.push({ evidence });
    continue;
  }
  const tile = new VectorTile(new PbfReader(await readFile(tilePath)));
  const layers = Object.entries(tile.layers).map(([name, layer]) => {
    const features = Array.from({ length: layer.length }, (_, i) => layer.feature(i));
    return {
      name,
      featureCount: layer.length,
      unknownCanonicalIds: features
        .filter((f) => !adm3.zones.some((z) => z.id === f.properties.territoryId))
        .map((f) => f.properties.territoryId ?? null),
      sampleProperties: features[0]?.properties,
      missingParentMetadataCount: features.filter((f) => !f.properties.parentAdm2Id).length,
      missingSourceVersionCount: features.filter((f) => !f.properties.sourceVersion).length
    };
  });
  tiles.push({
    evidence,
    manifestPath: `${base}/render/manifest.json`,
    advertisedLayers: manifest.layers,
    decodedLayers: layers,
    layerAgreement: layers.every((l) => manifest.layers.some((a) => a.id === l.name)),
    scope: "One Fatih tile sample; not an all-zoom/all-tile identity proof"
  });
}
const pbf = ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/turkey.osm.pbf";
const osmLock = await json(".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json");
files.push(await inspectFile(pbf, { sha256: osmLock.sha256, byteSize: osmLock.fileSizeBytes }));
const measuredLevels = {};
for (const level of ["ADM0", "ADM1", "ADM2", "ADM3"]) {
  const data =
    level === "ADM3"
      ? adm3
      : level === "ADM2"
        ? adm2
        : level === "ADM1"
          ? adm1
          : await json(`${root}/levels/${level}/dataset.json`);
  measuredLevels[level] = {
    count: data.zones.length,
    geometryHash: createDatasetGeometryHash(data),
    declaredGeometryHash: data.manifest.geometryHash
  };
}
const full = await json(`${root}/dataset.json`);
const fullGeometry = {
  count: full.zones.length,
  geometryHash: createDatasetGeometryHash(full),
  declaredGeometryHash: full.manifest.geometryHash
};
files.push(await inspectFile(`${root}/dataset.json`, checksum.files["dataset.json"]));
const delivery = await json(`${root}/delivery-manifest.json`);
const { contentHash: deliveryHash, ...deliveryBody } = delivery;
const canonicalById = new Map(adm3.zones.map((z) => [z.id, z]));
const renderManifest = await json(`${root}/render/manifest.json`);
const mvtInventory = {
  tileCount: 0,
  checksumMismatches: 0,
  decodeFailures: 0,
  layerMismatchTiles: 0,
  unknownIdentityFeatures: 0,
  geometryHashMismatchFeatures: 0,
  missingParentFeatures: 0,
  missingSourceVersionFeatures: 0,
  zooms: {},
  encodedLayers: {},
  firstFailures: []
};
for (const [p, pin] of Object.entries(checksum.files).filter(([p]) =>
  /^render\/tiles\/\d+\/\d+\/\d+\.mvt$/.test(p)
)) {
  mvtInventory.tileCount++;
  const zoom = p.split("/")[2];
  mvtInventory.zooms[zoom] = (mvtInventory.zooms[zoom] ?? 0) + 1;
  try {
    const bytes = await readFile(`${root}/${p}`);
    if (hash(bytes) !== pin.sha256 || bytes.length !== pin.byteSize)
      mvtInventory.checksumMismatches++;
    const tile = new VectorTile(new PbfReader(bytes));
    if (Object.keys(tile.layers).some((name) => !renderManifest.layers.some((l) => l.id === name)))
      mvtInventory.layerMismatchTiles++;
    for (const [name, layer] of Object.entries(tile.layers)) {
      mvtInventory.encodedLayers[name] = (mvtInventory.encodedLayers[name] ?? 0) + layer.length;
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        feature.loadGeometry();
        const properties = feature.properties;
        const zone = canonicalById.get(properties.territoryId);
        if (!zone) mvtInventory.unknownIdentityFeatures++;
        else if (properties.geometryHash !== metadata(zone).geometryHash)
          mvtInventory.geometryHashMismatchFeatures++;
        if (!properties.parentAdm2Id) mvtInventory.missingParentFeatures++;
        if (!properties.sourceVersion) mvtInventory.missingSourceVersionFeatures++;
      }
    }
  } catch (error) {
    mvtInventory.decodeFailures++;
    if (mvtInventory.firstFailures.length < 10)
      mvtInventory.firstFailures.push({ path: p, error: error.message });
  }
}
// Geometric equality is intentionally not asserted: MVT is clipped, quantized and simplified.
mvtInventory.scope =
  "All checksum-indexed national MVTs; canonical identity/hash metadata agreement, decoded geometry readability. Not exact coordinate equality or hosted/cache validation.";
const historicalIstanbul = ".territory/sprint-6/final/istanbul39-final-current.json";
files.push(await inspectFile(historicalIstanbul));
const historical = await json(historicalIstanbul);
const historicalSamples = historical.results.filter((r) => names.includes(r.district));
await writeFile(
  `${output}/istanbul-recorded-network-diagnostics.json`,
  JSON.stringify(
    {
      sourcePath: historicalIstanbul,
      scope:
        "Historical district replay, geometry hashes differ from assembled national children. Not a current mobile observation.",
      results: historicalSamples
    },
    null,
    2
  ) + "\n"
);
await writeFile(
  `${output}/district-quality-diagnostics.json`,
  JSON.stringify(
    {
      sourcePath: `${root}/smart-coverage.json`,
      sourceLockHash: contentHash,
      scope:
        "Recorded smart geometry QA; canonical hashes are measured separately in coverage matrix. No national regeneration.",
      thresholdSource:
        "packages/generators/src/turkey-smart-fallback.ts:passesTurkeySmartGeographicRealism",
      districts: smart.districts.map((d) => ({
        adm2Id: d.adm2Id,
        provinceCode: d.provinceCode,
        district: d.district,
        confidence: d.confidence,
        acceptanceStatus: d.smartAcceptanceStatus,
        hardGateFailures: d.smartHardGateFailures,
        qualityGates: d.qualityGates,
        syntheticBoundaryRatio: d.syntheticBoundaryRatio,
        unsupportedStraightRatio: d.longUnsupportedStraightBoundaryRatio,
        barrierFollowingRatio: d.barrierFollowingInternalBoundaryRatio,
        barrierArtifactChecksum: d.barrierArtifactChecksum,
        sourceLockHash: contentHash,
        reasonCodes: d.reasonCodes,
        syntheticConnectorEvidence: d.syntheticConnectorEvidence,
        evidenceStatus: "RECORDED_BUILD_DIAGNOSTICS"
      }))
    },
    null,
    2
  ) + "\n"
);
const evidence = {
  inspectedCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  scope: "Local rc.7 release candidate bytes, not production/mobile selection",
  files,
  levels: measuredLevels,
  fullGeometry,
  deliveryContentHash: deliveryHash,
  deliveryContentHashRecomputed: hash(JSON.stringify(deliveryBody)),
  deliveryContentHashMatchesCurrentBody: deliveryHash === hash(JSON.stringify(deliveryBody)),
  mvtInventory,
  sourceLockContentHash: contentHash,
  sourceLockContentHashRecomputed: lockHashRecomputed,
  sourceLockContentHashMatchesCurrentBody: contentHash === lockHashRecomputed,
  tiles,
  recordedNationalSmartTotals: smart.totals,
  measuredSmartRows: {
    districts: smart.districts.length,
    lowConfidence: smart.districts.filter((d) => d.confidence === "low").length,
    hardRejects: smart.districts.filter((d) => d.smartAcceptanceStatus === "HARD_REJECT").length,
    realismWarnings: smart.districts.filter((d) => d.smartQualityGates?.geographicRealism === false)
      .length
  },
  rebuildStatus:
    "NOT_EXECUTED; locked PBF bytes inspected, all barrier artifact checksums and national replay still require verification"
};
await writeFile(`${output}/artifact-evidence.json`, JSON.stringify(evidence, null, 2) + "\n");
console.log(
  JSON.stringify({
    levels: measuredLevels,
    rawChanges: rawChanges.length,
    parentCorrections: parentCorrections.length,
    tiles: tiles.map((t) => ({ path: t.evidence.path, agreement: t.layerAgreement }))
  })
);
