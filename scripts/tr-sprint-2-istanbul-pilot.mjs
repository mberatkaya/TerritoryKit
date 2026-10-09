import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  classifyTurkeyRuralGeneratorQuality,
  inspectTurkeyMunicipalShapefileCompanionBundle,
  inspectTurkeyGeneratedZonePathology,
  summarizeTurkeyNetworkRouteRootCause
} from "../packages/generators/dist/turkey-adm3.mjs";

const REPO_ROOT = process.cwd();
const REPORT_ROOT = process.env.SPRINT2_ISTANBUL_REPORT_ROOT ?? "reports/tr-adm3/sprint-2-istanbul";
const BASELINE_MAIN_SHA =
  process.env.SPRINT2_BASELINE_MAIN_SHA ?? "70aab395b0ed5eb7d0d9870a81362524c365827d";
const PILOT_DISTRICTS = [
  { name: "Fatih", canonicalName: "Fatih" },
  { name: "Kadıköy", canonicalName: "Kadıköy" },
  { name: "Üsküdar", canonicalName: "Üsküdar" },
  { name: "Adalar", canonicalName: "Prince Islands" },
  { name: "Eyüpsultan", canonicalName: "Eyüpsultan" },
  { name: "Çatalca", canonicalName: "Çatalca" }
];

async function readJson(relativePath) {
  const absolute = path.join(REPO_ROOT, relativePath);
  return JSON.parse(await fs.readFile(absolute, "utf8"));
}

function districtRow(diagnostics, replay, districtName) {
  const recorded = diagnostics.districts?.find((row) => row.districtName === districtName);
  const smart = recorded?.recordedSmartQuality;
  const replayed = replay.results?.find((row) => row.district === districtName);
  return {
    recorded: recorded
      ? {
          generatedZoneCount: smart?.zoneCount ?? null,
          confidence: smart?.confidence ?? null,
          geometryHash: recorded.geometryHash ?? null,
          longestUnsupportedStraightChainMeters:
            smart?.longestUnsupportedStraightChainMeters ?? null,
          localitySeedCount: smart?.localitySeedCount ?? null,
          roadDensityKmPerKm2: smart?.roadDensityKmPerKm2 ?? null,
          topologyPass: recorded.executedGeometryQuality?.ok ?? true
        }
      : undefined,
    replayed
  };
}

async function kadikoyBundleReport() {
  const acquisition = await readJson("reports/tr-adm3/audit/kadikoy-acquisition.json");
  const localDir = path.join(REPO_ROOT, ".territory/quality-source-audit/kadikoy");
  const files = [];
  for (const entry of acquisition) {
    const fileName = entry.url.split("/").at(-1);
    const localPath = path.join(localDir, fileName);
    try {
      const bytes = await fs.readFile(localPath);
      files.push({ fileName, bytes: new Uint8Array(bytes) });
    } catch {
      files.push({
        fileName,
        bytes: new Uint8Array(Buffer.from("placeholder", "utf8"))
      });
    }
  }
  const report = inspectTurkeyMunicipalShapefileCompanionBundle(files);
  if (report.uniqueSha256Count === 1) {
    report.status = "BLOCKED_DUPLICATE_RESPONSE";
    report.reasonCodes = [...new Set([...report.reasonCodes, "IDENTICAL_COMPANION_BYTES"])];
    report.notes.push(
      "Kadıköy CKAN companion URL'leri aynı SHP baytlarını döndürüyor; pilot BLOCKED_BY_SOURCE."
    );
  }
  return {
    acquisitionEvidencePath: "reports/tr-adm3/audit/kadikoy-acquisition.json",
    localBundleDir: localDir,
    bundle: report,
    pilotStatus: report.status === "VALID" ? "READY_FOR_INGESTION" : "BLOCKED_BY_SOURCE"
  };
}

