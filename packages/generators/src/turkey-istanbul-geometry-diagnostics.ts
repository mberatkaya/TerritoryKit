import { geometryToPolygons, hasRingSelfIntersection } from "@territory-kit/dataset";
import type { LngLat, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import * as polygonClipping from "polygon-clipping";
import type { MultiPolygon as ClippingMultiPolygon } from "polygon-clipping";
import {
  clippingMultiPolygonToTerritoryGeometry,
  computeTurkeyAdm3GeometryAreaKm2,
  geometryToClippingMultiPolygon
} from "./turkey-adm3-full-coverage.js";
import type { TurkeyOrganicRoutingDiagnostics } from "./turkey-organic-routing.js";
import type { TurkeyNetworkConstructionDiagnostics } from "./turkey-smart-fallback.js";
import type { TurkeySmartFallbackBarrier } from "./turkey-smart-fallback.js";
import { isTurkeyGeneratedGameplayZone } from "./turkey-generated-zone-pathology.js";

export const TURKEY_ISTANBUL_GEOMETRY_DIAGNOSTICS_SCHEMA_VERSION =
  "territorykit-tr-adm3-istanbul-geometry-diagnostics@1";

const CLIPPER = polygonClipping;

export type TurkeySpatialAssessmentStatus =
  "NOT_ASSESSED" | "ASSESSED_CLEAR" | "VERIFIED_FINDING" | "SUSPECTED";

type IntersectionAreaResult =
  { status: "ok"; areaKm2: number } | { status: "failed"; reason: string };

function territoryGeometryClipConversionFailed(geometry: TerritoryGeometry): boolean {
  if (geometryToClippingMultiPolygon(geometry).length > 0) {
    return false;
  }
  for (const polygon of geometryToPolygons(geometry)) {
    const shell = polygon[0];
    if (shell && shell.length >= 3) {
      return true;
    }
  }
  return false;
}

function ringIsClosed(ring: LngLat[]): boolean {
  if (ring.length < 3) {
    return false;
  }
  const first = ring[0]!;
  const last = ring.at(-1)!;
  return first[0] === last[0] && first[1] === last[1];
}

function firstTagValue(value: string | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}

function featureTags(properties: GeoJsonProperties): Record<string, string> {
  if (!properties || typeof properties !== "object") {
    return {};
  }
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null) {
      continue;
    }
    tags[key] = String(value);
  }
  return tags;
}

function isWaterwayLineTags(tags: Record<string, string>): boolean {
  return firstTagValue(tags.waterway) !== undefined;
}

function isWaterAreaPolygonTags(tags: Record<string, string>): boolean {
  if (isWaterwayLineTags(tags)) {
    return false;
  }
  if (firstTagValue(tags.natural) === "coastline") {
    return false;
  }
  const natural = firstTagValue(tags.natural);
  const water = firstTagValue(tags.water);
  const landuse = firstTagValue(tags.landuse);
  if (natural === "water" || natural === "bay") {
    return true;
  }
  if (water !== undefined) {
    return true;
  }
  if (landuse === "reservoir" || landuse === "basin") {
    return true;
  }
  return false;
}

function territoryGeometryHasSelfIntersection(geometry: TerritoryGeometry): boolean {
  for (const polygon of geometryToPolygons(geometry)) {
    for (const ring of polygon) {
      if (ring.length >= 4 && hasRingSelfIntersection(ring)) {
        return true;
      }
    }
  }
  return false;
}

function geoJsonToVerifiedWaterArea(geometry: Geometry): TerritoryGeometry | null {
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: geometry.coordinates as LngLat[][] };
  }
  if (geometry.type === "MultiPolygon") {
    return { type: "MultiPolygon", coordinates: geometry.coordinates as LngLat[][][] };
  }
  return null;
}

