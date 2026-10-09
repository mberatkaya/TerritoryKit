import { computeTerritoryAreaM2, geometryToPolygons } from "@territory-kit/dataset";
import type { LngLat, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import { computeTurkeyAdm3GeometryAreaKm2 } from "./turkey-adm3-full-coverage.js";
import type { TurkeySmartFallbackBarrier } from "./turkey-smart-fallback.js";
import {
  inspectTurkeySmartBoundaryAlignment,
  type TurkeySmartFallbackConfiguration
} from "./turkey-smart-fallback.js";
import type { MultiPolygon as ClippingMultiPolygon } from "polygon-clipping";

export const TURKEY_GENERATED_ZONE_PATHOLOGY_SCHEMA_VERSION =
  "territorykit-tr-adm3-generated-pathology@1";

export interface TurkeyGeneratedZonePathologyThresholds {
  minSliverAreaKm2: number;
  maxAspectRatio: number;
  minCorridorWidthMeters: number;
  spikeMaxAdjacentEdgeMeters: number;
  spikeMaxInteriorAngleDegrees: number;
  minDetachedComponentAreaKm2: number;
}

export const DEFAULT_TURKEY_GENERATED_ZONE_PATHOLOGY_THRESHOLDS: TurkeyGeneratedZonePathologyThresholds =
  {
    minSliverAreaKm2: 0.000_05,
    maxAspectRatio: 28,
    minCorridorWidthMeters: 18,
    spikeMaxAdjacentEdgeMeters: 120,
    spikeMaxInteriorAngleDegrees: 14,
    minDetachedComponentAreaKm2: 0.000_02
  };

export interface TurkeyGeneratedZonePathologyFinding {
  zoneId: string;
  parentId?: string;
  code:
    | "SLIVER"
    | "EXCESSIVE_ASPECT_RATIO"
    | "THIN_CORRIDOR"
    | "SPIKE"
    | "DETACHED_MICRO_COMPONENT"
    | "UNSUPPORTED_STRAIGHT_BOUNDARY"
    | "LOW_BARRIER_ADHERENCE";
  severity: "warning" | "info";
  measurement: Record<string, number | string>;
}

export interface TurkeyGeneratedZonePathologyReport {
  schemaVersion: typeof TURKEY_GENERATED_ZONE_PATHOLOGY_SCHEMA_VERSION;
  generatedZoneCount: number;
  skippedOfficialZoneCount: number;
  findings: TurkeyGeneratedZonePathologyFinding[];
  boundaryAlignmentSummary?: {
    longUnsupportedStraightBoundaryRatio: number;
    longestUnsupportedStraightChainMeters: number;
    barrierFollowingInternalBoundaryRatio: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTurkeyGeneratedGameplayZone(zone: TerritoryZone): boolean {
  const territory = zone.properties?.territory;
  if (!isRecord(territory)) {
    return false;
  }
  if (territory.administrative === true || territory.authoritative === true) {
    return false;
  }
  const sourceClass = territory.sourceClass;
  const boundarySourceClass = territory.boundarySourceClass;
  return sourceClass === "generated" || boundarySourceClass === "smart-derived";
}

function haversineMeters(a: LngLat, b: LngLat): number {
  const cos = Math.cos((a[1] * Math.PI) / 180);
  const dx = (a[0] - b[0]) * cos * 111_320;
  const dy = (a[1] - b[1]) * 111_320;
  return Math.hypot(dx, dy);
}

function ringInteriorAngleDegrees(prev: LngLat, vertex: LngLat, next: LngLat): number {
  const cos = Math.cos((vertex[1] * Math.PI) / 180);
  const v1x = (prev[0] - vertex[0]) * cos;
  const v1y = prev[1] - vertex[1];
  const v2x = (next[0] - vertex[0]) * cos;
  const v2y = next[1] - vertex[1];
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 <= 0 || m2 <= 0) {
    return 180;
  }
  return (Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * 180) / Math.PI;
}

function estimateMinWidthMeters(geometry: TerritoryGeometry): number {
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
    const areaM2 = computeTerritoryAreaM2({ type: "Polygon", coordinates: [ring] });
    const lengthM = Math.max(widthM, areaM2 / Math.max(widthM, 1));
    const widthEstimate = areaM2 / Math.max(lengthM, 1);
    minWidth = Math.min(minWidth, widthM, widthEstimate);
  }
  return Number.isFinite(minWidth) ? minWidth : 0;
}

function bboxAspectRatio(geometry: TerritoryGeometry): number {
  const polygons = geometryToPolygons(geometry);
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const point of ring) {
        minLon = Math.min(minLon, point[0]);
        maxLon = Math.max(maxLon, point[0]);
        minLat = Math.min(minLat, point[1]);
        maxLat = Math.max(maxLat, point[1]);
      }
    }
  }
  const cos = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const widthM = (maxLon - minLon) * cos * 111_320;
  const heightM = (maxLat - minLat) * 111_320;
  const major = Math.max(widthM, heightM, 1);
  const minor = Math.max(Math.min(widthM, heightM), 0.001);
  return major / minor;
}

