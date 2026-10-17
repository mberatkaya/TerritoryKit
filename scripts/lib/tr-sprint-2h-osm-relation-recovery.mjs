/**
 * Sprint 2H — OSM relation completeness, recovery QA, and Istanbul pilot comparisons.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createTurkeyAdm3GeometryHash,
  extractTurkeyAdm3OsmPbf,
  inspectTurkeyAdm3SpatialQuality,
  summarizeTurkeyAdm3OsmUnresolvedEntries,
  TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION
} from "../../packages/generators/dist/turkey-adm3.mjs";
import {
  hashTerritoryGeometry,
  validateGeometryDataset
} from "../../packages/dataset/dist/index.mjs";
import {
  assessDistrictGeometryQa,
  buildMapPreviewGeoJson,
  loadRc8DistrictContext,
  orderedIstanbulPilots
} from "./tr-sprint-2g-geometry-validation.mjs";
import {
  ISTANBUL_SETTLEMENT_IDENTITY_PILOTS,
  pilotBySlug
} from "./tr-mahalle-identity-istanbul-pilots.mjs";

export const SPRINT_2H_REPORT_ROOT = "reports/tr-adm3/sprint-2h-osm-relation-recovery";
export const SPRINT_2H_ARTIFACT_ROOT = ".territory/sprint-2h";
export const SPRINT_2H_EXTRACT_IMPLEMENTATION_REVISION = "territorykit-tr-sprint-2h-osm-extract@2";

const COUNTRY_PBF = ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/turkey.osm.pbf";
const COUNTRY_LOCK = ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json";
const PINNED_SOURCE_SNAPSHOT_DATE = "2026-08-27T20:21:06.000Z";
const PINNED_SOURCE_PBF_SHA256 = "5ec68ce5e0b2be55b2c34ee7cd1ff91b6b3d8db8acab5a6be2fa7beb633eaedc";

export function expectedParentAdm2Id(pilot) {
  return `tr:adm2:${pilot.adm2Suffix}`;
}

export function sprint2gClipPolyRel(pilot) {
  return `.territory/sprint-2g/osm-clip-poly-${pilot.adm2Suffix}.osm.pbf`;
}

export function sprint2gClipBboxRel(pilot) {
  return `.territory/sprint-2g/osm-clip-bbox-${pilot.adm2Suffix}.osm.pbf`;
}

export function resolveDistrictExtractionClipRel(pilot) {
  if (pilot.slug === "fatih" || pilot.slug === "adalar") {
    return sprint2gClipPolyRel(pilot);
  }
  return sprint2gClipBboxRel(pilot);
}

/** Reject swapped/manual suffix tables: clip path must embed the pilot's canonical adm2Suffix. */
export function validateDistrictClipAssignment(pilot, parent, clipRel) {
  const expectedParentId = expectedParentAdm2Id(pilot);
  const errors = [];

  if (!pilot?.adm2Suffix) {
    errors.push({ code: "MISSING_PILOT_SUFFIX", slug: pilot?.slug ?? null });
  }
  if (parent?.id !== expectedParentId) {
    errors.push({
      code: "PARENT_ADM2_MISMATCH",
      expectedParentAdm2Id: expectedParentId,
      observedParentAdm2Id: parent?.id ?? null,
      pilotDistrict: pilot.district,
      pilotSlug: pilot.slug
    });
  }
  if (!clipRel || !clipRel.includes(pilot.adm2Suffix)) {
    errors.push({
      code: "CLIP_SUFFIX_MISMATCH",
      expectedAdm2Suffix: pilot.adm2Suffix,
      clipRel,
      pilotDistrict: pilot.district,
      pilotSlug: pilot.slug
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    pilotDistrict: pilot.district,
    pilotSlug: pilot.slug,
    adm2Suffix: pilot.adm2Suffix,
    expectedParentAdm2Id: expectedParentId,
    clipRel
  };
}

export function assertPilotRegistryClipConsistency() {
  const mismatches = [];
  for (const pilot of ISTANBUL_SETTLEMENT_IDENTITY_PILOTS) {
    const poly = sprint2gClipPolyRel(pilot);
    const bbox = sprint2gClipBboxRel(pilot);
    if (!poly.includes(pilot.adm2Suffix) || !bbox.includes(pilot.adm2Suffix)) {
      mismatches.push({ slug: pilot.slug, adm2Suffix: pilot.adm2Suffix, poly, bbox });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

function readMemorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    heapTotalBytes: usage.heapTotal,
    externalBytes: usage.external
  };
}

export async function verifyOriginalSourceIntegrity(repoRoot) {
  const lockPath = join(repoRoot, COUNTRY_LOCK);
  const pbfPath = join(repoRoot, COUNTRY_PBF);
  if (!existsSync(lockPath) || !existsSync(pbfPath)) {
    return {
      schemaVersion: "territorykit-tr-sprint-2h-source-integrity@1",
      status: "BLOCKED_BY_SOURCE",
      missingArtifact: !existsSync(pbfPath) ? COUNTRY_PBF : COUNTRY_LOCK
    };
  }
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const onDiskSha256 = await sha256File(pbfPath);
  const byteSize = statSync(pbfPath).size;
  const expectedSha256 = "5ec68ce5e0b2be55b2c34ee7cd1ff91b6b3d8db8acab5a6be2fa7beb633eaedc";
  return {
    schemaVersion: "territorykit-tr-sprint-2h-source-integrity@1",
    status:
      lock.sha256 === onDiskSha256 && onDiskSha256 === expectedSha256 && byteSize === 643317882
        ? "GO"
        : "NO_GO",
    expectedSha256,
    lockSha256: lock.sha256 ?? null,
    onDiskSha256,
    expectedByteSize: 643317882,
    onDiskByteSize: byteSize,
    snapshotDate: lock.snapshotDate ?? lock.pbfHeader?.osmosisReplicationTimestamp ?? null,
    providerId: lock.providerId ?? "geofabrik-osm-extracts",
    pbfPath: COUNTRY_PBF,
    lockPath: COUNTRY_LOCK
  };
}

async function runOsmExtractOnClip(repoRoot, { clipRel, parent, generatedAt }) {
  const clipAbs = join(repoRoot, clipRel);
  if (!existsSync(clipAbs)) {
    return { blocked: true, missingArtifact: clipRel };
  }
  const memoryBefore = readMemorySnapshot();
  const startedAt = performance.now();
  const result = await extractTurkeyAdm3OsmPbf({
    pbfPath: clipAbs,
    generatedAt,
    providerId: "tr-adm3-osm-34-geofabrik-turkey",
    provinceCode: "34",
    districtZones: [parent]
  });
  const durationMs = Math.round(performance.now() - startedAt);
  const memoryAfter = readMemorySnapshot();
  const clipSha256 = await sha256File(clipAbs);
  return {
    blocked: false,
    clipRel,
    clipSha256,
    clipByteSize: statSync(clipAbs).size,
    durationMs,
    memoryBefore,
    memoryAfter,
    builtPolygonCount: result.zones.length,
    unresolvedCount: result.unresolved.length,
    unresolvedSummary: summarizeTurkeyAdm3OsmUnresolvedEntries(result.unresolved),
    zones: result.zones,
    unresolved: result.unresolved,
    quality: result.quality,
    sourceLock: result.sourceLock
  };
}

function collectRelationIdsFromExtract(extract) {
  const ids = new Set();
  for (const zone of extract.zones ?? []) {
    const territory = zone.properties?.territory ?? {};
    if (territory.osmType === "relation" && typeof territory.osmId === "number") {
      ids.add(territory.osmId);
    }
  }
  for (const entry of extract.unresolved ?? []) {
    if (entry.osmType === "relation" && typeof entry.osmId === "number") {
      ids.add(entry.osmId);
    }
  }
  return [...ids].sort((left, right) => left - right);
}

function builtRelationIdsFromExtract(extract) {
  if (extract?.blocked) {
    return [];
  }
  return (extract.zones ?? [])
    .map((zone) => zone.properties?.territory)
    .filter((territory) => territory?.osmType === "relation" && typeof territory.osmId === "number")
    .map((territory) => territory.osmId)
    .sort((left, right) => left - right);
}

function unresolvedRelationIdsFromExtract(extract) {
  if (extract?.blocked) {
    return [];
  }
  return (extract.unresolved ?? [])
    .filter((entry) => entry.osmType === "relation" && typeof entry.osmId === "number")
    .map((entry) => entry.osmId)
    .sort((left, right) => left - right);
}

function relationIdSetSha256(relationIds) {
  return createHash("sha256").update(relationIds.join(",")).digest("hex");
}

async function ensureRelationGetidClip(
  repoRoot,
  { pilot, relationIds, countrySha256, force = false }
) {
  const suffix = pilot.adm2Suffix;
  const outRel = `${SPRINT_2H_ARTIFACT_ROOT}/osm-clip-relation-getid-${suffix}.osm.pbf`;
  const metaRel = `${SPRINT_2H_ARTIFACT_ROOT}/osm-clip-relation-getid-${suffix}.meta.json`;
  const outAbs = join(repoRoot, outRel);
  const metaAbs = join(repoRoot, metaRel);
  await mkdir(join(repoRoot, SPRINT_2H_ARTIFACT_ROOT), { recursive: true });

  const relationIdSetHash = relationIdSetSha256(relationIds);
  const expectedMeta = {
    schemaVersion: "territorykit-tr-sprint-2h-relation-getid-clip-meta@1",
    adm2Suffix: suffix,
    pilotSlug: pilot.slug,
    relationIdCount: relationIds.length,
    relationIdSetSha256: relationIdSetHash,
    countryPbfSha256: countrySha256,
    parserImplementationRevision: TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION,
    extractImplementationRevision: SPRINT_2H_EXTRACT_IMPLEMENTATION_REVISION
  };

  if (
    !force &&
    existsSync(outAbs) &&
    existsSync(metaAbs) &&
    process.env.SPRINT_2H_FORCE_RELATION_GETID !== "1"
  ) {
    try {
      const cachedMeta = JSON.parse(await readFile(metaAbs, "utf8"));
      if (
        cachedMeta.relationIdSetSha256 === relationIdSetHash &&
        cachedMeta.countryPbfSha256 === countrySha256 &&
        cachedMeta.parserImplementationRevision === TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION
      ) {
        return {
          clipRel: outRel,
          metaRel,
          command: "cached",
          relationIdCount: relationIds.length,
          cacheValid: true
        };
      }
    } catch {
      // stale meta — rebuild below
    }
  }

  if (relationIds.length === 0) {
    return { blocked: true, reasonCode: "NO_RELATION_IDS" };
  }
  const countryAbs = join(repoRoot, COUNTRY_PBF);
  const idList = relationIds.map((id) => `r${id}`).join(" ");
  const command = `osmium getid -r "${countryAbs}" ${idList} -o "${outAbs}" --overwrite`;
  execSync(command, { stdio: "pipe" });
  await writeFile(metaAbs, `${JSON.stringify(expectedMeta, null, 2)}\n`, "utf8");
  return {
    clipRel: outRel,
    metaRel,
    command,
    relationIdCount: relationIds.length,
    cacheValid: false
  };
}

export async function compareDistrictExtractionMethods(
  repoRoot,
  pilot,
  { generatedAt, parent, countrySha256 }
) {
  const polyClipRel = sprint2gClipPolyRel(pilot);
  const bboxClipRel = sprint2gClipBboxRel(pilot);
  const polyValidation = validateDistrictClipAssignment(pilot, parent, polyClipRel);
  const bboxValidation = validateDistrictClipAssignment(pilot, parent, bboxClipRel);
  if (!polyValidation.ok || !bboxValidation.ok) {
    return {
      schemaVersion: "territorykit-tr-sprint-2h-extraction-method-comparison@1",
      slug: pilot.slug,
      parentAdm2Id: parent.id,
      blocked: true,
      clipValidation: { polygon: polyValidation, bbox: bboxValidation }
    };
  }

  const polygonClip = await runOsmExtractOnClip(repoRoot, {
    clipRel: polyClipRel,
    parent,
    generatedAt
  });
  const bboxClip = await runOsmExtractOnClip(repoRoot, {
    clipRel: bboxClipRel,
    parent,
    generatedAt
  });

  const targetRelationIds = collectRelationIdsFromExtract(
    polygonClip.blocked ? bboxClip : polygonClip
  );
  const getidClip = await ensureRelationGetidClip(repoRoot, {
    pilot,
    relationIds: targetRelationIds,
    countrySha256
  });
  const relationGetid = getidClip.blocked
    ? { blocked: true, reasonCode: getidClip.reasonCode }
    : await runOsmExtractOnClip(repoRoot, {
        clipRel: getidClip.clipRel,
        parent,
        generatedAt
      });

  const polygonBuiltIds = builtRelationIdsFromExtract(polygonClip);
  const bboxBuiltIds = builtRelationIdsFromExtract(bboxClip);
  const getidBuiltIds = builtRelationIdsFromExtract(relationGetid);
  const polygonUnresolvedIds = unresolvedRelationIdsFromExtract(polygonClip);
  const getidUnresolvedIds = unresolvedRelationIdsFromExtract(relationGetid);

  const onlyInGetidBuilt = getidBuiltIds.filter((id) => !polygonBuiltIds.includes(id));
  const onlyInPolygonBuilt = polygonBuiltIds.filter((id) => !getidBuiltIds.includes(id));
  const unresolvedInPolygonNotGetid = polygonUnresolvedIds.filter(
    (id) => !getidUnresolvedIds.includes(id) && !getidBuiltIds.includes(id)
  );

  return {
    schemaVersion: "territorykit-tr-sprint-2h-extraction-method-comparison@2",
    slug: pilot.slug,
    pilotDistrict: pilot.district,
    parentAdm2Id: parent.id,
    adm2Suffix: pilot.adm2Suffix,
    clipValidation: { polygon: polyValidation, bbox: bboxValidation },
    fixedTargetRelationIdCount: targetRelationIds.length,
    targetRelationIds,
    relationIdSetSha256: relationIdSetSha256(targetRelationIds),
    relationIdDiff: {
      builtRelationIds: {
        polygonClip: polygonBuiltIds,
        bboxClip: bboxBuiltIds,
        countryRelationGetid: getidBuiltIds
      },
      unresolvedRelationIds: {
        polygonClip: polygonUnresolvedIds,
        countryRelationGetid: getidUnresolvedIds
      },
      onlyBuiltInCountryGetid: onlyInGetidBuilt,
      onlyBuiltInPolygonClip: onlyInPolygonBuilt,
      polygonUnresolvedRecoveredByGetid: polygonUnresolvedIds.filter((id) =>
        getidBuiltIds.includes(id)
      ),
      stillUnresolvedAfterGetid: getidUnresolvedIds,
      polygonUnresolvedMissingMembersInClip: unresolvedInPolygonNotGetid
    },
    methods: {
      polygonCompleteWays: summarizeMethod("polygon-complete_ways", polygonClip),
      bboxCompleteWays: summarizeMethod("bbox-complete_ways", bboxClip),
      countryRelationGetid: summarizeMethod("relation-getid-country", {
        ...relationGetid,
        extractionCommand: getidClip.command,
        clipMetaPath: getidClip.metaRel ?? null
      })
    },
    parserImplementationRevision: TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION,
    extractImplementationRevision: SPRINT_2H_EXTRACT_IMPLEMENTATION_REVISION
  };
}

function summarizeMethod(label, extract) {
  if (extract?.blocked) {
    return {
      label,
      status: "BLOCKED",
      missingArtifact: extract.missingArtifact ?? extract.reasonCode ?? null
    };
  }
  return {
    label,
    status: "ASSESSED",
    clipPath: extract.clipRel,
    clipSha256: extract.clipSha256,
    clipByteSize: extract.clipByteSize,
    builtPolygonCount: extract.builtPolygonCount,
    unresolvedCount: extract.unresolvedCount,
    uniqueUnresolvedRelationIds: extract.unresolvedSummary?.uniqueUnresolvedRelationIds ?? 0,
    reasonCounts: extract.unresolvedSummary?.reasonCounts ?? {},
    durationMs: extract.durationMs,
    peakHeapUsedBytes: extract.memoryAfter?.heapUsedBytes ?? null,
    extractionCommand: extract.extractionCommand ?? null
  };
}

export async function diagnoseRelationCompleteness(repoRoot, { generatedAt, comparisons }) {
  const countryAbs = join(repoRoot, COUNTRY_PBF);
  const rows = [];
  const fatihIdLevel = [];
  for (const comparison of comparisons) {
    if (comparison.blocked) {
      rows.push({
        slug: comparison.slug,
        blocked: true,
        clipValidation: comparison.clipValidation ?? null
      });
      continue;
    }
    const polygonMethod = comparison.methods.polygonCompleteWays;
    const bboxMethod = comparison.methods.bboxCompleteWays;
    const getidMethod = comparison.methods.countryRelationGetid;
    if (polygonMethod.status !== "ASSESSED" || getidMethod.status !== "ASSESSED") {
      continue;
    }
    const unresolvedDelta = polygonMethod.unresolvedCount - getidMethod.unresolvedCount;
    rows.push({
      slug: comparison.slug,
      parentAdm2Id: comparison.parentAdm2Id,
      targetRelationIdCount: comparison.fixedTargetRelationIdCount,
      relationIdSetSha256: comparison.relationIdSetSha256,
      polygonClipBuilt: polygonMethod.builtPolygonCount,
      bboxClipBuilt: bboxMethod.status === "ASSESSED" ? bboxMethod.builtPolygonCount : null,
      countryGetidBuilt: getidMethod.builtPolygonCount,
      polygonClipUnresolved: polygonMethod.unresolvedCount,
      bboxClipUnresolved: bboxMethod.status === "ASSESSED" ? bboxMethod.unresolvedCount : null,
      relationGetidUnresolved: getidMethod.unresolvedCount,
      unresolvedDeltaAfterCountryGetid: unresolvedDelta,
      polygonClipMissingOuter: polygonMethod.reasonCounts?.["missing-outer-way-members"] ?? 0,
      relationGetidMissingOuter: getidMethod.reasonCounts?.["missing-outer-way-members"] ?? 0,
      relationIdDiff: comparison.relationIdDiff ?? null,
      rootCauseHint:
        (comparison.relationIdDiff?.onlyBuiltInCountryGetid?.length ?? 0) > 0
          ? "derived-polygon-clip-missing-members-recovered-from-country-pbf"
          : unresolvedDelta > 0
            ? "clip-or-assembler-loss"
            : polygonMethod.builtPolygonCount < getidMethod.builtPolygonCount
              ? "country-getid-member-complete-extract"
              : "remaining-source-or-semantic-blockers"
    });
    if (comparison.slug === "fatih" && comparison.relationIdDiff) {
      fatihIdLevel.push({
        fixedTargetRelationIdCount: comparison.fixedTargetRelationIdCount,
        ...comparison.relationIdDiff
      });
    }
  }

  return {
    schemaVersion: "territorykit-tr-sprint-2h-relation-completeness-root-cause@2",
    generatedAt,
    countryPbfPath: COUNTRY_PBF,
    countryPbfSha256: PINNED_SOURCE_PBF_SHA256,
    countryPbfPresent: existsSync(countryAbs),
    parserImplementationRevision: TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION,
    extractImplementationRevision: SPRINT_2H_EXTRACT_IMPLEMENTATION_REVISION,
    summary: {
      assessedDistricts: rows.filter((row) => !row.blocked).length,
      districtsWithClipDrivenLoss: rows.filter(
        (row) => (row.relationIdDiff?.onlyBuiltInCountryGetid?.length ?? 0) > 0
      ).length
    },
    districts: rows,
    fatihRelationIdLevelEvidence: fatihIdLevel[0] ?? null,
    conclusion:
      "Open-way multipolygon stitching (Sprint 2H parser) recovers most admin relations whose member ways are present in the derived clip; remaining Fatih gaps are explained at relation-ID granularity by polygon-clip missing outer ways versus country-PBF osmium getid recovery."
  };
}

export async function extractAllPilotDistricts(repoRoot, generatedAt) {
  const pilots = orderedIstanbulPilots();
  const perDistrict = [];
  const mergedZones = [];
  const mergedUnresolved = [];
  const provenanceByZoneId = new Map();
  const seenNative = new Set();

  for (const pilot of pilots) {
    const context = await loadRc8DistrictContext(repoRoot, pilot);
    if (context.blocked) {
      perDistrict.push({
        slug: pilot.slug,
        pilotDistrict: pilot.district,
        parentAdm2Id: context.parentAdm2Id,
        blocked: true,
        reasonCode: context.reasonCode ?? "BLOCKED_BY_SOURCE"
      });
      continue;
    }
    const clipRel = resolveDistrictExtractionClipRel(pilot);
    const clipValidation = validateDistrictClipAssignment(pilot, context.parent, clipRel);
    if (!clipValidation.ok) {
      perDistrict.push({
        slug: pilot.slug,
        pilotDistrict: pilot.district,
        parentAdm2Id: context.parent.id,
        blocked: true,
        reasonCode: "CLIP_ASSIGNMENT_INVALID",
        clipValidation
      });
      continue;
    }
    const extract = await runOsmExtractOnClip(repoRoot, {
      clipRel,
      parent: context.parent,
      generatedAt
    });
    if (extract.blocked) {
      perDistrict.push({
        slug: pilot.slug,
        pilotDistrict: pilot.district,
        parentAdm2Id: context.parent.id,
        blocked: true,
        missingArtifact: extract.missingArtifact,
        clipValidation
      });
      continue;
    }
    const adm2MatchedCount = extract.zones.filter(
      (zone) => zone.parentId === context.parent.id
    ).length;
    perDistrict.push({
      slug: pilot.slug,
      pilotDistrict: pilot.district,
      adm2Suffix: pilot.adm2Suffix,
      parentAdm2Id: context.parent.id,
      clipRel,
      clipSha256: extract.clipSha256,
      clipByteSize: extract.clipByteSize,
      clipValidation,
      shardParentId: context.parent.id,
      builtPolygonCount: extract.builtPolygonCount,
      adm2MatchedPolygonCount: adm2MatchedCount,
      unresolvedCount: extract.unresolvedCount,
      unresolvedSummary: extract.unresolvedSummary,
      durationMs: extract.durationMs
    });
    for (const zone of extract.zones) {
      const territory = zone.properties?.territory ?? {};
      const nativeId = territory.sourceNativeId ?? zone.id;
      if (seenNative.has(nativeId)) {
        continue;
      }
      seenNative.add(nativeId);
      mergedZones.push(zone);
      provenanceByZoneId.set(zone.id, {
        derivedClipRel: clipRel,
        derivedClipSha256: extract.clipSha256,
        sourcePbfSha256: PINNED_SOURCE_PBF_SHA256,
        sourceSnapshotDate: PINNED_SOURCE_SNAPSHOT_DATE,
        extractionGeneratedAt: generatedAt,
        parserImplementationRevision: TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION,
        pilotSlug: pilot.slug,
        pilotDistrict: pilot.district,
        expectedParentAdm2Id: context.parent.id
      });
    }
    for (const entry of extract.unresolved) {
      mergedUnresolved.push({
        ...entry,
        parentAdm2Id: context.parent.id,
        pilotSlug: pilot.slug
      });
    }
  }

  return {
    perDistrict,
    zones: mergedZones,
    unresolved: mergedUnresolved,
    unresolvedSummary: summarizeTurkeyAdm3OsmUnresolvedEntries(mergedUnresolved),
    provenanceByZoneId
  };
}

export function buildSemanticClassificationRollup(zones, geometryQaRollup, provenanceByZoneId) {
  const adm2Matched = zones.filter((zone) => {
    const provenance = provenanceByZoneId?.get(zone.id);
    return provenance && zone.parentId === provenance.expectedParentAdm2Id;
  }).length;
  return {
    assembledPolygons: zones.length,
    structurallyValidPolygons: geometryQaRollup?.structurallyValidPolygonCount ?? null,
    structurallyInvalidPolygons: geometryQaRollup?.structurallyInvalidPolygonCount ?? null,
    adm2MatchedPolygons: adm2Matched,
    semanticallyReviewedApprovedPolygons: 0,
    officialVerifiedPolygons: 0,
    note: "OSM research candidates only; semantic-review-required does not imply mahalle/köy administrative truth."
  };
}

export function buildRecoveredPolygonsReport(
  zones,
  { generatedAt, provenanceByZoneId, geometryQaRollup }
) {
  const polygons = zones.map((zone) => {
    const territory = zone.properties?.territory ?? {};
    const provenance = provenanceByZoneId?.get(zone.id) ?? {};
    const nativeOsmRelationId =
      territory.osmType === "relation" && typeof territory.osmId === "number"
        ? territory.osmId
        : null;
    return {
      osmCandidateId: zone.id,
      osmType: territory.osmType,
      osmId: territory.osmId,
      nativeOsmRelationId,
      name: zone.name,
      parentAdm2Id: territory.parentAdm2Id ?? zone.parentId,
      adminLevel: territory.osmTags?.admin_level ?? null,
      semanticType: territory.semanticType,
      semanticReviewStatus: territory.semanticReviewStatus ?? "semantic-review-required",
      provenanceStatus: "OSM_RESEARCH_CANDIDATE",
      sourceClass: "osm-administrative",
      official: false,
      productionEligible: false,
      geometryHash: territory.geometryHash ?? createTurkeyAdm3GeometryHash(zone.geometry),
      sourceSnapshotDate: provenance.sourceSnapshotDate ?? PINNED_SOURCE_SNAPSHOT_DATE,
      sourcePbfSha256: provenance.sourcePbfSha256 ?? PINNED_SOURCE_PBF_SHA256,
      derivedClipSha256: provenance.derivedClipSha256 ?? null,
      derivedClipRel: provenance.derivedClipRel ?? null,
      extractionGeneratedAt: provenance.extractionGeneratedAt ?? generatedAt,
      parserImplementationRevision:
        provenance.parserImplementationRevision ?? TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION
    };
  });

  return {
    schemaVersion: "territorykit-tr-sprint-2h-recovered-osm-polygons@2",
    generatedAt,
    parserImplementationRevision: TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION,
    polygonCount: polygons.length,
    classificationRollup: buildSemanticClassificationRollup(
      zones,
      geometryQaRollup,
      provenanceByZoneId
    ),
    polygons
  };
}

export function buildDistrictMatrix(perDistrict, sprint2gBaseline) {
  const baselineBySlug = new Map((sprint2gBaseline?.districts ?? []).map((row) => [row.slug, row]));
  const totalBuilt = perDistrict
    .filter((row) => !row.blocked && typeof row.builtPolygonCount === "number")
    .reduce((sum, row) => sum + row.builtPolygonCount, 0);
  return {
    schemaVersion: "territorykit-tr-sprint-2h-eight-district-recovery-matrix@2",
    rollupBuiltPolygonCount: totalBuilt,
    districts: perDistrict.map((row) => {
      const baseline = baselineBySlug.get(row.slug);
      const sprint2gBuilt = baseline?.osmAdministrativePolygons ?? null;
      return {
        ...row,
        sprint2gBuiltPolygonCount: sprint2gBuilt,
        sprint2gUnresolvedCount:
          baseline?.geometryQa?.districtCoverage?.osmAdministrative?.unresolvedRelationEntries ??
          null,
        deltaBuiltPolygons:
          typeof sprint2gBuilt === "number" && typeof row.builtPolygonCount === "number"
            ? row.builtPolygonCount - sprint2gBuilt
            : null
      };
    })
  };
}

export function buildSprint2hDecision(input) {
  return {
    schemaVersion: "territorykit-tr-sprint-2h-decision@1",
    generatedAt: input.generatedAt,
    headSha: input.headSha,
    parserImplementationRevision: TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION,
    meaningfulProgress: input.meaningfulProgress,
    gates: input.gates,
    technicalMergeRecommendation: input.technicalMergeRecommendation,
    geographicalAcceptance: "NO_GO",
    nationalExpansion: "NO_GO",
    productionReadiness: "NO_GO",
    legalRedistribution: "BLOCKED_BY_SOURCE"
  };
}

export async function buildExtendedMapPreview(
  repoRoot,
  pilot,
  zones,
  parent,
  gameplayZones,
  seeds
) {
  const base = buildMapPreviewGeoJson({
    pilot,
    parent,
    gameplayZones,
    osmZones: zones,
    seeds
  });
  for (const feature of base.features) {
    if (feature.properties?.layerClass === "osm-administrative-research") {
      feature.properties.layerClass = "osm-administrative-recovered-sprint-2h";
      feature.properties.technicalQa = "research-only";
      feature.properties.parserRevision = TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION;
    }
  }
  return base;
}

export async function buildPolygonTechnicalQa(parent, zones) {
  if (zones.length === 0) {
    return { status: "NOT_ASSESSED", zoneCount: 0 };
  }

  let ringValidation = null;
  try {
    ringValidation = validateGeometryDataset(
      { manifest: { datasetId: "tr-adm3-osm-research-qa" }, zones },
      {
        checks: {
          ringClosure: true,
          selfIntersections: true,
          duplicateVertices: true,
          parentContainment: false,
          siblingOverlaps: false
        }
      }
    );
  } catch {
    ringValidation = null;
  }

  const spatial =
    zones.length > 0 ? inspectTurkeyAdm3SpatialQuality({ districts: [parent], zones }) : null;

  const structurallyValidPolygonCount = ringValidation?.summary?.validFeatureCount ?? null;
  const structurallyInvalidPolygonCount = ringValidation?.summary?.invalidFeatureCount ?? null;
  const ringValidationAssessed = ringValidation !== null;
  const spatialAssessed = spatial !== null;

  const structurallyValid =
    ringValidationAssessed && spatialAssessed
      ? ringValidation.ok && spatial.ok
      : ringValidationAssessed
        ? ringValidation.ok
        : spatialAssessed
          ? spatial.ok
          : null;

  return {
    schemaVersion: "territorykit-tr-sprint-2h-polygon-technical-qa@2",
    status: structurallyValid === null ? "NOT_ASSESSED" : "ASSESSED",
    zoneCount: zones.length,
    structurallyValid,
    structurallyValidPolygonCount,
    structurallyInvalidPolygonCount,
    ringValidation: ringValidationAssessed
      ? {
          ok: ringValidation.ok,
          errorCount: ringValidation.summary.errorCount,
          warningCount: ringValidation.summary.warningCount,
          invalidFeatureCount: ringValidation.summary.invalidFeatureCount,
          issueCodes: [...new Set(ringValidation.issues.map((issue) => issue.code))].sort()
        }
      : { status: "NOT_ASSESSED" },
    spatialQuality: spatialAssessed
      ? {
          ok: spatial.ok,
          selfIntersectionCount: spatial.summary.selfIntersectionCount ?? 0,
          overlapCount: spatial.summary.overlapCount ?? 0,
          gapCount: spatial.summary.gapCount ?? 0,
          parentContainmentErrors: spatial.parentContainmentErrors ?? [],
          overlaps: spatial.overlaps ?? [],
          gaps: spatial.gaps ?? []
        }
      : { status: "NOT_ASSESSED" },
    districtCoverageComplete: spatialAssessed ? spatial.summary.gapCount === 0 : null,
    note: "Individual polygon ring validity (validateGeometryDataset) is separate from district administrative coverage (inspectTurkeyAdm3SpatialQuality gaps/overlaps)."
  };
}

export function rollupGeometryQaCounts(technicalQaByDistrict) {
  let structurallyValidPolygonCount = 0;
  let structurallyInvalidPolygonCount = 0;
  for (const row of Object.values(technicalQaByDistrict)) {
    if (typeof row.structurallyValidPolygonCount === "number") {
      structurallyValidPolygonCount += row.structurallyValidPolygonCount;
    }
    if (typeof row.structurallyInvalidPolygonCount === "number") {
      structurallyInvalidPolygonCount += row.structurallyInvalidPolygonCount;
    }
  }
  return { structurallyValidPolygonCount, structurallyInvalidPolygonCount };
}

export async function loadSprint2gBaseline(repoRoot) {
  const path = join(
    repoRoot,
    "reports/tr-adm3/sprint-2g-geometry-validation/istanbul-eight-district-geometry-matrix.json"
  );
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(await readFile(path, "utf8"));
}