export function collectVerifiedWaterAreaGeometries(input: {
  verifiedWaterAreas?: readonly TerritoryGeometry[];
  waterSourceFeatures?: FeatureCollection;
}): {
  geometries: TerritoryGeometry[];
  excludedLineLikeFeatureCount: number;
  excludedNonPolygonGeometryCount: number;
  excludedInvalidGeometryCount: number;
  excludedMissingTagsCount: number;
} {
  const geometries: TerritoryGeometry[] = [];
  let excludedLineLikeFeatureCount = 0;
  let excludedNonPolygonGeometryCount = 0;
  let excludedInvalidGeometryCount = 0;
  let excludedMissingTagsCount = 0;

  for (const area of input.verifiedWaterAreas ?? []) {
    if (area.type !== "Polygon" && area.type !== "MultiPolygon") {
      excludedNonPolygonGeometryCount += 1;
      continue;
    }
    if (territoryGeometryHasSelfIntersection(area)) {
      excludedInvalidGeometryCount += 1;
      continue;
    }
    if (territoryGeometryClipConversionFailed(area)) {
      excludedInvalidGeometryCount += 1;
      continue;
    }
    geometries.push(area);
  }

  for (const feature of input.waterSourceFeatures?.features ?? []) {
    const tags = featureTags(feature.properties);
    if (!isWaterAreaPolygonTags(tags)) {
      if (isWaterwayLineTags(tags)) {
        excludedLineLikeFeatureCount += 1;
      } else {
        excludedMissingTagsCount += 1;
      }
      continue;
    }
    const geometry = geoJsonToVerifiedWaterArea(feature.geometry);
    if (!geometry) {
      excludedNonPolygonGeometryCount += 1;
      continue;
    }
    if (territoryGeometryHasSelfIntersection(geometry)) {
      excludedInvalidGeometryCount += 1;
      continue;
    }
    if (territoryGeometryClipConversionFailed(geometry)) {
      excludedInvalidGeometryCount += 1;
      continue;
    }
    geometries.push(geometry);
  }

  return {
    geometries,
    excludedLineLikeFeatureCount,
    excludedNonPolygonGeometryCount,
    excludedInvalidGeometryCount,
    excludedMissingTagsCount
  };
}

function unionVerifiedWaterAreas(
  geometries: readonly TerritoryGeometry[]
): { status: "ok"; union: TerritoryGeometry | null } | { status: "failed"; reason: string } {
  let acc: ClippingMultiPolygon = [];
  for (const geometry of geometries) {
    const clip = geometryToClippingMultiPolygon(geometry);
    if (clip.length === 0) {
      return {
        status: "failed",
        reason: "water_clip_conversion_empty"
      };
    }
    try {
      acc = acc.length === 0 ? clip : (CLIPPER.union(acc, clip) as ClippingMultiPolygon);
    } catch (error) {
      return {
        status: "failed",
        reason: error instanceof Error ? error.message : "water_union_failed"
      };
    }
  }
  if (acc.length === 0) {
    return { status: "ok", union: null };
  }
  return { status: "ok", union: clippingMultiPolygonToTerritoryGeometry(acc) ?? null };
}

function intersectionAreaKm2(
  left: TerritoryGeometry,
  right: TerritoryGeometry
): IntersectionAreaResult {
  if (territoryGeometryClipConversionFailed(left) || territoryGeometryClipConversionFailed(right)) {
    return { status: "failed", reason: "clip_conversion_empty" };
  }
  const leftClip = geometryToClippingMultiPolygon(left);
  const rightClip = geometryToClippingMultiPolygon(right);
  if (leftClip.length === 0 || rightClip.length === 0) {
    return { status: "ok", areaKm2: 0 };
  }
  try {
    const intersection = CLIPPER.intersection(leftClip, rightClip) as ClippingMultiPolygon;
    const geometry = clippingMultiPolygonToTerritoryGeometry(intersection);
    return { status: "ok", areaKm2: geometry ? computeTurkeyAdm3GeometryAreaKm2(geometry) : 0 };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "intersection_failed"
    };
  }
}

