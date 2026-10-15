#!/usr/bin/env node
/**
 * Sprint 2C — Fatih mahalle identity layer (Alternative B) from pinned rc.8 gameplay + OSM seeds.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  buildSettlementIdentityLayer,
  hashTerritoryGeometry
} from "../packages/dataset/dist/index.mjs";
import { createSettlementIdentityLookup } from "../packages/core/dist/index.mjs";
import { readTurkeyOsmAdm2BarrierArtifact } from "../packages/generators/dist/turkey-adm3.mjs";
import { writeReportJson, writeReportMarkdown } from "./lib/write-report-json.mjs";

const REPO_ROOT = process.cwd();
const FATIH_ADM2_SUFFIX = "54988432b39641834885080";
const PARENT_ADM2_ID = `tr:adm2:${FATIH_ADM2_SUFFIX}`;
const RC8_ROOT =
  process.env.MAHALLE_IDENTITY_RC8_ROOT ??
  ".territory/national-geometry-remediation/candidate-rc8-impl-rev1";
const BARRIER_ROOT =
  process.env.MAHALLE_IDENTITY_BARRIER_ROOT ?? ".territory/sprint-6/calibration/barriers";
const OSM_SOURCE_LOCK =
  process.env.MAHALLE_IDENTITY_OSM_SOURCE_LOCK ??
  ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json";
const REPORT_ROOT = "reports/tr-adm3/mahalle-identity-layer";
const PREVIEW_ALT_B =
  "reports/tr-adm3/mahalle-first-program/fatih-alternative-b-semantic-association.json";
const IDENTITY_LAYER_VERSION = "tr-mahalle-identity-fatih-pilot@2026-10-15";

async function readJson(path) {
  return JSON.parse(await readFile(join(REPO_ROOT, path), "utf8"));
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function stableStringify(input) {
  return JSON.stringify(sortJson(input));
}

function sortJson(input) {
  if (Array.isArray(input)) {
    return input.map((value) => sortJson(value));
  }
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, sortJson(value)])
    );
  }
  return input;
}

function summarizeZoneNaming(layer) {
  const ambiguous = layer.zoneSummaries.filter(
    (row) => row.associationStatus === "multiple-candidates"
  );
  const single = layer.zoneSummaries.filter((row) => row.associationStatus === "single-candidate");
  const unseeded = layer.zoneSummaries.filter((row) => row.associationStatus === "unseeded");
  const distinctNames = new Set(layer.zoneSummaries.flatMap((row) => row.distinctNormalizedNames));
  return {
    zoneCount: layer.gameplayZoneCount,
    ambiguousZoneCount: ambiguous.length,
    singleSeedZoneCount: single.length,
    unseededZoneCount: unseeded.length,
    distinctSeedsRepresented: distinctNames.size
  };
}

function buildMapPreviewGeoJson(layer, gameplayZones) {
  const zoneFeatures = gameplayZones.map((zone) => {
    const summary = layer.zoneSummaries.find((row) => row.zoneId === zone.id);
    return {
      type: "Feature",
      properties: {
        kind: "gameplay-zone",
        zoneId: zone.id,
        zoneName: zone.name,
        associationStatus: summary?.associationStatus ?? "unseeded",
        autoDisplayNameAllowed: summary?.autoDisplayNameAllowed ?? false,
        geometryHash: hashTerritoryGeometry(zone.geometry)
      },
      geometry: zone.geometry
    };
  });

  const seedFeatures = layer.settlements.map((settlement) => ({
    type: "Feature",
    properties: {
      kind: "locality-seed",
      settlementId: settlement.settlementId,
      displayName: settlement.displayName,
      verificationState: settlement.verificationState,
      geometryAvailability: settlement.geometryAvailability,
      confidence: settlement.confidence ?? null
    },
    geometry: {
      type: "Point",
      coordinates: settlement.seedCoordinate
    }
  }));

  return {
    type: "FeatureCollection",
    features: [...zoneFeatures, ...seedFeatures]
  };
}

async function main() {
  const baselineShard = join(RC8_ROOT, "districts", `tr_adm2_${FATIH_ADM2_SUFFIX}`, "dataset.json");
  const baselineDataset = await readJson(baselineShard);
  const parent = baselineDataset.zones.find(
    (zone) => zone.level === 2 && zone.id === PARENT_ADM2_ID
  );
  if (!parent) {
    throw new Error(`ADM2 parent not found in rc.8 shard: ${PARENT_ADM2_ID}`);
  }

  const gameplayZones = baselineDataset.zones.filter((zone) => zone.level === 3);
  const zoneIds = gameplayZones.map((zone) => zone.id).sort();
  const geometryHashes = Object.fromEntries(
    gameplayZones.map((zone) => [zone.id, hashTerritoryGeometry(zone.geometry)])
  );

  const artifact = await readTurkeyOsmAdm2BarrierArtifact(
    join(REPO_ROOT, BARRIER_ROOT),
    PARENT_ADM2_ID
  );
  const sourceLock = await readJson(OSM_SOURCE_LOCK).catch(() => null);
  const generatedAt = new Date().toISOString();
  const osmSourceLockState = sourceLock?.contentHash ? "verified" : "unknown";
  const osmLicenseEvidenceState = artifact.manifest?.source?.license ? "pending" : "unknown";
  const seedProvenanceDefaults = {
    providerId: artifact.manifest?.source?.providerId ?? "openstreetmap",
    providerName: artifact.manifest?.source?.providerName ?? "OpenStreetMap",
    sourceDatasetId: artifact.manifest?.source?.sourceDatasetId ?? "openstreetmap",
    sourceUrl: artifact.manifest?.source?.sourceUrl,
    snapshotDate: artifact.manifest?.source?.snapshotDate,
    snapshotChecksum: artifact.manifest?.source?.snapshotSha256,
    license: artifact.manifest?.source?.license ?? "ODbL-1.0",
    attribution: artifact.manifest?.source?.attribution ?? "OpenStreetMap contributors",
    licenseState: "pending",
    permissionStatus: "redistribution-unknown",
    sourceLockState: osmSourceLockState,
    redistributionEvidenceState: osmLicenseEvidenceState
  };

  const layer = buildSettlementIdentityLayer({
    gameplayZones,
    parentAdm2Zone: parent,
    parentAdm1Id: "tr:adm1:34",
    parentAdm0Id: "tr:adm0:TR",
    seeds: artifact.localitySeeds,
    gameplayDatasetVersion: baselineDataset.manifest?.datasetVersion ?? "2.1.0-rc.8",
    identityLayerVersion: IDENTITY_LAYER_VERSION,
    generatedAt,
    boundaryMode: "covers",
    defaultProvenance: seedProvenanceDefaults
  });

  const lookup = createSettlementIdentityLookup({ layer });
  const metrics = summarizeZoneNaming(layer);

  let altBComparison = null;
  try {
    const altB = await readJson(PREVIEW_ALT_B);
    altBComparison = {
      previewSchema: altB.schemaVersion,
      preview: {
        ambiguousZoneCount: altB.ambiguousZoneCount,
        singleSeedZoneCount: altB.singleSeedZoneCount,
        unseededZoneCount: altB.unseededZoneCount,
        distinctSeedsRepresented: altB.distinctSeedsRepresented,
        zoneCount: altB.zoneCount
      },
      identityLayer: metrics,
      deltas: {
        ambiguousZoneCount: metrics.ambiguousZoneCount - altB.ambiguousZoneCount,
        singleSeedZoneCount: metrics.singleSeedZoneCount - altB.singleSeedZoneCount,
        unseededZoneCount: metrics.unseededZoneCount - altB.unseededZoneCount,
        distinctSeedsRepresented: metrics.distinctSeedsRepresented - altB.distinctSeedsRepresented
      },
      deltaExplanation:
        metrics.distinctSeedsRepresented !== altB.distinctSeedsRepresented
          ? "Identity layer dedupes seeds outside ADM2 and near-duplicates; preview used all raw seeds with outer-ring-only point tests."
          : "Counts match preview within dedupe/boundary policy."
    };
  } catch {
    altBComparison = { missingPreview: true };
  }

  const ambiguityReport = {
    schemaVersion: "territorykit-tr-mahalle-identity-ambiguity@1",
    generatedAt,
    parentAdm2Id: PARENT_ADM2_ID,
    ...metrics,
    ambiguousZones: layer.zoneSummaries
      .filter((row) => row.associationStatus === "multiple-candidates")
      .map((row) => ({
        zoneId: row.zoneId,
        zoneName: row.zoneName,
        distinctNormalizedNames: row.distinctNormalizedNames,
        settlementIds: row.distinctSettlementIds
      })),
    conflictAssociations: layer.associations.filter((row) => row.status === "conflict"),
    altBComparison
  };

  const coverage = {
    schemaVersion: "territorykit-tr-mahalle-identity-coverage@1",
    generatedAt,
    parentAdm2Id: PARENT_ADM2_ID,
    gameplayDatasetVersion: layer.gameplayDatasetVersion,
    identityLayerVersion: layer.identityLayerVersion,
    contentChecksum: layer.contentChecksum,
    associationCoverage: {
      seededZoneCount: metrics.zoneCount - metrics.unseededZoneCount,
      unseededZoneCount: metrics.unseededZoneCount,
      singleCandidateZoneCount: metrics.singleSeedZoneCount,
      ambiguousZoneCount: metrics.ambiguousZoneCount,
      seedCount: layer.settlements.length,
      associationCount: layer.associations.length
    },
    officialPolygonCoverage: {
      settlementCountWithOfficialPolygon: 0,
      settlementCountWithOsmAdminPolygon: 0,
      settlementCountSeedOnly: layer.settlements.length,
      note: "Fatih pilot has no independently verified official mahalle polygons in gameplay or identity layer."
    },
    sourcePrecedence: [
      "approved-official-polygon",
      "reviewed-osm-administrative-polygon",
      "seed-only-semantic-association",
      "unknown"
    ],
    provenance: {
      gameplayShard: baselineShard,
      rc8Root: RC8_ROOT,
      barrierRoot: BARRIER_ROOT,
      osmSourceLock: sourceLock?.contentHash ?? null,
      osmSourceLockState,
      barrierManifestChecksum: artifact.manifest?.artifactChecksum ?? null,
      missingSourceReasonCode: sourceLock?.contentHash ? undefined : "SOURCE_LOCK_MISSING"
    },
    licenseChecks: {
      osmLicense: artifact.manifest?.source?.license ?? "ODbL-1.0",
      licenseState: "pending",
      permissionStatus: "redistribution-unknown",
      redistributionApproved: false,
      redistributionEvidenceState: osmLicenseEvidenceState,
      commercialUseRequiresSeparateReview: true,
      hostedTileDeliveryRequiresSeparateReview: true
    }
  };

  const immutability = {
    schemaVersion: "territorykit-tr-mahalle-identity-immutability@1",
    generatedAt,
    parentAdm2Id: PARENT_ADM2_ID,
    gameplayDatasetVersion: layer.gameplayDatasetVersion,
    pinnedRc8Shard: baselineShard,
    zoneIdSetSha256: sha256Hex(stableStringify(zoneIds)),
    zoneCount: zoneIds.length,
    geometryHashByZoneId: geometryHashes,
    geometryHashSetSha256: sha256Hex(
      stableStringify(
        Object.entries(geometryHashes)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([zoneId, hash]) => ({ zoneId, hash }))
      )
    ),
    parentAdm2IdVerified: parent.id,
    parentAdm2GeometryHash: hashTerritoryGeometry(parent.geometry),
    identityLayerContentChecksum: layer.contentChecksum,
    determinismNote:
      "Identity layer does not modify gameplay dataset bytes; associations are derived read-only metadata.",
    replayChecksum: layer.contentChecksum
  };

  const repeatLayer = buildSettlementIdentityLayer({
    gameplayZones,
    parentAdm2Zone: parent,
    parentAdm1Id: "tr:adm1:34",
    parentAdm0Id: "tr:adm0:TR",
    seeds: artifact.localitySeeds,
    gameplayDatasetVersion: baselineDataset.manifest?.datasetVersion ?? "2.1.0-rc.8",
    identityLayerVersion: IDENTITY_LAYER_VERSION,
    generatedAt,
    boundaryMode: "covers",
    defaultProvenance: seedProvenanceDefaults
  });
  immutability.determinismVerified = repeatLayer.contentChecksum === layer.contentChecksum;

  const settlementsOut = {
    schemaVersion: "territorykit-tr-mahalle-settlement-identities@1",
    generatedAt,
    parentAdm2Id: PARENT_ADM2_ID,
    identityLayerVersion: layer.identityLayerVersion,
    contentChecksum: layer.contentChecksum,
    settlements: layer.settlements
  };

  const associationsOut = {
    schemaVersion: "territorykit-tr-mahalle-zone-associations@1",
    generatedAt,
    parentAdm2Id: PARENT_ADM2_ID,
    identityLayerVersion: layer.identityLayerVersion,
    contentChecksum: layer.contentChecksum,
    boundaryMode: layer.boundaryMode,
    associations: layer.associations,
    zoneSummaries: layer.zoneSummaries
  };

  const mapPreview = buildMapPreviewGeoJson(layer, gameplayZones);

  await mkdir(join(REPO_ROOT, REPORT_ROOT), { recursive: true });
  const outputs = [
    ["fatih-settlement-identities.json", settlementsOut],
    ["fatih-zone-associations.json", associationsOut],
    ["fatih-ambiguity-report.json", ambiguityReport],
    ["fatih-coverage-and-provenance.json", coverage],
    ["fatih-geometry-immutability.json", immutability],
    ["fatih-map-preview.geojson", mapPreview],
    ["fatih-identity-layer.json", layer]
  ];

  for (const [name, payload] of outputs) {
    const path = join(REPORT_ROOT, name);
    if (name.endsWith(".geojson")) {
      await writeFile(join(REPO_ROOT, path), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    } else {
      await writeReportJson(path, payload);
    }
  }

  const decision = {
    schemaVersion: "territorykit-tr-mahalle-identity-sprint-2c-decision@1",
    generatedAt,
    district: "Fatih",
    parentAdm2Id: PARENT_ADM2_ID,
    technicalPilotDecision: "GO_WITH_REVIEW",
    productionReleaseReadiness: "NO_GO",
    rationale: [
      "Gameplay rc.8 zone IDs and geometry hashes unchanged; identity layer is versioned separately.",
      "Seed-only semantics explicitly non-authoritative; no official mahalle polygons promoted.",
      `${metrics.ambiguousZoneCount} ambiguous zones require human review before auto display naming.`,
      "Official polygon acquisition remains the long-term precedence path."
    ],
    metrics,
    immutability: {
      determinismVerified: immutability.determinismVerified,
      zoneIdSetSha256: immutability.zoneIdSetSha256,
      geometryHashSetSha256: immutability.geometryHashSetSha256,
      identityLayerContentChecksum: layer.contentChecksum
    },
    consumerContract: {
      lookup: "createSettlementIdentityLookup (@territory-kit/core)",
      autoDisplayNameAllowedOnlyWhen:
        "never for automatic seed associations; use consumerNameSemantics seed-locality-label with verificationState locality-seed",
      reviewApprovalRequires: "explicit human review evidence (association method reviewed)"
    },
    nextIstanbulPilots: [
      {
        district: "Kadıköy",
        note: "Blocked on official source acquisition / license review per Sprint 2 reports."
      },
      {
        district: "Eyüpsultan",
        note: "Sparse barrier network — expect lower seed coverage; identity layer still useful."
      },
      {
        district: "Adalar",
        note: "Coastline/multipolygon edge cases — validate boundary-point policy on islands."
      }
    ],
    lookupSmoke: {
      sampleZone: lookup.listSettlementsForZone(zoneIds[0] ?? ""),
      layerVersion: lookup.describeLayerVersion()
    }
  };

  await writeReportMarkdown(
    join(REPORT_ROOT, "sprint-2c-decision.md"),
    `# Sprint 2C — Fatih mahalle identity layer

## Decision

- **Technical pilot:** ${decision.technicalPilotDecision}
- **Production release:** ${decision.productionReleaseReadiness}

## Fatih metrics

| Metric | Value |
| --- | ---: |
| Gameplay zones | ${metrics.zoneCount} |
| Ambiguous zones | ${metrics.ambiguousZoneCount} |
| Single-seed zones | ${metrics.singleSeedZoneCount} |
| Unseeded zones | ${metrics.unseededZoneCount} |
| Distinct seeds represented | ${metrics.distinctSeedsRepresented} |

## Immutability

- Zone ID set SHA-256: \`${immutability.zoneIdSetSha256}\`
- Geometry hash set SHA-256: \`${immutability.geometryHashSetSha256}\`
- Identity layer checksum: \`${layer.contentChecksum}\`
- Determinism verified: **${immutability.determinismVerified}**

## Alternative B preview comparison

${altBComparison?.missingPreview ? "Preview file not found." : `Ambiguous Δ ${altBComparison.deltas.ambiguousZoneCount}, distinct seeds Δ ${altBComparison.deltas.distinctSeedsRepresented}. ${altBComparison.deltaExplanation}`}

## Consumer contract

Use \`createSettlementIdentityLookup\` from \`@territory-kit/core\` with artifacts under \`reports/tr-adm3/mahalle-identity-layer/\`. Do not treat gameplay polygon edges as official mahalle boundaries.

## Map preview

Serve \`examples/web-maplibre-turkey\` with \`MAHALLE_IDENTITY_PREVIEW=1\` or open the mahalle identity preview entry.
`
  );

  await writeReportJson(join(REPORT_ROOT, "sprint-2c-decision.json"), decision);

  console.log(
    JSON.stringify(
      {
        ok: true,
        reportRoot: REPORT_ROOT,
        metrics,
        contentChecksum: layer.contentChecksum,
        determinismVerified: immutability.determinismVerified
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
