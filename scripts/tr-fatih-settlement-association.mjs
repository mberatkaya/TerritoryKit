#!/usr/bin/env node
/**
 * Sprint 2C — Fatih settlement semantic association (Alternative B).
 * Gameplay geometry comes from pinned rc.8 shard; associations are versioned separately.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  buildTrSettlementAssociations,
  compareTrSettlementGameplayGeometryInvariant,
  validateTrSettlementAssociationArtifact
} from "../packages/dataset/dist/tr-settlement-association.mjs";
import { loadTerritoryDataset } from "../packages/dataset/dist/index.mjs";
import { createTrSettlementAssociationQuery } from "../packages/core/dist/settlement-association-query.mjs";
import {
  buildTurkeyNetworkFirstSmartFallbackWithAdjacency,
  createTurkeySmartFallbackDataset,
  readTurkeyOsmAdm2BarrierArtifact
} from "../packages/generators/dist/turkey-adm3.mjs";

const REPO_ROOT = process.cwd();
const FATIH_ADM2_SUFFIX = "54988432b39641834885080";
const PARENT_ADM2_ID = `tr:adm2:${FATIH_ADM2_SUFFIX}`;
const BASELINE_ROOT =
  process.env.MAHALLE_FIRST_RC8_ROOT ??
  ".territory/national-geometry-remediation/candidate-rc8-impl-rev1";
const BARRIER_ROOT =
  process.env.MAHALLE_FIRST_BARRIER_ROOT ?? ".territory/sprint-6/calibration/barriers";
const OUTPUT_ROOT =
  process.env.MAHALLE_FIRST_FATIH_SETTLEMENT_OUTPUT ??
  ".territory/mahalle-first-pilot/fatih-settlement-association";
const REPORT_ROOT = "reports/tr-adm3/mahalle-first-program";

const EXPECTED_BASELINE = {
  zoneCount: 30,
  ambiguousZoneCount: 15,
  singleSeedZoneCount: 10,
  unseededZoneCount: 5,
  distinctSeedsRepresented: 71
};

async function readJson(path) {
  return JSON.parse(await readFile(join(REPO_ROOT, path), "utf8"));
}

async function writeStableJson(relativePath, value) {
  const absolute = join(REPO_ROOT, relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(absolute, body, "utf8");
  const checksum = createHash("sha256").update(body).digest("hex");
  await writeFile(`${absolute}.sha256`, `${checksum}\n`, "utf8");
  return { path: relativePath, checksum };
}

async function runV17ReplayDataset(parent, artifact, smartInput) {
  const result = await buildTurkeyNetworkFirstSmartFallbackWithAdjacency(smartInput);
  const dataset = createTurkeySmartFallbackDataset({
    parent: smartInput.parent,
    zones: result.zones,
    datasetId: "tr-adm3-smart-fallback-v17-replay",
    sourceDate: result.configuration.algorithmVersion
  });
  return { result, dataset };
}

function countZoneStatuses(artifact) {
  const counts = {
    SINGLE_SEED_MATCH: 0,
    AMBIGUOUS_REVIEW_REQUIRED: 0,
    UNSEEDED: 0,
    SOURCE_REVIEW_REQUIRED: 0,
    VERIFIED_BOUNDARY_MATCH: 0
  };
  for (const summary of artifact.zoneSummaries) {
    counts[summary.associationStatus] = (counts[summary.associationStatus] ?? 0) + 1;
  }
  return counts;
}

function distinctSeedNames(artifact) {
  return new Set(artifact.associations.map((row) => row.normalizedName)).size;
}

async function main() {
  const started = performance.now();
  const baselineShard = join(
    BASELINE_ROOT,
    "districts",
    `tr_adm2_${FATIH_ADM2_SUFFIX}`,
    "dataset.json"
  );
  const baselineDataset = loadTerritoryDataset(await readJson(baselineShard));
  const parent = baselineDataset.zones.find(
    (zone) => zone.level === 2 && zone.id === PARENT_ADM2_ID
  );
  if (!parent) {
    throw new Error(`ADM2 parent not found: ${PARENT_ADM2_ID}`);
  }

  const barrierArtifact = await readTurkeyOsmAdm2BarrierArtifact(
    join(REPO_ROOT, BARRIER_ROOT),
    PARENT_ADM2_ID
  );

  const smartInput = {
    parent,
    provinceCode: "34",
    districtCode: FATIH_ADM2_SUFFIX,
    profile: "dense-urban",
    roads: barrierArtifact.roads,
    railways: barrierArtifact.railways,
    water: barrierArtifact.water,
    landuse: barrierArtifact.landuse,
    parks: barrierArtifact.parks,
    localitySeeds: barrierArtifact.localitySeeds,
    options: {
      sourceMetadata: {
        providerId: barrierArtifact.manifest.source.providerId,
        providerName: barrierArtifact.manifest.source.providerName,
        sourceDatasetId: barrierArtifact.manifest.source.sourceDatasetId,
        sourceId: barrierArtifact.manifest.adm2Id,
        sourceDate: barrierArtifact.manifest.source.snapshotDate,
        sourceVersion: barrierArtifact.manifest.source.algorithmVersion,
        sourceUrl: barrierArtifact.manifest.source.sourceUrl,
        sourceSnapshotId: barrierArtifact.manifest.source.snapshotSha256.slice(0, 16),
        sourceSnapshotChecksum: barrierArtifact.manifest.source.snapshotSha256,
        barrierArtifactChecksum: barrierArtifact.manifest.artifactChecksum,
        license: barrierArtifact.manifest.source.license,
        attribution: barrierArtifact.manifest.source.attribution
      }
    }
  };

  const v17Replay = await runV17ReplayDataset(parent, barrierArtifact, smartInput);
  const rc8SelfInvariant = compareTrSettlementGameplayGeometryInvariant(
    baselineDataset,
    baselineDataset,
    PARENT_ADM2_ID
  );
  const v17ReplayVsRc8 = compareTrSettlementGameplayGeometryInvariant(
    baselineDataset,
    v17Replay.dataset,
    PARENT_ADM2_ID
  );

  const associationInput = {
    dataset: baselineDataset,
    parentAdm2Id: PARENT_ADM2_ID,
    builtAt: new Date().toISOString(),
    seeds: barrierArtifact.localitySeeds,
    source: {
      providerId: barrierArtifact.manifest.source.providerId,
      sourceDatasetId: barrierArtifact.manifest.source.sourceDatasetId,
      sourceSnapshotChecksum: barrierArtifact.manifest.source.snapshotSha256,
      sourceSnapshotId: barrierArtifact.manifest.source.snapshotSha256.slice(0, 16),
      license: barrierArtifact.manifest.source.license,
      licenseState: barrierArtifact.manifest.source.license ? "approved" : "unknown",
      attribution: barrierArtifact.manifest.source.attribution
    }
  };

  const artifact = buildTrSettlementAssociations(associationInput);
  const validation = validateTrSettlementAssociationArtifact(baselineDataset, artifact);
  const query = createTrSettlementAssociationQuery(artifact);
  const proof = query.getAssociationsForZone(artifact.zoneSummaries[0]?.zoneId ?? "");

  const statusCounts = countZoneStatuses(artifact);
  const comparison = {
    schemaVersion: "territorykit-tr-mahalle-first-sprint-2c-comparison@1",
    generatedAt: associationInput.builtAt,
    parentAdm2Id: PARENT_ADM2_ID,
    rc8Shard: baselineShard,
    authoritativeGameplaySource: "rc8-shard",
    rc8SelfInvariant,
    v17ReplayVsRc8,
    v17ReplayMatchesRc8: v17ReplayVsRc8.ok,
    v17ReplayNote: v17ReplayVsRc8.ok
      ? "v1.7 replay matches pinned rc.8 Fatih shard fingerprints."
      : "v1.7 replay on current main does not match rc.8 shard bytes; associations are anchored to rc.8 only.",
    expectedBaseline: EXPECTED_BASELINE,
    actual: {
      zoneCount: artifact.summary.zoneCount,
      ambiguousZoneCount: statusCounts.AMBIGUOUS_REVIEW_REQUIRED,
      singleSeedZoneCount: statusCounts.SINGLE_SEED_MATCH,
      unseededZoneCount: statusCounts.UNSEEDED,
      distinctSeedsRepresented: distinctSeedNames(artifact),
      associationCount: artifact.summary.associationCount
    },
    delta: {
      zoneCount: artifact.summary.zoneCount - EXPECTED_BASELINE.zoneCount,
      ambiguousZoneCount:
        statusCounts.AMBIGUOUS_REVIEW_REQUIRED - EXPECTED_BASELINE.ambiguousZoneCount,
      singleSeedZoneCount: statusCounts.SINGLE_SEED_MATCH - EXPECTED_BASELINE.singleSeedZoneCount,
      unseededZoneCount: statusCounts.UNSEEDED - EXPECTED_BASELINE.unseededZoneCount,
      distinctSeedsRepresented:
        distinctSeedNames(artifact) - EXPECTED_BASELINE.distinctSeedsRepresented
    },
    officialMahalleInventoryComparison: "NOT_ASSESSED",
    validationOk: validation.ok,
    sdkProof: {
      sampleZoneId: proof.zoneId,
      associationStatus: proof.associationStatus,
      reasonCodeCount: proof.reasonCodes.length,
      provenanceProviderId: proof.provenance.providerId ?? null
    },
    legalBlockers: [
      "OSM locality seeds are not licensed official mahalle boundaries.",
      "VERIFIED_BOUNDARY_MATCH requires separately governed official polygon sources."
    ],
    durationMs: Math.round(performance.now() - started)
  };

  const writes = await Promise.all([
    writeStableJson(join(OUTPUT_ROOT, "settlement-association.json"), artifact),
    writeStableJson(join(REPORT_ROOT, "fatih-settlement-association.json"), artifact),
    writeStableJson(join(REPORT_ROOT, "fatih-settlement-association-comparison.json"), comparison),
    writeStableJson(join(REPORT_ROOT, "fatih-settlement-geometry-invariant.json"), {
      rc8SelfInvariant,
      v17ReplayVsRc8
    })
  ]);

  const prettyTargets = [
    join(REPORT_ROOT, "fatih-settlement-association.json"),
    join(REPORT_ROOT, "fatih-settlement-association-comparison.json"),
    join(REPORT_ROOT, "fatih-settlement-geometry-invariant.json")
  ];
  execSync(`pnpm prettier --write ${prettyTargets.join(" ")}`, {
    cwd: REPO_ROOT,
    stdio: "inherit"
  });
  for (const relativePath of prettyTargets) {
    const body = await readFile(join(REPO_ROOT, relativePath), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex");
    await writeFile(`${join(REPO_ROOT, relativePath)}.sha256`, `${checksum}\n`, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        ok: validation.ok && rc8SelfInvariant.ok && comparison.delta.distinctSeedsRepresented === 0,
        writes,
        comparison: comparison.actual,
        delta: comparison.delta,
        v17ReplayMatchesRc8: v17ReplayVsRc8.ok,
        rc8SelfInvariantOk: rc8SelfInvariant.ok
      },
      null,
      2
    )
  );

  if (!validation.ok || !rc8SelfInvariant.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
