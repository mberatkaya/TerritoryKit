import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  computeGeometryBBox,
  computeGeometryCenter,
  geometryToPolygons
} from "@territory-kit/dataset";
import type { LngLat, TerritoryBBox, TerritoryGeometry } from "@territory-kit/dataset";

export type TerritoryGeometryRepairEngine = "auto" | "shapely" | "typescript";
export type TerritoryGeometryRepairStatus =
  | "unchanged"
  | "precision-normalized"
  | "ring-normalized"
  | "geometry-repaired"
  | "component-discarded"
  | "rejected";

export interface TerritoryGeometryRepairOptions {
  engine?: TerritoryGeometryRepairEngine;
  pythonPath?: string;
  cwd?: string;
  precision?: number;
  mode?: "make-valid";
}

export interface TerritoryGeometryRepairInputFeature {
  id: string;
  sourceFeatureId?: string;
  geometry: TerritoryGeometry;
}

export interface TerritoryGeometryDiscardedComponent {
  territoryId: string;
  sourceFeatureId?: string;
  geometryType: string;
  area: number;
  reason: string;
  safeToDiscard: boolean;
}

export interface TerritoryGeometryRepairFeatureResult {
  id: string;
  sourceFeatureId?: string;
  status: TerritoryGeometryRepairStatus;
  geometry?: TerritoryGeometry;
  bbox?: TerritoryBBox;
  center?: LngLat;
  engine: string;
  engineVersion: string;
  mode: string;
  precision: number;
  areaBefore: number;
  areaAfter: number;
  areaDifference: number;
  componentsDiscarded: number;
  discardedComponents: TerritoryGeometryDiscardedComponent[];
  message?: string;
}

export interface TerritoryGeometryRepairReport {
  engine: string;
  engineVersion: string;
  mode: string;
  precision: number;
  featuresRepaired: number;
  featuresUnchanged: number;
  featuresPrecisionNormalized: number;
  featuresRingNormalized: number;
  featuresWithDiscardedComponents: number;
  featuresRejected: number;
  areaDifference: number;
  componentsDiscarded: number;
  results: TerritoryGeometryRepairFeatureResult[];
}

interface ShapelyRepairPayload {
  features: Array<{
    id: string;
    sourceFeatureId?: string;
    geometry: TerritoryGeometry;
  }>;
  precision: number;
}

interface ShapelyRepairResult {
  engine: string;
  engineVersion: string;
  mode: "make-valid";
  precision: number;
  results: Array<{
    id: string;
    sourceFeatureId?: string;
    status: TerritoryGeometryRepairStatus;
    geometry?: TerritoryGeometry;
    center?: LngLat;
    areaBefore: number;
    areaAfter: number;
    areaDifference: number;
    componentsDiscarded: number;
    discardedComponents?: Array<{
      geometryType: string;
      area: number;
      reason: string;
      safeToDiscard: boolean;
    }>;
    message?: string;
  }>;
}

