#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { format as formatPrettier } from "prettier";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT_DIR = resolve(ROOT, "reports/tr-adm3/sprint-1-governance");

const SCHEMA_VERSION = "territorykit-tr-sprint-1-governance@1";

function inspectedCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function readJson(relativePath) {
  const text = await readFile(resolve(ROOT, relativePath), "utf8");
  return JSON.parse(text);
}

async function writeJson(path, value) {
  const formatted = await formatPrettier(JSON.stringify(value, null, 2) + "\n", {
    parser: "json"
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, formatted, "utf8");
}

function summarizeProvinces(provinces) {
  const byStatus = {};
  const blockers = [];
  for (const province of provinces) {
    byStatus[province.status] = (byStatus[province.status] ?? 0) + 1;
    const primaryBlocker = classifyProvinceBlocker(province);
    if (primaryBlocker) {
      blockers.push({
        provinceCode: province.code,
        provinceName: province.name,
        status: province.status,
        primaryBlocker,
        productionEligibleSources: (province.sources ?? []).filter((s) => s.productionEligible)
          .length,
        candidateSourceCount: province.sources?.length ?? 0
      });
    }
  }
  return { provinceCount: provinces.length, byStatus, blockers };
}

function classifyProvinceBlocker(province) {
  switch (province.status) {
    case "official-ready":
      return null;
    case "partial-official":
      return "partial-official-coverage";
    case "official-license-review":
      return "license-pending";
    case "official-service-only":
      return "access-blocked-service-only";
    case "official-restricted":
      return "access-blocked-restricted";
    case "osm-candidate":
      return "osm-candidate-not-approved";
    case "research-required":
      return "research-required";
    case "unavailable":
      return "geometry-unavailable";
    default:
      return `unknown-status:${province.status}`;
  }
}

function buildLicensingMatrix(sourceCandidates, nationalCatalog) {
  const rows = sourceCandidates.candidates.map((candidate) => ({
    adminLevel: candidate.adminLevel,
    originalDataSourceLicense: candidate.lockLicense,
    originalDataSourceLicenseUrl: candidate.lockLicenseUrl,
    geoBoundariesDistributionLicense: candidate.adapterDefaultLicense,
    geoBoundariesDistributionNote: candidate.distributionLicenseNote,
    metadataApiUrl: candidate.metadataUrl,
    pinnedReleaseCommit: candidate.gitReleaseCommit,
    lockAttribution: candidate.lockAttribution,
    commercialUseAllowed: "requires-legal-review",
    modificationAndDerivedData: "requires-legal-review",
    databaseRedistributionObligations: "requires-legal-review",
    turkeyGovernmentAuthorityClaim: false,
    legalReviewStatus: "PENDING_REVIEW"
  }));

  return {
    schemaVersion: `${SCHEMA_VERSION}/licensing-matrix`,
    generatedAt: new Date().toISOString(),
    inspectedCommit: inspectedCommit(),
    legalDisclaimer:
      "Technical metadata compilation only. This matrix is not legal advice and does not constitute redistribution authorization.",
    nationalCatalogHdx: {
      provider: nationalCatalog.provider,
      license: nationalCatalog.license,
      licenseUrl: nationalCatalog.licenseUrl,
      redistributionAllowed: nationalCatalog.redistributionAllowed,
      commercialUseAllowed: nationalCatalog.commercialUseAllowed,
      legalReviewStatus: "ACCEPTED_FOR_CATALOG_METADATA_ONLY",
      note: "HDX COD-AB describes downloadable ZIP members used by the national catalog lock; canonical parent polygons in local dataset.json are geoBoundaries-sourced per PR #104–#106."
    },
    geoBoundariesPinnedParent: rows,
    unresolvedQuestions: [
      "Are per-level lock license strings (CC BY-SA 2.0 / ODbL 1.0) compatible with geoBoundaries gbOpen CC BY 4.0 distribution terms for TerritoryKit redistribution?",
      "Does ODbL on ADM2 impose share-alike obligations on produced derivative datasets beyond attribution?",
      "Is commercial use permitted under all cited upstream terms for a gameplay dataset product?",
      "Do Türkiye government data policies require separate permission for MAKS/TUCBS-derived or official municipal exports used in ADM3?",
      "Does public GIS endpoint access imply redistribution rights for locked polygon artifacts?"
    ]
  };
}

function buildPathDecisionMatrix() {
  return {
    schemaVersion: `${SCHEMA_VERSION}/path-decision-matrix`,
    generatedAt: new Date().toISOString(),
    inspectedCommit: inspectedCommit(),
    adr006Status: "ACCEPTED_UNCHANGED",
    dec008Status: "PROPOSED_NOT_ACCEPTED",
    pathBTechnicalStatus: "PARTIAL",
    legalReviewStatus: "PENDING_REVIEW",
    migrationAuthorized: false,
    options: [
      {
        id: "PATH_A",
        title: "Migrate parent polygons to HDX COD-AB",
        technicalConsequences:
          "Re-import ADM0–ADM2 from locked HDX ZIP members; rebuild canonical parent dataset.json bytes.",
        geometryAndIdImpact:
          "Serialized geometry hashes and possibly stable IDs if field mapping differs; ADM3 parent clip replay required.",
        licensingUncertainties:
          "HDX CC BY-IGO catalog is documented; verify gameplay derivative obligations separately.",
        adm3ClippingImpact:
          "High — all ADM3 zones clipped to new parent boundaries must be regression-tested.",
        registryImpact: "Aligns national.json with polygons; reduces catalog/polygon mismatch.",
        consumerImpact:
          "Breaking geometry change unless versioned migration; MVT/tile regeneration.",
        requiredApprovals: [
          "ADR amendment or superseding decision",
          "Legal review",
          "National rebuild authorization"
        ],
        rollbackPrerequisites:
          "Retain geoBoundaries canonical snapshot SHA-256 and prior dataset version pin."
      },
      {
        id: "PATH_B",
        title: "Align catalog/metadata with geoBoundaries-derived canonical parent",
        technicalConsequences:
          "Metadata-only realignment of national.json and source-lock strings without changing canonical polygon bytes.",
        geometryAndIdImpact:
          "No intended parent byte change; 44 serialized hash gaps vs full-builder replay remain documented (geographically equivalent under IoU tolerance per #106).",
        licensingUncertainties:
          "CC BY-SA 2.0 / ODbL 1.0 / CC BY 4.0 adapter mismatch unresolved; not production-approved.",
        adm3ClippingImpact: "Low if parent bytes unchanged; verify no accidental geometry refresh.",
        registryImpact: "national.json provider switches from hdx-cod-ab to geoBoundaries pins.",
        consumerImpact:
          "Attribution text changes; geometry unchanged if migration is strictly metadata.",
        requiredApprovals: [
          "DEC-008 acceptance",
          "ADR-006 amendment",
          "Legal review accepting geoBoundaries attribution chain",
          "Explicit acceptance of 44 hash gaps or mitigation plan"
        ],
        rollbackPrerequisites:
          "Preserve HDX catalog lock checksums and pre-migration national.json."
      }
    ],
    recommendation: {
      preferredOption: "DEFER_MIGRATION",
      rationale:
        "Existing evidence supports documenting the catalog/polygon mismatch and completing legal review before either Path A geometry migration or Path B metadata realignment. Path B is technically PARTIAL, not production-approved.",
      evidence: [
        "reports/tr-adm3/provenance/resolution.md",
        "reports/tr-adm3/provenance/geoboundaries/path-b-feasibility.md",
        "reports/tr-adm3/provenance/geoboundaries/replay/replay-summary.json",
        "adr/ADR-006-turkey-national-administrative-sources.md"
      ]
    }
  };
}

function buildHumanApprovals() {
  return {
    schemaVersion: `${SCHEMA_VERSION}/human-approvals`,
    generatedAt: new Date().toISOString(),
    inspectedCommit: inspectedCommit(),
    items: [
      {
        id: "LEGAL_ADM0_ADM2_GEOBOUNDARIES",
        status: "PENDING_REVIEW",
        summary: "geoBoundaries gbOpen license chain vs per-level lock strings for TR ADM0–ADM2"
      },
      {
        id: "PATH_A_OR_B_MIGRATION",
        status: "NOT_AUTHORIZED",
        summary: "Parent polygon migration (Path A) or metadata realignment (Path B)"
      },
      {
        id: "DEC_008_ACCEPTANCE",
        status: "OPEN",
        summary: "Accept proposed DEC-008 after legal and replay evidence review"
      },
      {
        id: "ADR_006_AMENDMENT",
        status: "OPEN",
        summary: "Amend ADR-006 only if Path B is chosen"
      },
      {
        id: "NATIONAL_DATASET_PROMOTION",
        status: "NOT_AUTHORIZED",
        summary: "Promote territory-kit-tr-v2-playable@2.1.0-rc.7 to production/hosted delivery"
      },
      {
        id: "ADM3_OFFICIAL_SOURCE_EXPANSION",
        status: "PENDING_PER_PROVINCE",
        summary: "Municipal/national official ADM3 licenses (81-province registry blockers)"
      },
      {
        id: "VERSION_PACKAGES_PR_103",
        status: "OBSERVE_ONLY",
        summary: "PR #103 Version Packages — do not merge without explicit authorization"
      }
    ]
  };
}

async function main() {
  const registry = await readJson("datasets/sources/TR/adm3/source-registry.json");
  const sourceCandidates = await readJson(
    "reports/tr-adm3/provenance/geoboundaries/source-candidates.json"
  );
  const nationalCatalog = await readJson("datasets/sources/TR/national.json");
  const replaySummary = await readJson(
    "reports/tr-adm3/provenance/geoboundaries/replay/replay-summary.json"
  );

  const generatedAt = new Date().toISOString();
  const commit = inspectedCommit();
  const provinceSummary = summarizeProvinces(registry.provinces);

  const governanceStatus = {
    schemaVersion: `${SCHEMA_VERSION}/source-governance-status`,
    generatedAt,
    inspectedCommit: commit,
    originMainVerifiedAtSprintStart: "dd3ab8eea31e0f1bce1cbb664105f53d150d7ca9",
    mergedResearchPrs: [
      { number: 104, title: "fix(tr): verify and reconcile national parent source provenance" },
      { number: 105, title: "research(tr): verify geoBoundaries parent source lineage for Path B" },
      {
        number: 106,
        title: "research(tr): reproduce geoBoundaries parent geometry through full country builder"
      }
    ],
    nationalDatasetCandidate: {
      package: "territory-kit-tr-v2-playable",
      version: "2.1.0-rc.7",
      scope: "LOCAL_RELEASE_CANDIDATE_NOT_PRODUCTION",
      evidence: "reports/tr-adm3/audit/baseline-claims.json",
      renderableAreaCoverageNote:
        "Renderable coverage (e.g. 99.999979%) measures gameplay polygon completeness, not official administrative accuracy.",
      officialAreaCoverageNote:
        "Official effective area share (~4.997459%) is distinct from renderable coverage; see audit current-state.md."
    },
    parentProvenance: {
      canonicalParentProvider: "geoboundaries",
      nationalCatalogProvider: nationalCatalog.provider,
      classification: "CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS",
      geoBoundariesBytesVerified: true,
      identityMatch: { ADM0: 1, ADM1: 81, ADM2: 973 },
      fullBuilderReplay: {
        classification: replaySummary.classification,
        pathBTechnicalRecommendation: replaySummary.pathBTechnicalRecommendation,
        geometryHashMismatches: 44,
        determinismByteIdentical: replaySummary.determinism?.byteIdentical ?? null,
        legalReviewStatus: "PENDING_REVIEW",
        productionApproved: false
      },
      evidenceIndex: [
        "reports/tr-adm3/provenance/resolution.md",
        "reports/tr-adm3/provenance/geoboundaries/",
        "reports/tr-adm3/provenance/geoboundaries/replay/"
      ]
    },
    implementationRoadmap: {
      sprint1: "Source and governance closeout",
      sprint2: "Istanbul ADM3 geometry quality",
      sprint3: "National RC and delivery validation",
      sprint4: "Rush&Claim integration"
    }
  };

  const adm3Readiness = {
    schemaVersion: `${SCHEMA_VERSION}/adm3-readiness`,
    generatedAt,
    inspectedCommit: commit,
    registryPath: "datasets/sources/TR/adm3/source-registry.json",
    catalogSidecarPath: "datasets/sources/TR/adm3-catalog.json",
    provinceSummary,
    nationalSourcesAssessment: registry.nationalSources?.map((source) => ({
      provider: source.provider,
      licenseState: source.licenseState,
      productionEligible: source.productionEligible,
      access: source.access
    })),
    statusLegend: {
      "official-ready":
        "Approved source path documented; production eligibility still requires locked polygons",
      "official-license-review": "License pending",
      "official-restricted": "Access blocked / no redistributable package",
      "official-service-only": "Service/API without redistributable export",
      "partial-official": "Partial municipal official coverage only",
      "osm-candidate": "OSM candidate — not approved official substitute",
      "research-required": "Research required",
      unavailable: "Geometry unavailable"
    }
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeJson(resolve(OUT_DIR, "source-governance-status.json"), governanceStatus);
  await writeJson(
    resolve(OUT_DIR, "licensing-evidence-matrix.json"),
    buildLicensingMatrix(sourceCandidates, nationalCatalog)
  );
  await writeJson(resolve(OUT_DIR, "adm3-readiness-report.json"), adm3Readiness);
  await writeJson(resolve(OUT_DIR, "path-a-vs-path-b-matrix.json"), buildPathDecisionMatrix());
  await writeJson(resolve(OUT_DIR, "human-approvals-required.json"), buildHumanApprovals());

  console.log(`[sprint-1-governance] Wrote reports to ${OUT_DIR}`);
}

await main();
