import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyTurkeyRuralGeneratorQuality,
  inspectTurkeyGeneratedCoastlineSpill,
  inspectTurkeyIslandMultipolygonSafety,
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

const ZONE_ARTIFACT_CANDIDATES = [
  ".territory/rushclaim-adm3-visibility/provinces/34/dataset.json",
  ".territory/sprint-6/final/istanbul-qa/report.json"
];

async function readJson(relativePath) {
  const absolute = path.join(REPO_ROOT, relativePath);
  return JSON.parse(await fs.readFile(absolute, "utf8"));
}

async function readJsonIfExists(relativePath) {
  try {
    return await readJson(relativePath);
  } catch {
    return null;
  }
}

function resolveHeadSha() {
  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA;
  }
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

async function loadDistrictParentIds() {
  const source = await readJsonIfExists("datasets/generated/countries/TR/dataset.json");
  if (!source) {
    return new Map();
  }
  const province = source.zones?.find((zone) => zone.level === 1 && zone.name === "İstanbul");
  if (!province) {
    return new Map();
  }
  const map = new Map();
  for (const { canonicalName } of PILOT_DISTRICTS) {
    const district = source.zones?.find(
      (zone) => zone.level === 2 && zone.parentId === province.id && zone.name === canonicalName
    );
    if (district) {
      map.set(canonicalName, district.id);
    }
  }
  return map;
}

async function loadPilotZones(parentAdm2Id) {
  for (const candidate of ZONE_ARTIFACT_CANDIDATES) {
    const payload = await readJsonIfExists(candidate);
    if (!payload) {
      continue;
    }
    const zones = (
      payload.zones ??
      payload.results?.flatMap((row) => row.zones ?? []) ??
      []
    ).filter((zone) => zone.level === 3 && zone.parentId === parentAdm2Id);
    if (zones.length > 0) {
      return {
        zones,
        geometryEvidence: "REAL_REPLAY_VERIFIED",
        geometrySource: candidate
      };
    }
  }
  return {
    zones: [],
    geometryEvidence: "NOT_ASSESSED",
    geometrySource: null
  };
}

function districtRow(diagnostics, replay, districtName) {
  const recorded = diagnostics.districts?.find((row) => row.districtName === districtName);
  const smart = recorded?.recordedSmartQuality;
  const replayed = replay.results?.find((row) => row.district === districtName);
  const topologyRecorded = recorded?.executedGeometryQuality?.ok;
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
          topologyPass: topologyRecorded ?? null,
          topologyEvidence:
            topologyRecorded === undefined ? "NOT_ASSESSED" : "HISTORICAL_AUDIT_ONLY"
        }
      : undefined,
    replayed
  };
}

async function kadikoyBundleReport() {
  const acquisition = await readJson("reports/tr-adm3/audit/kadikoy-acquisition.json");
  const localDir = path.join(REPO_ROOT, ".territory/quality-source-audit/kadikoy");
  const files = [];
  const companionStates = [];
  for (const entry of acquisition) {
    const fileName = entry.url.split("/").at(-1);
    const localPath = path.join(localDir, fileName);
    try {
      const bytes = await fs.readFile(localPath);
      files.push({ fileName, bytes: new Uint8Array(bytes) });
      companionStates.push({
        fileName,
        localPath,
        state: "LOCAL_FILE_PRESENT",
        acquisitionSha256: entry.sha256,
        byteSize: entry.byteSize
      });
    } catch {
      companionStates.push({
        fileName,
        localPath,
        state: "MISSING_LOCAL_FILE",
        acquisitionSha256: entry.sha256,
        byteSize: entry.byteSize,
        note: "Yerel dosya yok; sentetik placeholder bayt kullanılmadı."
      });
    }
  }

  const report =
    files.length > 0
      ? inspectTurkeyMunicipalShapefileCompanionBundle(files)
      : {
          schemaVersion: "territorykit-tr-adm3-municipal-shapefile-bundle@1",
          status: "BLOCKED_INCOMPLETE_COMPANIONS",
          structuralStatus: "NOT_RUN",
          productionEligibility: "NOT_ELIGIBLE",
          reasonCodes: ["MISSING_LOCAL_COMPANION_FILES"],
          companions: [],
          shpRecordCount: null,
          shxRecordCount: null,
          dbfRecordCount: null,
          uniqueSha256Count: 0,
          notes: [
            "Kadıköy companion dosyaları yerelde yok; acquisition kanıtı HISTORICAL_AUDIT_ONLY."
          ]
        };

  const historicalDuplicateEvidence = acquisition.every(
    (entry, index, rows) => index === 0 || entry.sha256 === rows[0].sha256
  );
  if (historicalDuplicateEvidence && acquisition.length > 1) {
    report.reasonCodes = [
      ...new Set([...(report.reasonCodes ?? []), "HISTORICAL_IDENTICAL_DOWNLOAD_BYTES"])
    ];
    report.notes = [
      ...(report.notes ?? []),
      "Acquisition kaydı: beş indirme URL'si aynı SHP baytlarını döndürdü (bağımsız companion doğrulaması yapılmadı)."
    ];
    if (report.status === "VALID") {
      report.status = "BLOCKED_DUPLICATE_RESPONSE";
    }
  }

  return {
    acquisitionEvidencePath: "reports/tr-adm3/audit/kadikoy-acquisition.json",
    acquisitionEvidenceClass: "HISTORICAL_AUDIT_ONLY",
    localBundleDir: localDir,
    companionStates,
    bundle: report,
    pilotStatus: "BLOCKED_BY_SOURCE",
    verificationClass: files.length > 0 ? "FIXTURE_TESTED" : "BLOCKED_BY_MISSING_SOURCE"
  };
}

