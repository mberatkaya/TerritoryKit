#!/usr/bin/env node
/**
 * Sprint 3 playable-v3 representative district sample (hybrid national path, no legacy grid).
 * Map previews are written under .territory (gitignored); metrics-only JSON goes to reports/.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeReportGeoJson, writeReportHtml, writeReportJson } from "./lib/write-report-json.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PARENT = path.join(REPO_ROOT, "datasets/generated/countries/TR/dataset.json");
const BARRIER_ROOT = path.join(REPO_ROOT, ".territory/sprint-6/calibration/barriers");
const METRICS_OUT = path.join(REPO_ROOT, "reports/tr-adm3/sprint-3-national-playable-v3");
const PREVIEW_OUT = path.join(REPO_ROOT, ".territory/sprint-3/playable-v3/map-preview");

const SAMPLE_DISTRICTS = [
  {
    label: "Fatih",
    city: "Istanbul",
    archetype: "dense-urban",
    id: "tr:adm2:54988432b39641834885080"
  },
  {
    label: "Eyüpsultan",
    city: "Istanbul",
    archetype: "mixed-urban-rural",
    id: "tr:adm2:54988432b93840376788897"
  },
  {
    label: "Adalar",
    city: "Istanbul",
    archetype: "coastal-island",
    id: "tr:adm2:54988432b94516152709384"
  },
  {
    label: "Çankaya",
    city: "Ankara",
    archetype: "dense-urban",
    id: "tr:adm2:54988432b72030220276956"
  },
  {
    label: "Konak",
    city: "Izmir",
    archetype: "dense-urban",
    id: "tr:adm2:54988432b43742920895959"
  },
  {
    label: "Muratpaşa",
    city: "Antalya",
    archetype: "coastal-urban",
    id: "tr:adm2:54988432b17723605206621"
  },
  { label: "Çatalca", city: "Istanbul", archetype: "rural", id: "tr:adm2:54988432b71345383711908" },
  {
    label: "Ağrı merkez",
    city: "Eastern",
    archetype: "rural-mountain",
    id: "tr:adm2:54988432b81567150601582"
  },
  {
    label: "İskenderun",
    city: "Coastal",
    archetype: "coastal-urban",
    id: "tr:adm2:54988432b95277821649488"
  }
];

function resolveParentDataset() {
  if (existsSync(DEFAULT_PARENT)) return DEFAULT_PARENT;
  throw new Error("Missing ADM0–ADM2 parent dataset for Sprint 3 sample.");
}

async function loadGenerators() {
  return import(path.join(REPO_ROOT, "packages/generators/dist/turkey-adm3.mjs"));
}

function readProvinceCode(zone) {
  const territory = zone.properties?.territory ?? {};
  return String(territory.provinceCode ?? "00");
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
  const rescue = result.issues.find((issue) => issue.code === "PLAYABLE_RESCUE_DECISION");
  const rescueDetails = rescue?.details ?? {};
  const partitionOutcome = classifyPartitionOutcome(result);
  return {
    playableZoneCount: result.effective.generated.length,
    oversizedUrbanCellShare: metricOrNull(q?.largestTerritoryAreaShare),
    roadBarrierAlignment: metricOrNull(q?.barrierFollowingInternalBoundaryRatio),
    longestUnsupportedStraightMeters: metricOrNull(q?.longestUnsupportedStraightChainMeters),
    invalidPolygonCount: metricOrNull(q?.invalidGeometryCount),
    finalCoveragePercent: result.coverage.finalCoveragePercent ?? null,
    qualityOk: result.quality.ok,
    smartAcceptance: q?.acceptanceStatus ?? null,
    rescueMode: rescueDetails.selectedMode ?? null,
    rescueStage: rescueDetails.selectedStage ?? null,
    partitionOutcome,
    deterministicRebuildHash: result.deterministicHash ?? null
  };
}

function sampleDistrictStatus(metrics) {
  if (metrics.partitionOutcome === "failed" || metrics.playableZoneCount <= 0) {
    return "FAILED";
  }
  if (metrics.partitionOutcome === "emergency-single-parent-fallback") {
    return "EMERGENCY_SINGLE_PARENT";
  }
  if (metrics.partitionOutcome === "low-confidence-playable-rescue") {
    return "LOW_CONFIDENCE";
  }
  return "OK";
}

function bboxFromZones(zones) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const zone of zones) {
    const [w, s, e, n] = zone.bbox ?? [0, 0, 0, 0];
    minX = Math.min(minX, w);
    minY = Math.min(minY, s);
    maxX = Math.max(maxX, e);
    maxY = Math.max(maxY, n);
  }
  return [minX, minY, maxX, maxY];
}

function buildMapPreviewHtml({ title, bbox, geojsonName, zoom }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <link href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css" rel="stylesheet" />
  <script src="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js"></script>
  <style>html,body,#map{margin:0;height:100%;}</style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = new maplibregl.Map({
      container: "map",
      style: "https://demotiles.maplibre.org/style.json",
      center: [(${bbox[0]} + ${bbox[2]}) / 2, (${bbox[1]} + ${bbox[3]}) / 2],
      zoom: ${zoom}
    });
    map.on("load", () => {
      map.addSource("zones", { type: "geojson", data: "./${geojsonName}" });
      map.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: { "fill-color": "#2ec27e", "fill-opacity": 0.35 }
      });
      map.addLayer({
        id: "zones-line",
        type: "line",
        source: "zones",
        paint: { "line-color": "#1a5fb4", "line-width": 1.2 }
      });
      map.fitBounds([[${bbox[0]}, ${bbox[1]}], [${bbox[2]}, ${bbox[3]}]], { padding: 24 });
    });
  </script>
</body>
</html>`;
}

async function main() {
  if (!existsSync(BARRIER_ROOT)) {
    throw new Error(`Missing OSM barrier root: ${BARRIER_ROOT}`);
  }
  const parentPath = resolveParentDataset();
  const {
    buildTurkeyV2HybridDistrict,
    createTurkeyOsmSmartFallbackGeneratedOptions,
    readTurkeyOsmAdm2BarrierArtifact
  } = await loadGenerators();
  const dataset = JSON.parse(await readFile(parentPath, "utf8"));
  await mkdir(METRICS_OUT, { recursive: true });
  await mkdir(PREVIEW_OUT, { recursive: true });

  const generatedAt = new Date().toISOString();
  const rows = [];
  for (const spec of SAMPLE_DISTRICTS) {
    const district = dataset.zones.find((zone) => zone.id === spec.id);
    if (!district) {
      rows.push({ ...spec, status: "MISSING_DISTRICT", metrics: null });
      continue;
    }
    const artifact = await readTurkeyOsmAdm2BarrierArtifact(BARRIER_ROOT, spec.id);
    const generated = createTurkeyOsmSmartFallbackGeneratedOptions(artifact, {});
    const result = await buildTurkeyV2HybridDistrict({
      district,
      provinceCode: readProvinceCode(district),
      districtCode: readDistrictCode(district),
      officialZones: [],
      osmZones: [],
      generated,
      buildDate: generatedAt
    });
    const metrics = metricsFromHybrid(result);
    const slug = spec.label
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const geojsonName = `${slug}-playable-v3.geojson`;
    await writeReportGeoJson(path.join(PREVIEW_OUT, geojsonName), {
      type: "FeatureCollection",
      features: result.effective.generated.map((zone) => ({
        type: "Feature",
        properties: { id: zone.id, name: zone.name },
        geometry: zone.geometry
      }))
    });
    const bbox = bboxFromZones(
      result.effective.generated.length ? result.effective.generated : [district]
    );
    await writeReportHtml(
      path.join(PREVIEW_OUT, `${slug}-playable-v3.html`),
      buildMapPreviewHtml({
        title: `${spec.label} (${spec.city}) playable-v3 preview`,
        bbox,
        geojsonName,
        zoom: spec.archetype.includes("rural")
          ? 10
          : spec.archetype === "mixed-urban-rural"
            ? 11
            : 12
      })
    );
    rows.push({
      ...spec,
      status: sampleDistrictStatus(metrics),
      metrics
    });
  }

  const payload = {
    schemaVersion: "territorykit-tr-sprint-3-playable-v3-sample@1",
    generatedAt,
    parentDatasetPath: path.relative(REPO_ROOT, parentPath),
    barrierRoot: path.relative(REPO_ROOT, BARRIER_ROOT),
    mapPreviewRoot: path.relative(REPO_ROOT, PREVIEW_OUT),
    districts: rows
  };
  const jsonPath = path.join(METRICS_OUT, "sample-metrics.json");
  await writeReportJson(jsonPath, payload);
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  await writeFile(
    path.join(METRICS_OUT, "sample-metrics.sha256"),
    `${digest}  sample-metrics.json\n`
  );
  console.log(`Wrote ${jsonPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