function estimateBboxApproxMinWidthMeters(geometry: TerritoryGeometry): number {
  const polygons = geometryToPolygons(geometry);
  let minWidth = Infinity;
  for (const polygon of polygons) {
    const ring = polygon[0];
    if (!ring || ring.length < 4) {
      continue;
    }
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const point of ring) {
      minLon = Math.min(minLon, point[0]);
      maxLon = Math.max(maxLon, point[0]);
      minLat = Math.min(minLat, point[1]);
      maxLat = Math.max(maxLat, point[1]);
    }
    const cos = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
    const widthM = Math.min((maxLon - minLon) * cos * 111_320, (maxLat - minLat) * 111_320);
    const areaM2 =
      computeTurkeyAdm3GeometryAreaKm2({
        type: "Polygon",
        coordinates: [ring]
      }) * 1_000_000;
    const lengthM = Math.max(widthM, areaM2 / Math.max(widthM, 1));
    const widthEstimate = areaM2 / Math.max(lengthM, 1);
    minWidth = Math.min(minWidth, widthM, widthEstimate);
  }
  return Number.isFinite(minWidth) ? minWidth : 0;
}

export interface TurkeyCoastlineSpillReport {
  ok: boolean;
  assessmentStatus: TurkeySpatialAssessmentStatus;
  verifiedWaterPolygonCount: number;
  unclosedCoastlineBarrierCount: number;
  intersectionFailureCount: number;
  excludedInvalidWaterAreaCount: number;
  spillFindings: Array<{
    zoneId: string;
    waterOverlapAreaKm2: number;
    classification: "VERIFIED_FINDING";
    code: "OPEN_WATER_OVERLAP";
  }>;
}