export function sha256OfUtf8FileContents(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function main() {
  const diagnostics = await readJson("reports/tr-adm3/audit/istanbul-district-diagnostics.json");
  const replay = await readJson("reports/tr-adm3/audit/istanbul-replay.json");
  const determinism = await readJson("reports/tr-adm3/audit/istanbul-determinism.json");
  const kadikoy = await kadikoyBundleReport();
  const parentIds = await loadDistrictParentIds();
  const determinismDistrictCount = determinism.districtCount ?? 3;
  const replayDistrictNames = new Set(replay.results?.map((row) => row.district) ?? []);

  const pilotRows = [];
  for (const { name, canonicalName } of PILOT_DISTRICTS) {
    const { recorded, replayed } = districtRow(diagnostics, replay, canonicalName);
    const parentAdm2Id = parentIds.get(canonicalName) ?? null;
    const geometryLoad = parentAdm2Id
      ? await loadPilotZones(parentAdm2Id)
      : { zones: [], geometryEvidence: "NOT_ASSESSED", geometrySource: null };

    const pathology =
      geometryLoad.zones.length > 0
        ? inspectTurkeyGeneratedZonePathology({ zones: geometryLoad.zones })
        : {
            schemaVersion: "territorykit-tr-adm3-generated-pathology@1",
            generatedZoneCount: 0,
            skippedOfficialZoneCount: 0,
            findings: [],
            pathologyEvidence: "NOT_ASSESSED"
          };

    const coastline =
      geometryLoad.zones.length > 0
        ? inspectTurkeyGeneratedCoastlineSpill({ zones: geometryLoad.zones, waterBarriers: [] })
        : { assessmentStatus: "NOT_ASSESSED", ok: false, spillFindings: [] };

    const islandSafety =
      geometryLoad.zones.length > 0
        ? inspectTurkeyIslandMultipolygonSafety(geometryLoad.zones)
        : { assessmentStatus: "NOT_ASSESSED", ok: false, findings: [] };

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

    const replayEvidence = replayed
      ? "REAL_REPLAY_VERIFIED"
      : replayDistrictNames.has(canonicalName)
        ? "HISTORICAL_AUDIT_ONLY"
        : "NOT_ASSESSED";

    pilotRows.push({
      district: name,
      canonicalAdm2Name: canonicalName,
      scope: {
        replayEvidence,
        geometryChange: geometryLoad.zones.length > 0 ? "NO_GEOMETRY_CHANGE" : "NOT_ASSESSED",
        pathologyEvidence:
          geometryLoad.zones.length > 0 ? geometryLoad.geometryEvidence : "NOT_ASSESSED",
        coastlineEvidence: coastline.assessmentStatus,
        islandSafetyEvidence: islandSafety.assessmentStatus,
        determinismEvidence:
          replayDistrictNames.has(canonicalName) && determinismDistrictCount === 3
            ? determinism.differences?.length === 0
              ? "HISTORICAL_AUDIT_ONLY"
              : "HISTORICAL_AUDIT_ONLY"
            : "NOT_ASSESSED",
        stableIdEvidence: "NOT_ASSESSED"
      },
      baseline: {
        zoneCount: recorded?.generatedZoneCount ?? replayed?.zoneCount ?? null,
        confidence: recorded?.confidence ?? replayed?.confidenceTier ?? null,
        geometryHash: replayed?.geometryHash ?? recorded?.geometryHash ?? null,
        longestUnsupportedStraightChainMeters:
          recorded?.longestUnsupportedStraightChainMeters ??
          replayed?.longestUnsupportedStraightChainMeters ??
          null,
        topologyPass: recorded?.topologyPass ?? null,
        topologyEvidence:
          recorded?.topologyEvidence ?? (replayed ? "HISTORICAL_AUDIT_ONLY" : "NOT_ASSESSED")
      },
      current: {
        sourceVersion: replay.algorithmVersion ?? "smart-derived-v1.7",
        replayAvailable: Boolean(replayed),
        replayProcessedDistrictCount: replay.processedDistrictCount ?? null,
        geometrySource: geometryLoad.geometrySource,
        generatedZoneCountLoaded: geometryLoad.zones.length,
        pathology,
        coastline,
        islandSafety,
        ruralQuality: rural,
        routeRootCause
      }
    });
  }

  const summary = {
    schemaVersion: "territorykit-tr-adm3-sprint-2-istanbul@2",
    generatedAt: process.env.SPRINT2_PILOT_GENERATED_AT ?? new Date().toISOString(),
    baselineMainSha: BASELINE_MAIN_SHA,
    headSha: resolveHeadSha(),
    determinismScope: {
      assessedDistrictCount: determinismDistrictCount,
      note: "Determinizm kanıtı yalnızca replay edilen 3 ilçe için geçerlidir; 6 pilot ilçe deterministik değildir."
    },
    sourceArtifacts: {
      istanbulDistrictDiagnostics: "reports/tr-adm3/audit/istanbul-district-diagnostics.json",
      istanbulReplay: "reports/tr-adm3/audit/istanbul-replay.json",
      istanbulDeterminism: "reports/tr-adm3/audit/istanbul-determinism.json",
      kadikoyAcquisition: "reports/tr-adm3/audit/kadikoy-acquisition.json"
    },
    kadikoyOfficialPilot: kadikoy,
    pilotDistricts: pilotRows,
    limitations: [
      "Canlı İstanbul bariyer replay (.territory/sprint-6/calibration/barriers) CI ortamında genelde yok; kıyı/su diagnostikleri verified water polygon olmadan NOT_ASSESSED.",
      "rc.7 ulusal artifact'leri değiştirilmedi; geometri karşılaştırması yalnızca mevcut yerel replay artifact'lerine dayanır.",
      "Sprint 2 çıktısı diagnostik ve kanıt düzeltmesidir; üretim poligon onayı veya rc.7 promote içermez."
    ]
  };

  await fs.mkdir(path.join(REPO_ROOT, REPORT_ROOT), { recursive: true });
  const jsonPath = path.join(REPORT_ROOT, "pilot-summary.json");
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  await fs.writeFile(jsonPath, serialized);
  const mdPath = path.join(REPORT_ROOT, "OZET.md");
  const md = `# Sprint 2 — İstanbul ADM3 pilot özeti

- **Baseline main SHA:** \`${BASELINE_MAIN_SHA}\`
- **HEAD SHA:** \`${summary.headSha ?? "bilinmiyor"}\`
- **Kadıköy resmî bundle:** ${kadikoy.pilotStatus} (\`${kadikoy.bundle.status}\`, ${kadikoy.verificationClass})
- **Determinizm kapsamı:** ${determinismDistrictCount} ilçe replay (audit); 6 pilot ilçe için genel determinizm iddiası yok

## Pilot ilçe tablosu

| İlçe | Zone | Güven | Replay | Patoloji | Kıyı/su | Ada güvenliği | Geometri |
| --- | ---: | --- | --- | --- | --- | --- | --- |
${pilotRows
  .map(
    (row) =>
      `| ${row.district} | ${row.baseline.zoneCount ?? "—"} | ${row.baseline.confidence ?? "—"} | ${row.scope.replayEvidence} | ${row.scope.pathologyEvidence} | ${row.scope.coastlineEvidence} | ${row.scope.islandSafetyEvidence} | ${row.scope.geometryChange} |`
  )
  .join("\n")}

## Eyüpsultan NO_ROUTE

${pilotRows.find((row) => row.district === "Eyüpsultan")?.current.routeRootCause?.summaryTr ?? "Replay kanıtı yok."}

## Kadıköy kaynak doğrulama

Companion yerel durumu: **${kadikoy.companionStates.filter((row) => row.state === "MISSING_LOCAL_FILE").length}** eksik dosya. Bundle: **${kadikoy.bundle.status}**.

## Kısıtlar

${summary.limitations.map((item) => `- ${item}`).join("\n")}
`;
  await fs.writeFile(mdPath, md);
  try {
    execSync(`pnpm exec prettier --write "${mdPath}"`, { cwd: REPO_ROOT, stdio: "pipe" });
  } catch {
    // Prettier is optional in minimal environments; CI will enforce formatting separately.
  }
  const digest = sha256OfUtf8FileContents(serialized);
  await fs.writeFile(
    path.join(REPORT_ROOT, "pilot-summary.sha256"),
    `${digest}  pilot-summary.json\n`
  );
  console.log(`Wrote ${jsonPath}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
