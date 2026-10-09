import { geometryToPolygons } from "@territory-kit/dataset";
import type { LngLat, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import { computeTurkeyAdm3GeometryAreaKm2 } from "./turkey-adm3-full-coverage.js";
import type { TurkeyOrganicRoutingDiagnostics } from "./turkey-organic-routing.js";
import type { TurkeyNetworkConstructionDiagnostics } from "./turkey-smart-fallback.js";
import type { TurkeySmartFallbackBarrier } from "./turkey-smart-fallback.js";
import { isTurkeyGeneratedGameplayZone } from "./turkey-generated-zone-pathology.js";

export const TURKEY_ISTANBUL_GEOMETRY_DIAGNOSTICS_SCHEMA_VERSION =
  "territorykit-tr-adm3-istanbul-geometry-diagnostics@1";

function haversineMeters(a: LngLat, b: LngLat): number {
  const cos = Math.cos((a[1] * Math.PI) / 180);
  const dx = (a[0] - b[0]) * cos * 111_320;
  const dy = (a[1] - b[1]) * 111_320;
  return Math.hypot(dx, dy);
}

function componentCentroid(shell: LngLat[]): LngLat {
  let sumLon = 0;
  let sumLat = 0;
  const count = Math.max(shell.length - 1, 1);
  for (let index = 0; index < count; index += 1) {
    sumLon += shell[index]![0];
    sumLat += shell[index]![1];
  }
  return [sumLon / count, sumLat / count];
}

export interface TurkeyCoastlineSpillReport {
  ok: boolean;
  spillFindings: Array<{
    zoneId: string;
    waterOverlapAreaKm2: number;
    code: "OPEN_WATER_OVERLAP" | "UNSUPPORTED_SHORE_CONNECTOR";
  }>;
}

export function inspectTurkeyGeneratedCoastlineSpill(input: {
  zones: readonly TerritoryZone[];
  waterBarriers: readonly TurkeySmartFallbackBarrier[];
  minOverlapAreaKm2?: number;
}): TurkeyCoastlineSpillReport {
  const minOverlapAreaKm2 = input.minOverlapAreaKm2 ?? 0.000_01;
  const generated = input.zones.filter(isTurkeyGeneratedGameplayZone);
  const spillFindings: TurkeyCoastlineSpillReport["spillFindings"] = [];
  const waterPolygons = input.waterBarriers
    .filter((barrier) => barrier.barrierClass === "water" || barrier.barrierClass === "coastline")
    .flatMap((barrier) => {
      if (barrier.coordinates.length < 3) {
        return [];
      }
      const ring = [...barrier.coordinates];
      if (ring[0]![0] !== ring.at(-1)![0] || ring[0]![1] !== ring.at(-1)![1]) {
        ring.push(ring[0]!);
      }
      return [{ type: "Polygon" as const, coordinates: [ring] }];
    });

  for (const zone of generated) {
    const zoneAreaKm2 = computeTurkeyAdm3GeometryAreaKm2(zone.geometry);
    let overlapKm2 = 0;
    for (const water of waterPolygons) {
      const zonePolygons = geometryToPolygons(zone.geometry);
      const waterPolygons = geometryToPolygons(water);
      for (const zp of zonePolygons) {
        for (const wp of waterPolygons) {
          const zShell = zp[0];
          const wShell = wp[0];
          if (!zShell || !wShell) {
            continue;
          }
          const zCentroid = componentCentroid(zShell as LngLat[]);
          const wCentroid = componentCentroid(wShell as LngLat[]);
          if (haversineMeters(zCentroid, wCentroid) < 30) {
            overlapKm2 += Math.min(zoneAreaKm2, computeTurkeyAdm3GeometryAreaKm2(water)) * 0.05;
          }
        }
      }
    }
    if (overlapKm2 > minOverlapAreaKm2) {
      spillFindings.push({
        zoneId: zone.id,
        waterOverlapAreaKm2: overlapKm2,
        code: "OPEN_WATER_OVERLAP"
      });
    }
  }

  return { ok: spillFindings.length === 0, spillFindings };
}

export interface TurkeyIslandMultipolygonSafetyReport {
  ok: boolean;
  zoneCount: number;
  multiComponentZoneCount: number;
  artificialConnectorFindings: Array<{
    zoneId: string;
    componentIndexes: [number, number];
    bridgeWidthMeters: number;
  }>;
}

export function inspectTurkeyIslandMultipolygonSafety(
  zones: readonly TerritoryZone[],
  options: { maxArtificialBridgeWidthMeters?: number } = {}
): TurkeyIslandMultipolygonSafetyReport {
  const maxArtificialBridgeWidthMeters = options.maxArtificialBridgeWidthMeters ?? 25;
  const artificialConnectorFindings: TurkeyIslandMultipolygonSafetyReport["artificialConnectorFindings"] =
    [];
  let multiComponentZoneCount = 0;

  for (const zone of zones) {
    if (zone.geometry.type !== "MultiPolygon") {
      continue;
    }
    const components = zone.geometry.coordinates;
    if (components.length < 2) {
      continue;
    }
    multiComponentZoneCount += 1;
    for (let left = 0; left < components.length; left += 1) {
      for (let right = left + 1; right < components.length; right += 1) {
        const leftShell = components[left]?.[0];
        const rightShell = components[right]?.[0];
        if (!leftShell || !rightShell) {
          continue;
        }
        const distance = haversineMeters(
          componentCentroid(leftShell as LngLat[]),
          componentCentroid(rightShell as LngLat[])
        );
        const leftArea = computeTurkeyAdm3GeometryAreaKm2({
          type: "Polygon",
          coordinates: components[left]!
        });
        const rightArea = computeTurkeyAdm3GeometryAreaKm2({
          type: "Polygon",
          coordinates: components[right]!
        });
        const minArea = Math.min(leftArea, rightArea);
        const bridgeWidthMeters = minArea > 0 ? (minArea * 1_000_000) / Math.max(distance, 1) : 0;
        if (distance > 80 && bridgeWidthMeters < maxArtificialBridgeWidthMeters) {
          artificialConnectorFindings.push({
            zoneId: zone.id,
            componentIndexes: [left, right],
            bridgeWidthMeters
          });
        }
      }
    }
  }

  return {
    ok: artificialConnectorFindings.length === 0,
    zoneCount: zones.length,
    multiComponentZoneCount,
    artificialConnectorFindings
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