const DEFAULT_PRECISION = 6;
const PYTHON_REPAIR_SCRIPT = String.raw`
import json
import sys

try:
    import shapely
    from shapely import make_valid, set_precision
    from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape
    from shapely.geometry.polygon import orient
    from shapely.ops import unary_union
except Exception as error:
    print(json.dumps({"ok": False, "error": f"SHAPELY_UNAVAILABLE: {error}"}))
    sys.exit(0)


def discarded_component(geometry, reason, safe_to_discard=True):
    return {
        "geometryType": geometry.geom_type,
        "area": float(getattr(geometry, "area", 0.0) or 0.0),
        "reason": reason,
        "safeToDiscard": bool(safe_to_discard)
    }


def collect_area_components(geometry):
    if geometry.is_empty:
        return [], []
    if isinstance(geometry, Polygon):
        return [geometry], []
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms), []
    if isinstance(geometry, GeometryCollection):
        polygons = []
        discarded = []
        for part in geometry.geoms:
            part_polygons, part_discarded = collect_area_components(part)
            polygons.extend(part_polygons)
            discarded.extend(part_discarded)
        return polygons, discarded
    return [], [discarded_component(geometry, "make-valid-produced-non-polygonal-component", True)]


MIN_POLYGON_AREA = 1e-8


def clean_polygon_components(polygons):
    cleaned = []
    discarded = []
    for polygon in polygons:
        if polygon.is_empty or polygon.area <= MIN_POLYGON_AREA:
            discarded.append(
                discarded_component(polygon, "polygonal-component-area-below-threshold", True)
            )
            continue
        shell = polygon.exterior
        holes = []
        for hole in polygon.interiors:
            hole_polygon = Polygon(hole)
            if hole_polygon.area <= MIN_POLYGON_AREA:
                discarded.append(
                    discarded_component(hole_polygon, "hole-area-below-threshold", True)
                )
                continue
            holes.append(hole)
        cleaned_polygon = Polygon(shell, holes)
        if cleaned_polygon.is_empty or cleaned_polygon.area <= MIN_POLYGON_AREA:
            discarded.append(
                discarded_component(cleaned_polygon, "cleaned-polygon-area-below-threshold", True)
            )
            continue
        cleaned.append(orient(cleaned_polygon, sign=1.0))
    return cleaned, discarded


def area_geometry_from_components(polygons):
    polygons, discarded = clean_polygon_components(polygons)
    if not polygons:
        return None, discarded
    geometry = polygons[0] if len(polygons) == 1 else unary_union(polygons)
    polygons, extra_discarded = collect_area_components(geometry)
    discarded += extra_discarded
    polygons, extra_discarded = clean_polygon_components(polygons)
    discarded += extra_discarded
    if not polygons:
        return None, discarded
    if len(polygons) == 1:
        return polygons[0], discarded
    return MultiPolygon(polygons), discarded


def repair_one(feature, precision):
    feature_id = feature["id"]
    source_feature_id = feature.get("sourceFeatureId")
    try:
        original = shape(feature["geometry"])
        area_before = float(original.area)
        repaired = make_valid(original)
        if precision > 0:
            grid_size = 10 ** (-precision)
            repaired = set_precision(repaired, grid_size)
            repaired = repaired.simplify(grid_size, preserve_topology=False)
            repaired = set_precision(make_valid(repaired), grid_size)
        polygons, discarded = collect_area_components(repaired)
        area_geometry, extra_discarded = area_geometry_from_components(polygons)
        discarded += extra_discarded

        if area_geometry is None or area_geometry.is_empty:
            return {
                "id": feature_id,
                "sourceFeatureId": source_feature_id,
                "status": "rejected",
                "areaBefore": area_before,
                "areaAfter": 0,
                "areaDifference": area_before,
                "componentsDiscarded": len(discarded),
                "discardedComponents": discarded,
                "message": "MakeValid produced no polygonal components."
            }

        if not area_geometry.is_valid:
            valid_again = make_valid(area_geometry)
            polygons, extra_discarded = collect_area_components(valid_again)
            area_geometry, second_extra_discarded = area_geometry_from_components(polygons)
            discarded += extra_discarded + second_extra_discarded

        if area_geometry is None or area_geometry.is_empty or not area_geometry.is_valid:
            return {
                "id": feature_id,
                "sourceFeatureId": source_feature_id,
                "status": "rejected",
                "areaBefore": area_before,
                "areaAfter": 0,
                "areaDifference": area_before,
                "componentsDiscarded": len(discarded),
                "discardedComponents": discarded,
                "message": "MakeValid output remained invalid or empty after polygon extraction."
            }

        area_after = float(area_geometry.area)
        area_delta_ratio = abs(area_after - area_before) / max(abs(area_before), 1)
        materially_changed = (
            not original.is_valid
            or area_delta_ratio > 10 ** (-max(precision, 1))
            or original.geom_type != area_geometry.geom_type
        )
        if discarded:
            status = "component-discarded"
        elif materially_changed:
            status = "geometry-repaired"
        elif not original.equals_exact(area_geometry, 0.0):
            status = "precision-normalized"
        else:
            status = "unchanged"
        point = area_geometry.representative_point()
        result = {
            "id": feature_id,
            "sourceFeatureId": source_feature_id,
            "status": status,
            "geometry": mapping(area_geometry),
            "center": [float(point.x), float(point.y)],
            "areaBefore": area_before,
            "areaAfter": area_after,
            "areaDifference": abs(area_after - area_before),
            "componentsDiscarded": len(discarded),
            "discardedComponents": discarded
        }
        return result
    except Exception as error:
        return {
            "id": feature_id,
            "sourceFeatureId": source_feature_id,
            "status": "rejected",
            "areaBefore": 0,
            "areaAfter": 0,
            "areaDifference": 0,
            "componentsDiscarded": 0,
            "discardedComponents": [],
            "message": str(error)
        }


payload = json.load(sys.stdin)
precision = int(payload.get("precision", 6))
results = [repair_one(feature, precision) for feature in payload.get("features", [])]
print(json.dumps({
    "ok": True,
    "engine": "GEOS/Shapely",
    "engineVersion": f"Shapely {shapely.__version__}; GEOS {shapely.geos_version_string}",
    "mode": "make-valid",
    "precision": precision,
    "results": results
}))
`;

