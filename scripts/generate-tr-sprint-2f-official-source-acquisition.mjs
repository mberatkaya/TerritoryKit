#!/usr/bin/env node
/**
 * Sprint 2F — Istanbul pilot official polygon source acquisition matrix (research-only).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeReportJson, writeReportMarkdown } from "./lib/write-report-json.mjs";
import { ISTANBUL_SETTLEMENT_IDENTITY_PILOTS } from "./lib/tr-mahalle-identity-istanbul-pilots.mjs";
import { investigateKadikoyOfficialShapefile } from "./investigate-kadikoy-official-shapefile.mjs";

const REPO_ROOT = process.cwd();
const REPORT_ROOT = "reports/tr-adm3/sprint-2f-official-sources";

const PRIORITY = [
  "kadikoy",
  "fatih",
  "uskudar",
  "adalar",
  "eyupsultan",
  "catalca",
  "basaksehir",
  "esenyurt"
];

const IBBS_RUNTIME_PROVIDER = {
  providerId:
    "tr-adm3-runtime-34-istanbul-buyuksehir-belediyesi-sehir-haritasi-non-catalog-arcgis-traces",
  sourceUrl:
    "datasets/registry/tr-adm3-runtime-providers.json#tr-adm3-runtime-34-istanbul-buyuksehir-belediyesi-sehir-haritasi-non-catalog-arcgis-traces",
  notes:
    "Visible İBB map layers exist; no verified redistributable open-data vector download in approved official registry."
};

function districtCandidate(pilot, kadikoyInvestigation) {
  const parentAdm2Id = `tr:adm2:${pilot.adm2Suffix}`;
  const base = {
    district: pilot.district,
    slug: pilot.slug,
    parentAdm2Id,
    priority: PRIORITY.indexOf(pilot.slug) + 1,
    officialProvider: null,
    sourceUrl: null,
    rawAccessMethod: null,
    fileFormat: null,
    sourceVersionDate: null,
    license: null,
    attribution: null,
    redistributionPermission: "unknown",
    geometryAvailability: "not-verified",
    featureCount: null,
    adm2MappingFeasibility: "requires-official-parent-code-crosswalk",
    status: "research-required",
    blockingReason:
      pilot.officialPolygonNote ?? "No verified official mahalle polygon package ingested.",
    registryReferences: [IBBS_RUNTIME_PROVIDER.providerId],
    evidencePaths: []
  };

  if (pilot.officialDataPolicy?.status === "BLOCKED_BY_SOURCE") {
    return {
      ...base,
      district: pilot.district,
      officialProvider: "Kadıköy Belediyesi Açık Veri (CKAN)",
      sourceUrl:
        "https://acikveri.kadikoy.bel.tr/api/3/action/package_show?id=1f49bf03-cea5-40b9-9604-5f71c6f71e22",
      rawAccessMethod: "HTTP resource download (companion SHP bundle)",
      fileFormat: "claimed-shapefile-companion",
      license: "REVIEW_REQUIRED",
      attribution: "Kadıköy Belediyesi",
      redistributionPermission: "not-approved",
      geometryAvailability: "blocked-invalid-bytes",
      status: "BLOCKED_BY_SOURCE",
      blockingReason:
        kadikoyInvestigation?.decision?.summary ??
        "Companion SHP files are structurally invalid / identical erroneous bytes.",
      evidencePaths: [
        pilot.officialDataPolicy.acquisitionEvidencePath,
        "reports/tr-adm3/sprint-2e-source-evidence/kadikoy-official-shapefile-investigation.json"
      ],
      alternativeAccessPaths: [
        {
          kind: "municipal-ckan-api",
          url: "https://acikveri.kadikoy.bel.tr/api/3/action/package_search?q=mahalle",
          status: "investigate-documented-export-bundles"
        },
        {
          kind: "ibb-city-map-runtime",
          providerId: IBBS_RUNTIME_PROVIDER.providerId,
          status: "runtime-only-unverified-redistribution"
        }
      ]
    };
  }

  return {
    ...base,
    officialProvider: "İstanbul Büyükşehir Belediyesi (province-level research)",
    sourceUrl: IBBS_RUNTIME_PROVIDER.sourceUrl,
    rawAccessMethod: "registry trace / manual authority request",
    redistributionPermission: "unknown",
    geometryAvailability: "no-verified-vector-download",
    status: "NO_VERIFIED_OFFICIAL_PACKAGE",
    blockingReason:
      "İstanbul province has no approved official mahalle polygon provider in tr-adm3-official-providers.json.",
    evidencePaths: [
      `reports/tr-adm3/mahalle-identity-layer/${pilot.slug}-coverage-and-provenance.json`
    ]
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const kadikoyInvestigation = existsSync(
    join(
      REPO_ROOT,
      "reports/tr-adm3/sprint-2e-source-evidence/kadikoy-official-shapefile-investigation.json"
    )
  )
    ? JSON.parse(
        await readFile(
          join(
            REPO_ROOT,
            "reports/tr-adm3/sprint-2e-source-evidence/kadikoy-official-shapefile-investigation.json"
          ),
          "utf8"
        )
      )
    : await investigateKadikoyOfficialShapefile({ repoRoot: REPO_ROOT });

  const pilots = PRIORITY.map((slug) =>
    ISTANBUL_SETTLEMENT_IDENTITY_PILOTS.find((row) => row.slug === slug)
  ).filter(Boolean);

  const candidates = pilots.map((pilot) => districtCandidate(pilot, kadikoyInvestigation));

  const blockers = {
    schemaVersion: "territorykit-tr-sprint-2f-official-source-blockers@1",
    generatedAt,
    legalRedistribution: [
      "No municipal redistribution approval recorded for Istanbul pilot official polygons.",
      "Public downloadability does not imply hosted/game redistribution rights."
    ],
    technical: [
      "Kadıköy companion SHP acquisition bytes fail structural validation.",
      "İstanbul lacks verified official provider entry in tr-adm3-official-providers.json."
    ],
    kadikoyStatus: kadikoyInvestigation.decision?.status ?? "BLOCKED_BY_SOURCE"
  };

  const matrix = {
    schemaVersion: "territorykit-tr-sprint-2f-official-source-acquisition@1",
    generatedAt,
    provinceCode: "34",
    verifiedOfficialPolygonCount: 0,
    candidates
  };

  await mkdir(join(REPO_ROOT, REPORT_ROOT), { recursive: true });
  await writeReportJson(`${REPORT_ROOT}/istanbul-pilot-official-source-matrix.json`, matrix);
  await writeReportJson(`${REPORT_ROOT}/source-legal-blockers.json`, blockers);

  await writeReportMarkdown(
    `${REPORT_ROOT}/OZET.md`,
    `# Sprint 2F — Official source acquisition (İstanbul pilots)

| District | Status | Geometry |
| --- | --- | --- |
${candidates
  .map((row) => `| ${row.district} | ${row.status} | ${row.geometryAvailability} |`)
  .join("\n")}

Kadıköy: **${blockers.kadikoyStatus}**. Verified official mahalle polygons: **0**.
`
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        verifiedOfficialPolygonCount: 0,
        kadikoyStatus: blockers.kadikoyStatus,
        reportRoot: REPORT_ROOT
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