export function inspectTurkeyGeneratedZonePathology(input: {
  zones: readonly TerritoryZone[];
  parentGeometry?: ClippingMultiPolygon;
  barriers?: readonly TurkeySmartFallbackBarrier[];
  configuration?: TurkeySmartFallbackConfiguration;
  thresholds?: Partial<TurkeyGeneratedZonePathologyThresholds>;
}): TurkeyGeneratedZonePathologyReport {
  const thresholds = {
    ...DEFAULT_TURKEY_GENERATED_ZONE_PATHOLOGY_THRESHOLDS,
    ...input.thresholds
  };
  const findings: TurkeyGeneratedZonePathologyFinding[] = [];
  const generated = input.zones.filter(isTurkeyGeneratedGameplayZone);
  const skippedOfficialZoneCount = input.zones.length - generated.length;

  for (const zone of generated) {
    const areaKm2 = computeTurkeyAdm3GeometryAreaKm2(zone.geometry);
    if (areaKm2 > 0 && areaKm2 < thresholds.minSliverAreaKm2) {
      findings.push({
        zoneId: zone.id,
        ...(zone.parentId ? { parentId: zone.parentId } : {}),
        code: "SLIVER",
        severity: "warning",
        measurement: { areaKm2 }
      });
    }

    const aspectRatio = bboxAspectRatio(zone.geometry);
    if (aspectRatio > thresholds.maxAspectRatio) {
      findings.push({
        zoneId: zone.id,
        ...(zone.parentId ? { parentId: zone.parentId } : {}),
        code: "EXCESSIVE_ASPECT_RATIO",
        severity: "warning",
        measurement: { aspectRatio, areaKm2 }
      });
    }

    const minWidthMeters = estimateMinWidthMeters(zone.geometry);
    if (
      areaKm2 >= thresholds.minSliverAreaKm2 &&
      minWidthMeters < thresholds.minCorridorWidthMeters
    ) {
      findings.push({
        zoneId: zone.id,
        ...(zone.parentId ? { parentId: zone.parentId } : {}),
        code: "THIN_CORRIDOR",
        severity: "warning",
        measurement: { minWidthMeters, areaKm2 }
      });
    }

    for (const polygon of geometryToPolygons(zone.geometry)) {
      const ring = polygon[0];
      if (!ring || ring.length < 5) {
        continue;
      }
      for (let index = 1; index < ring.length - 1; index += 1) {
        const prev = ring[index - 1]!;
        const vertex = ring[index]!;
        const next = ring[index + 1]!;
        const angle = ringInteriorAngleDegrees(prev, vertex, next);
        const edge1 = haversineMeters(prev, vertex);
        const edge2 = haversineMeters(vertex, next);
        if (
          angle <= thresholds.spikeMaxInteriorAngleDegrees &&
          edge1 <= thresholds.spikeMaxAdjacentEdgeMeters &&
          edge2 <= thresholds.spikeMaxAdjacentEdgeMeters
        ) {
          findings.push({
            zoneId: zone.id,
            ...(zone.parentId ? { parentId: zone.parentId } : {}),
            code: "SPIKE",
            severity: "info",
            measurement: {
              interiorAngleDegrees: Number(angle.toFixed(3)),
              edge1Meters: Number(edge1.toFixed(3)),
              edge2Meters: Number(edge2.toFixed(3)),
              vertexIndex: String(index)
            }
          });
        }
      }
    }

    if (zone.geometry.type === "MultiPolygon") {
      for (const [componentIndex, polygon] of zone.geometry.coordinates.entries()) {
        const shell = polygon[0];
        if (!shell) {
          continue;
        }
        const componentAreaKm2 = computeTurkeyAdm3GeometryAreaKm2({
          type: "Polygon",
          coordinates: polygon
        });
        if (componentAreaKm2 < thresholds.minDetachedComponentAreaKm2) {
          findings.push({
            zoneId: zone.id,
            ...(zone.parentId ? { parentId: zone.parentId } : {}),
            code: "DETACHED_MICRO_COMPONENT",
            severity: "info",
            measurement: { componentIndex, componentAreaKm2 }
          });
        }
      }
    }
  }

  let boundaryAlignmentSummary: TurkeyGeneratedZonePathologyReport["boundaryAlignmentSummary"];
  if (input.parentGeometry && input.barriers && input.configuration && generated.length) {
    const alignment = inspectTurkeySmartBoundaryAlignment({
      zones: generated,
      parentGeometry: input.parentGeometry,
      barriers: input.barriers,
      configuration: input.configuration
    });
    boundaryAlignmentSummary = {
      longUnsupportedStraightBoundaryRatio: alignment.longUnsupportedStraightBoundaryRatio,
      longestUnsupportedStraightChainMeters: alignment.longestUnsupportedStraightChainMeters,
      barrierFollowingInternalBoundaryRatio: alignment.barrierFollowingInternalBoundaryRatio
    };
    if (alignment.longestUnsupportedStraightChainMeters >= 500) {
      const owner = alignment.longestUnsupportedStraightChain?.ownerZoneId ?? generated[0]!.id;
      findings.push({
        zoneId: owner,
        code: "UNSUPPORTED_STRAIGHT_BOUNDARY",
        severity: "warning",
        measurement: {
          longestUnsupportedStraightChainMeters: alignment.longestUnsupportedStraightChainMeters,
          longUnsupportedStraightBoundaryRatio: alignment.longUnsupportedStraightBoundaryRatio
        }
      });
    }
    if (alignment.barrierFollowingInternalBoundaryRatio < 0.55) {
      findings.push({
        zoneId: generated[0]!.id,
        code: "LOW_BARRIER_ADHERENCE",
        severity: "info",
        measurement: {
          barrierFollowingInternalBoundaryRatio: alignment.barrierFollowingInternalBoundaryRatio,
          availableBarrierOpportunityRatio: alignment.availableBarrierOpportunityRatio
        }
      });
    }
  }

  return {
    schemaVersion: TURKEY_GENERATED_ZONE_PATHOLOGY_SCHEMA_VERSION,
    generatedZoneCount: generated.length,
    skippedOfficialZoneCount,
    findings: findings.sort(
      (left, right) =>
        left.zoneId.localeCompare(right.zoneId) || left.code.localeCompare(right.code)
    ),
    ...(boundaryAlignmentSummary ? { boundaryAlignmentSummary } : {})
  };
}
