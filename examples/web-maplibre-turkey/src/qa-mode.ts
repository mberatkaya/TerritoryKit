import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";

/** National closeout: unsupportedStraightThresholdDistricts uses axisAlignedInternalBoundaryRatio > 0.15 */
export const STRAIGHT_BOUNDARY_THRESHOLD = 0.15;
export const OVERSIZED_CELL_SHARE_THRESHOLD = 0.35;

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

const QA_FILL_LAYERS = [
  {
    id: "turkey-qa-adm2-low-confidence",
    flag: "qaLowConfidence",
    color: "rgba(245, 158, 11, 0.32)"
  },
  {
    id: "turkey-qa-adm2-straight-threshold",
    flag: "qaStraightViolation",
    color: "rgba(239, 68, 68, 0.26)"
  },
  { id: "turkey-qa-adm2-oversized", flag: "qaOversizedCell", color: "rgba(168, 85, 247, 0.26)" },
  {
    id: "turkey-qa-adm2-metric-missing",
    flag: "qaMetricMissing",
    color: "rgba(100, 116, 139, 0.22)"
  }
] as const;

const QA_LINE_LAYER = "turkey-qa-adm2-outline";

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
  for (const layer of QA_FILL_LAYERS) {
    if (map.getLayer(layer.id)) map.removeLayer(layer.id);
  }
  if (map.getLayer(QA_LINE_LAYER)) map.removeLayer(QA_LINE_LAYER);
  if (map.getSource("turkey-qa-adm2")) map.removeSource("turkey-qa-adm2");

  if (!enabled) return;

  map.addSource("turkey-qa-adm2", { type: "geojson", data: geojson, promoteId: "territoryId" });

  for (const layer of QA_FILL_LAYERS) {
    map.addLayer({
      id: layer.id,
      type: "fill",
      source: "turkey-qa-adm2",
      filter: ["==", ["get", layer.flag], true],
      paint: {
        "fill-color": layer.color,
        "fill-outline-color": "rgba(15, 23, 42, 0.12)"
      }
    });
  }

  map.addLayer({
    id: QA_LINE_LAYER,
    type: "line",
    source: "turkey-qa-adm2",
    filter: [
      "any",
      ["==", ["get", "qaLowConfidence"], true],
      ["==", ["get", "qaStraightViolation"], true],
      ["==", ["get", "qaOversizedCell"], true],
      ["==", ["get", "qaMetricMissing"], true]
    ],
    paint: {
      "line-color": "#0f172a",
      "line-width": 0.8,
      "line-opacity": 0.4
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
      const qaLowConfidence = metrics?.confidence === "low";
      const qaStraightViolation =
        typeof straight === "number" && straight > STRAIGHT_BOUNDARY_THRESHOLD;
      const qaOversizedCell =
        typeof largest === "number" && largest > OVERSIZED_CELL_SHARE_THRESHOLD;
      const qaMetricMissing =
        metrics !== undefined &&
        largest === null &&
        straight === null &&
        metrics.confidence !== "low";

      return {
        ...feature,
        properties: {
          ...feature.properties,
          qaLowConfidence,
          qaStraightViolation,
          qaOversizedCell,
          qaMetricMissing,
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
    ["boolean", ["feature-state", "selected"], false],
    "rgba(37, 99, 235, 0.75)",
    ["boolean", ["feature-state", "hover"], false],
    "rgba(14, 165, 233, 0.58)",
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
