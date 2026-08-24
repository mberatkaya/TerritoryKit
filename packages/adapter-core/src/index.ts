import {
  TerritoryError,
  createTerritoryGeometryVersion,
  hasRingSelfIntersection
} from "@territory-kit/dataset";
import type {
  LngLat,
  TerritoryErrorCode,
  TerritoryGeometry,
  TerritoryZone
} from "@territory-kit/dataset";
import type { Feature, FeatureCollection } from "geojson";

export const TERRITORY_ADAPTER_CAPABILITY_NAMES = [
  "geoJson",
  "vectorTiles",
  "featureState",
  "hover",
  "click",
  "selection",
  "symbols",
  "transitions",
  "runtimeThemeUpdates",
  "sourceReplacement",
  "viewportEvents"
] as const;

export type TerritoryAdapterCapabilityName = (typeof TERRITORY_ADAPTER_CAPABILITY_NAMES)[number];

export type TerritoryAdapterCapabilities = Readonly<
  Record<TerritoryAdapterCapabilityName, boolean> & Record<string, boolean>
>;

export type TerritoryAdapterCapabilitiesInput = Partial<
  Record<TerritoryAdapterCapabilityName, boolean | undefined>
> &
  Readonly<Record<string, boolean | undefined>>;

export type TerritoryAdapterLifecycleState =
  "detached" | "attaching" | "attached" | "detaching" | "disposed" | "error";

export type TerritoryRenderSourceType = "geojson" | "vector-tiles";

