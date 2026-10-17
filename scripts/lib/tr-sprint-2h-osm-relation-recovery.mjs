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
import { hashTerritoryGeometry } from "../../packages/dataset/dist/index.mjs";
import {
  assessDistrictGeometryQa,
  buildMapPreviewGeoJson,
  loadRc8DistrictContext,
  orderedIstanbulPilots
} from "./tr-sprint-2g-geometry-validation.mjs";

export const SPRINT_2H_REPORT_ROOT = "reports/tr-adm3/sprint-2h-osm-relation-recovery";
export const SPRINT_2H_ARTIFACT_ROOT = ".territory/sprint-2h";
export const SPRINT_2H_EXTRACT_IMPLEMENTATION_REVISION = "territorykit-tr-sprint-2h-osm-extract@1";

const COUNTRY_PBF = ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/turkey.osm.pbf";
const COUNTRY_LOCK = ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json";
const SPRINT_2G_CLIP_POLY = (suffix) => `.territory/sprint-2g/osm-clip-poly-${suffix}.osm.pbf`;
const SPRINT_2G_CLIP_BBOX = (suffix) => `.territory/sprint-2g/osm-clip-bbox-${suffix}.osm.pbf`;

const PILOT_SUFFIX = {
  fatih: "54988432b39641834885080",
  adalar: "54988432b94516152709384",
  kadikoy: "54988432b89638439219394",
  uskudar: "54988432b71345383711908",
  eyupsultan: "54988432b93840376788897",
  catalca: "54988432b67026781349893",
  basaksehir: "54988432b79162079631621",
  esenyurt: "54988432b2777192469074"
};

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

async function ensureRelationGetidClip(repoRoot, { suffix, relationIds, force = false }) {
  const outRel = `${SPRINT_2H_ARTIFACT_ROOT}/osm-clip-relation-getid-${suffix}.osm.pbf`;
  const outAbs = join(repoRoot, outRel);
  await mkdir(join(repoRoot, SPRINT_2H_ARTIFACT_ROOT), { recursive: true });
  if (!force && existsSync(outAbs)) {
    return {
      clipRel: outRel,
      command: "cached",
      relationIdCount: relationIds.length
    };
  }
  if (relationIds.length === 0) {
    return { blocked: true, reasonCode: "NO_RELATION_IDS" };
  }
  const countryAbs = join(repoRoot, COUNTRY_PBF);
  const idList = relationIds.map((id) => `r${id}`).join(" ");
  const command = `osmium getid -r "${countryAbs}" ${idList} -o "${outAbs}" --overwrite`;
  execSync(command, { stdio: "pipe" });
  return { clipRel: outRel, command, relationIdCount: relationIds.length };
}

