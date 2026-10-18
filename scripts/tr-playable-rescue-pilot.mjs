#!/usr/bin/env node
/**
 * Sprint 1 playable rescue pilot metrics + MapLibre before/after previews.
 * Uses pinned national-blocker fixtures in CI; prefers local calibration when present.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { writeReportGeoJson, writeReportHtml, writeReportJson } from "./lib/write-report-json.mjs";

function resolveRegressionInputs(repoRoot, fixtureRoot) {
  const localBarrierRoot = path.join(repoRoot, ".territory/sprint-6/calibration/barriers");
  const localDatasetPath = path.join(repoRoot, "datasets/generated/countries/TR/dataset.json");
  const fixtureBarrierRoot = path.join(fixtureRoot, "barriers");
  const fixtureDatasetPath = path.join(fixtureRoot, "adm2-dataset.json");
  const barrierPath = existsSync(localBarrierRoot) ? localBarrierRoot : fixtureBarrierRoot;
  const datasetPath = existsSync(localDatasetPath) ? localDatasetPath : fixtureDatasetPath;
  const barrierPick = existsSync(localBarrierRoot) ? "local" : "fixture";
  const datasetPick = existsSync(localDatasetPath) ? "local" : "fixture";
  if (!existsSync(barrierPath) || !existsSync(datasetPath)) {
    return { status: "NOT_RUN_MISSING_REAL_ARTIFACT", barrierPath, datasetPath };
  }
  return { status: "ready", barrierPath, datasetPath, barrierPick, datasetPick };
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT =
  process.env.TR_PLAYABLE_RESCUE_OUTPUT ??
  path.join(REPO_ROOT, "reports/tr-adm3/playable-rescue-pilot");
const GENERATED_AT = process.env.TR_PLAYABLE_RESCUE_GENERATED_AT ?? new Date().toISOString();

const ISTANBUL_PILOTS = [
  { label: "Fatih", archetype: "dense-urban", id: "tr:adm2:54988432b39641834885080" },
  { label: "Adalar", archetype: "coastal-island", id: "tr:adm2:54988432b94516152709384" },
  { label: "Çatalca", archetype: "rural", id: "tr:adm2:54988432b71345383711908" },
  { label: "Eyüpsultan", archetype: "mixed-urban-rural", id: "tr:adm2:54988432b93840376788897" },
  { label: "Kadıköy", archetype: "dense-urban", id: "tr:adm2:54988432b89638439219394" },
  { label: "Üsküdar", archetype: "urban-coastal", id: "tr:adm2:54988432b79162079631621" }
];

const FIXTURE_PILOTS = [
  { label: "İskenderun", archetype: "coastal-urban", id: "tr:adm2:54988432b95277821649488" },
  { label: "Ağrı merkez", archetype: "rural", id: "tr:adm2:54988432b81567150601582" },
  { label: "Erbaa", archetype: "rural-town", id: "tr:adm2:54988432b28913521474336" }
];

async function loadGenerators() {
  return import(path.join(REPO_ROOT, "packages/generators/dist/turkey-adm3.mjs"));
}

function readProvinceCode(zone) {
  const idMatch = zone.parentId?.match(/tr:adm1:tr-(\d{2})/);
  return idMatch?.[1] ?? "00";
}

function readDistrictCode(zone) {
  const territory = zone.properties?.territory ?? {};
  const source =
    territory.codes?.source ?? territory.source?.sourceId ?? zone.id.replace(/^tr:adm2:/, "");
  return String(source).toLowerCase();
}

function metricOrNull(value) {
  return value === undefined ? null : value;
}

function classifyPartitionOutcome(result) {
  const zoneCount = result.effective.generated.length;
  if (result.issues.some((issue) => issue.code === "PLAYABLE_RESCUE_SINGLE_PARENT")) {
    return "emergency-single-parent-fallback";
  }
  if (zoneCount <= 0) {
    return "failed";
  }
  if (zoneCount === 1) {
    return "emergency-single-parent-fallback";
  }
  const rescueDecision = result.issues.find(
    (issue) => issue.code === "PLAYABLE_RESCUE_DECISION"
  )?.details;
  if (rescueDecision?.acceptedAsRescue) {
    return "low-confidence-playable-rescue";
  }
  if (result.issues.some((issue) => issue.code === "PLAYABLE_RESCUE_LOW_CONFIDENCE_ACCEPTED")) {
    return "low-confidence-playable-rescue";
  }
  return "neighborhood-partition";
}

function metricsFromHybrid(result) {
  const q = result.smartFallbackResult?.quality;
  const uncovered =
    result.coverage.uncoveredAreaKm2 ?? result.coverage.uncoveredInsideParentKm2 ?? null;
  return {
    playableZoneCount: result.effective.generated.length,
    uncoveredAreaKm2: metricOrNull(uncovered),
    oversizedUrbanCellShare: metricOrNull(q?.largestTerritoryAreaShare),
    roadBarrierAlignment: metricOrNull(q?.barrierFollowingInternalBoundaryRatio),
    longestUnsupportedStraightMeters: metricOrNull(q?.longestUnsupportedStraightChainMeters),
    invalidPolygonCount: q?.invalidGeometryCount ?? null,
    overlapAreaKm2: metricOrNull(q?.overlapAreaKm2),
    finalCoveragePercent: result.coverage.finalCoveragePercent,
    qualityOk: result.quality.ok,
    smartAcceptance: q?.acceptanceStatus ?? null,
    rescueMode:
      result.issues.find((issue) => issue.code === "PLAYABLE_RESCUE_DECISION")?.details
        ?.selectedMode ?? null,
    rescueStage:
      result.issues.find((issue) => issue.code === "PLAYABLE_RESCUE_DECISION")?.details
        ?.selectedStage ?? null,
    partitionOutcome: classifyPartitionOutcome(result),
    deterministicRebuildHash: result.smartFallbackResult?.deterministicHash ?? null
  };
}

function bboxFromZones(zones) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const zone of zones) {
    const [w, s, e, n] = zone.bbox;
    west = Math.min(west, w);
    south = Math.min(south, s);
    east = Math.max(east, e);
    north = Math.max(north, n);
  }
  return [west, south, east, north];
}

function buildMapPreviewHtml(input) {
  const [west, south, east, north] = input.bbox;
  const center = [(west + east) / 2, (south + north) / 2];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${input.title}</title>
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>
    html, body, #map { margin: 0; height: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = new maplibregl.Map({
      container: "map",
      style: "https://demotiles.maplibre.org/style.json",
      center: [${center[0]}, ${center[1]}],
      zoom: ${input.zoom}
    });
    map.fitBounds([[${west}, ${south}], [${east}, ${north}]], { padding: 40, maxZoom: ${input.zoom} });
    map.on("load", () => {
      map.addSource("zones", { type: "geojson", data: "${input.geojsonName}" });
      map.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: { "fill-color": "#2563eb", "fill-opacity": 0.35 }
      });
      map.addLayer({
        id: "zones-line",
        type: "line",
        source: "zones",
        paint: { "line-color": "#1e3a8a", "line-width": 1.2 }
      });
    });
  </script>
</body>
</html>`;
}

async function buildDistrict(input) {
  const {
    buildTurkeyV2HybridDistrict,
    createTurkeyOsmSmartFallbackGeneratedOptions,
    readTurkeyOsmAdm2BarrierArtifact
  } = await loadGenerators();
  const artifact = await readTurkeyOsmAdm2BarrierArtifact(input.barrierRoot, input.district.id);
  const generated = createTurkeyOsmSmartFallbackGeneratedOptions(artifact, {});
  const result = await buildTurkeyV2HybridDistrict({
    district: input.district,
    provinceCode: readProvinceCode(input.district),
    districtCode: readDistrictCode(input.district),
    officialZones: [],
    osmZones: [],
    generated,
    buildDate: GENERATED_AT
  });
  return result;
}

async function main() {
  const fixtureRoot = path.join(
    REPO_ROOT,
    "packages/generators/test/fixtures/national-blocker-districts"
  );
  const regression = resolveRegressionInputs(REPO_ROOT, fixtureRoot);
  const localDatasetPath = path.join(REPO_ROOT, "datasets/generated/countries/TR/dataset.json");
  const localBarrierRoot = path.join(REPO_ROOT, ".territory/sprint-6/calibration/barriers");
  const useIstanbul =
    regression.status === "ready" &&
    regression.datasetPick === "local" &&
    (await readFile(localDatasetPath).catch(() => null));
  const pilots = useIstanbul ? ISTANBUL_PILOTS : FIXTURE_PILOTS;
  if (regression.status !== "ready") {
    throw new Error("Missing barrier or ADM2 dataset inputs for playable rescue pilot.");
  }
  const datasetPath = useIstanbul ? localDatasetPath : regression.datasetPath;
  const barrierRoot = useIstanbul ? localBarrierRoot : regression.barrierPath;
  const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
  await mkdir(OUTPUT_ROOT, { recursive: true });
  await mkdir(path.join(OUTPUT_ROOT, "previews"), { recursive: true });

  const rows = [];
  for (const pilot of pilots) {
    const district = dataset.zones.find((zone) => zone.id === pilot.id);
    if (!district) {
      rows.push({
        ...pilot,
        status: "MISSING_DISTRICT_GEOMETRY",
        metrics: null
      });
      continue;
    }
    const result = await buildDistrict({ district, barrierRoot });
    const metrics = metricsFromHybrid(result);
    const rescueFailure = result.issues.find((issue) => issue.code === "PLAYABLE_RESCUE_FAILED");
    const geojson = {
      type: "FeatureCollection",
      features: result.effective.generated.map((zone) => ({
        type: "Feature",
        properties: { id: zone.id, name: zone.name },
        geometry: zone.geometry
      }))
    };
    const slug = pilot.label
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const geojsonName = `${slug}-after.geojson`;
    await writeReportGeoJson(path.join(OUTPUT_ROOT, "previews", geojsonName), geojson);
    const bbox = bboxFromZones(
      result.effective.generated.length ? result.effective.generated : [district]
    );
    await writeReportHtml(
      path.join(OUTPUT_ROOT, "previews", `${slug}-after.html`),
      buildMapPreviewHtml({
        title: `${pilot.label} playable rescue preview`,
        bbox,
        geojsonName,
        zoom:
          pilot.archetype === "rural" || pilot.archetype === "rural-town"
            ? 10
            : pilot.archetype === "mixed-urban-rural"
              ? 11
              : 12
      })
    );
    const partitionOutcome = metrics.partitionOutcome;
    rows.push({
      ...pilot,
      status:
        metrics.playableZoneCount > 0
          ? partitionOutcome === "emergency-single-parent-fallback"
            ? "EMERGENCY_SINGLE_PARENT"
            : "OK"
          : "ZERO_PLAYABLE",
      explicitFailureReason:
        rescueFailure?.details?.failureReason ??
        (metrics.playableZoneCount === 0 ? "ZERO_PLAYABLE_ZONES" : null),
      metrics
    });
  }

  const payload = {
    schemaVersion: "territorykit-tr-playable-rescue-pilot@1",
    generatedAt: GENERATED_AT,
    inputRoots: {
      datasetPath: path.relative(REPO_ROOT, datasetPath),
      barrierRoot: path.relative(REPO_ROOT, barrierRoot),
      pilotSet: useIstanbul ? "istanbul-local-calibration" : "national-blocker-fixtures"
    },
    pilots: rows
  };
  const jsonPath = path.join(OUTPUT_ROOT, "pilot-metrics.json");
  await writeReportJson(jsonPath, payload);
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  await writeFile(
    path.join(OUTPUT_ROOT, "pilot-metrics.sha256"),
    `${digest}  pilot-metrics.json\n`,
    "utf8"
  );
  console.log(`Wrote ${jsonPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
