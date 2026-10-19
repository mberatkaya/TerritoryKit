import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";

/** gridThresholdViolations in smart-coverage totals (axis-aligned internal boundaries). */
export const AXIS_ALIGNED_BOUNDARY_THRESHOLD = 0.15;
export const OVERSIZED_CELL_SHARE_THRESHOLD = 0.35;

export interface DistrictQaRecord {
  adm2Id: string;
  district?: string;
  province?: string;
  confidence?: string;
  largestTerritoryAreaShare?: number | null;
  axisAlignedInternalBoundaryRatio?: number | null;
  smartQualityGates?: {
    geographicRealism?: boolean;
    maximumArea?: boolean;
  };
  zoneCount?: number;
}

export interface SmartCoverageIndex {
  districts: DistrictQaRecord[];
}

export interface DistrictQaFlags {
  qaLowConfidence: boolean;
  qaGeographicRealismFailure: boolean;
  qaGeographicMetricMissing: boolean;
  qaAxisAlignedWarning: boolean;
  qaAxisMetricMissing: boolean;
  qaOversizedCell: boolean;
  qaOversizedMetricMissing: boolean;
  qaCoverageMissing: boolean;
}

export interface Adm2QaSummary {
  adm2Features: number;
  indexedDistricts: number;
  qaLowConfidence: number;
  qaGeographicRealismFailure: number;
  qaGeographicMetricMissing: number;
  qaAxisAlignedWarning: number;
  qaAxisMetricMissing: number;
  qaOversizedCell: number;
  qaOversizedMetricMissing: number;
  qaCoverageMissing: number;
}

const QA_FILL_LAYERS = [
  {
    id: "turkey-qa-adm2-low-confidence",
    flag: "qaLowConfidence",
    color: "rgba(245, 158, 11, 0.32)"
  },
  {
    id: "turkey-qa-adm2-geographic-realism",
    flag: "qaGeographicRealismFailure",
    color: "rgba(239, 68, 68, 0.26)"
  },
  {
    id: "turkey-qa-adm2-axis-aligned",
    flag: "qaAxisAlignedWarning",
    color: "rgba(251, 146, 60, 0.24)"
  },
  {
    id: "turkey-qa-adm2-oversized",
    flag: "qaOversizedCell",
    color: "rgba(168, 85, 247, 0.26)"
  },
  {
    id: "turkey-qa-adm2-metric-missing",
    flag: "qaMetricMissing",
    color: "rgba(100, 116, 139, 0.22)"
  },
  {
    id: "turkey-qa-adm2-coverage-missing",
    flag: "qaCoverageMissing",
    color: "rgba(148, 163, 184, 0.18)"
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

export function isPresentNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function evaluateDistrictQaFlags(metrics: DistrictQaRecord | undefined): DistrictQaFlags {
  if (!metrics) {
    return {
      qaLowConfidence: false,
      qaGeographicRealismFailure: false,
      qaGeographicMetricMissing: false,
      qaAxisAlignedWarning: false,
      qaAxisMetricMissing: false,
      qaOversizedCell: false,
      qaOversizedMetricMissing: true,
      qaCoverageMissing: true
    };
  }

  const geographicGate = metrics.smartQualityGates?.geographicRealism;
  const axis = metrics.axisAlignedInternalBoundaryRatio;
  const largest = metrics.largestTerritoryAreaShare;

  const qaGeographicMetricMissing = geographicGate === undefined;
  const qaAxisMetricMissing = axis === undefined || axis === null || !isPresentNumber(axis);
  const qaOversizedMetricMissing =
    largest === undefined || largest === null || !isPresentNumber(largest);

  return {
    qaLowConfidence: metrics.confidence === "low",
    qaGeographicRealismFailure: geographicGate === false,
    qaGeographicMetricMissing,
    qaAxisAlignedWarning: isPresentNumber(axis) && axis > AXIS_ALIGNED_BOUNDARY_THRESHOLD,
    qaAxisMetricMissing,
    qaOversizedCell: isPresentNumber(largest) && largest > OVERSIZED_CELL_SHARE_THRESHOLD,
    qaOversizedMetricMissing,
    qaCoverageMissing: false
  };
}

export function summarizeAdm2QaGeoJson(geojson: GeoJSON.FeatureCollection): Adm2QaSummary {
  const features = geojson.features ?? [];
  const count = (flag: string) =>
    features.filter((feature) => feature.properties?.[flag] === true).length;

  return {
    adm2Features: features.length,
    indexedDistricts: features.length - count("qaCoverageMissing"),
    qaLowConfidence: count("qaLowConfidence"),
    qaGeographicRealismFailure: count("qaGeographicRealismFailure"),
    qaGeographicMetricMissing: count("qaGeographicMetricMissing"),
    qaAxisAlignedWarning: count("qaAxisAlignedWarning"),
    qaAxisMetricMissing: count("qaAxisMetricMissing"),
    qaOversizedCell: count("qaOversizedCell"),
    qaOversizedMetricMissing: count("qaOversizedMetricMissing"),
    qaCoverageMissing: count("qaCoverageMissing")
  };
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
      ["==", ["get", "qaGeographicRealismFailure"], true],
      ["==", ["get", "qaAxisAlignedWarning"], true],
      ["==", ["get", "qaOversizedCell"], true],
      ["==", ["get", "qaMetricMissing"], true],
      ["==", ["get", "qaCoverageMissing"], true]
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
      const flags = evaluateDistrictQaFlags(metrics);
      const qaMetricMissing =
        flags.qaGeographicMetricMissing ||
        flags.qaAxisMetricMissing ||
        flags.qaOversizedMetricMissing;

      const axis = metrics?.axisAlignedInternalBoundaryRatio;
      const largest = metrics?.largestTerritoryAreaShare;

      return {
        ...feature,
        properties: {
          ...feature.properties,
          ...flags,
          qaMetricMissing,
          ...(metrics?.confidence ? { qaConfidence: metrics.confidence } : {}),
          ...(isPresentNumber(largest) ? { qaLargestShare: largest } : {}),
          ...(isPresentNumber(axis) ? { qaAxisAlignedRatio: axis } : {}),
          ...(metrics?.smartQualityGates?.geographicRealism === false
            ? { qaGeographicRealismGate: false }
            : metrics?.smartQualityGates?.geographicRealism === true
              ? { qaGeographicRealismGate: true }
              : {})
        }
      };
    })
  };
}

export function formatQaLegendSummary(summary: Adm2QaSummary): string {
  return [
    `QA özet (ADM2 ${summary.adm2Features}, smart-coverage ${summary.indexedDistricts}):`,
    `düşük güven ${summary.qaLowConfidence}`,
    `coğrafi gerçekçilik kapısı ${summary.qaGeographicRealismFailure}`,
    `eksik coğrafi kapı ${summary.qaGeographicMetricMissing}`,
    `eksen-hizalı uyarı (>${AXIS_ALIGNED_BOUNDARY_THRESHOLD}) ${summary.qaAxisAlignedWarning}`,
    `eksik eksen metrik ${summary.qaAxisMetricMissing}`,
    `büyük hücre (>${OVERSIZED_CELL_SHARE_THRESHOLD}) ${summary.qaOversizedCell}`,
    `eksik hücre metrik ${summary.qaOversizedMetricMissing}`,
    `coverage yok ${summary.qaCoverageMissing}`
  ].join(" · ");
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