export function inspectTurkeyGeneratedCoastlineSpill(input: {
  zones: readonly TerritoryZone[];
  waterBarriers?: readonly TurkeySmartFallbackBarrier[];
  verifiedWaterAreas?: readonly TerritoryGeometry[];
  waterSourceFeatures?: FeatureCollection;
  minOverlapAreaKm2?: number;
}): TurkeyCoastlineSpillReport {
  const minOverlapAreaKm2 = input.minOverlapAreaKm2 ?? 0.000_01;
  const generated = input.zones.filter(isTurkeyGeneratedGameplayZone);
  const spillFindings: TurkeyCoastlineSpillReport["spillFindings"] = [];

  const waterCollectionInput: {
    verifiedWaterAreas?: readonly TerritoryGeometry[];
    waterSourceFeatures?: FeatureCollection;
  } = {};
  if (input.verifiedWaterAreas !== undefined) {
    waterCollectionInput.verifiedWaterAreas = input.verifiedWaterAreas;
  }
  if (input.waterSourceFeatures !== undefined) {
    waterCollectionInput.waterSourceFeatures = input.waterSourceFeatures;
  }
  const waterCollection = collectVerifiedWaterAreaGeometries(waterCollectionInput);

  let unclosedCoastlineBarrierCount = 0;
  for (const barrier of input.waterBarriers ?? []) {
    if (barrier.barrierClass !== "coastline") {
      continue;
    }
    if (barrier.coordinates.length < 2 || !ringIsClosed(barrier.coordinates)) {
      unclosedCoastlineBarrierCount += 1;
    }
  }

  if (waterCollection.geometries.length === 0) {
    return {
      ok: false,
      assessmentStatus: "NOT_ASSESSED",
      verifiedWaterPolygonCount: 0,
      unclosedCoastlineBarrierCount,
      intersectionFailureCount: 0,
      excludedInvalidWaterAreaCount: waterCollection.excludedInvalidGeometryCount,
      spillFindings
    };
  }

  const unionResult = unionVerifiedWaterAreas(waterCollection.geometries);
  if (unionResult.status === "failed" || !unionResult.union) {
    return {
      ok: false,
      assessmentStatus: "NOT_ASSESSED",
      verifiedWaterPolygonCount: waterCollection.geometries.length,
      unclosedCoastlineBarrierCount,
      intersectionFailureCount: unionResult.status === "failed" ? 1 : 0,
      excludedInvalidWaterAreaCount: waterCollection.excludedInvalidGeometryCount,
      spillFindings
    };
  }

  let intersectionFailureCount = 0;
  for (const zone of generated) {
    const intersection = intersectionAreaKm2(zone.geometry, unionResult.union);
    if (intersection.status === "failed") {
      intersectionFailureCount += 1;
      continue;
    }
    if (intersection.areaKm2 > minOverlapAreaKm2) {
      spillFindings.push({
        zoneId: zone.id,
        waterOverlapAreaKm2: intersection.areaKm2,
        classification: "VERIFIED_FINDING",
        code: "OPEN_WATER_OVERLAP"
      });
    }
  }

  if (intersectionFailureCount > 0) {
    return {
      ok: false,
      assessmentStatus: "NOT_ASSESSED",
      verifiedWaterPolygonCount: waterCollection.geometries.length,
      unclosedCoastlineBarrierCount,
      intersectionFailureCount,
      excludedInvalidWaterAreaCount: waterCollection.excludedInvalidGeometryCount,
      spillFindings
    };
  }

  const suppliedInvalidWaterAreaCount = waterCollection.excludedInvalidGeometryCount;
  if (suppliedInvalidWaterAreaCount > 0) {
    return {
      ok: false,
      assessmentStatus: "NOT_ASSESSED",
      verifiedWaterPolygonCount: waterCollection.geometries.length,
      unclosedCoastlineBarrierCount,
      intersectionFailureCount: 0,
      excludedInvalidWaterAreaCount: suppliedInvalidWaterAreaCount,
      spillFindings
    };
  }

  const assessmentStatus = spillFindings.length > 0 ? "VERIFIED_FINDING" : "ASSESSED_CLEAR";

  return {
    ok: assessmentStatus === "ASSESSED_CLEAR",
    assessmentStatus,
    verifiedWaterPolygonCount: waterCollection.geometries.length,
    unclosedCoastlineBarrierCount,
    intersectionFailureCount: 0,
    excludedInvalidWaterAreaCount: waterCollection.excludedInvalidGeometryCount,
    spillFindings
  };
}

export interface TurkeyIslandMultipolygonSafetyReport {
  ok: boolean;
  assessmentStatus: TurkeySpatialAssessmentStatus;
  assessmentScopes: {
    narrowNeckBboxApprox: TurkeySpatialAssessmentStatus;
    crossWaterComponentSeparation: TurkeySpatialAssessmentStatus;
  };
  zoneCount: number;
  multiComponentZoneCount: number;
  /** @deprecated Use `findings` — never populated by centroid/area heuristics. */
  artificialConnectorFindings: Array<{
    zoneId: string;
    componentIndexes: [number, number];
    bridgeWidthMeters: number;
  }>;
  findings: Array<{
    zoneId: string;
    classification: "VERIFIED_FINDING" | "SUSPECTED";
    code: "NARROW_NECK_BBOX_APPROX";
    measurement: Record<string, number | string>;
    componentIndexes?: [number, number];
  }>;
}

