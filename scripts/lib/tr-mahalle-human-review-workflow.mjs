import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MAHALLE_HUMAN_REVIEW_DECISION_LEDGER_SCHEMA_VERSION,
  MAHALLE_HUMAN_REVIEW_QUEUE_SCHEMA_VERSION,
  buildMahalleHumanReviewContextPin,
  computeMahalleHumanReviewRecordId,
  countAttributedHumanReviewDecisions,
  countMahalleHumanReviewDecisionStates,
  createPendingMahalleHumanReviewDecisionEntry,
  hashTerritoryGeometry,
  validateMahalleHumanReviewDecisionLedger
} from "../../packages/dataset/dist/index.mjs";
import { ISTANBUL_SETTLEMENT_IDENTITY_PILOTS } from "./tr-mahalle-identity-istanbul-pilots.mjs";

/**
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {object} options.queue
 * @param {string} [options.identityReportRoot]
 * @param {string} [options.rc8Root]
 */
export async function loadDistrictReviewPins(options) {
  const identityReportRoot = options.identityReportRoot ?? "reports/tr-adm3/mahalle-identity-layer";
  const rc8Root =
    options.rc8Root ?? ".territory/national-geometry-remediation/candidate-rc8-impl-rev1";
  const pinsByDistrict = new Map();

  for (const pilot of ISTANBUL_SETTLEMENT_IDENTITY_PILOTS) {
    const immutabilityPath = join(
      options.repoRoot,
      identityReportRoot,
      `${pilot.slug}-geometry-immutability.json`
    );
    const coveragePath = join(
      options.repoRoot,
      identityReportRoot,
      `${pilot.slug}-coverage-and-provenance.json`
    );
    const identityPath = join(
      options.repoRoot,
      identityReportRoot,
      `${pilot.slug}-identity-layer.json`
    );
    const shardPath = join(
      options.repoRoot,
      rc8Root,
      `districts/tr_adm2_${pilot.adm2Suffix}/dataset.json`
    );

    let immutability;
    let coverage;
    let identityLayer;
    let shard;
    try {
      immutability = JSON.parse(await readFile(immutabilityPath, "utf8"));
      coverage = JSON.parse(await readFile(coveragePath, "utf8"));
      identityLayer = JSON.parse(await readFile(identityPath, "utf8"));
      shard = JSON.parse(await readFile(shardPath, "utf8"));
    } catch {
      continue;
    }

    const parentAdm2Id = `tr:adm2:${pilot.adm2Suffix}`;
    const geometryHashByZoneId = {};
    for (const zone of shard.zones.filter((row) => row.level === 3)) {
      geometryHashByZoneId[zone.id] = hashTerritoryGeometry(zone.geometry);
    }

    pinsByDistrict.set(pilot.district, {
      zoneIdSetSha256: immutability.zoneIdSetSha256,
      geometryHashSetSha256: immutability.geometryHashSetSha256,
      identityLayerVersion: pilot.identityLayerVersion,
      identityLayerContentChecksum: identityLayer.contentChecksum ?? null,
      gameplayDatasetVersion: shard.manifest?.datasetVersion ?? null,
      geometryHashByZoneId,
      parentAdm2Id
    });
  }

  return pinsByDistrict;
}

/**
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {object} options.queue
 * @param {Map<string, object>} options.districtPins
 */
export function buildInitialMahalleHumanReviewDecisionLedger(options) {
  const { queue, districtPins } = options;
  const generatedAt = new Date().toISOString();
  const entries = [];

  for (const record of queue.records) {
    const districtPin = districtPins.get(record.district);
    const zoneGeometryHash =
      record.stableZoneId && districtPin?.geometryHashByZoneId
        ? (districtPin.geometryHashByZoneId[record.stableZoneId] ?? null)
        : null;

    const pins = buildMahalleHumanReviewContextPin({
      queueRecord: record,
      reviewQueueGeneratedAt: queue.generatedAt,
      zoneGeometryHash,
      districtPins: districtPin
        ? {
            zoneIdSetSha256: districtPin.zoneIdSetSha256,
            geometryHashSetSha256: districtPin.geometryHashSetSha256,
            identityLayerVersion: districtPin.identityLayerVersion,
            identityLayerContentChecksum: districtPin.identityLayerContentChecksum,
            gameplayDatasetVersion: districtPin.gameplayDatasetVersion
          }
        : undefined
    });

    const normalizedRecord = {
      ...record,
      reviewRecordId: record.reviewRecordId ?? computeMahalleHumanReviewRecordId(record)
    };

    entries.push(
      createPendingMahalleHumanReviewDecisionEntry({
        queueRecord: normalizedRecord,
        reviewQueueGeneratedAt: queue.generatedAt,
        pins
      })
    );
  }

  const ledger = {
    schemaVersion: MAHALLE_HUMAN_REVIEW_DECISION_LEDGER_SCHEMA_VERSION,
    generatedAt,
    programBaseline: {
      reviewQueueSchemaVersion: queue.schemaVersion ?? MAHALLE_HUMAN_REVIEW_QUEUE_SCHEMA_VERSION,
      reviewQueueGeneratedAt: queue.generatedAt,
      reviewRecordCount: queue.records.length,
      gameplayZoneCount: queue.summary?.gameplayZoneCount ?? queue.programBaseline?.gameplayZones,
      settlementRecords: queue.programBaseline?.settlementRecords ?? null
    },
    redistributionRightsApproved: false,
    officialVerifiedPolygonCount: 0,
    entries
  };

  const validation = validateMahalleHumanReviewDecisionLedger(ledger);
  if (!validation.ok) {
    const message = validation.issues.map((row) => row.message).join("; ");
    throw new Error(`Invalid initial human review ledger: ${message}`);
  }

  return ledger;
}

export function summarizeMahalleHumanReviewProgress(ledger) {
  const stateCounts = countMahalleHumanReviewDecisionStates(ledger);
  const attributedDecisions = countAttributedHumanReviewDecisions(ledger);
  return {
    reviewRecordCount: ledger.entries.length,
    attributedHumanDecisions: attributedDecisions,
    pendingRecords: stateCounts.pending,
    needsEvidenceRecords: stateCounts["needs-evidence"],
    approvedSemanticLabelRecords: stateCounts["approved-semantic-label"],
    rejectedRecords: stateCounts.rejected,
    supersededRecords: stateCounts.superseded,
    autoDisplayNameAllowedCount: ledger.entries.filter((row) => row.autoDisplayNameAllowed === true)
      .length,
    officialVerifiedPolygonCount: ledger.officialVerifiedPolygonCount
  };
}
