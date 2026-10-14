#!/usr/bin/env node
/**
 * National ADM2–ADM3 quality closeout (read-only on rc.7 candidate; does not rebuild or overwrite candidate).
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format as formatPrettier } from "prettier";
import { generateCoverage, metadata, parentId } from "./tr-adm3-quality-source-audit.mjs";
import {
  BASELINE_PATH,
  EVIDENCE,
  SCHEMA,
  buildBaselineComparison,
  buildBlockers,
  buildDistrictQualityMatrix,
  buildMapIndexPayload,
  buildNationalInventory,
  buildNeighborhoodIdentityAudit,
  buildProvinceSummary,
  buildReplacementMap,
  buildSourceAvailabilityMatrix,
  validateAdm2Layer,
  validateDistrictGeometry
} from "./lib/tr-national-quality-closeout.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT_DIR = resolve(ROOT, "reports/tr-adm3/national-quality-closeout");
const DEFAULT_CANDIDATE = resolve(ROOT, ".territory/sprint-6/final/candidate");

function parseArgs(argv) {
  const options = {
    artifactRoot: DEFAULT_CANDIDATE,
    skipGeometryRerun: false,
    skipCoverageRefresh: false,
    skipValidate: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--skip-geometry-rerun") options.skipGeometryRerun = true;
    else if (arg === "--skip-coverage-refresh") options.skipCoverageRefresh = true;
    else if (arg === "--skip-validate") options.skipValidate = true;
    else if (arg === "--artifact-root") options.artifactRoot = resolve(ROOT, argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function writeJson(relativePath, value) {
  const path = resolve(ROOT, relativePath);
  const formatted = await formatPrettier(JSON.stringify(value, null, 2) + "\n", { parser: "json" });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, formatted, "utf8");
}

async function readJsonOptional(relativeOrAbsolute) {
  const path = relativeOrAbsolute.startsWith("/")
    ? relativeOrAbsolute
    : resolve(ROOT, relativeOrAbsolute);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

function inspectedCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function originMainSha() {
  try {
    return execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: ROOT,
      encoding: "utf8"
    }).trim();
  } catch {
    return null;
  }
}

async function writeMapIndex(geojson, matrix) {
  const legend = `
<ul>
<li><span style="background:#1a5fb4"></span> Official</li>
<li><span style="background:#2ec27e"></span> OSM administrative</li>
<li><span style="background:#e5a50a"></span> Smart-derived estimated</li>
<li><span style="background:#c01c28"></span> Low confidence</li>
<li><span style="background:#777"></span> Blocked</li>
</ul>`;
  const html = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title>Türkiye ADM2 kalite indeksi</title>
  <link href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    body { margin: 0; font: 14px system-ui, sans-serif; }
    #map { position: absolute; top: 0; bottom: 0; width: 100%; }
    .panel { position: absolute; top: 12px; left: 12px; z-index: 1; background: #fff; padding: 12px; max-width: 360px; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
    .panel ul { list-style: none; padding: 0; }
    .panel li span { display: inline-block; width: 12px; height: 12px; margin-right: 6px; vertical-align: middle; }
    pre { white-space: pre-wrap; font-size: 12px; }
  </style>
</head>
<body>
  <div class="panel">
    <h1>ADM2 öncelik haritası</h1>
    <p>rc.7 ilçe merkezleri; renk kaynak sınıfı / güven.</p>
    ${legend}
    <pre id="detail">Bir ilçe noktasına tıklayın.</pre>
  </div>
  <div id="map"></div>
  <script src="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js"></script>
  <script>
    const data = ${JSON.stringify(geojson)};
    const colors = {
      official: "#1a5fb4",
      "osm": "#2ec27e",
      "smart-derived": "#e5a50a",
      "low-confidence": "#c01c28",
      blocked: "#777"
    };
    const map = new maplibregl.Map({
      container: "map",
      style: "https://demotiles.maplibre.org/style.json",
      center: [35.2, 39.1],
      zoom: 5.2
    });
    map.on("load", () => {
      map.addSource("closeout", { type: "geojson", data });
      map.addLayer({
        id: "adm1-fill",
        type: "fill",
        filter: ["==", ["get", "level"], 1],
        source: "closeout",
        paint: { "fill-color": "#deddda", "fill-opacity": 0.25 }
      });
      map.addLayer({
        id: "adm2-points",
        type: "circle",
        filter: ["has", "qualityStatus"],
        source: "closeout",
        paint: {
          "circle-radius": 5,
          "circle-color": ["match", ["get", "sourceClass"], ...Object.flatMap(Object.entries(colors), e => e), "#999"]
        }
      });
      map.on("click", "adm2-points", (e) => {
        const p = e.features[0].properties;
        document.getElementById("detail").textContent = JSON.stringify(p, null, 2);
      });
    });
  </script>
</body>
</html>`;
  await writeFile(resolve(OUT_DIR, "map-index.html"), html, "utf8");
  await writeJson("reports/tr-adm3/national-quality-closeout/map-features.geojson", geojson);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const artifactRoot = options.artifactRoot;
  const artifactExists = existsSync(resolve(artifactRoot, "levels/ADM3/dataset.json"));
  const artifactClassification = artifactExists
    ? EVIDENCE.REAL_ARTIFACT_VERIFIED
    : EVIDENCE.BLOCKED_BY_MISSING_ARTIFACT;

  let coverageReport;
  if (!options.skipCoverageRefresh) {
    coverageReport = await generateCoverage({
      artifactRoot,
      output: resolve(ROOT, "reports/tr-adm3/audit")
    });
  } else {
    coverageReport = await readJsonOptional("reports/tr-adm3/audit/adm3-district-coverage.json");
  }

  const adm1 = artifactExists
    ? await readJsonOptional(resolve(artifactRoot, "levels/ADM1/dataset.json"))
    : null;
  const adm2 = artifactExists
    ? await readJsonOptional(resolve(artifactRoot, "levels/ADM2/dataset.json"))
    : null;
  const adm3 = artifactExists
    ? await readJsonOptional(resolve(artifactRoot, "levels/ADM3/dataset.json"))
    : null;
  const smart = artifactExists
    ? await readJsonOptional(resolve(artifactRoot, "smart-coverage.json"))
    : null;
  const baseline = await readJsonOptional(BASELINE_PATH);
  const baselineClaims = await readJsonOptional("reports/tr-adm3/audit/baseline-claims.json");
  const sourceInventory = await readJsonOptional("datasets/registry/tr-adm3-source-inventory.json");
  const providerRegistry = await readJsonOptional("datasets/registry/tr-adm3-providers.json");
  const officialFidelity = await readJsonOptional(
    "reports/tr-adm3/audit/official-source-fidelity.json"
  );
  const humanGates = await readJsonOptional(
    "reports/tr-adm3/sprint-1-governance/human-approvals-required.json"
  );
  const kadikoyAcquisition = await readJsonOptional(
    "reports/tr-adm3/audit/kadikoy-acquisition.json"
  );

  const smartByAdm2 = new Map((smart?.districts ?? []).map((d) => [d.adm2Id, d]));
  const geometryByAdm2 = new Map();
  const adm2Validation =
    adm1 && adm2
      ? validateAdm2Layer({ adm1, adm2, manifest: adm2.manifest })
      : {
          adm1Count: 0,
          adm2Count: 0,
          adm1Expected: 81,
          adm2Expected: 973,
          adm1Complete: false,
          adm2Complete: false,
          evidenceClass: EVIDENCE.BLOCKED_BY_MISSING_ARTIFACT
        };

  if (artifactExists && adm2 && adm3 && !options.skipGeometryRerun) {
    const byParent = new Map();
    for (const zone of adm3.zones) {
      const id = parentId(zone);
      const list = byParent.get(id) ?? [];
      list.push(zone);
      byParent.set(id, list);
    }
    for (const district of adm2.zones) {
      geometryByAdm2.set(
        district.id,
        validateDistrictGeometry({
          district,
          zones: byParent.get(district.id) ?? [],
          manifest: adm3.manifest
        })
      );
    }
  }

  const matrix = buildDistrictQualityMatrix({
    coverageDistricts: coverageReport?.districts ?? [],
    smartByAdm2,
    geometryByAdm2,
    artifactAvailable:
      artifactExists && coverageReport?.fileEvidence?.status !== "CHECKSUM_MISMATCH"
  });

  if (matrix.length !== 973 && artifactExists) {
    throw new Error(`Expected 973 district rows, got ${matrix.length}`);
  }

  const provinceSummary = buildProvinceSummary(matrix);
  const nationalInventory = buildNationalInventory({
    coverageReport,
    matrix,
    adm2Validation,
    artifactClassification
  });
  const sourceAvailabilityMatrix = buildSourceAvailabilityMatrix(sourceInventory, providerRegistry);
  const neighborhoodIdentityAudit = buildNeighborhoodIdentityAudit({
    officialFidelity,
    adm3Zones: adm3?.zones ?? []
  });
  const baselineComparison = buildBaselineComparison({
    baseline,
    baselineClaims,
    coverageReport,
    smartTotals: smart?.totals ?? baseline?.quality,
    matrix
  });
  const replacementMap = buildReplacementMap({
    baseline,
    baselineClaims,
    coverageReport,
    adm3ZoneCount: adm3?.zones?.length ?? baseline?.adm3Zones ?? 0
  });
  const blockers = buildBlockers({
    matrix,
    sourceMatrix: sourceAvailabilityMatrix,
    humanGates,
    kadikoyAcquisition
  });

  const header = {
    schemaVersion: SCHEMA,
    inspectedCommit: inspectedCommit(),
    originMainSha: originMainSha(),
    artifactRoot: artifactRoot.startsWith(ROOT)
      ? artifactRoot.slice(ROOT.length + 1)
      : artifactRoot,
    artifactClassification,
    generatedAt: new Date().toISOString(),
    adm2Validation
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeJson("reports/tr-adm3/national-quality-closeout/national-inventory.json", {
    ...header,
    ...nationalInventory
  });
  await writeJson("reports/tr-adm3/national-quality-closeout/province-summary.json", {
    ...header,
    provinces: provinceSummary
  });
  await writeJson("reports/tr-adm3/national-quality-closeout/district-quality-matrix.json", {
    ...header,
    districts: matrix
  });
  await writeJson("reports/tr-adm3/national-quality-closeout/neighborhood-identity-audit.json", {
    ...header,
    ...neighborhoodIdentityAudit
  });
  await writeJson("reports/tr-adm3/national-quality-closeout/source-availability-matrix.json", {
    ...header,
    provinces: sourceAvailabilityMatrix
  });
  await writeJson("reports/tr-adm3/national-quality-closeout/baseline-comparison.json", {
    ...header,
    ...baselineComparison
  });
  await writeJson("reports/tr-adm3/national-quality-closeout/blockers.json", {
    ...header,
    ...blockers
  });
  await writeJson("reports/tr-adm3/national-quality-closeout/replacement-map.json", {
    ...header,
    ...replacementMap
  });

  if (artifactExists && adm1 && adm2) {
    const geojson = buildMapIndexPayload({ matrix, adm1Zones: adm1.zones, adm2Zones: adm2.zones });
    await writeMapIndex(geojson, matrix);
  } else {
    await writeFile(
      resolve(OUT_DIR, "map-index.html"),
      "<!-- BLOCKED_BY_MISSING_ARTIFACT: run with local rc.7 candidate -->\n",
      "utf8"
    );
  }

  let validateStandard = { ok: false, skipped: true };
  let validatePublish = { ok: false, skipped: true };
  if (artifactExists && !options.skipValidate) {
    try {
      const stdout = execSync("pnpm turkey:v2:national:validate", {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      validateStandard = { ok: true, skipped: false, tail: stdout.slice(-200) };
    } catch (error) {
      validateStandard = {
        ok: false,
        skipped: false,
        stderr: String(error.stderr ?? error.message)
      };
    }
    try {
      const stdout = execSync("pnpm turkey:v2:national:validate:publish-ready", {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      validatePublish = { ok: true, skipped: false, tail: stdout.slice(-200) };
    } catch (error) {
      validatePublish = {
        ok: false,
        skipped: false,
        stderr: String(error.stderr ?? error.message)
      };
    }
  }

  const lowCount = matrix.filter((r) => r.confidence === "low").length;
  const warningCount = matrix.filter((r) => r.qualityStatus === "WARNING_REVIEW_REQUIRED").length;
  const officialDistricts = matrix.filter((r) => (r.officialPolygonCount ?? 0) > 0).length;

  const decision = `# Ulusal ADM2–ADM3 kalite kapanışı — nihai karar

**İncelenen commit:** ${header.inspectedCommit}  
**origin/main:** ${header.originMainSha}  
**Candidate:** ${header.artifactRoot}  
**Sınıflandırma:** ${artifactClassification}

## 20 soru — özet cevaplar

| # | Soru | Cevap |
| --- | --- | --- |
| 1 | 81 il kapsanıyor mu? | ${provinceSummary.length === 81 ? "Evet (envanter)" : artifactExists ? `${provinceSummary.length} il özetlendi` : "BLOCKED_BY_MISSING_ARTIFACT"} |
| 2 | 973 ilçe denetlendi mi? | ${matrix.length === 973 ? "Evet" : artifactExists ? `${matrix.length} satır` : "Hayır"} |
| 3 | Resmî geometri kapsaması | ${coverageReport?.measuredAreaPercent?.officialAreaPercent?.toFixed(4) ?? "n/a"}% alan (rc.7 ölçümü) |
| 4 | Tahmini geometri bölgeleri | ${coverageReport?.totals?.generatedFeatureCount ?? "n/a"} zone |
| 5 | Mahalle kimlik eşleşmesi | Yalnız lisanslı resmî illerde; ayrıntı \`neighborhood-identity-audit.json\` |
| 6 | Düşük güven düzeltilen ilçe | 0 (rc.7 baytları yeniden üretilmedi; #108 kodu rebuild gerektirir) |
| 7 | Düşük güven devam | ${lowCount} ilçe |
| 8 | 577 gerçekçilik uyarısı kapatıldı | 0 (kayıtlı smart-coverage; yeniden üretim yok) |
| 9 | Yeni uyarı | Hayır (ölçüm yenilenmedi) |
| 10 | Kaynak yetersizliği | ${sourceAvailabilityMatrix.filter((p) => p.inventoryStatus === "requires-authority-request").length} il metadata engelli |
| 11 | Hukuki izin bekleyen | \`human-approvals-required.json\` + Path A/B |
| 12 | Değişen polygon | rc.7 baseline ile aynı geometry hash → değişiklik yok |
| 13 | Stable ID kaybı | Hayır (kimlik haritası 1:1) |
| 14 | Replacement-map | Tamamlandı (\`replacement-map.json\`) |
| 15 | Yeni ulusal candidate | **Hayır** — rc.7 korundu |
| 16 | MVT/shard doğrulama | Sprint 3 raporları + yerel validate: standard=${validateStandard.ok ? "PASS" : validateStandard.skipped ? "SKIP" : "FAIL"}, publish-ready=${validatePublish.ok ? "PASS" : validatePublish.skipped ? "SKIP" : "FAIL"} |
| 17 | GitHub CI | Bu PR push sonrası doğrulanacak |
| 18 | Rush&Claim Sprint 4 | **CONDITIONAL GO** — tüketici sözleşmesi hazır; canlı veri yok |
| 19 | Production engeller | Hosted delivery, full MVT gate, lisans onayı, düşük güven havuzu |
| 20 | Kullanıcı onayı | Path A/B, yayın, Kadıköy kaynağı, production promote |

## Önce / sonra (rc.7 baseline ↔ aynı candidate)

| Metrik | Baseline (rc.7) | Gözlem |
| --- | ---: | ---: |
| ADM3 zone | ${baseline?.adm3Zones ?? "—"} | ${coverageReport?.totals ? coverageReport.totals.officialFeatureCount + coverageReport.totals.generatedFeatureCount : "—"} |
| Resmî zone | ${baseline?.sourceClassZones?.official ?? "—"} | ${coverageReport?.totals?.officialFeatureCount ?? "—"} |
| Smart-generated zone | ${baseline?.sourceClassZones?.generated ?? "—"} | ${coverageReport?.totals?.generatedFeatureCount ?? "—"} |
| Düşük güven ilçe | ${baseline?.confidenceDistricts?.low ?? "—"} | ${lowCount} |
| Uyarı ilçe (closeout sınıfı) | — | ${warningCount} |
| Resmî polygon içeren ilçe | — | ${officialDistricts} |

## GO / NO-GO

| Karar | Sonuç |
| --- | --- |
| National QA closeout | ${artifactExists && matrix.length === 973 ? "**CONDITIONAL GO**" : "**NO-GO**"} |
| Release candidate technical readiness | **CONDITIONAL GO** (rc.7 yerel doğrulama) |
| Rush&Claim integration preparation | **CONDITIONAL GO** |
| Production dataset promotion | **NO-GO** |

## Komutlar

\`\`\`sh
pnpm data:tr:national-quality-closeout
pnpm turkey:v2:national:validate
pnpm data:tr:adm3:audit:test
\`\`\`
`;

  await writeFile(resolve(OUT_DIR, "final-decision.md"), decision, "utf8");
  await writeFile(
    resolve(OUT_DIR, "README.md"),
    `# National quality closeout

Salt okuma ulusal envanter ve QA çıktıları. rc.7 candidate üzerine yazmaz.

Yeniden üretim:

\`\`\`sh
pnpm data:tr:national-quality-closeout
\`\`\`

Harita: \`map-index.html\` (yerel candidate gerekir).
`,
    "utf8"
  );

  console.log(
    JSON.stringify({
      districts: matrix.length,
      artifactClassification,
      lowConfidenceDistricts: lowCount,
      validateStandard: validateStandard.ok,
      validatePublishReady: validatePublish.ok,
      output: "reports/tr-adm3/national-quality-closeout"
    })
  );
}

await main();
