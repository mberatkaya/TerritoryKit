/**
 * Sprint 2G — Istanbul mahalle geometry validation helpers (research-only).
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  collectGameplayAdm3Zones,
  computeGeometryBBox,
  computeSettlementIdentityGeometryHashSetSha256,
  computeSettlementIdentityZoneIdSetSha256,
  hashTerritoryGeometry
} from "../../packages/dataset/dist/index.mjs";
import {
  computeTurkeyAdm3GeometryAreaKm2,
  createTurkeyAdm3GeometryHash,
  createTurkeyAdm3OsmResearchSpatialCorrespondenceReport,
  extractTurkeyAdm3OsmPbf,
  inspectTurkeyAdm3SpatialQuality,
  inspectTurkeyGeneratedZonePathology,
  summarizeTurkeyAdm3OsmUnresolvedEntries,
  TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION
} from "../../packages/generators/dist/turkey-adm3.mjs";
import { ISTANBUL_SETTLEMENT_IDENTITY_PILOTS } from "./tr-mahalle-identity-istanbul-pilots.mjs";

export const SPRINT_2G_REPORT_ROOT = "reports/tr-adm3/sprint-2g-geometry-validation";

export const SPRINT_2G_DISTRICT_PRIORITY = [
  "kadikoy",
  "fatih",
  "uskudar",
  "adalar",
  "eyupsultan",
  "catalca",
  "basaksehir",
  "esenyurt"
];

const DEFAULT_RC8_ROOT =
  process.env.SPRINT_2G_RC8_ROOT ??
  ".territory/national-geometry-remediation/candidate-rc8-impl-rev1";
const DEFAULT_OSM_PBF =
  process.env.SPRINT_2G_OSM_PBF ?? ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/turkey.osm.pbf";
const DEFAULT_COUNTRY_SOURCE_LOCK =
  process.env.SPRINT_2G_COUNTRY_SOURCE_LOCK ??
  ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json";
const OSM_EXTRACT_CACHE =
  process.env.SPRINT_2G_OSM_EXTRACT_CACHE ??
  ".territory/sprint-2g/osm-administrative-extract-istanbul-pilots.json";
const OSM_EXTRACT_IMPLEMENTATION_REVISION = "territorykit-tr-sprint-2g-osm-extract@2";
const GEOMETRY_IMMUTABILITY_EVIDENCE =
  "reports/tr-adm3/sprint-2e-source-evidence/geometry-immutability-evidence.json";
const POLYGON_CLIP_PILOT_SLUGS = new Set(["fatih", "adalar"]);

const KADIKOY_PACKAGE_API =
  "https://acikveri.kadikoy.bel.tr/api/3/action/package_show?id=1f49bf03-cea5-40b9-9604-5f71c6f71e22";
const KADIKOY_SEARCH_API =
  "https://acikveri.kadikoy.bel.tr/api/3/action/package_search?q=mahalle&rows=20";

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
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

async function loadCountryPbfSourceLock(repoRoot) {
  const lockPath = join(repoRoot, DEFAULT_COUNTRY_SOURCE_LOCK);
  if (!existsSync(lockPath)) {
    return { blocked: true, missingArtifact: DEFAULT_COUNTRY_SOURCE_LOCK };
  }
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const pbfPath = join(repoRoot, DEFAULT_OSM_PBF);
  if (!existsSync(pbfPath)) {
    return { blocked: true, missingArtifact: DEFAULT_OSM_PBF };
  }
  const onDiskSha256 = await sha256File(pbfPath);
  if (lock.sha256 && lock.sha256 !== onDiskSha256) {
    return {
      blocked: true,
      reasonCode: "COUNTRY_PBF_SHA_MISMATCH",
      missingArtifact: null,
      expectedSha256: lock.sha256,
      observedSha256: onDiskSha256
    };
  }
  return {
    blocked: false,
    lock,
    lockPath: DEFAULT_COUNTRY_SOURCE_LOCK,
    pbfPath: DEFAULT_OSM_PBF,
    onDiskSha256,
    byteSize: statSync(pbfPath).size
  };
}

async function loadGeometryImmutabilityPins(repoRoot) {
  const path = join(repoRoot, GEOMETRY_IMMUTABILITY_EVIDENCE);
  if (!existsSync(path)) {
    return new Map();
  }
  const payload = JSON.parse(await readFile(path, "utf8"));
  return new Map(
    (payload.districts ?? []).map((row) => [
      String(row.district).toLocaleLowerCase("tr-TR").normalize("NFKC"),
      row
    ])
  );
}

function geometryToGeoJsonFeature(parent) {
  return {
    type: "Feature",
    properties: { parentAdm2Id: parent.id },
    geometry: parent.geometry
  };
}

function osmExtractCacheIsValid(cached, countryLock, districtParents) {
  if (cached.schemaVersion !== "territorykit-tr-sprint-2g-osm-admin-extract@2") {
    return false;
  }
  if (cached.extractImplementationRevision !== OSM_EXTRACT_IMPLEMENTATION_REVISION) {
    return false;
  }
  if (cached.osmParserImplementationRevision !== TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION) {
    return false;
  }
  if (cached.countryPbfSourceLock?.sha256 !== countryLock.sha256) {
    return false;
  }
  const expectedParents = districtParents
    .map((parent) => parent.id)
    .sort()
    .join("|");
  const cachedParents = (cached.districtParentIds ?? []).sort().join("|");
  return expectedParents === cachedParents;
}

function magicLabel(bytes) {
  if (!bytes || bytes.length < 4) {
    return "TOO_SHORT";
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x27 && bytes[3] === 0x0a) {
    return "ESRI_SHAPEFILE_MAIN";
  }
  if (bytes[0] === 0x03 && bytes[1] === 0x00 && bytes[2] === 0x00 && bytes[3] === 0x00) {
    return "ESRI_DBASE_III";
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return "ZIP_ARCHIVE";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x50) {
    return "GEOPACKAGE";
  }
  return `UNKNOWN_${bytes.slice(0, 4).toString("hex")}`;
}

async function probeUrl(url) {
  try {
    const response = await fetch(url, { method: "GET", redirect: "follow" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      url,
      httpStatus: response.status,
      contentType: response.headers.get("content-type"),
      byteSize: bytes.byteLength,
      sha256: sha256Hex(bytes),
      magic: magicLabel(bytes),
      ok: response.ok
    };
  } catch (error) {
    return {
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function probeKadikoyCkanAlternatives() {
  const alternatives = [];
  let search = null;
  try {
    const response = await fetch(KADIKOY_SEARCH_API);
    search = await response.json();
  } catch (error) {
    search = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const packages =
    search?.result?.results?.flatMap((pkg) =>
      (pkg.resources ?? []).map((resource) => ({
        packageId: pkg.id,
        packageTitle: pkg.title,
        resourceId: resource.id,
        name: resource.name,
        format: resource.format,
        url: resource.url
      }))
    ) ?? [];

  for (const resource of packages.slice(0, 12)) {
    if (!resource.url) {
      continue;
    }
    const probe = await probeUrl(resource.url);
    alternatives.push({
      ...resource,
      probe
    });
  }

  return {
    packageShowApi: KADIKOY_PACKAGE_API,
    searchApi: KADIKOY_SEARCH_API,
    searchResultCount: search?.result?.count ?? null,
    probedResourceCount: alternatives.length,
    distinctMagicLabels: [...new Set(alternatives.map((row) => row.probe.magic).filter(Boolean))],
    zipOrGpkgCandidates: alternatives.filter(
      (row) => row.probe.magic === "ZIP_ARCHIVE" || row.probe.magic === "GEOPACKAGE"
    ),
    validShapefileMainCandidates: alternatives.filter(
      (row) => row.probe.magic === "ESRI_SHAPEFILE_MAIN"
    ),
    identicalPayloadResources: alternatives.filter(
      (row, _, all) =>
        row.probe.sha256 &&
        all.filter((other) => other.probe.sha256 === row.probe.sha256).length > 1
    ),
    alternatives
  };
}

export function orderedIstanbulPilots() {
  return SPRINT_2G_DISTRICT_PRIORITY.map((slug) =>
    ISTANBUL_SETTLEMENT_IDENTITY_PILOTS.find((row) => row.slug === slug)
  ).filter(Boolean);
}

export async function loadRc8DistrictContext(repoRoot, pilot, rc8Root = DEFAULT_RC8_ROOT) {
  const parentAdm2Id = `tr:adm2:${pilot.adm2Suffix}`;
  const shardPath = join(
    repoRoot,
    rc8Root,
    "districts",
    `tr_adm2_${pilot.adm2Suffix}`,
    "dataset.json"
  );
  if (!existsSync(shardPath)) {
    return {
      blocked: true,
      reasonCode: "BLOCKED_BY_SOURCE",
      parentAdm2Id,
      missingArtifact: shardPath.replace(`${repoRoot}/`, "")
    };
  }

  const dataset = JSON.parse(await readFile(shardPath, "utf8"));
  const parent = dataset.zones.find((zone) => zone.level === 2 && zone.id === parentAdm2Id);
  const gameplayZones = collectGameplayAdm3Zones(dataset, parentAdm2Id);
  if (!parent) {
    throw new Error(`ADM2 parent missing in shard for ${pilot.district}`);
  }

  const geometryHashByZoneId = Object.fromEntries(
    gameplayZones.map((zone) => [zone.id, hashTerritoryGeometry(zone.geometry)])
  );
  const zoneIdSetSha256 = computeSettlementIdentityZoneIdSetSha256(
    gameplayZones.map((zone) => zone.id)
  );
  const geometryHashSetSha256 =
    computeSettlementIdentityGeometryHashSetSha256(geometryHashByZoneId);

  const immutabilityPins = await loadGeometryImmutabilityPins(repoRoot);
  const pin = immutabilityPins.get(pilot.district.toLocaleLowerCase("tr-TR").normalize("NFKC"));
  const pinMismatch =
    pin &&
    (pin.zoneIdSetSha256 !== zoneIdSetSha256 ||
      pin.geometryHashSetSha256 !== geometryHashSetSha256);

  return {
    blocked: Boolean(pinMismatch),
    ...(pinMismatch
      ? {
          reasonCode: "GEOMETRY_IMMUTABILITY_PIN_MISMATCH",
          expectedPins: {
            zoneIdSetSha256: pin.zoneIdSetSha256,
            geometryHashSetSha256: pin.geometryHashSetSha256
          },
          observedPins: { zoneIdSetSha256, geometryHashSetSha256 }
        }
      : {}),
    parentAdm2Id,
    parent,
    gameplayZones,
    geometryHashByZoneId,
    datasetVersion: dataset.manifest?.datasetVersion ?? "2.1.0-rc.8",
    zoneIdSetSha256,
    geometryHashSetSha256,
    shardPath: shardPath.replace(`${repoRoot}/`, ""),
    canonicalHashFunctions: {
      zoneIdSet: "computeSettlementIdentityZoneIdSetSha256",
      geometryHashSet: "computeSettlementIdentityGeometryHashSetSha256",
      perZoneGeometry: "hashTerritoryGeometry"
    }
  };
}

function pilotSlugForParent(parent) {
  const suffix = parent.id.replace(/^tr:adm2:/, "");
  return (
    ISTANBUL_SETTLEMENT_IDENTITY_PILOTS.find((row) => row.adm2Suffix === suffix)?.slug ?? suffix
  );
}

export async function loadOrExtractIstanbulOsmAdministrative(options) {
  const {
    repoRoot,
    generatedAt,
    districtParents,
    forceExtract = process.env.SPRINT_2G_FORCE_OSM_EXTRACT === "1"
  } = options;
  const cachePath = join(repoRoot, OSM_EXTRACT_CACHE);
  const country = await loadCountryPbfSourceLock(repoRoot);

  if (country.blocked) {
    return {
      blocked: true,
      reasonCode: "BLOCKED_BY_SOURCE",
      missingArtifact: country.missingArtifact ?? DEFAULT_COUNTRY_SOURCE_LOCK,
      fromCache: false
    };
  }

  const pbfPath = join(repoRoot, country.pbfPath);

  if (!forceExtract && existsSync(cachePath)) {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    if (osmExtractCacheIsValid(cached, country.lock, districtParents)) {
      return {
        ...cached,
        fromCache: true,
        cachePath: OSM_EXTRACT_CACHE,
        countryPbfSourceLock: cached.countryPbfSourceLock ?? country.lock
      };
    }
  }

  const perDistrictExtracts = [];
  const mergedZones = [];
  const mergedUnresolved = [];
  const mergedDuplicates = [];
  const seenOsmIds = new Set();
  const extractionComparisons = [];

  for (const parent of districtParents) {
    const slug = pilotSlugForParent(parent);
    const clip = await ensureDistrictOsmClip({
      repoRoot,
      sourcePbfPath: pbfPath,
      parent,
      slug,
      forceClip: forceExtract
    });
    if (!clip?.clipAbs) {
      continue;
    }

    const extract = await extractTurkeyAdm3OsmPbf({
      pbfPath: clip.clipAbs,
      generatedAt,
      providerId: "tr-adm3-osm-34-geofabrik-turkey",
      provinceCode: "34",
      districtZones: [parent]
    });

    perDistrictExtracts.push({
      parentAdm2Id: parent.id,
      slug,
      extractionMode: clip.mode,
      extractionCommand: clip.command,
      extractionStrategy: clip.strategy,
      parentAdm2GeometryHash: hashTerritoryGeometry(parent.geometry),
      derivedClip: {
        path: clip.clipRel,
        sha256: clip.sha256,
        byteSize: clip.byteSize
      },
      derivedInputSourceLock: extract.sourceLock,
      builtPolygonCount: extract.zones.length,
      unresolvedCount: extract.unresolved.length,
      unresolvedSummary: summarizeTurkeyAdm3OsmUnresolvedEntries(extract.unresolved)
    });

    if (POLYGON_CLIP_PILOT_SLUGS.has(slug)) {
      const bboxClip = await ensureDistrictOsmClip({
        repoRoot,
        sourcePbfPath: pbfPath,
        parent,
        slug,
        forceClip: forceExtract,
        modeOverride: "bbox-complete_ways"
      });
      if (bboxClip?.clipAbs) {
        const bboxExtract = await extractTurkeyAdm3OsmPbf({
          pbfPath: bboxClip.clipAbs,
          generatedAt,
          providerId: "tr-adm3-osm-34-geofabrik-turkey",
          provinceCode: "34",
          districtZones: [parent]
        });
        extractionComparisons.push({
          slug,
          parentAdm2Id: parent.id,
          polygonClip: {
            mode: clip.mode,
            builtPolygonCount: extract.zones.length,
            unresolvedCount: extract.unresolved.length,
            uniqueUnresolvedRelations: summarizeTurkeyAdm3OsmUnresolvedEntries(extract.unresolved)
              .uniqueUnresolvedRelationIds
          },
          bboxClip: {
            mode: bboxClip.mode,
            builtPolygonCount: bboxExtract.zones.length,
            unresolvedCount: bboxExtract.unresolved.length,
            uniqueUnresolvedRelations: summarizeTurkeyAdm3OsmUnresolvedEntries(
              bboxExtract.unresolved
            ).uniqueUnresolvedRelationIds
          }
        });
      }
    }

    for (const zone of extract.zones) {
      const territory = zone.properties?.territory ?? {};
      const nativeId = territory.sourceNativeId ?? zone.id;
      if (seenOsmIds.has(nativeId)) {
        continue;
      }
      seenOsmIds.add(nativeId);
      mergedZones.push(zone);
    }
    mergedUnresolved.push(...extract.unresolved);
    mergedDuplicates.push(...extract.duplicates);
  }

  if (perDistrictExtracts.length === 0) {
    return {
      blocked: true,
      reasonCode: "BLOCKED_BY_SOURCE",
      missingArtifact: "osmium-per-district-clip",
      fromCache: false
    };
  }

  const unresolvedSummary = summarizeTurkeyAdm3OsmUnresolvedEntries(mergedUnresolved);

  const payload = {
    schemaVersion: "territorykit-tr-sprint-2g-osm-admin-extract@2",
    generatedAt,
    extractImplementationRevision: OSM_EXTRACT_IMPLEMENTATION_REVISION,
    osmParserImplementationRevision: TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION,
    countryPbfSourceLock: {
      ...country.lock,
      lockPath: country.lockPath,
      pbfPath: country.pbfPath,
      onDiskSha256: country.onDiskSha256,
      byteSize: country.byteSize
    },
    districtParentIds: districtParents.map((parent) => parent.id),
    perDistrictExtracts,
    extractionComparisons,
    cachePath: OSM_EXTRACT_CACHE,
    zones: mergedZones,
    coverage: {
      schemaVersion: "territorykit-tr-adm3-osm-coverage@1",
      country: "TR",
      generatedAt,
      candidateCount: mergedZones.length + mergedUnresolved.length,
      builtPolygonCount: mergedZones.length,
      unresolvedCount: mergedUnresolved.length,
      duplicateCount: mergedDuplicates.length,
      unresolvedSummary
    },
    quality: {
      schemaVersion: "territorykit-tr-sprint-2g-osm-quality-rollup@2",
      generatedAt,
      perDistrictExtracts,
      unresolvedSummary
    },
    unresolved: mergedUnresolved,
    duplicates: mergedDuplicates
  };

  await mkdir(join(repoRoot, ".territory/sprint-2g"), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return { ...payload, fromCache: false, blocked: false };
}

async function ensureDistrictOsmClip({
  repoRoot,
  sourcePbfPath,
  parent,
  slug,
  forceClip,
  modeOverride
}) {
  const suffix = parent.id.replace(/^tr:adm2:/, "");
  const usePolygon =
    modeOverride === "bbox-complete_ways"
      ? false
      : POLYGON_CLIP_PILOT_SLUGS.has(slug) && modeOverride !== "bbox-complete_ways";
  const mode = usePolygon ? "polygon-complete_ways" : "bbox-complete_ways";
  const clipRel = usePolygon
    ? `.territory/sprint-2g/osm-clip-poly-${suffix}.osm.pbf`
    : `.territory/sprint-2g/osm-clip-bbox-${suffix}.osm.pbf`;
  const clipAbs = join(repoRoot, clipRel);
  const polyGeojsonRel = `.territory/sprint-2g/osm-clip-poly-${suffix}.geojson`;
  const polyGeojsonAbs = join(repoRoot, polyGeojsonRel);
  await mkdir(join(repoRoot, ".territory/sprint-2g"), { recursive: true });

  if (!forceClip && existsSync(clipAbs)) {
    return {
      clipAbs,
      clipRel,
      mode,
      strategy: "complete_ways",
      command: "cached",
      sha256: await sha256File(clipAbs),
      byteSize: statSync(clipAbs).size
    };
  }

  let command;
  try {
    if (usePolygon) {
      await writeFile(
        polyGeojsonAbs,
        `${JSON.stringify(geometryToGeoJsonFeature(parent), null, 2)}\n`,
        "utf8"
      );
      command = `osmium extract -p "${polyGeojsonAbs}" "${sourcePbfPath}" -o "${clipAbs}" --overwrite -s complete_ways`;
      execSync(command, { stdio: "pipe" });
    } else {
      const bbox = computeGeometryBBox(parent.geometry);
      const pad = 0.025;
      const bboxArg = [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad]
        .map((value) => value.toFixed(6))
        .join(",");
      command = `osmium extract -b ${bboxArg} "${sourcePbfPath}" -o "${clipAbs}" --overwrite -s complete_ways`;
      execSync(command, { stdio: "pipe" });
    }
  } catch {
    return null;
  }

  return {
    clipAbs,
    clipRel,
    mode,
    strategy: "complete_ways",
    command,
    sha256: await sha256File(clipAbs),
    byteSize: statSync(clipAbs).size
  };
}

export function osmZonesForParent(osmExtract, parentAdm2Id) {
  return (osmExtract.zones ?? []).filter((zone) => zone.parentId === parentAdm2Id);
}

export function metricVerdict(pass) {
  return pass ? "PASS" : "FAIL";
}

export function assessDistrictGeometryQa({
  parent,
  gameplayZones,
  osmZones,
  osmUnresolvedForDistrict = []
}) {
  const gameplayPolygonTechnical = inspectTurkeyAdm3SpatialQuality({
    districts: [parent],
    zones: gameplayZones
  });
  const osmPolygonTechnical =
    osmZones.length > 0
      ? inspectTurkeyAdm3SpatialQuality({
          districts: [parent],
          zones: osmZones
        })
      : null;

  const gameplayPathology = inspectTurkeyGeneratedZonePathology({
    zones: gameplayZones
  });

  const defaultParentOutsideToleranceKm2 = 0.000001;
  const parentContainmentErrors = gameplayPolygonTechnical.parentContainmentErrors.map((row) => ({
    zoneId: row.zoneId,
    outsideAreaKm2: row.outsideAreaKm2,
    outsideAreaM2: typeof row.outsideAreaKm2 === "number" ? row.outsideAreaKm2 * 1_000_000 : null,
    defaultToleranceKm2: defaultParentOutsideToleranceKm2,
    defaultToleranceM2: defaultParentOutsideToleranceKm2 * 1_000_000,
    exceedsDefaultTolerance:
      typeof row.outsideAreaKm2 === "number" &&
      row.outsideAreaKm2 > defaultParentOutsideToleranceKm2
  }));
  const parentContainmentExceedsTolerance = parentContainmentErrors.some(
    (row) => row.exceedsDefaultTolerance
  );
  const parentContainmentNote =
    parentContainmentErrors.length > 0
      ? {
          classification: parentContainmentExceedsTolerance
            ? "parent-containment-exceeds-default-tolerance"
            : "within-default-parent-outside-tolerance",
          defaultToleranceKm2: defaultParentOutsideToleranceKm2,
          unitNote: "Areas are square kilometres (km²); 0.000001 km² = 1 m².",
          structurallyValidParentContainment: !parentContainmentExceedsTolerance,
          errors: parentContainmentErrors,
          note: parentContainmentExceedsTolerance
            ? "Outside-parent area exceeds the default inspectTurkeyAdm3SpatialQuality tolerance; report as QA failure without mutating pinned rc.8 geometry."
            : "Outside-parent area within default tolerance; may reflect floating-point/CRS precision on immutable rc.8 gameplay."
        }
      : null;
  const gameplayStructurallyValid =
    gameplayPolygonTechnical.ok && !parentContainmentExceedsTolerance;

  const gameplayCoverage = assessDistrictAdministrativeCoverage({
    parent,
    zones: gameplayZones,
    layerLabel: "rc8-gameplay",
    treatAsCompleteInventory: true
  });
  const osmCoverage = assessDistrictAdministrativeCoverage({
    parent,
    zones: osmZones,
    layerLabel: "osm-administrative-research",
    treatAsCompleteInventory: false,
    unresolvedCount: osmUnresolvedForDistrict.length
  });

  return {
    polygonTechnicalQa: {
      gameplay: {
        spatialQuality: gameplayPolygonTechnical,
        pathology: gameplayPathology,
        zoneCount: gameplayZones.length,
        structurallyValid: gameplayStructurallyValid,
        parentContainmentNote,
        evidencePath: "inspectTurkeyAdm3SpatialQuality(gameplay)"
      },
      osmAdministrative: osmPolygonTechnical
        ? {
            spatialQuality: osmPolygonTechnical,
            zoneCount: osmZones.length,
            structurallyValid: osmPolygonTechnical.ok,
            evidencePath: "inspectTurkeyAdm3SpatialQuality(osm-administrative)"
          }
        : {
            zoneCount: 0,
            structurallyValid: null,
            status: "NOT_ASSESSED",
            evidencePath: null
          }
    },
    districtCoverageQa: {
      gameplay: gameplayCoverage,
      osmAdministrative: osmCoverage
    },
    gameplay: {
      spatialQuality: gameplayPolygonTechnical,
      pathology: gameplayPathology,
      zoneCount: gameplayZones.length,
      evidencePath: "inspectTurkeyAdm3SpatialQuality(gameplay)"
    },
    osmAdministrative: osmPolygonTechnical
      ? {
          spatialQuality: osmPolygonTechnical,
          zoneCount: osmZones.length,
          polygonFeatureCount: osmZones.length,
          evidencePath: "inspectTurkeyAdm3SpatialQuality(osm-administrative)"
        }
      : {
          zoneCount: 0,
          polygonFeatureCount: 0,
          status: "NOT_ASSESSED",
          evidencePath: null
        }
  };
}

function assessDistrictAdministrativeCoverage({
  parent,
  zones,
  layerLabel,
  treatAsCompleteInventory,
  unresolvedCount = 0
}) {
  const spatial =
    zones.length > 0
      ? inspectTurkeyAdm3SpatialQuality({
          districts: [parent],
          zones
        })
      : null;
  const parentAreaKm2 = computeTurkeyAdm3GeometryAreaKm2(parent.geometry);
  const coveredAreaKm2 = zones.reduce(
    (total, zone) => total + computeTurkeyAdm3GeometryAreaKm2(zone.geometry),
    0
  );
  const gapAreaKm2 = spatial?.gaps?.[0]?.areaKm2 ?? null;

  return {
    layerLabel,
    zoneCount: zones.length,
    unresolvedRelationEntries: unresolvedCount,
    districtCoverageComplete:
      treatAsCompleteInventory && unresolvedCount === 0 && (spatial?.summary.gapCount ?? 0) === 0,
    administrativeInventoryComplete: treatAsCompleteInventory,
    parentAreaKm2,
    summedZoneAreaKm2: round4(coveredAreaKm2),
    uncoveredParentAreaKm2: gapAreaKm2,
    gapCount: spatial?.summary.gapCount ?? null,
    overlapCount: spatial?.summary.overlapCount ?? null,
    note: treatAsCompleteInventory
      ? "Pinned rc.8 gameplay shard is the authoritative district inventory for Sprint 2 acceptance."
      : "Partial OSM extract; gaps/overlaps reflect incomplete relation inventory, not necessarily invalid individual polygons."
  };
}

export function summarizeIdentitySeedMetrics(identityMetrics) {
  if (!identityMetrics) {
    return { status: "NOT_ASSESSED" };
  }
  const seededZones = identityMetrics.singleSeedZoneCount + identityMetrics.ambiguousZoneCount;
  const seedCoverageRatio =
    identityMetrics.zoneCount > 0 ? round4(seededZones / identityMetrics.zoneCount) : null;
  return {
    status: "ASSESSED",
    zoneCount: identityMetrics.zoneCount,
    settlementCount: identityMetrics.settlementCount,
    seededZoneCount: seededZones,
    unseededZoneCount: identityMetrics.unseededZoneCount,
    ambiguousZoneCount: identityMetrics.ambiguousZoneCount,
    seedCoverageRatio,
    evidencePath: "settlement-identity-layer-metrics"
  };
}

function round4(value) {
  return Math.round(value * 10_000) / 10_000;
}

export function buildGameplayOverlayReport({ generatedAt, gameplayZones, osmZones }) {
  const research = createTurkeyAdm3OsmResearchSpatialCorrespondenceReport({
    generatedAt,
    gameplayZones,
    osmCandidateZones: osmZones
  });

  if (research.status === "NOT_ASSESSED") {
    return {
      schemaVersion: "territorykit-tr-sprint-2g-gameplay-overlay@2",
      generatedAt,
      status: "NOT_ASSESSED",
      reason: "no-osm-administrative-polygons-for-parent",
      ownershipMigrationPerformed: false,
      eligibleForMigration: false,
      researchCorrespondenceSchema: research.schemaVersion
    };
  }

  const mappedGameplay = new Set(research.correspondences.map((row) => row.gameplayZoneId));
  const orphanGameplay = gameplayZones
    .filter((zone) => !mappedGameplay.has(zone.id))
    .map((zone) => zone.id);
  const mappedOsm = new Set(research.correspondences.map((row) => row.osmCandidateId));
  const orphanOsm = osmZones.filter((zone) => !mappedOsm.has(zone.id)).map((zone) => zone.id);

  const oneToMany = research.correspondences.reduce((acc, row) => {
    acc[row.osmCandidateId] = (acc[row.osmCandidateId] ?? 0) + 1;
    return acc;
  }, {});
  const mergeCandidates = Object.entries(oneToMany).filter(([, count]) => count > 1);

  return {
    schemaVersion: "territorykit-tr-sprint-2g-gameplay-overlay@2",
    generatedAt,
    status: "ASSESSED",
    researchCorrespondenceSchema: research.schemaVersion,
    correspondences: research.correspondences,
    correspondence: {
      gameplayZoneCount: gameplayZones.length,
      osmPolygonCount: osmZones.length,
      mappedGameplayCount: mappedGameplay.size,
      orphanGameplayZoneIds: orphanGameplay,
      orphanOsmPolygonIds: orphanOsm,
      manyToOneMergeCandidates: mergeCandidates.map(([osmCandidateId, gameplayCount]) => ({
        osmCandidateId,
        gameplayZoneCount: gameplayCount
      }))
    },
    stableIdMappingFeasibility:
      orphanGameplay.length === 0 && mergeCandidates.length === 0
        ? "ONE_TO_ONE_POSSIBLE_WITH_REVIEW"
        : "REQUIRES_SPLIT_MERGE_MAP",
    ownershipMigrationPerformed: false,
    eligibleForMigration: false,
    reviewRequired: true,
    evidencePath: "createTurkeyAdm3OsmResearchSpatialCorrespondenceReport"
  };
}

export function osmUnresolvedForParent(osmExtract, parentAdm2Id) {
  return (osmExtract.unresolved ?? []).filter((entry) => {
    if (entry.parentId === parentAdm2Id) {
      return true;
    }
    return false;
  });
}

export function classifyDistrictOutcome({
  pilot,
  kadikoyBlocked,
  osmPolygonCount,
  officialVerified,
  experimentalImproved
}) {
  if (pilot.slug === "kadikoy" || pilot.officialDataPolicy?.status === "BLOCKED_BY_SOURCE") {
    if (kadikoyBlocked) {
      return "BLOCKED_BY_SOURCE";
    }
  }
  if (officialVerified) {
    return "REAL_POLYGON_CANDIDATE";
  }
  if (experimentalImproved) {
    return "ESTIMATED_IMPROVED";
  }
  if (osmPolygonCount > 0) {
    return "VERIFIED_OSM_CANDIDATE";
  }
  return "BASELINE_PRESERVED";
}

export function buildMapPreviewGeoJson({ pilot, parent, gameplayZones, osmZones, seeds }) {
  const features = [];

  features.push({
    type: "Feature",
    properties: {
      layerClass: "rc8-gameplay",
      sourceClass: "smart-derived",
      polygonId: parent.id,
      settlementIdentity: null,
      parentAdm2: pilot.district,
      confidence: "gameplay-immutable",
      licenseStatus: "mixed-rc8",
      sourceSnapshot: "2.1.0-rc.8",
      geometryHash: hashTerritoryGeometry(parent.geometry)
    },
    geometry: parent.geometry
  });

  for (const zone of gameplayZones) {
    features.push({
      type: "Feature",
      properties: {
        layerClass: "rc8-gameplay",
        sourceClass: zone.properties?.territory?.sourceClass ?? "estimated",
        polygonId: zone.id,
        settlementIdentity: zone.name,
        parentAdm2: pilot.district,
        confidence: zone.properties?.territory?.confidence ?? "medium",
        licenseStatus: "rc8-pinned",
        sourceSnapshot: "2.1.0-rc.8",
        geometryHash: hashTerritoryGeometry(zone.geometry)
      },
      geometry: zone.geometry
    });
  }

  for (const zone of osmZones) {
    const territory = zone.properties?.territory ?? {};
    features.push({
      type: "Feature",
      properties: {
        layerClass: "osm-administrative",
        sourceClass: "osm-administrative",
        polygonId: zone.id,
        settlementIdentity: zone.name,
        parentAdm2: pilot.district,
        confidence: territory.parentConfidence ?? "medium",
        licenseStatus: "ODbL-pending-redistribution",
        sourceSnapshot: territory.sourceNativeId ?? `osm:${territory.osmType}:${territory.osmId}`,
        geometryHash: createTurkeyAdm3GeometryHash(zone.geometry)
      },
      geometry: zone.geometry
    });
  }

  for (const seed of seeds ?? []) {
    features.push({
      type: "Feature",
      properties: {
        layerClass: "settlement-seed",
        sourceClass: "osm-place-node",
        polygonId: seed.id ?? seed.osmId,
        settlementIdentity: seed.name,
        parentAdm2: pilot.district,
        confidence: "seed-only",
        licenseStatus: "not-administrative-polygon",
        sourceSnapshot: seed.sourceNativeId ?? null,
        geometryHash: null
      },
      geometry: {
        type: "Point",
        coordinates: seed.seedCoordinate ?? seed.coordinate ?? seed.lngLat ?? [seed.lon, seed.lat]
      }
    });
  }

  return {
    type: "FeatureCollection",
    schemaVersion: "territorykit-tr-sprint-2g-map-preview@1",
    district: pilot.district,
    slug: pilot.slug,
    features
  };
}

export async function loadFatihHistoricalReferences(repoRoot) {
  const paths = [
    "reports/tr-adm3/mahalle-first-program/fatih-v1-v2-comparison.json",
    "reports/tr-adm3/mahalle-first-program/fatih-v2-impl-rev2-comparison.json",
    "reports/tr-adm3/mahalle-first-program/fatih-hybrid-rev4-comparison.json"
  ];
  const loaded = {};
  for (const relative of paths) {
    const abs = join(repoRoot, relative);
    if (existsSync(abs)) {
      loaded[relative] = JSON.parse(await readFile(abs, "utf8"));
    }
  }
  return loaded;
}

export function buildFatihAlternativeMatrix(historical, osmQa, gameplayQa) {
  const v17 =
    historical["reports/tr-adm3/mahalle-first-program/fatih-v1-v2-comparison.json"]?.v17Replay;
  const v2 =
    historical["reports/tr-adm3/mahalle-first-program/fatih-v2-impl-rev2-comparison.json"]
      ?.implRev3 ??
    historical["reports/tr-adm3/mahalle-first-program/fatih-v1-v2-comparison.json"]?.v2Pilot;
  const hybrid =
    historical["reports/tr-adm3/mahalle-first-program/fatih-hybrid-rev4-comparison.json"]
      ?.implRev4Hybrid;

  const alternatives = [
    {
      id: "A-real-administrative-polygon",
      label: "Official administrative polygon",
      quality: "NOT_AVAILABLE",
      sourceEvidence: "NO_VERIFIED_OFFICIAL_PACKAGE",
      legalEligibility: "BLOCKED_BY_SOURCE",
      migrationImpact: "NOT_ASSESSED",
      decision: "BLOCKED_BY_SOURCE"
    },
    {
      id: "B-reviewed-osm-administrative",
      label: "Reviewed OSM administrative polygon",
      quality: osmQa?.osmAdministrative?.spatialQuality?.ok ? "TECHNICAL_PASS" : "TECHNICAL_REVIEW",
      sourceEvidence: `osmPolygonCount=${osmQa?.osmAdministrative?.zoneCount ?? 0}`,
      geometryDifference: "independent-osm-layer-not-gameplay",
      semanticAccuracy: "REVIEW_REQUIRED",
      legalEligibility: "ODbL-identified-redistribution-pending",
      migrationImpact: "overlay-analysis-required",
      decision: (osmQa?.osmAdministrative?.zoneCount ?? 0) > 0 ? "GO_WITH_REVIEW" : "NO_GO"
    },
    {
      id: "C-improved-smart-derived",
      label: "Improved estimated smart-derived (v2/hybrid)",
      quality: "NO_GO",
      sourceEvidence: "Sprint-2B.4-historical-NO-GO",
      geometryDifference: hybrid
        ? {
            v17WeightedBarrierAlignment: v17?.quality?.meanBarrierAlignment,
            v2WeightedBarrierAlignment: v2?.quality?.meanBarrierAlignment,
            hybridWeightedBarrierAlignment: hybrid?.weightedInternalBarrierAlignment,
            v17SeedCoverage: v17?.seedCoverageRatio,
            v2SeedCoverage: v2?.seedCoverageRatio,
            hybridSeedCoverage: hybrid?.seedCoverageRatio
          }
        : null,
      semanticAccuracy: "seed-association-improved-barrier-alignment-regressed",
      legalEligibility: "estimated-internal",
      migrationImpact: "high-zone-count-drift",
      decision: "NO_GO"
    },
    {
      id: "D-preserve-rc8",
      label: "Preserve rc.8 gameplay + semantic layer",
      quality: gameplayQa?.gameplay?.spatialQuality?.ok
        ? "BASELINE_STABLE"
        : "BASELINE_WITH_KNOWN_ISSUES",
      sourceEvidence: "pinned-rc8",
      geometryDifference: "immutable",
      semanticAccuracy: "identity-layer-pilot",
      legalEligibility: "existing-mixed-rc8",
      migrationImpact: "none",
      decision: "GO_WITH_REVIEW"
    }
  ];

  return {
    historicalReferenceOnly: true,
    note: "v1.7/v2/hybrid metrics are historical replay artifacts; do not treat as re-measured in Sprint 2G without identical inputs.",
    sprint2bDecision: "NO_GO",
    alternatives,
    selectedForGameplay: "D-preserve-rc8",
    selectedForBoundaryResearch:
      alternatives.find((row) => row.id === "B-reviewed-osm-administrative")?.decision ===
      "GO_WITH_REVIEW"
        ? "B-reviewed-osm-administrative"
        : "none"
  };
}

export function buildAcceptanceGates({
  officialVerifiedCount,
  osmVerifiedDistrictCount,
  osmPolygonCount,
  osmTechnicalPassCount,
  kadikoyStatus,
  overlayAssessed,
  geographicalGo
}) {
  const gateB =
    osmPolygonCount > 0 ? (osmTechnicalPassCount > 0 ? "GO_WITH_REVIEW" : "NO_GO") : "NOT_ASSESSED";

  return {
    gateA_sourceDiscovery:
      osmVerifiedDistrictCount > 0 || kadikoyStatus === "BLOCKED_BY_SOURCE"
        ? "GO_WITH_REVIEW"
        : "NO_GO",
    gateB_technicalPolygonQa: gateB,
    gateC_geographicalQuality: geographicalGo ? "GO_WITH_REVIEW" : "NO_GO",
    gateD_sourceLegalEligibility:
      officialVerifiedCount > 0 ? "GO_WITH_REVIEW" : "BLOCKED_BY_SOURCE",
    gateE_gameplayMigrationReadiness: overlayAssessed ? "GO_WITH_REVIEW" : "NOT_ASSESSED",
    gateF_productionReadiness: "NO_GO"
  };
}
