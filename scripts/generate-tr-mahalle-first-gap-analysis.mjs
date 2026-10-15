#!/usr/bin/env node
/**
 * Mahalle-first ADM3 program — repo keşfi ve gap-analysis raporu.
 * Yalnızca mevcut kanıt dosyalarını ve source-registry'yi okur; ulusal rebuild yapmaz.
 */
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { format as formatPrettier } from "prettier";

const REPO_ROOT = process.cwd();
const REPORT_DIR = "reports/tr-adm3/mahalle-first-program";

const FOCUS_PROVINCES = ["16", "27", "34", "54", "58"];

const MODULE_MAP = [
  {
    requirement: "Source registry (81 il)",
    implementation: "datasets/sources/TR/adm3/source-registry.json",
    generator: "scripts/generate-tr-adm3-source-registry.mjs",
    gap: "4/81 productionEligible; 62 official-restricted; İstanbul license-blocked"
  },
  {
    requirement: "Official importer / adapters",
    implementation:
      "packages/generators/src/turkey-adm3-ingestion.ts, turkey-adm3-adapters.ts, adm3-catalog.json",
    gap: "Sakarya CRS/reprojection; Kadıköy bundle structurally invalid; Sivas download timeout"
  },
  {
    requirement: "OSM pipeline + barriers",
    implementation: "packages/generators/src/turkey-osm-barriers.ts, turkey-adm3-osm.ts",
    gap: "Eyüpsultan %24 network coverage; sparse barrier graphs in rural pilots"
  },
  {
    requirement: "smart-derived v1.7",
    implementation: "packages/generators/src/turkey-smart-fallback.ts",
    gap: "smart-derived-v2 yok; 631 low-confidence / 577 realism-warning districts (rc.8)"
  },
  {
    requirement: "Mahalle seed resolver",
    implementation:
      "turkey-osm-barriers locality-seeds.json + normalizeLocalitySeeds in smart-fallback",
    gap: "Seed coverage düşük; nameSource=generated-index yaygın; resmi mahalle uydurma yok (doğru)"
  },
  {
    requirement: "Barrier graph + organic routing",
    implementation: "turkey-network-faces.ts, turkey-network-bounded.ts, turkey-organic-routing.ts",
    gap: "Eyüpsultan ORGANIC_ROUTE_NO_PATH; parçalı graph bileşenleri"
  },
  {
    requirement: "Coastline / water QA",
    implementation: "turkey-istanbul-geometry-diagnostics.ts, inspectTurkeyGeneratedCoastlineSpill",
    gap: "Sprint-2 pilotlarda coastlineEvidence çoğunlukla NOT_ASSESSED"
  },
  {
    requirement: "Disconnected geometry QA",
    implementation: "turkey-generated-zone-pathology.ts, component-chunk in smart-fallback",
    gap: "crossWaterComponentSeparation çoğu pilotte NOT_ASSESSED"
  },
  {
    requirement: "Hybrid priority + clipping",
    implementation: "packages/generators/src/turkey-v2-hybrid.ts",
    gap: "PR #111 sibling overlap remediation; kalite skorları değişmedi"
  },
  {
    requirement: "National assembly + source-lock",
    implementation: "turkey-v2-national.ts, packages/cli tr v2 national",
    gap: "rc.8 publishReady=false (buildMode partial); rc.7 bytes korunmalı"
  },
  {
    requirement: "QA / MVT / migration",
    implementation: "packages/dataset quality, render-artifacts, @territory-kit/migration",
    gap: "rc.8 geometry hash delta 34 zone; migration-plan.json rc.7→rc.8 için authoritative değil"
  }
];