export function inspectTurkeyIslandMultipolygonSafety(
  zones: readonly TerritoryZone[],
  options: {
    maxArtificialBridgeWidthMeters?: number;
    minNeckAssessmentAreaKm2?: number;
    waterBarriers?: readonly TurkeySmartFallbackBarrier[];
    verifiedWaterAreas?: readonly TerritoryGeometry[];
    waterSourceFeatures?: FeatureCollection;
  } = {}
): TurkeyIslandMultipolygonSafetyReport {
  const maxArtificialBridgeWidthMeters = options.maxArtificialBridgeWidthMeters ?? 25;
  const minNeckAssessmentAreaKm2 = options.minNeckAssessmentAreaKm2 ?? 0.000_05;
  const findings: TurkeyIslandMultipolygonSafetyReport["findings"] = [];
  let multiComponentZoneCount = 0;

  for (const zone of zones) {
    if (!isTurkeyGeneratedGameplayZone(zone)) {
      continue;
    }

    if (zone.geometry.type === "MultiPolygon" && zone.geometry.coordinates.length >= 2) {
      multiComponentZoneCount += 1;
    }

    for (const polygon of geometryToPolygons(zone.geometry)) {
      const shell = polygon[0];
      if (!shell || shell.length < 4) {
        continue;
      }
      const areaKm2 = computeTurkeyAdm3GeometryAreaKm2({
        type: "Polygon",
        coordinates: polygon
      });
      if (areaKm2 < minNeckAssessmentAreaKm2) {
        continue;
      }
      const bboxApproxMinWidthMeters = estimateBboxApproxMinWidthMeters({
        type: "Polygon",
        coordinates: polygon
      });
      if (bboxApproxMinWidthMeters < maxArtificialBridgeWidthMeters) {
        findings.push({
          zoneId: zone.id,
          classification: "SUSPECTED",
          code: "NARROW_NECK_BBOX_APPROX",
          measurement: {
            bboxApproxMinWidthMeters: Number(bboxApproxMinWidthMeters.toFixed(3)),
            areaKm2,
            measurementNote: "Bounding-box width estimate; not a proven minimum corridor width."
          }
        });
      }
    }
  }

  const generatedPresent = zones.some(isTurkeyGeneratedGameplayZone);
  const narrowNeckBboxApprox: TurkeySpatialAssessmentStatus = !generatedPresent
    ? "NOT_ASSESSED"
    : findings.some((finding) => finding.classification === "VERIFIED_FINDING")
      ? "VERIFIED_FINDING"
      : findings.some((finding) => finding.classification === "SUSPECTED")
        ? "SUSPECTED"
        : "ASSESSED_CLEAR";

  const crossWaterComponentSeparation: TurkeySpatialAssessmentStatus = "NOT_ASSESSED";

  const assessmentStatus: TurkeySpatialAssessmentStatus = !generatedPresent
    ? "NOT_ASSESSED"
    : narrowNeckBboxApprox === "VERIFIED_FINDING"
      ? "VERIFIED_FINDING"
      : narrowNeckBboxApprox === "SUSPECTED"
        ? "SUSPECTED"
        : crossWaterComponentSeparation === "NOT_ASSESSED"
          ? "NOT_ASSESSED"
          : "ASSESSED_CLEAR";

  return {
    ok: assessmentStatus === "ASSESSED_CLEAR",
    assessmentStatus,
    assessmentScopes: {
      narrowNeckBboxApprox,
      crossWaterComponentSeparation
    },
    zoneCount: zones.length,
    multiComponentZoneCount,
    artificialConnectorFindings: [],
    findings
  };
}

export interface TurkeyRuralGeneratorQualityReport {
  confidenceTier: "low" | "medium" | "high";
  reasonCodes: string[];
  longestUnsupportedChainMeters: number;
  localitySeedCount: number;
  roadDensityKmPerKm2: number;
}

export function classifyTurkeyRuralGeneratorQuality(input: {
  longestUnsupportedChainMeters: number;
  localitySeedCount: number;
  roadDensityKmPerKm2: number;
  networkCoveragePercent?: number;
}): TurkeyRuralGeneratorQualityReport {
  const reasonCodes: string[] = [];
  if (input.roadDensityKmPerKm2 < 4) {
    reasonCodes.push("LOW_ROAD_DENSITY");
  }
  if (input.longestUnsupportedChainMeters > 2_500) {
    reasonCodes.push("LONG_UNSUPPORTED_CHAIN");
  }
  if ((input.networkCoveragePercent ?? 100) < 35) {
    reasonCodes.push("LOW_NETWORK_FACE_COVERAGE");
  }
  if (input.localitySeedCount > 120 && input.longestUnsupportedChainMeters > 5_000) {
    reasonCodes.push("SEED_DENSITY_INSUFFICIENT_FOR_RESIDUAL");
  }
  const confidenceTier =
    reasonCodes.length >= 2 || input.longestUnsupportedChainMeters > 6_000
      ? "low"
      : reasonCodes.length === 1
        ? "medium"
        : "high";
  return {
    confidenceTier,
    reasonCodes,
    longestUnsupportedChainMeters: input.longestUnsupportedChainMeters,
    localitySeedCount: input.localitySeedCount,
    roadDensityKmPerKm2: input.roadDensityKmPerKm2
  };
}