export async function repairTerritoryGeometries(
  features: readonly TerritoryGeometryRepairInputFeature[],
  options: TerritoryGeometryRepairOptions = {}
): Promise<TerritoryGeometryRepairReport> {
  const engine = options.engine ?? readRepairEngineFromEnv();
  const precision = options.precision ?? readRepairPrecisionFromEnv();

  if (engine !== "typescript") {
    const errors: string[] = [];
    const pythonPath = options.pythonPath ?? process.env.TERRITORYKIT_GEOMETRY_REPAIR_PYTHON;

    for (const candidate of resolvePythonCandidates({
      cwd: options.cwd ?? process.cwd(),
      ...(pythonPath ? { pythonPath } : {})
    })) {
      try {
        return summarizeRepairResults(
          await runShapelyRepair(features, {
            precision,
            pythonPath: candidate
          }),
          features
        );
      } catch (error) {
        errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (engine === "shapely") {
      throw new Error(`Shapely geometry repair unavailable. ${errors.join(" | ")}`);
    }
  }

  return summarizeRepairResults(createTypescriptRepairResult(features, precision), features);
}

export function computeGeometryRepresentativePoint(geometry: TerritoryGeometry): LngLat {
  const centroid = normalizeLngLat(computeGeometryCenter(geometry));

  if (pointCoveredByGeometry(centroid, geometry)) {
    return centroid;
  }

  const largest = findLargestOuterRing(geometry);
  const fallback = largest?.[0];

  return fallback
    ? normalizeLngLat(fallback)
    : normalizeLngLat(computeGeometryBBox(geometry).slice(0, 2) as LngLat);
}

export function pointCoveredByGeometry(point: LngLat, geometry: TerritoryGeometry): boolean {
  return geometryToPolygons(geometry).some(
    (polygon) =>
      pointCoveredByPolygon(point, polygon) || pointCoveredByUnwrappedPolygon(point, polygon)
  );
}

function summarizeRepairResults(
  result: ShapelyRepairResult,
  originalFeatures: readonly TerritoryGeometryRepairInputFeature[]
): TerritoryGeometryRepairReport {
  const originalById = new Map(originalFeatures.map((feature) => [feature.id, feature.geometry]));
  const sourceFeatureIdById = new Map(
    originalFeatures.map((feature) => [feature.id, feature.sourceFeatureId])
  );
  const results = result.results.map((item) => {
    const sourceFeatureId = item.sourceFeatureId ?? sourceFeatureIdById.get(item.id);
    const discardedComponents = (item.discardedComponents ?? []).map((component) => ({
      territoryId: item.id,
      ...(sourceFeatureId ? { sourceFeatureId } : {}),
      geometryType: component.geometryType,
      area: component.area,
      reason: component.reason,
      safeToDiscard: component.safeToDiscard
    }));

    if (item.status === "rejected") {
      return {
        id: item.id,
        ...(sourceFeatureId ? { sourceFeatureId } : {}),
        status: "rejected" as const,
        engine: result.engine,
        engineVersion: result.engineVersion,
        mode: result.mode,
        precision: result.precision,
        areaBefore: item.areaBefore,
        areaAfter: item.areaAfter,
        areaDifference: item.areaDifference,
        componentsDiscarded: item.componentsDiscarded,
        discardedComponents,
        ...(item.message ? { message: item.message } : {})
      };
    }

    const originalGeometry = originalById.get(item.id);
    const rawGeometry = item.geometry ?? originalGeometry;
    const geometry =
      rawGeometry && geometryHasOutOfRangeLongitude(rawGeometry)
        ? normalizeGeoJsonGeometry(rawGeometry)
        : rawGeometry;

    if (!geometry) {
      return {
        id: item.id,
        ...(sourceFeatureId ? { sourceFeatureId } : {}),
        status: "rejected" as const,
        engine: result.engine,
        engineVersion: result.engineVersion,
        mode: result.mode,
        precision: result.precision,
        areaBefore: item.areaBefore,
        areaAfter: item.areaAfter,
        areaDifference: item.areaDifference,
        componentsDiscarded: item.componentsDiscarded,
        discardedComponents,
        message: "Repair engine did not return geometry and original geometry was unavailable."
      };
    }

    return {
      id: item.id,
      ...(sourceFeatureId ? { sourceFeatureId } : {}),
      status: item.status,
      geometry,
      bbox: computeGeometryBBox(geometry),
      center: normalizeLngLat(item.center ?? computeGeometryRepresentativePoint(geometry)),
      engine: result.engine,
      engineVersion: result.engineVersion,
      mode: result.mode,
      precision: result.precision,
      areaBefore: item.areaBefore,
      areaAfter: item.areaAfter,
      areaDifference: item.areaDifference,
      componentsDiscarded: item.componentsDiscarded,
      discardedComponents
    };
  });
  const repairedStatuses = new Set<TerritoryGeometryRepairStatus>([
    "geometry-repaired",
    "component-discarded"
  ]);

  return {
    engine: result.engine,
    engineVersion: result.engineVersion,
    mode: result.mode,
    precision: result.precision,
    featuresRepaired: results.filter((item) => repairedStatuses.has(item.status)).length,
    featuresUnchanged: results.filter((item) => item.status === "unchanged").length,
    featuresPrecisionNormalized: results.filter((item) => item.status === "precision-normalized")
      .length,
    featuresRingNormalized: results.filter((item) => item.status === "ring-normalized").length,
    featuresWithDiscardedComponents: results.filter((item) => item.componentsDiscarded > 0).length,
    featuresRejected: results.filter((item) => item.status === "rejected").length,
    areaDifference: roundCoordinate(
      results.reduce((sum, item) => sum + item.areaDifference, 0),
      result.precision
    ),
    componentsDiscarded: results.reduce((sum, item) => sum + item.componentsDiscarded, 0),
    results
  };
}

async function runShapelyRepair(
  features: readonly TerritoryGeometryRepairInputFeature[],
  options: { precision: number; pythonPath?: string }
): Promise<ShapelyRepairResult> {
  const pythonPath = options.pythonPath ?? "python3";
  const payload: ShapelyRepairPayload = {
    precision: options.precision,
    features: features.map((feature) => ({
      id: feature.id,
      ...(feature.sourceFeatureId ? { sourceFeatureId: feature.sourceFeatureId } : {}),
      geometry: unwrapAntimeridianGeometry(feature.geometry)
    }))
  };
  const raw = await runPythonJson(pythonPath, PYTHON_REPAIR_SCRIPT, payload);
  const parsed = JSON.parse(raw) as unknown;

  if (!isRecord(parsed) || parsed.ok !== true) {
    const message = isRecord(parsed) && typeof parsed.error === "string" ? parsed.error : raw;
    throw new Error(`Geometry repair engine failed: ${message}`);
  }

  return parsed as unknown as ShapelyRepairResult;
}

function runPythonJson(
  pythonPath: string,
  script: string,
  payload: ShapelyRepairPayload
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, ["-c", script], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8");
      const error = Buffer.concat(stderr).toString("utf8");

      if (code !== 0) {
        reject(new Error(`Geometry repair Python process exited ${code}: ${error || output}`));
        return;
      }

      resolve(output);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function createTypescriptRepairResult(
  features: readonly TerritoryGeometryRepairInputFeature[],
  precision: number
): ShapelyRepairResult {
  return {
    engine: "TypeScript fallback",
    engineVersion: "shapely-unavailable",
    mode: "make-valid",
    precision,
    results: features.map((feature) => {
      const geometry = normalizeGeoJsonGeometry(feature.geometry);
      return {
        id: feature.id,
        ...(feature.sourceFeatureId ? { sourceFeatureId: feature.sourceFeatureId } : {}),
        status: "unchanged",
        geometry,
        center: computeGeometryRepresentativePoint(geometry),
        areaBefore: computeGeometryArea(geometry),
        areaAfter: computeGeometryArea(geometry),
        areaDifference: 0,
        componentsDiscarded: 0,
        discardedComponents: []
      };
    })
  };
}

function normalizeGeoJsonGeometry(geometry: TerritoryGeometry): TerritoryGeometry {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: normalizePolygonCoordinates(geometry.coordinates as LngLat[][])
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: (geometry.coordinates as LngLat[][][]).map((polygon) =>
      normalizePolygonCoordinates(polygon)
    )
  };
}

function geometryHasOutOfRangeLongitude(geometry: TerritoryGeometry): boolean {
  return geometryToPolygons(geometry).some((polygon) =>
    polygon.some((ring) =>
      ring.some((point) => {
        const longitude = point[0];
        return longitude < -180 || longitude > 180;
      })
    )
  );
}

function normalizePolygonCoordinates(polygon: LngLat[][]): LngLat[][] {
  return polygon.map((ring) => normalizeRingCoordinates(ring)).filter((ring) => ring.length >= 4);
}

function normalizeRingCoordinates(ring: LngLat[]): LngLat[] {
  const normalized: LngLat[] = [];

  for (const point of ring) {
    const next = normalizeLngLat(point);
    const previous = normalized[normalized.length - 1];

    if (previous && pointsEqual(previous, next)) {
      continue;
    }

    normalized.push(next);
  }

  const first = normalized[0];
  const last = normalized[normalized.length - 1];

  if (first && last && !pointsEqual(first, last)) {
    normalized.push([...first] as LngLat);
  }

  return normalized.map((point) => [
    roundCoordinate(point[0], DEFAULT_PRECISION),
    roundCoordinate(point[1], DEFAULT_PRECISION)
  ]);
}

function unwrapAntimeridianGeometry(geometry: TerritoryGeometry): TerritoryGeometry {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: (geometry.coordinates as LngLat[][]).map((ring) => unwrapRing(ring))
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: (geometry.coordinates as LngLat[][][]).map((polygon) =>
      polygon.map((ring) => unwrapRing(ring))
    )
  };
}

function unwrapRing(ring: LngLat[]): LngLat[] {
  const first = ring[0];

  if (!first) {
    return [];
  }

  let offset = 0;
  let previous = first[0];

  return ring.map((point, index) => {
    if (index === 0) {
      previous = point[0];
      return [point[0], point[1]];
    }

    let longitude = point[0] + offset;
    const delta = longitude - previous;

    if (delta > 180) {
      offset -= 360;
      longitude = point[0] + offset;
    } else if (delta < -180) {
      offset += 360;
      longitude = point[0] + offset;
    }

    previous = longitude;
    return [longitude, point[1]];
  });
}

function pointCoveredByPolygon(point: LngLat, polygon: LngLat[][]): boolean {
  const shell = polygon[0];

  if (!shell || !pointInRingOrBoundary(point, shell)) {
    return false;
  }

  for (const hole of polygon.slice(1)) {
    if (pointInRingStrict(point, hole)) {
      return false;
    }
  }

  return true;
}

function pointCoveredByUnwrappedPolygon(point: LngLat, polygon: LngLat[][]): boolean {
  const unwrapped = polygon.map((ring) => unwrapRing(ring));

  return [0, 360, -360].some((longitudeOffset) =>
    pointCoveredByPolygon([point[0] + longitudeOffset, point[1]], unwrapped)
  );
}

function pointInRingOrBoundary(point: LngLat, ring: LngLat[]): boolean {
  if (pointOnRingBoundary(point, ring)) {
    return true;
  }

  return pointInRingStrict(point, ring);
}

function pointInRingStrict(point: LngLat, ring: LngLat[]): boolean {
  let inside = false;

  for (
    let index = 0, previousIndex = ring.length - 1;
    index < ring.length;
    previousIndex = index, index += 1
  ) {
    const current = ring[index];
    const previous = ring[previousIndex];

    if (!current || !previous) {
      continue;
    }

    const intersects =
      current[1] > point[1] !== previous[1] > point[1] &&
      point[0] <
        ((previous[0] - current[0]) * (point[1] - current[1])) / (previous[1] - current[1]) +
          current[0];

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointOnRingBoundary(point: LngLat, ring: LngLat[]): boolean {
  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];

    if (start && end && pointOnSegment(point, start, end)) {
      return true;
    }
  }

  return false;
}

function pointOnSegment(point: LngLat, start: LngLat, end: LngLat): boolean {
  const cross =
    (point[1] - start[1]) * (end[0] - start[0]) - (point[0] - start[0]) * (end[1] - start[1]);

  if (Math.abs(cross) > 1e-9) {
    return false;
  }

  return (
    point[0] >= Math.min(start[0], end[0]) - 1e-9 &&
    point[0] <= Math.max(start[0], end[0]) + 1e-9 &&
    point[1] >= Math.min(start[1], end[1]) - 1e-9 &&
    point[1] <= Math.max(start[1], end[1]) + 1e-9
  );
}

function findLargestOuterRing(geometry: TerritoryGeometry): LngLat[] | undefined {
  return geometryToPolygons(geometry)
    .map((polygon) => polygon[0])
    .filter((ring): ring is LngLat[] => Boolean(ring))
    .sort((left, right) => Math.abs(computeRingArea(right)) - Math.abs(computeRingArea(left)))[0];
}

function computeGeometryArea(geometry: TerritoryGeometry): number {
  return geometryToPolygons(geometry).reduce(
    (sum, polygon) =>
      sum +
      polygon.reduce((area, ring, index) => {
        const ringArea = Math.abs(computeRingArea(ring));
        return index === 0 ? area + ringArea : area - ringArea;
      }, 0),
    0
  );
}

function computeRingArea(ring: LngLat[]): number {
  let area = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];

    if (current && next) {
      area += current[0] * next[1] - next[0] * current[1];
    }
  }

  return area / 2;
}

