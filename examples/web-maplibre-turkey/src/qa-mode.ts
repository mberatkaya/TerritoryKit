import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";

export interface DistrictQaRecord {
  adm2Id: string;
  district?: string;
  province?: string;
  confidence?: string;
  largestTerritoryAreaShare?: number | null;
  axisAlignedInternalBoundaryRatio?: number | null;
  zoneCount?: number;
}

export interface SmartCoverageIndex {
  districts: DistrictQaRecord[];
}

const QA_FILL_LAYER = "turkey-qa-adm2-fill";
const QA_LINE_LAYER = "turkey-qa-adm2-line";

export async function loadSmartCoverageIndex(url: string): Promise<SmartCoverageIndex> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`smart-coverage.json HTTP ${response.status}`);
  }
  const payload = (await response.json()) as SmartCoverageIndex;
  return { districts: payload.districts ?? [] };
}

export function applyQaDistrictOverlay(
  map: MapLibreMap,
  geojson: GeoJSON.FeatureCollection,
  enabled: boolean
): void {
  for (const layerId of [QA_FILL_LAYER, QA_LINE_LAYER]) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  if (map.getSource("turkey-qa-adm2")) map.removeSource("turkey-qa-adm2");

  if (!enabled) return;

  map.addSource("turkey-qa-adm2", { type: "geojson", data: geojson, promoteId: "territoryId" });
  map.addLayer({
    id: QA_FILL_LAYER,
    type: "fill",
    source: "turkey-qa-adm2",
    paint: {
      "fill-color": [
        "case",
        ["==", ["get", "qaFlag"], "low-confidence"],
        "rgba(245, 158, 11, 0.35)",
        ["==", ["get", "qaFlag"], "straight-threshold"],
        "rgba(239, 68, 68, 0.28)",
        ["==", ["get", "qaFlag"], "oversized-cell"],
        "rgba(168, 85, 247, 0.28)",
        "rgba(148, 163, 184, 0.08)"
      ],
      "fill-outline-color": "rgba(15, 23, 42, 0.15)"
    }
  });
  map.addLayer({
    id: QA_LINE_LAYER,
    type: "line",
    source: "turkey-qa-adm2",
    paint: {
      "line-color": "#0f172a",
      "line-width": 0.6,
      "line-opacity": 0.35
    }
  });
}

export function buildAdm2QaGeoJson(
  adm2Dataset: GeoJSON.FeatureCollection,
  index: SmartCoverageIndex
): GeoJSON.FeatureCollection {
  const byId = new Map(index.districts.map((row) => [row.adm2Id, row]));
  return {
    type: "FeatureCollection",
    features: adm2Dataset.features.map((feature) => {
      const territoryId = String(feature.properties?.territoryId ?? feature.id ?? "");
      const metrics = byId.get(territoryId);
      const largest = metrics?.largestTerritoryAreaShare;
      const straight = metrics?.axisAlignedInternalBoundaryRatio;
      let qaFlag = "ok";
      if (metrics?.confidence === "low") qaFlag = "low-confidence";
      else if (typeof straight === "number" && straight > 0.15) qaFlag = "straight-threshold";
      else if (typeof largest === "number" && largest > 0.35) qaFlag = "oversized-cell";
      else if (largest === null || largest === undefined) qaFlag = "metric-missing";

      return {
        ...feature,
        properties: {
          ...feature.properties,
          qaFlag,
          ...(metrics?.confidence ? { qaConfidence: metrics.confidence } : {}),
          ...(typeof largest === "number" ? { qaLargestShare: largest } : {}),
          ...(typeof straight === "number" ? { qaStraightRatio: straight } : {})
        }
      };
    })
  };
}

export function adm3QaFillColorExpression(): ExpressionSpecification {
  return [
    "case",
    ["==", ["get", "confidence"], "low"],
    "rgba(245, 158, 11, 0.55)",
    ["==", ["get", "boundaryKind"], "estimated"],
    "rgba(239, 68, 68, 0.42)",
    ["in", ["get", "sourceClass"], ["literal", ["generated"]]],
    "rgba(239, 68, 68, 0.42)",
    "rgba(59, 130, 246, 0.28)"
  ];
}

export function adm3DefaultFillColorExpression(): ExpressionSpecification {
  return [
    "case",
    ["boolean", ["feature-state", "selected"], false],
    "rgba(37, 99, 235, 0.55)",
    ["boolean", ["feature-state", "hover"], false],
    "rgba(14, 165, 233, 0.42)",
    "rgba(59, 130, 246, 0.22)"
  ];
}