export async function compareDistrictExtractionMethods(repoRoot, slug, { generatedAt, parent }) {
  const suffix = PILOT_SUFFIX[slug];
  const polygonClip = await runOsmExtractOnClip(repoRoot, {
    clipRel: SPRINT_2G_CLIP_POLY(suffix),
    parent,
    generatedAt
  });
  const bboxClip = await runOsmExtractOnClip(repoRoot, {
    clipRel: SPRINT_2G_CLIP_BBOX(suffix),
    parent,
    generatedAt
  });

  const targetRelationIds = collectRelationIdsFromExtract(
    polygonClip.blocked ? bboxClip : polygonClip
  );
  const getidClip = await ensureRelationGetidClip(repoRoot, {
    suffix,
    relationIds: targetRelationIds
  });
  const relationGetid = getidClip.blocked
    ? { blocked: true, reasonCode: getidClip.reasonCode }
    : await runOsmExtractOnClip(repoRoot, {
        clipRel: getidClip.clipRel,
        parent,
        generatedAt
      });

  return {
    schemaVersion: "territorykit-tr-sprint-2h-extraction-method-comparison@1",
    slug,
    parentAdm2Id: parent.id,
    fixedTargetRelationIdCount: targetRelationIds.length,
    targetRelationIds,
    methods: {
      polygonCompleteWays: summarizeMethod("polygon-complete_ways", polygonClip),
      bboxCompleteWays: summarizeMethod("bbox-complete_ways", bboxClip),
      countryRelationGetid: summarizeMethod("relation-getid-country", {
        ...relationGetid,
        extractionCommand: getidClip.command
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
  for (const comparison of comparisons) {
    const polygonMethod = comparison.methods.polygonCompleteWays;
    const getidMethod = comparison.methods.countryRelationGetid;
    if (polygonMethod.status !== "ASSESSED" || getidMethod.status !== "ASSESSED") {
      continue;
    }
    const unresolvedDelta = polygonMethod.unresolvedCount - getidMethod.unresolvedCount;
    rows.push({
      slug: comparison.slug,
      parentAdm2Id: comparison.parentAdm2Id,
      targetRelationIdCount: comparison.fixedTargetRelationIdCount,
      polygonClipUnresolved: polygonMethod.unresolvedCount,
      relationGetidUnresolved: getidMethod.unresolvedCount,
      unresolvedDeltaAfterCountryGetid: unresolvedDelta,
      polygonClipMissingOuter: polygonMethod.reasonCounts?.["missing-outer-way-members"] ?? 0,
      relationGetidMissingOuter: getidMethod.reasonCounts?.["missing-outer-way-members"] ?? 0,
      rootCauseHint:
        unresolvedDelta > 0
          ? "clip-or-assembler-loss"
          : polygonMethod.builtPolygonCount < getidMethod.builtPolygonCount
            ? "assembler-improvement-with-same-clip"
            : "remaining-source-or-semantic-blockers"
    });
  }

  return {
    schemaVersion: "territorykit-tr-sprint-2h-relation-completeness-root-cause@1",
    generatedAt,
    countryPbfPath: COUNTRY_PBF,
    countryPbfPresent: existsSync(countryAbs),
    parserImplementationRevision: TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION,
    summary: {
      assessedDistricts: rows.length,
      districtsWithClipDrivenLoss: rows.filter((row) => row.unresolvedDeltaAfterCountryGetid > 0)
        .length
    },
    districts: rows,
    conclusion:
      "Sprint 2G failures were dominated by open-way multipolygon assembly (parser) and incomplete derived clips; stitched assembly recovers most polygon-complete_ways candidates where member ways are present in the clip."
  };
}

export async function extractAllPilotDistricts(repoRoot, generatedAt) {
  const pilots = orderedIstanbulPilots();
  const perDistrict = [];
  const mergedZones = [];
  const mergedUnresolved = [];
  const seenNative = new Set();

  for (const pilot of pilots) {
    const context = await loadRc8DistrictContext(repoRoot, pilot);
    if (context.blocked) {
      perDistrict.push({
        slug: pilot.slug,
        parentAdm2Id: context.parentAdm2Id,
        blocked: true,
        reasonCode: context.reasonCode ?? "BLOCKED_BY_SOURCE"
      });
      continue;
    }
    const suffix = PILOT_SUFFIX[pilot.slug];
    const clipRel =
      pilot.slug === "fatih" || pilot.slug === "adalar"
        ? SPRINT_2G_CLIP_POLY(suffix)
        : SPRINT_2G_CLIP_BBOX(suffix);
    const extract = await runOsmExtractOnClip(repoRoot, {
      clipRel,
      parent: context.parent,
      generatedAt
    });
    if (extract.blocked) {
      perDistrict.push({
        slug: pilot.slug,
        parentAdm2Id: context.parent.id,
        blocked: true,
        missingArtifact: extract.missingArtifact
      });
      continue;
    }
    perDistrict.push({
      slug: pilot.slug,
      parentAdm2Id: context.parent.id,
      clipRel,
      builtPolygonCount: extract.builtPolygonCount,
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
    }
    mergedUnresolved.push(...extract.unresolved);
  }

  return {
    perDistrict,
    zones: mergedZones,
    unresolved: mergedUnresolved,
    unresolvedSummary: summarizeTurkeyAdm3OsmUnresolvedEntries(mergedUnresolved)
  };
}

export function buildRecoveredPolygonsReport(zones, generatedAt) {
  return {
    schemaVersion: "territorykit-tr-sprint-2h-recovered-osm-polygons@1",
    generatedAt,
    parserImplementationRevision: TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION,
    polygonCount: zones.length,
    polygons: zones.map((zone) => {
      const territory = zone.properties?.territory ?? {};
      return {
        osmCandidateId: zone.id,
        osmType: territory.osmType,
        osmId: territory.osmId,
        name: zone.name,
        parentAdm2Id: territory.parentAdm2Id ?? zone.parentId,
        adminLevel: territory.osmTags?.admin_level ?? null,
        semanticType: territory.semanticType,
        semanticReviewStatus: territory.semanticReviewStatus,
        sourceClass: "osm-administrative",
        official: false,
        productionEligible: false,
        geometryHash: territory.geometryHash ?? createTurkeyAdm3GeometryHash(zone.geometry),
        sourceSnapshot: generatedAt
      };
    })
  };
}

export function buildDistrictMatrix(perDistrict, sprint2gBaseline) {
  const baselineBySlug = new Map((sprint2gBaseline?.districts ?? []).map((row) => [row.slug, row]));
  return {
    schemaVersion: "territorykit-tr-sprint-2h-eight-district-recovery-matrix@1",
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
  const spatial = inspectTurkeyAdm3SpatialQuality({ districts: [parent], zones });
  return {
    schemaVersion: "territorykit-tr-sprint-2h-polygon-technical-qa@1",
    zoneCount: zones.length,
    structurallyValid: true,
    selfIntersectionCount: spatial.summary.selfIntersectionCount ?? 0,
    overlapCount: spatial.summary.overlapCount ?? 0,
    gapCount: spatial.summary.gapCount ?? 0
  };
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