function normalizeLngLat(point: LngLat): LngLat {
  return [normalizeLongitude(point[0]), point[1]];
}

function normalizeLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) {
    return longitude;
  }

  const normalized = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 && longitude > 0 ? 180 : normalized;
}

function roundCoordinate(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function pointsEqual(left: LngLat, right: LngLat): boolean {
  return Math.abs(left[0] - right[0]) <= 1e-12 && Math.abs(left[1] - right[1]) <= 1e-12;
}

function readRepairEngineFromEnv(): TerritoryGeometryRepairEngine {
  const value = process.env.TERRITORYKIT_GEOMETRY_REPAIR_ENGINE;

  return value === "shapely" || value === "typescript" ? value : "auto";
}

function readRepairPrecisionFromEnv(): number {
  const value = Number(process.env.TERRITORYKIT_GEOMETRY_REPAIR_PRECISION ?? DEFAULT_PRECISION);
  return Number.isInteger(value) && value >= 0 && value <= 12 ? value : DEFAULT_PRECISION;
}

function resolvePythonCandidates(options: { cwd: string; pythonPath?: string }): string[] {
  const candidates: string[] = [];

  if (options.pythonPath) {
    candidates.push(options.pythonPath);
  }

  const localVenvPython = join(
    options.cwd,
    ".territory",
    "tools",
    "geometry-repair-venv",
    "bin",
    "python"
  );

  if (existsSync(localVenvPython)) {
    candidates.push(localVenvPython);
  }

  candidates.push("python3");

  return [...new Set(candidates)];
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