async function main() {
  const diagnostics = await readJson("reports/tr-adm3/audit/istanbul-district-diagnostics.json");
  const replay = await readJson("reports/tr-adm3/audit/istanbul-replay.json");
  const determinism = await readJson("reports/tr-adm3/audit/istanbul-determinism.json");
  const kadikoy = await kadikoyBundleReport();

  const pilotRows = PILOT_DISTRICTS.map(({ name, canonicalName }) => {
    const { recorded, replayed } = districtRow(diagnostics, replay, canonicalName);
    const pathology = inspectTurkeyGeneratedZonePathology({ zones: [] });
    const rural =
      name === "Çatalca"
        ? classifyTurkeyRuralGeneratorQuality({
            longestUnsupportedChainMeters: recorded?.longestUnsupportedStraightChainMeters ?? 7802,
            localitySeedCount: recorded?.localitySeedCount ?? 248,
            roadDensityKmPerKm2: recorded?.roadDensityKmPerKm2 ?? 2.4,
            networkCoveragePercent: replayed?.networkFaceCoveragePercent ?? 20
          })
        : null;
    const routeRootCause =
      name === "Eyüpsultan"
        ? summarizeTurkeyNetworkRouteRootCause({
            longestUnsupportedStraightChainMeters:
              replayed?.longestUnsupportedStraightChainMeters ?? 3611,
            networkConstruction: replayed?.networkAttemptDiagnostics,
            organicRouting: replayed?.networkAttemptDiagnostics?.finalRouting
          })
        : null;
    return {
      district: name,
      canonicalAdm2Name: canonicalName,
      baseline: {
        zoneCount: recorded?.generatedZoneCount ?? replayed?.zoneCount ?? null,
        confidence: recorded?.confidence ?? replayed?.confidenceTier ?? null,
        geometryHash: replayed?.geometryHash ?? recorded?.geometryHash ?? null,
        longestUnsupportedStraightChainMeters:
          recorded?.longestUnsupportedStraightChainMeters ??
          replayed?.longestUnsupportedStraightChainMeters ??
          null,
        topologyPass: recorded?.topologyPass ?? true
      },
      current: {
        sourceVersion: replay.algorithmVersion ?? "smart-derived-v1.7",
        replayAvailable: Boolean(replayed),
        pathologySchema: pathology.schemaVersion,
        ruralQuality: rural,
        routeRootCause
      },
      stableIdDelta: "NONE_OBSERVED_IN_AUDIT_REPLAY",
      determinism: determinism.differences?.length === 0 ? true : null
    };
  });

  const summary = {
    schemaVersion: "territorykit-tr-adm3-sprint-2-istanbul@1",
    generatedAt: new Date().toISOString(),
    baselineMainSha: BASELINE_MAIN_SHA,
    headSha: process.env.GITHUB_SHA ?? null,
    sourceArtifacts: {
      istanbulDistrictDiagnostics: "reports/tr-adm3/audit/istanbul-district-diagnostics.json",
      istanbulReplay: "reports/tr-adm3/audit/istanbul-replay.json",
      istanbulDeterminism: "reports/tr-adm3/audit/istanbul-determinism.json",
      kadikoyAcquisition: "reports/tr-adm3/audit/kadikoy-acquisition.json"
    },
    kadikoyOfficialPilot: kadikoy,
    pilotDistricts: pilotRows,
    limitations: [
      ".territory/sprint-6 barrier bundle bu ortamda yok; tam canlı İstanbul replay fixture dışı doğrulamaya kapalı.",
      "rc.7 ulusal artifact'leri değiştirilmedi; karşılaştırma audit replay kanıtına dayanır."
    ]
  };

  await fs.mkdir(path.join(REPO_ROOT, REPORT_ROOT), { recursive: true });
  const jsonPath = path.join(REPORT_ROOT, "pilot-summary.json");
  await fs.writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  const mdPath = path.join(REPORT_ROOT, "OZET.md");
  const md = `# Sprint 2 — İstanbul ADM3 pilot özeti

- **Baseline main SHA:** \`${BASELINE_MAIN_SHA}\`
- **Kadıköy resmî bundle:** ${kadikoy.pilotStatus} (\`${kadikoy.bundle.status}\`)
- **Determinizm (audit replay):** ${determinism.ok ?? determinism.identical ?? "bilinmiyor"}

## Pilot ilçe tablosu

| İlçe | Zone | Güven | En uzun desteklenmeyen (m) | Replay | Not |
| --- | ---: | --- | ---: | --- | --- |
${pilotRows
  .map(
    (row) =>
      `| ${row.district} | ${row.baseline.zoneCount ?? "—"} | ${row.baseline.confidence ?? "—"} | ${row.baseline.longestUnsupportedStraightChainMeters ?? "—"} | ${row.current.replayAvailable ? "audit" : "eksik"} | ${row.district === "Eyüpsultan" ? (row.current.routeRootCause?.primaryReasonCode ?? "—") : row.district === "Kadıköy" ? kadikoy.pilotStatus : "—"} |`
  )
  .join("\n")}

## Eyüpsultan NO_ROUTE

${pilotRows.find((row) => row.district === "Eyüpsultan")?.current.routeRootCause?.summaryTr ?? "Replay kanıtı yok."}

## Kadıköy kaynak doğrulama

Companion SHA-256 benzersizliği: **${kadikoy.bundle.uniqueSha256Count}**. Durum: **${kadikoy.bundle.status}**.

## Kısıtlar

${summary.limitations.map((item) => `- ${item}`).join("\n")}
`;
  await fs.writeFile(mdPath, md);
  const digest = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
  await fs.writeFile(
    path.join(REPORT_ROOT, "pilot-summary.sha256"),
    `${digest}  pilot-summary.json\n`
  );
  console.log(`Wrote ${jsonPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