export interface TerritoryRenderSource {
  readonly id: string;
  readonly type: TerritoryRenderSourceType;
  readonly data?: unknown;
  readonly url?: string;
  readonly tiles?: readonly string[];
  readonly sourceLayer?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TerritoryAdapterOperationContext {
  readonly requestId: string;
  readonly revision: number;
  readonly signal?: AbortSignal;
}

export interface TerritoryRenderTheme {
  readonly fillColor?: string;
  readonly fillOpacity?: number;
  readonly lineColor?: string;
  readonly lineWidth?: number;
  readonly hoverFillColor?: string;
  readonly selectedFillColor?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TerritoryRenderSelection {
  readonly territoryId: string;
  readonly selected?: boolean;
  readonly hover?: boolean;
  readonly properties?: Readonly<Record<string, unknown>>;
}

export interface TerritoryRenderState {
  readonly selectedTerritoryIds?: readonly string[];
  readonly hoverTerritoryId?: string;
  readonly hiddenTerritoryIds?: readonly string[];
  readonly stateByTerritoryId?: ReadonlyMap<string, TerritoryRenderSelection>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TerritoryRenderTransition {
  readonly durationMs: number;
  readonly easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type TerritoryRenderEventType =
  | "click"
  | "hover"
  | "leave"
  | "viewport-change"
  | "source-change"
  | "state-change"
  | "theme-change"
  | "error";

export interface TerritoryRenderViewport {
  readonly bounds: {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
  };
  readonly zoom?: number;
  readonly bearing?: number;
  readonly pitch?: number;
  readonly center?: {
    readonly lat: number;
    readonly lng: number;
  };
}

export interface TerritoryRenderEvent {
  readonly type: TerritoryRenderEventType;
  readonly territoryId?: string;
  readonly sourceId?: string;
  readonly viewport?: TerritoryRenderViewport;
  readonly originalEvent?: unknown;
  readonly error?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TerritoryRendererAdapter<TTarget = unknown> {
  readonly capabilities: TerritoryAdapterCapabilities;
  readonly lifecycleState: TerritoryAdapterLifecycleState;
  readonly managedSourceId?: string;
  attach(target: TTarget): void | Promise<void>;
  detach(): void | Promise<void>;
  setSource(
    source: TerritoryRenderSource,
    context?: TerritoryAdapterOperationContext
  ): void | Promise<void>;
  updateState(state: TerritoryRenderState): void | Promise<void>;
  updateTheme(theme: TerritoryRenderTheme): void | Promise<void>;
}

export interface TerritoryGeoJsonFeatureProperties extends Record<string, unknown> {
  id: string;
  territoryId: string;
  datasetId: string;
  datasetVersion?: string;
  geometryVersion?: string;
  level: number;
  adminLevel: string;
  countryCode?: string;
  name?: string;
  parentId?: string;
}

export type TerritoryGeoJsonPropertyMode = "all" | "minimal";

export interface TerritoryZonesToFeatureCollectionOptions<TState extends object> {
  readonly stateByZoneId?: ReadonlyMap<string, TState>;
  readonly propertyMode?: TerritoryGeoJsonPropertyMode;
  readonly datasetVersion?: string;
  readonly includeGeometryVersion?: boolean;
  readonly simplifyTolerance?: number;
}

export interface TerritoryAdapterLifecycleController<TTarget = unknown> {
  readonly lifecycleState: TerritoryAdapterLifecycleState;
  readonly target: TTarget | undefined;
  attach(target: TTarget): "attached" | "refreshed" | "replaced";
  detach(): "detached" | "noop";
  dispose(): "disposed" | "noop";
  fail(error: unknown): TerritoryError;
  assertAttached(action: string): void;
}

const DEFAULT_CAPABILITIES = Object.freeze(
  Object.fromEntries(TERRITORY_ADAPTER_CAPABILITY_NAMES.map((name) => [name, false]))
) as TerritoryAdapterCapabilities;

export function defineTerritoryAdapterCapabilities(
  capabilities: TerritoryAdapterCapabilitiesInput = {}
): TerritoryAdapterCapabilities {
  const normalized: Record<string, boolean> = { ...DEFAULT_CAPABILITIES };

  for (const [key, value] of Object.entries(capabilities)) {
    if (value !== undefined) {
      normalized[key] = value;
    }
  }

  return Object.freeze(normalized) as TerritoryAdapterCapabilities;
}

export function hasTerritoryAdapterCapability(
  capabilities: TerritoryAdapterCapabilities,
  capability: string
): boolean {
  return capabilities[capability] === true;
}

export function assertTerritoryAdapterCapability(
  capabilities: TerritoryAdapterCapabilities,
  capability: string,
  action = capability
): void {
  if (!hasTerritoryAdapterCapability(capabilities, capability)) {
    throw new TerritoryError(
      "CAPABILITY_UNSUPPORTED",
      `Adapter capability '${capability}' is not supported.`,
      {
        details: { capability, action }
      }
    );
  }
}

export function assertTerritoryAdapterAttached(
  lifecycleState: TerritoryAdapterLifecycleState,
  action: string
): void {
  if (lifecycleState === "disposed") {
    throw adapterLifecycleError(
      "ADAPTER_DISPOSED",
      `Cannot ${action} after the adapter has been disposed.`,
      lifecycleState,
      action
    );
  }

  if (lifecycleState !== "attached") {
    throw adapterLifecycleError(
      "ADAPTER_NOT_ATTACHED",
      `Cannot ${action} before the adapter is attached.`,
      lifecycleState,
      action
    );
  }
}

export function territoryZonesToFeatureCollection<TState extends object = never>(
  zones: readonly TerritoryZone[],
  options: TerritoryZonesToFeatureCollectionOptions<TState> = {}
): FeatureCollection {
  const propertyMode = options.propertyMode ?? "all";

  return {
    type: "FeatureCollection",
    features: zones.map((zone): Feature => {
      const state = options.stateByZoneId?.get(zone.id);
      const baseProperties: TerritoryGeoJsonFeatureProperties = {
        id: zone.id,
        territoryId: zone.id,
        datasetId: zone.datasetId,
        ...(options.datasetVersion ? { datasetVersion: options.datasetVersion } : {}),
        ...(options.includeGeometryVersion
          ? { geometryVersion: createTerritoryGeometryVersion(zone.geometry) }
          : {}),
        level: zone.level,
        adminLevel: `ADM${zone.level}`,
        ...(zone.countryCode ? { countryCode: zone.countryCode } : {}),
        ...(zone.name ? { name: zone.name } : {}),
        ...(zone.parentId ? { parentId: zone.parentId } : {})
      };
      const properties: TerritoryGeoJsonFeatureProperties = {
        ...(propertyMode === "all" ? zone.properties : {}),
        ...(state ?? {}),
        ...baseProperties
      };

      return {
        type: "Feature",
        id: zone.id,
        geometry:
          options.simplifyTolerance !== undefined && options.simplifyTolerance > 0
            ? simplifyTerritoryGeometry(zone.geometry, options.simplifyTolerance)
            : zone.geometry,
        properties
      };
    })
  };
}

export function simplifyTerritoryGeometry(
  geometry: TerritoryGeometry,
  tolerance: number
): TerritoryGeometry {
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    return geometry;
  }

  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) =>
        simplifyClosedRing(ring as LngLat[], tolerance)
      )
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((polygon) =>
      polygon.map((ring) => simplifyClosedRing(ring as LngLat[], tolerance))
    )
  };
}

export function estimateTerritoryFeatureCollectionBytes(collection: FeatureCollection): number {
  return new TextEncoder().encode(JSON.stringify(collection)).byteLength;
}

function simplifyClosedRing(ring: LngLat[], tolerance: number): LngLat[] {
  if (ring.length <= 4) {
    return ring;
  }

  const openRing = isClosedRing(ring) ? ring.slice(0, -1) : [...ring];
  const simplifiedOpenRing = simplifyOpenLine(openRing, tolerance);
  const simplifiedRing = closeRing(simplifiedOpenRing);

  if (
    simplifiedRing.length < 4 ||
    uniqueCoordinateCount(simplifiedRing) < 3 ||
    hasRingSelfIntersection(simplifiedRing)
  ) {
    return ring;
  }

  return simplifiedRing;
}

function simplifyOpenLine(points: LngLat[], tolerance: number): LngLat[] {
  if (points.length <= 2) {
    return points;
  }

  let maxDistance = 0;
  let maxIndex = 0;
  const start = points[0];
  const end = points.at(-1);

  if (!start || !end) {
    return points;
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];

    if (!point) {
      continue;
    }

    const distance = perpendicularDistance(point, start, end);

    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = index;
    }
  }

  if (maxDistance <= tolerance) {
    return [start, end];
  }

  const left = simplifyOpenLine(points.slice(0, maxIndex + 1), tolerance);
  const right = simplifyOpenLine(points.slice(maxIndex), tolerance);

  return left.slice(0, -1).concat(right);
}

