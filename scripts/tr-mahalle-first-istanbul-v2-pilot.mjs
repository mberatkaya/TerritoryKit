#!/usr/bin/env node
/**
 * İstanbul mahalle-first v2 pilot — rc.7 baseline ilçe envanteri (yeniden build yok).
 */
import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = process.cwd();
const ARTIFACT_ROOT =
  process.env.MAHALLE_FIRST_BASELINE_ROOT ?? ".territory/sprint-6/final/candidate";
const OUTPUT_ROOT =
  process.env.MAHALLE_FIRST_PILOT_OUTPUT ?? "reports/tr-adm3/mahalle-first-program";
const OUTPUT_FILE = process.env.MAHALLE_FIRST_PILOT_REPORT ?? "istanbul-v2-pilot-baseline.json";

const PILOTS = [
  { label: "Fatih", adm2Suffix: "54988432b39641834885080" },
  { label: "Kadıköy", adm2Suffix: "54988432b89638439219394" },
  { label: "Üsküdar", adm2Suffix: "54988432b79162079631621" },
  { label: "Adalar", adm2Suffix: "54988432b94516152709384" },
  { label: "Eyüpsultan", adm2Suffix: "54988432b93840376788897" },
  { label: "Çatalca", adm2Suffix: "54988432b71345383711908" },
  { label: "Başakşehir", adm2Suffix: "54988432b67026781349893" },
  { label: "Esenyurt", adm2Suffix: "54988432b2777192469074" }
];

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(REPO_ROOT, relativePath), "utf8"));
}

function territoryMeta(zone) {
  return zone.properties?.territory ?? zone.properties ?? {};
}

function summarizeDistrict(dataset, parentAdm2Id, label) {
  const zones = (dataset.zones ?? []).filter((z) => z.level === 3 && z.parentId === parentAdm2Id);
  const byClass = {};
  let seedNamed = 0;
  let algorithmVersion = null;
  for (const zone of zones) {
    const meta = territoryMeta(zone);
    const bsc = meta.boundarySourceClass ?? meta.source?.boundarySourceClass ?? "unknown";
    byClass[bsc] = (byClass[bsc] ?? 0) + 1;
    if (meta.nameSource === "locality-seed" || meta.seedName) {
      seedNamed += 1;
    }
    algorithmVersion = meta.algorithmVersion ?? algorithmVersion;
  }
  const generated = zones.filter((z) => territoryMeta(z).boundarySourceClass === "smart-derived");
  return {
    district: label,
    parentAdm2Id,
    adm3ZoneCount: zones.length,
    boundarySourceClassCounts: byClass,
    smartDerivedZoneCount: generated.length,
    seedNamedZoneCount: seedNamed,
    seedNamedShare: zones.length ? round(seedNamed / zones.length) : 0,
    algorithmVersion,
    administrativeOfficialCount: zones.filter((z) => territoryMeta(z).administrative === true).length
  };
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

async function loadDistrictShard(adm2Suffix) {
  const shardPath = path.join(
    ARTIFACT_ROOT,
    "districts",
    `tr_adm2_${adm2Suffix}`,
    "dataset.json"
  );
  try {
    return { path: shardPath, dataset: await readJson(shardPath) };
  } catch {
    return { path: shardPath, dataset: null };
  }
}

async function main() {
  const parentDataset = await readJson("datasets/generated/countries/TR/dataset.json");
  const istanbul = parentDataset.zones?.find((z) => z.level === 1 && z.name === "İstanbul");
  if (!istanbul) {
    throw new Error("İstanbul ADM1 not found in parent dataset.");
  }

  const districts = [];
  for (const pilot of PILOTS) {
    const parentAdm2Id = `tr:adm2:${pilot.adm2Suffix}`;
    const parentZone = parentDataset.zones?.find((z) => z.id === parentAdm2Id);
    const { path: shardPath, dataset } = await loadDistrictShard(pilot.adm2Suffix);
    if (!dataset) {
      districts.push({
        district: pilot.label,
        parentAdm2Id,
        parentName: parentZone?.name ?? null,
        shardPath,
        status: "SHARD_MISSING",
        note: "rc.7 candidate shard absent locally; national shard build not executed in this session"
      });
      continue;
    }
    districts.push({
      ...summarizeDistrict(dataset, parentAdm2Id, pilot.label),
      parentName: parentZone?.name ?? null,
      shardPath,
      status: "BASELINE_LOADED"
    });
  }

  let sprint2 = null;
  try {
    sprint2 = await readJson("reports/tr-adm3/sprint-2-istanbul/pilot-summary.json");
  } catch {
    sprint2 = null;
  }

  const report = {
    schemaVersion: "territorykit-tr-mahalle-first-istanbul-v2-pilot@1",
    generatedAt: new Date().toISOString(),
    artifactRoot: ARTIFACT_ROOT,
    artifactPolicy: "READ_ONLY_RC7_BASELINE",
    smartDerivedTargetVersion: "smart-derived-v2.0-pilot",
    currentNationalAlgorithm: "smart-derived-v1.7",
    sprint2PilotDistrictCount: sprint2?.pilotDistricts?.length ?? null,
    expandedPilotDistrictCount: PILOTS.length,
    newDistrictsVsSprint2: ["Başakşehir", "Esenyurt"],
    districts,
    comparisonBaseline: {
      viewportNote:
        "MapLibre zoom/viewport karşılaştırması için reports/tr-adm3/national-quality-closeout/map-index.html ve sprint-2 OZET.md kullanılır; bu rapor yalnızca shard metrikleri.",
      sprint2SummaryPath: "reports/tr-adm3/sprint-2-istanbul/pilot-summary.json"
    },
    acceptanceGatesForNationalBuild: [
      "İstanbul 8-pilot smart-derived-v2 seedCoverage ve barrier adherence iyileşmesi",
      "Eyüpsultan route failure azaltma veya documented low-confidence",
      "coastline NOT_ASSESSED → assessed veya explicit policy",
      "pilot kalite regresyonu yok"
    ]
  };

  await fs.mkdir(path.join(REPO_ROOT, OUTPUT_ROOT), { recursive: true });
  const outPath = path.join(OUTPUT_ROOT, OUTPUT_FILE);
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