const SMART_DERIVED_V2_GAPS = [
  {
    id: "v2-algorithm-version",
    status: "missing",
    detail:
      "Kod yalnızca smart-derived-v1.7 kabul ediyor (SMART_FALLBACK_UNSUPPORTED_ALGORITHM aksi halde)."
  },
  {
    id: "seed-anchored-partition",
    status: "partial",
    detail:
      "v1.7 seed ataması var; mahalle seed yoğunluğu ile bölüm sayısı hizası zayıf (özellikle kırsal)."
  },
  {
    id: "coastline-assessment",
    status: "partial",
    detail: "Su poligonu yoksa fail-closed NOT_ASSESSED; v2 kıyı politikasını genişletmeli."
  },
  {
    id: "barrier-graph-fragmentation",
    status: "blocked-pilot",
    detail: "Eyüpsultan 368 graph bileşeni; v2 pilot önceliği."
  },
  {
    id: "official-vs-gameplay-separation",
    status: "done",
    detail: "administrative:false, boundarySourceClass smart-derived, dataset validation enforced."
  }
];

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(REPO_ROOT, relativePath), "utf8"));
}

async function readJsonIfExists(relativePath) {
  try {
    return await readJson(relativePath);
  } catch {
    return null;
  }
}

function resolveSha() {
  try {
    return execSync("git rev-parse origin/main", {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"]
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function extractProvince(registry, code) {
  const province = registry.provinces?.find((p) => p.code === code);
  if (!province) {
    return { code, status: "missing-from-registry" };
  }
  const official = (province.sources ?? []).filter(
    (s) => s.boundarySourceClass === "official-local"
  );
  return {
    code,
    name: province.name,
    status: province.status,
    productionEligible: province.sourceSummary?.productionEligible ?? false,
    officialSources: official.map((s) => ({
      id: s.id,
      productionEligible: s.productionEligible,
      licenseState: s.license?.state,
      licenseName: s.license?.name,
      sourceInventoryStatus: s.sourceInventoryStatus,
      geometryAvailable: s.access?.geometryAvailable,
      accessType: s.access?.type,
      lifecycle: s.lifecycle
    }))
  };
}

function catalogEntry(catalog, code) {
  const entry = catalog?.provinces?.[code];
  if (!entry) {
    return null;
  }
  return {
    providerId: entry.providerId,
    downloadUrl: entry.downloadUrl,
    license: entry.license,
    redistributionStatus: entry.redistributionStatus,
    expectedSha256: entry.expectedSha256,
    expectedFeatureCount: entry.expectedFeatureCount
  };
}

function classifyDataTier(source) {
  if (source.productionEligible === true && source.licenseState === "accepted") {
    return "approved-for-ingestion";
  }
  if (source.lifecycle === "verified" && source.geometryAvailable === true) {
    return "candidate-downloaded-or-verified-metadata";
  }
  if (source.accessType === "restricted" || source.sourceInventoryStatus === "license-blocked") {
    return "research-only";
  }
  return "registry-metadata-only";
}

async function main() {
  const originMainSha = resolveSha();
  const registry = await readJson("datasets/sources/TR/adm3/source-registry.json");
  const catalog = await readJsonIfExists("datasets/sources/TR/adm3-catalog.json");
  const humanApprovals = await readJson(
    "reports/tr-adm3/sprint-1-governance/human-approvals-required.json"
  );
  const pilotSummary = await readJsonIfExists(
    "reports/tr-adm3/sprint-2-istanbul/pilot-summary.json"
  );
  const rc8Decision = await readJsonIfExists(
    "reports/tr-adm3/national-geometry-remediation/final-decision.md"
  );
  const sprint3Decision = await readJsonIfExists(
    "reports/tr-adm3/sprint-3-national-rc/final-decision.md"
  );

  const governanceDelta = {
    schemaVersion: "territorykit-tr-mahalle-first-governance-delta@1",
    generatedAt: new Date().toISOString(),
    originMainSha,
    registrySummary: registry.summary,
    focusProvinces: FOCUS_PROVINCES.map((code) => {
      const province = extractProvince(registry, code);
      const catalogSidecar = catalogEntry(catalog, code);
      const tiers = (province.officialSources ?? []).map((s) => ({
        sourceId: s.id,
        dataTier: classifyDataTier(s),
        productionEligible: s.productionEligible
      }));
      return { ...province, catalogSidecar, sourceDataTiers: tiers };
    }),
    kadikoyAcquisition: pilotSummary?.kadikoyOfficialPilot ?? null,
    humanApprovals: humanApprovals.items,
    prohibitions: [
      "missing-institution-permission-never-marked-approved",
      "no-license-unknown-mahalle-in-public-artifacts",
      "no-overwrite-rc7-rc8-candidate-bytes-without-explicit-build"
    ]
  };

  const report = {
    schemaVersion: "territorykit-tr-mahalle-first-gap-analysis@1",
    generatedAt: new Date().toISOString(),
    originMainSha,
    pr111: {
      number: 111,
      state: "MERGED",
      note: "National ADM3 geometry remediation + rc.8 validation; doğrulama: gh pr view 111"
    },
    openPullRequests: {
      note: "Yalnızca dependabot + #103 Version Packages (observe only)",
      excludeAutoMerge: true
    },
    preservedArtifacts: {
      rc7: ".territory/sprint-6/final/candidate",
      rc8: ".territory/national-geometry-remediation/candidate-rc8-impl-rev1",
      policy: "READ_ONLY_BASELINE; yeni pilot çıktıları .territory/mahalle-first-pilot/ altında"
    },
    sprintProgramStatus: {
      sprint1Governance: "done (#107)",
      sprint2Istanbul: "done (#108) — 6 ilçe; Başakşehir/Esenyurt kapsam dışı",
      sprint3NationalRc: "done (#109)",
      sprint35QualityCloseout: "done (#110)",
      sprint36GeometryRemediation: "done (#111)",
      sprint4RushClaim: "planned — blocked on legal/hosted gates",
      mahalleFirstSmartDerivedV2: "not-started-in-main"
    },
    nationalMetrics: {
      source:
        "reports/tr-adm3/audit/current-state.md + national-geometry-remediation/final-decision.md",
      adm3ZoneCount: 20392,
      officialDistricts: "61 districts (Bursa, Gaziantep, Kayseri, Ordu)",
      estimatedAreaSharePercent: 95.002519987,
      officialAreaSharePercent: 4.997458769,
      lowConfidenceDistrictsRc8: 631,
      realismWarningDistrictsRc8: 577,
      geometryBlockedDistrictsRc8: 0
    },
    governanceDelta,
    moduleMap: MODULE_MAP,
    smartDerivedV2Gaps: SMART_DERIVED_V2_GAPS,
    istanbulSprint2Carryover: pilotSummary
      ? {
          pilotDistrictCount: pilotSummary.pilotDistricts?.length ?? 0,
          kadikoyStatus: pilotSummary.kadikoyOfficialPilot?.pilotStatus,
          determinismNote: pilotSummary.determinismScope?.note
        }
      : null,
    evidenceIndex: [
      "reports/tr-adm3/sprint-1-governance/",
      "reports/tr-adm3/sprint-2-istanbul/",
      "reports/tr-adm3/sprint-3-national-rc/",
      "reports/tr-adm3/national-quality-closeout/",
      "reports/tr-adm3/national-geometry-remediation/",
      "reports/tr-adm3/audit/current-state.md"
    ],
    completed: [
      "PR #111 merged on origin/main",
      "Source registry 81 il + adm3-catalog 4 ingestion-ready provinces",
      "smart-derived-v1.7 national rc.7/rc.8 topology remediation",
      "Sprint 2 Istanbul diagnostic reports and Kadıköy acquisition failure classification"
    ],
    failed: [],
    blocked: [
      "ADM3 official expansion without per-province legal acceptance",
      "Kadıköy mahalle SHP bundle (identical companion bytes)",
      "İstanbul İBB ArcGIS — license-blocked, research-only",
      "National publish-ready / production promotion",
      "973-district full rebuild for v2 until Istanbul pilot acceptance"
    ],
    nextPilotActions: [
      "Run scripts/tr-mahalle-first-istanbul-v2-pilot.mjs against rc.7 baseline bytes",
      "Implement smart-derived-v2.0-pilot behind explicit opt-in (no national default)",
      "Re-assess coastline/barrier metrics on 8 Istanbul districts including Başakşehir/Esenyurt"
    ]
  };

  await fs.mkdir(path.join(REPO_ROOT, REPORT_DIR), { recursive: true });
  const jsonPath = path.join(REPORT_DIR, "gap-analysis.json");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const md = `# Mahalle-first ADM3 — gap analysis (keşif)

**Üretim zamanı (UTC):** ${report.generatedAt}  
**Doğrulanan \`origin/main\`:** \`${originMainSha ?? "unknown"}\`  
**PR #111:** merge edildi (ulusal geometri remediation + rc.8 doğrulama).

## Özet

TerritoryKit bugün **mahalle-first** hedefi için güçlü bir governance + v1.7 smart-derived altyapısına sahip; ancak **smart-derived-v2** kodu yok ve ulusal kalite metrikleri (631 düşük güven / 577 realism uyarısı) Sprint 2 İstanbul kabul koşullarını karşılamıyor. rc.7 ve rc.8 artefaktları salt okunur baseline olarak korunmalı; yeni denemeler \`.territory/mahalle-first-pilot/\` altında yapılmalı.

## Sprint durumu (dört sprint + 3.5/3.6)

| Sprint | Odak | Durum |
| ------ | ---- | ----- |
| 1 | Kaynak / governance | **done** (#107) |
| 2 | İstanbul ADM3 kalite | **done** (#108) — 6 ilçe |
| 3 | Ulusal RC + delivery | **done** (#109) |
| 3.5 | 973 ilçe envanter QA | **done** (#110) |
| 3.6 | Geometri remediation rc.8 | **done** (#111) |
| 4 | Rush&Claim | **planlı** — yasal/hosted kapıları açık değil |

## Governance delta (Sprint 1 yeniden değerlendirme)

Registry özeti: **${registry.summary.provinceCount}** il, **${registry.summary.productionEligibleProvinceCount}** il productionEligible, **${registry.summary.statusCounts["official-restricted"]}** official-restricted.

### Odak iller (makine okunur: \`gap-analysis.json\` → \`governanceDelta.focusProvinces\`)

| İl | Registry status | Catalog ingestion | Not |
| --- | --- | --- | --- |
| Bursa (16) | official-ready | adm3-catalog SHA pinned | Lisans: Bursa Açık Veri — redistribution allowed (catalog) |
| Gaziantep (27) | official-ready | KML pinned | CC BY 4.0 (catalog) |
| İstanbul (34) | partial-official | yok | İBB servis **license-blocked**; Kadıköy SHP **BLOCKED_BY_SOURCE** |
| Sakarya (54) | official-license-review | GeoJSON URL | CRS/reprojection engeli; **candidate**, productionEligible false |
| Sivas (58) | official-license-review | SHP ZIP | İndirme timeout; alan şeması bekliyor |

**Veri katmanları:** indirilen doğrulanmış bytes ≠ onaylı redistribution ≠ gameplay estimated zone. Eksik kurum izinleri \`human-approvals-required.json\` içinde **PENDING_REVIEW** / **NOT_AUTHORIZED** olarak kalır.

## Modül eşlemesi ve boşluklar

${MODULE_MAP.map((m) => `- **${m.requirement}** → \`${m.implementation}\` — *gap:* ${m.gap}`).join("\n")}

## smart-derived-v2 gereksinim boşlukları

${SMART_DERIVED_V2_GAPS.map((g) => `- **${g.id}** (${g.status}): ${g.detail}`).join("\n")}

## Tamamlanan / engelli

**Tamamlanan:** ${report.completed.join("; ")}

**Engelli:** ${report.blocked.join("; ")}

## Sonraki adımlar (İstanbul pilot)

${report.nextPilotActions.map((a, i) => `${i + 1}. ${a}`).join("\n")}

---

Makine okunur rapor: [\`gap-analysis.json\`](./gap-analysis.json)
`;

  const mdPath = path.join(REPORT_DIR, "gap-analysis.md");
  const formattedMd = await formatPrettier(md, { filepath: mdPath });
  await fs.writeFile(mdPath, formattedMd);
  console.log(`Wrote ${jsonPath} and ${mdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
