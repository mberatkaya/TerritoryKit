import fs from "node:fs/promises";
import path from "node:path";

const root =
  process.env.ISTANBUL_QA_ARTIFACT_ROOT ?? ".territory/sprint-6/final/istanbul-network-rc5";
const [standard, organic, network] = await Promise.all([
  fs.readFile(path.join(root, "fatih-standard-47.json"), "utf8").then(JSON.parse),
  fs.readFile(".territory/sprint-6/final/istanbul-qa/fatih-map.json", "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "fatih-map.json"), "utf8").then(JSON.parse)
]);
const reports = await Promise.all([
  fs.readFile("reports/baselines/sprint-6-istanbul-39-rc4.json", "utf8").then(JSON.parse),
  fs.readFile("reports/baselines/sprint-6-istanbul-39.json", "utf8").then(JSON.parse)
]);
const organicMetrics = reports[0].results.find((row) => row.district === "Fatih");
const networkMetrics = reports[1].results.find((row) => row.district === "Fatih");
const polygons = (geometry) =>
  geometry?.type === "Polygon"
    ? [geometry.coordinates]
    : geometry?.type === "MultiPolygon"
      ? geometry.coordinates
      : [];
const rings = (geometry) => polygons(geometry).flatMap((polygon) => polygon);
const lines = (geometry) =>
  geometry?.type === "LineString"
    ? [geometry.coordinates]
    : geometry?.type === "MultiLineString"
      ? geometry.coordinates
      : rings(geometry);
const points = rings(network.parent).flat();
const west = Math.min(...points.map((p) => p[0]));
const east = Math.max(...points.map((p) => p[0]));
const south = Math.min(...points.map((p) => p[1]));
const north = Math.max(...points.map((p) => p[1]));
const cos = Math.cos((((south + north) / 2) * Math.PI) / 180);
const scale = Math.min(490 / ((east - west) * cos), 490 / (north - south));
const xy = (point, offset) => [
  (point[0] - west) * cos * scale + offset + 25,
  (north - point[1]) * scale + 90
];
const pathFor = (ring, offset) =>
  ring
    .map((point, index) => {
      const [x, y] = xy(point, offset);
      return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
const drawGeometry = (geometries, offset, stroke, width, fill = "none", opacity = 1) =>
  geometries
    .flatMap((geometry) =>
      rings(geometry).map(
        (ring) =>
          `<path d="${pathFor(ring, offset)} Z" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`
      )
    )
    .join("");
const drawFeatures = (features, offset, stroke, width, opacity) =>
  (features ?? [])
    .flatMap((feature) =>
      lines(feature.geometry).map(
        (line) =>
          `<path d="${pathFor(line, offset)}" fill="none" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`
      )
    )
    .join("");
const panels = [
  { title: "Historical Standard", zones: standard.zones, metrics: standard.quality },
  {
    title: "rc.4 Organic",
    zones: organic.zones,
    metrics: {
      accepted: organicMetrics.qualityAccepted,
      following: organicMetrics.barrierFollowingInternalBoundaryRatio,
      synthetic: organicMetrics.syntheticBoundaryRatio,
      longest: organicMetrics.longestUnsupportedStraightChainMeters
    }
  },
  {
    title: "rc.5 Network First",
    zones: network.zones,
    metrics: {
      accepted: networkMetrics.qualityAccepted,
      following: networkMetrics.barrierFollowingInternalBoundaryRatio,
      synthetic: networkMetrics.syntheticBoundaryRatio,
      longest: networkMetrics.longestUnsupportedStraightChainMeters
    }
  }
];
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1710" height="660" viewBox="0 0 1710 660"><rect width="1710" height="660" fill="#f7f9f7"/><text x="20" y="28" font-family="sans-serif" font-size="20" font-weight="bold">Fatih — matched geographic candidate comparison</text>`;
for (const [index, panel] of panels.entries()) {
  const offset = index * 570;
  const metrics = panel.metrics;
  svg += `<rect x="${offset + 10}" y="40" width="550" height="575" fill="white" stroke="#bdc8c5"/><text x="${offset + 20}" y="60" font-family="sans-serif" font-size="14">${panel.title} · ${panel.zones.length} zones · ${metrics.accepted ? "machine accepted" : "machine rejected"}</text><text x="${offset + 20}" y="78" font-family="sans-serif" font-size="12">following ${(metrics.following * 100).toFixed(1)}% · synthetic ${(metrics.synthetic * 100).toFixed(1)}% · longest ${Math.round(metrics.longest)} m</text>`;
  svg += drawGeometry([network.parent], offset, "#1d3641", 2, "#e5f1e6");
  svg += drawFeatures(network.water?.features, offset, "#488fca", 1.2, 0.8);
  svg += drawFeatures(network.roads?.features, offset, "#b6732a", 0.7, 0.55);
  svg += drawFeatures(network.rail?.features, offset, "#7b5e94", 1.1, 0.75);
  svg += drawGeometry(panel.zones, offset, "#d43a34", 1.2, "none", 0.85);
  svg += drawGeometry([network.parent], offset, "#1d3641", 2);
}
svg += `<text x="20" y="641" font-family="sans-serif" font-size="12">Same parent, viewport and OSM overlay in all panels. Red estimated territory boundaries · amber roads · blue water · violet rail.</text></svg>`;
const output = path.join(root, "fatih-three-way.svg");
await fs.writeFile(output, svg);
console.log(output);