function perpendicularDistance(point: LngLat, start: LngLat, end: LngLat): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const denominator = Math.sqrt(dx * dx + dy * dy);

  if (denominator === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }

  return (
    Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / denominator
  );
}

function closeRing(ring: LngLat[]): LngLat[] {
  const first = ring[0];
  const last = ring.at(-1);

  if (!first) {
    return ring;
  }

  return last && coordinatesEqual(first, last) ? ring : [...ring, first];
}

function isClosedRing(ring: LngLat[]): boolean {
  const first = ring[0];
  const last = ring.at(-1);

  return Boolean(first && last && coordinatesEqual(first, last));
}

function uniqueCoordinateCount(ring: LngLat[]): number {
  return new Set(ring.slice(0, -1).map((coordinate) => coordinate.join(","))).size;
}

function coordinatesEqual(left: LngLat, right: LngLat): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

export function isTerritoryFeatureCollection(input: unknown): input is FeatureCollection {
  return isRecord(input) && input.type === "FeatureCollection" && Array.isArray(input.features);
}

export function readTerritoryFeatureId(feature: unknown): string | undefined {
  if (!isRecord(feature)) {
    return undefined;
  }

  const properties = isRecord(feature.properties) ? feature.properties : undefined;
  const territoryId = properties?.territoryId;

  if (typeof territoryId === "string" || typeof territoryId === "number") {
    return String(territoryId);
  }

  const id = feature.id;

  if (typeof id === "string" || typeof id === "number") {
    return String(id);
  }

  const propertyId = properties?.id;

  if (typeof propertyId === "string" || typeof propertyId === "number") {
    return String(propertyId);
  }

  return undefined;
}

export function readFirstTerritoryRenderFeature(event: unknown): unknown {
  if (!isRecord(event)) {
    return undefined;
  }

  if (Array.isArray(event.features)) {
    return event.features[0];
  }

  if ("feature" in event) {
    return event.feature;
  }

  const layer = isRecord(event.layer) ? event.layer : undefined;
  if (layer && "feature" in layer) {
    return layer.feature;
  }

  const target = isRecord(event.target) ? event.target : undefined;
  if (target && "feature" in target) {
    return target.feature;
  }

  return undefined;
}

export function createTerritoryAdapterLifecycle<TTarget = unknown>(
  initialTarget?: TTarget
): TerritoryAdapterLifecycleController<TTarget> {
  let lifecycleState: TerritoryAdapterLifecycleState =
    initialTarget === undefined ? "detached" : "attached";
  let target = initialTarget;

  return {
    get lifecycleState() {
      return lifecycleState;
    },
    get target() {
      return target;
    },
    attach(nextTarget) {
      if (lifecycleState === "disposed") {
        throw adapterLifecycleError(
          "ADAPTER_DISPOSED",
          "Cannot attach a disposed adapter.",
          lifecycleState,
          "attach"
        );
      }

      const result =
        target === undefined
          ? "attached"
          : Object.is(target, nextTarget)
            ? "refreshed"
            : "replaced";
      lifecycleState = "attached";
      target = nextTarget;
      return result;
    },
    detach() {
      if (lifecycleState === "disposed" || target === undefined) {
        return "noop";
      }

      target = undefined;
      lifecycleState = "detached";
      return "detached";
    },
    dispose() {
      if (lifecycleState === "disposed") {
        return "noop";
      }

      target = undefined;
      lifecycleState = "disposed";
      return "disposed";
    },
    fail(error) {
      const territoryError =
        error instanceof TerritoryError
          ? error
          : new TerritoryError("UNKNOWN", "Adapter operation failed.", { cause: error });

      if (lifecycleState !== "disposed") {
        lifecycleState = "error";
      }

      return territoryError;
    },
    assertAttached(action) {
      assertTerritoryAdapterAttached(lifecycleState, action);
    }
  };
}

function adapterLifecycleError(
  code: Extract<TerritoryErrorCode, "ADAPTER_DISPOSED" | "ADAPTER_NOT_ATTACHED">,
  message: string,
  lifecycleState: TerritoryAdapterLifecycleState,
  action: string
): TerritoryError {
  return new TerritoryError(code, message, {
    details: { lifecycleState, action }
  });
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