export interface TurkeyNetworkRouteRootCauseReport {
  primaryReasonCode: string;
  reasonCodes: string[];
  summaryTr: string;
  routeFailureReason: TurkeyOrganicRoutingDiagnostics["longestUnroutedReason"] | null;
  graphComponentCount: number | null;
  networkCoveragePercent: number | null;
  residualAreaPercent: number | null;
}

export function summarizeTurkeyNetworkRouteRootCause(input: {
  networkConstruction?: TurkeyNetworkConstructionDiagnostics;
  organicRouting?: TurkeyOrganicRoutingDiagnostics;
  longestUnsupportedStraightChainMeters: number;
}): TurkeyNetworkRouteRootCauseReport {
  const reasonCodes: string[] = [];
  const construction = input.networkConstruction;
  const routing = input.organicRouting ?? construction?.finalRouting;
  const graphComponentCount = construction?.graphComponentCount ?? null;
  const networkCoveragePercent = construction?.networkCoveragePercent ?? null;
  const residualAreaPercent = construction?.residualAreaPercent ?? null;

  if (routing?.longestUnroutedReason === "NO_ROUTE") {
    reasonCodes.push("ORGANIC_ROUTE_NO_PATH");
  }
  if (routing?.longestUnroutedReason === "TOPOLOGY_REJECTED") {
    reasonCodes.push("ORGANIC_ROUTE_TOPOLOGY_REJECTED");
  }
  if (graphComponentCount !== null && graphComponentCount > 48) {
    reasonCodes.push("NETWORK_GRAPH_FRAGMENTED");
  }
  if (networkCoveragePercent !== null && networkCoveragePercent < 30) {
    reasonCodes.push("LOW_NETWORK_FACE_COVERAGE");
  }
  if (residualAreaPercent !== null && residualAreaPercent > 50) {
    reasonCodes.push("HIGH_RESIDUAL_AREA");
  }
  if (input.longestUnsupportedStraightChainMeters > 3_000) {
    reasonCodes.push("LONG_UNSUPPORTED_SEAM_REMAINS");
  }

  const primaryReasonCode = reasonCodes[0] ?? "NO_BLOCKER_DETECTED";
  const summaryTr =
    reasonCodes.includes("ORGANIC_ROUTE_NO_PATH") &&
    reasonCodes.includes("NETWORK_GRAPH_FRAGMENTED")
      ? "Koridor içinde bağlı bariyer grafiği yolu bulunamadı; OSM ağ bileşenleri parçalı ve yüzey kapsamı düşük."
      : reasonCodes.includes("ORGANIC_ROUTE_NO_PATH")
        ? "Paylaşılan sınır için güvenli bariyer rotası bulunamadı (NO_ROUTE)."
        : "Ölçülen desteklenmeyen dikiş için ek birincil engel kodu üretildi.";

  return {
    primaryReasonCode,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    summaryTr,
    routeFailureReason: routing?.longestUnroutedReason ?? null,
    graphComponentCount,
    networkCoveragePercent,
    residualAreaPercent
  };
}

export function geometryComponentCount(geometry: TerritoryGeometry): number {
  return geometry.type === "MultiPolygon" ? geometry.coordinates.length : 1;
}
