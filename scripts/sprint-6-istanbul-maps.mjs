import fs from "node:fs/promises";
import path from "node:path";
const root = ".territory/sprint-6/final/istanbul-qa";
const old = JSON.parse(
  await fs.readFile(".territory/sprint-6/calibration/candidate/levels/ADM3/dataset.json", "utf8")
);
const byParent = new Map();
for (const z of old.zones ?? []) {
  const parentId = z.parentId ?? z.properties?.territory?.parentId;
  if (!parentId) continue;
  const a = byParent.get(parentId) ?? [];
  a.push(z.geometry);
  byParent.set(parentId, a);
}
const files = (await fs.readdir(root)).filter((f) => f.endsWith("-map.json")).sort();
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]
  );
function polys(g) {
  return g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
}
function rings(g) {
  return polys(g).flatMap((p) => p);
}
function lines(g) {
  if (!g) return [];
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  if (g.type === "Polygon") return g.coordinates;
  if (g.type === "MultiPolygon") return g.coordinates.flatMap((p) => p);
  return [];
}
for (const file of files) {
  const m = JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
  const districtId = JSON.parse(
    await fs.readFile(path.join(root, file.replace("-map.json", ".json")), "utf8")
  ).districtId;
  const landusePath = path.join(
    ".territory/sprint-6/calibration/barriers/ADM2",
    districtId.replace(/[^a-zA-Z0-9_-]/g, "_"),
    "landuse.geojson"
  );
  const landuse = JSON.parse(await fs.readFile(landusePath, "utf8"));
  const majorRoads = {
    features: (m.roads?.features ?? []).filter((f) =>
      /^(motorway|trunk|primary|secondary)(|_link)$/.test(String(f.properties?.highway ?? ""))
    )
  };
  const secondaryRoads = {
    features: (m.roads?.features ?? []).filter(
      (f) =>
        !/^(motorway|trunk|primary|secondary)(|_link)$/.test(String(f.properties?.highway ?? ""))
    )
  };
  const [w, s, e, n] = (() => {
    const p = rings(m.parent).flat();
    return [
      Math.min(...p.map((x) => x[0])),
      Math.min(...p.map((x) => x[1])),
      Math.max(...p.map((x) => x[0])),
      Math.max(...p.map((x) => x[1]))
    ];
  })();
  const cos = Math.cos((((s + n) / 2) * Math.PI) / 180),
    dx = (e - w) * cos,
    dy = n - s,
    scale = Math.min(490 / dx, 490 / dy);
  const xy = (p, x) => [(p[0] - w) * cos * scale + x + 25, (n - p[1]) * scale + 65];
  const pathLine = (points, x) =>
    points
      .map((p, i) => {
        const [a, b] = xy(p, x);
        return `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`;
      })
      .join(" ");
  const drawGeo = (geoms, x, color, width, fill = "none", opacity = 1) =>
    geoms
      .flatMap((g) =>
        rings(g).map(
          (r) =>
            `<path d="${pathLine(r, x)} Z" fill="${fill}" stroke="${color}" stroke-width="${width}" opacity="${opacity}" fill-rule="evenodd"/>`
        )
      )
      .join("");
  const drawFc = (fc, x, color, width, opacity) =>
    fc?.features
      ?.flatMap((f) =>
        lines(f.geometry).map(
          (l) =>
            `<path d="${pathLine(l, x)}" fill="none" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`
        )
      )
      .join("") ?? "";
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1140" height="620" viewBox="0 0 1140 620"><rect width="1140" height="620" fill="#f7f9f7"/><text x="20" y="29" font-family="sans-serif" font-size="19" font-weight="bold">${esc(m.district)} — Istanbul Sprint 6 QA</text>`;
  for (const [x, title, zones] of [
    [0, "Before rc.2", byParent.get(districtId) ?? []],
    [570, "Current candidate", m.zones]
  ]) {
    svg += `<rect x="${x + 10}" y="40" width="550" height="545" fill="white" stroke="#bdc8c5"/><text x="${x + 20}" y="61" font-family="sans-serif" font-size="14">${title} · ${zones.length} generated zones</text>`;
    svg += drawGeo([m.parent], x, "#1d3641", 2, "#e5f1e6");
    svg +=
      drawFc(m.water, x, "#488fca", 1.2, 0.8) +
      drawFc(landuse, x, "#80a76e", 0.8, 0.25) +
      drawFc(m.parks, x, "#80a76e", 1, 0.6) +
      drawFc(secondaryRoads, x, "#cf984a", 0.5, 0.4) +
      drawFc(majorRoads, x, "#b6732a", 1.2, 0.75) +
      drawFc(m.rail, x, "#7b5e94", 1.1, 0.75);
    svg +=
      drawGeo(m.official, x, "#147a55", 1.5, "none", 0.9) +
      drawGeo(m.osm, x, "#3a7fbd", 1.5, "none", 0.9) +
      drawGeo(zones, x, "#d43a34", 1.2, "none", 0.8);
    svg += (m.seeds ?? [])
      .map((seed) => {
        const p = seed.coordinate ?? seed.coordinates;
        if (!p) return "";
        const [a, b] = xy(p, x);
        return `<circle cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="1.3" fill="#5f296e"/>`;
      })
      .join("");
    svg += drawGeo([m.parent], x, "#1d3641", 2);
  }
  svg +=
    '<text x="20" y="607" font-family="sans-serif" font-size="12">ADM2 dark · approved official green · OSM admin blue · estimated territory red · major roads dark amber · secondary roads light amber · landuse green · water blue · rail violet · locality dots purple</text></svg>';
  await fs.writeFile(path.join(root, file.replace("-map.json", ".svg")), svg);
}
const names = files.map((f) => f.replace("-map.json", ""));
await fs.writeFile(
  path.join(root, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Istanbul 39 QA</title><style>body{font:16px system-ui;background:#f5f7f6;color:#213}main{max-width:1160px;margin:auto}article{margin:30px 0;padding:12px;background:white}img{width:100%}</style><main><h1>Istanbul 39 district QA</h1><p>rc.2 before and current generated candidate, with real geographic context. Failed candidates may show accepted real sources only.</p>${names.map((n) => `<article><h2>${esc(n)}</h2><img src="${n}.svg"></article>`).join("")}</main>`
);
console.log(`Rendered ${files.length} maps`);
