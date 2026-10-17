import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildSettlementIdentityLayer,
  hashTerritoryGeometry
} from "../../packages/dataset/dist/index.mjs";
import {
  createSettlementIdentityLookup,
  loadSettlementIdentityConsumer
} from "../../packages/core/dist/index.mjs";
import { readTurkeyOsmAdm2BarrierArtifact } from "../../packages/generators/dist/turkey-adm3.mjs";
import { writeReportJson } from "./write-report-json.mjs";

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
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

function stableStringify(input) {
  return JSON.stringify(sortJson(input));
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
    distinctSeedsRepresented: distinctNames.size,
    settlementCount: layer.settlements.length,
    associationCount: layer.associations.length
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

async function readJson(repoRoot, path) {
  return JSON.parse(await readFile(join(repoRoot, path), "utf8"));
}

/**
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {import('./tr-mahalle-identity-istanbul-pilots.mjs').ISTANBUL_SETTLEMENT_IDENTITY_PILOTS[number]} options.pilot
 */
export async function buildMahalleIdentityDistrictReports(options) {
  const {
    repoRoot,
    pilot,
    rc8Root = process.env.MAHALLE_IDENTITY_RC8_ROOT ??
      ".territory/national-geometry-remediation/candidate-rc8-impl-rev1",
    barrierRoot = process.env.MAHALLE_IDENTITY_BARRIER_ROOT ??
      ".territory/sprint-6/calibration/barriers",
    osmSourceLockPath = process.env.MAHALLE_IDENTITY_OSM_SOURCE_LOCK ??
      ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json",
    reportRoot = "reports/tr-adm3/mahalle-identity-layer",
    writeArtifacts = true
  } = options;

  const parentAdm2Id = `tr:adm2:${pilot.adm2Suffix}`;
  const baselineShard = join(rc8Root, "districts", `tr_adm2_${pilot.adm2Suffix}`, "dataset.json");
  const baselineShardAbs = join(repoRoot, baselineShard);

  if (!existsSync(baselineShardAbs)) {
    return {
      ok: false,
      blocked: true,
      reasonCode: "BLOCKED_BY_SOURCE",
      district: pilot.district,
      slug: pilot.slug,
      parentAdm2Id,
      missingArtifact: baselineShard
    };
  }

  const barrierArtifactRoot = join(repoRoot, barrierRoot);
  try {
    await readTurkeyOsmAdm2BarrierArtifact(barrierArtifactRoot, parentAdm2Id);
  } catch {
    return {
      ok: false,
      blocked: true,
      reasonCode: "BLOCKED_BY_SOURCE",
      district: pilot.district,
      slug: pilot.slug,
      parentAdm2Id,
      missingArtifact: `${barrierRoot}/ADM2/tr_adm2_${pilot.adm2Suffix}`
    };
  }

  const baselineDataset = await readJson(repoRoot, baselineShard);
  const parent = baselineDataset.zones.find((zone) => zone.level === 2 && zone.id === parentAdm2Id);
  if (!parent) {
    throw new Error(`ADM2 parent ${parentAdm2Id} not found in rc.8 shard for ${pilot.district}`);
  }

  if (pilot.expectedParentNames?.length && !pilot.expectedParentNames.includes(parent.name)) {
    throw new Error(
      `Parent name mismatch for ${pilot.district}: shard has "${parent.name}", expected one of ${pilot.expectedParentNames.join(", ")}`
    );
  }

  const gameplayZones = baselineDataset.zones.filter((zone) => zone.level === 3);
  const zoneIds = gameplayZones.map((zone) => zone.id).sort();
  const geometryHashes = Object.fromEntries(
    gameplayZones.map((zone) => [zone.id, hashTerritoryGeometry(zone.geometry)])
  );

  const artifact = await readTurkeyOsmAdm2BarrierArtifact(barrierArtifactRoot, parentAdm2Id);
  const sourceLock = await readJson(repoRoot, osmSourceLockPath).catch(() => null);
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
    identityLayerVersion: pilot.identityLayerVersion,
    generatedAt,
    boundaryMode: "covers",
    defaultProvenance: seedProvenanceDefaults
  });

  const metrics = summarizeZoneNaming(layer);
  const lookup = createSettlementIdentityLookup({ layer });

  let altBComparison = null;
  if (pilot.altBPreviewPath) {
    try {
      const altB = await readJson(repoRoot, pilot.altBPreviewPath);
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
  }

  const ambiguityReport = {
    schemaVersion: "territorykit-tr-mahalle-identity-ambiguity@1",
    generatedAt,
    district: pilot.district,
    parentAdm2Id,
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
    district: pilot.district,
    parentAdm2Id,
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
      note: pilot.officialPolygonNote
    },
    ...(pilot.officialDataPolicy ? { officialDataPolicy: pilot.officialDataPolicy } : {}),
    sourcePrecedence: [
      "approved-official-polygon",
      "reviewed-osm-administrative-polygon",
      "seed-only-semantic-association",
      "unknown"
    ],
    provenance: {
      gameplayShard: baselineShard,
      rc8Root,
      barrierRoot,
      osmSourceLock: sourceLock?.contentHash ?? null,
      osmSourceLockState,
      barrierManifestChecksum: artifact.manifest?.artifactChecksum ?? null,
      datasetSourceChecksum: baselineDataset.manifest?.geometryHash ?? null,
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
    district: pilot.district,
    parentAdm2Id,
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
    parentAdm2NameVerified: parent.name,
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
    identityLayerVersion: pilot.identityLayerVersion,
    generatedAt,
    boundaryMode: "covers",
    defaultProvenance: seedProvenanceDefaults
  });
  immutability.determinismVerified = repeatLayer.contentChecksum === layer.contentChecksum;

  const consumerPin = {
    schemaVersion: "territorykit-tr-mahalle-identity-consumer-pin@1",
    district: pilot.district,
    parentAdm2Id,
    gameplayDatasetId:
      baselineDataset.manifest?.datasetId ?? `territory-kit-tr-v2-playable-adm3-${parentAdm2Id}`,
    gameplayDatasetVersion: layer.gameplayDatasetVersion,
    zoneIdSetSha256: immutability.zoneIdSetSha256,
    geometryHashSetSha256: immutability.geometryHashSetSha256,
    identityLayerContentChecksum: layer.contentChecksum,
    associationCounts: {
      zoneCount: metrics.zoneCount,
      settlementCount: layer.settlements.length,
      ambiguousZoneCount: metrics.ambiguousZoneCount,
      singleCandidateZoneCount: metrics.singleSeedZoneCount,
      unseededZoneCount: metrics.unseededZoneCount
    },
    sourceExpectations: {
      requireSourceLockVerified: false,
      missingSourceReasonCode: sourceLock?.contentHash ? undefined : "SOURCE_LOCK_MISSING",
      osmSnapshotChecksum: artifact.manifest?.source?.snapshotSha256 ?? null
    }
  };

  const consumerLoaded = loadSettlementIdentityConsumer({
    layer,
    gameplayDataset: baselineDataset,
    pins: {
      parentAdm2Id,
      gameplayDatasetVersion: layer.gameplayDatasetVersion,
      zoneIdSetSha256: immutability.zoneIdSetSha256,
      geometryHashSetSha256: immutability.geometryHashSetSha256,
      identityLayerContentChecksum: layer.contentChecksum,
      expectedOsmSnapshotChecksum: consumerPin.sourceExpectations.osmSnapshotChecksum ?? undefined
    }
  });

  const lookupSmoke = {
    consumerLoadOk: consumerLoaded.ok,
    validationIssueCodes: consumerLoaded.validation.issues?.map((row) => row.code) ?? [],
    sampleZone: lookup.listSettlementsForZone(zoneIds[0] ?? ""),
    layerVersion: lookup.describeLayerVersion()
  };

  const prefix = pilot.slug;
  const outputs = [
    [
      `${prefix}-settlement-identities.json`,
      {
        schemaVersion: "territorykit-tr-mahalle-settlement-identities@1",
        generatedAt,
        district: pilot.district,
        parentAdm2Id,
        identityLayerVersion: layer.identityLayerVersion,
        contentChecksum: layer.contentChecksum,
        settlements: layer.settlements
      }
    ],
    [
      `${prefix}-zone-associations.json`,
      {
        schemaVersion: "territorykit-tr-mahalle-zone-associations@1",
        generatedAt,
        district: pilot.district,
        parentAdm2Id,
        identityLayerVersion: layer.identityLayerVersion,
        contentChecksum: layer.contentChecksum,
        boundaryMode: layer.boundaryMode,
        associations: layer.associations,
        zoneSummaries: layer.zoneSummaries
      }
    ],
    [`${prefix}-ambiguity-report.json`, ambiguityReport],
    [`${prefix}-coverage-and-provenance.json`, coverage],
    [`${prefix}-geometry-immutability.json`, immutability],
    [`${prefix}-map-preview.geojson`, buildMapPreviewGeoJson(layer, gameplayZones)],
    [`${prefix}-identity-layer.json`, layer],
    [`${prefix}-consumer-pin.json`, consumerPin],
    [
      `${prefix}-lookup-smoke.json`,
      {
        schemaVersion: "territorykit-tr-mahalle-identity-lookup-smoke@1",
        generatedAt,
        district: pilot.district,
        parentAdm2Id,
        ...lookupSmoke
      }
    ]
  ];

  if (writeArtifacts) {
    await mkdir(join(repoRoot, reportRoot), { recursive: true });
    for (const [name, payload] of outputs) {
      const path = join(reportRoot, name);
      if (name.endsWith(".geojson")) {
        await writeFile(join(repoRoot, path), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      } else {
        await writeReportJson(path, payload);
      }
    }
  }

  return {
    ok: true,
    blocked: false,
    district: pilot.district,
    slug: pilot.slug,
    parentAdm2Id,
    parentAdm2Name: parent.name,
    metrics,
    immutability,
    consumerPin,
    coverage,
    lookupSmoke,
    layer,
    baselineDataset,
    gameplayShard: baselineShard
  };
}
