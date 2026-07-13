import type { Feature, FeatureCollection } from "geojson";
import type { TerritoryZone } from "@territory-kit/dataset";

export interface TerritoryMapLibreState {
  faction?: string;
  selected?: boolean;
  score?: number;
}

export interface TerritoryMapLibreFeatureProperties extends Record<string, unknown> {
  id: string;
  datasetId: string;
  level: number;
  parentId?: string;
  faction?: string;
  selected?: boolean;
  score?: number;
}

export interface TerritoryMapLibreLayerOptions {
  sourceId?: string;
  fillLayerId?: string;
  lineLayerId?: string;
  fillColor?: string;
  fillOpacity?: number;
  lineColor?: string;
  lineWidth?: number;
}

export interface TerritoryMapLibreTheme {
  fillColor?: string;
  fillOpacity?: number;
  lineColor?: string;
  lineWidth?: number;
}

export interface TerritoryMapLibreZoneEvent {
  zoneId: string;
  feature?: Feature;
  originalEvent: unknown;
}

export interface TerritoryMapLibreAdapterOptions extends TerritoryMapLibreLayerOptions {
  zones: TerritoryZone[];
  stateByZoneId?: ReadonlyMap<string, TerritoryMapLibreState>;
  onZoneClick?: (event: TerritoryMapLibreZoneEvent) => void;
  onZoneHover?: (event: TerritoryMapLibreZoneEvent) => void;
  onZoneLeave?: (event: TerritoryMapLibreZoneEvent) => void;
}

export interface TerritoryMapLibreGeoJsonSource {
  setData(data: FeatureCollection): void;
}

export interface TerritoryMapLibreMap {
  addLayer(layer: Record<string, unknown>): void;
  addSource(id: string, source: Record<string, unknown>): void;
  getLayer(id: string): unknown;
  getSource(id: string): TerritoryMapLibreGeoJsonSource | undefined;
  removeLayer(id: string): void;
  removeSource(id: string): void;
  setPaintProperty?(layerId: string, property: string, value: unknown): void;
  on?(type: string, layerId: string, listener: (event: unknown) => void): void;
  off?(type: string, layerId: string, listener: (event: unknown) => void): void;
}

export interface TerritoryMapLibreAdapter {
  attach(map: TerritoryMapLibreMap): void;
  detach(): void;
  updateData(
    zones: TerritoryZone[],
    stateByZoneId?: ReadonlyMap<string, TerritoryMapLibreState>
  ): void;
  updateTheme(theme: TerritoryMapLibreTheme): void;
}

export interface TerritoryMapLibreLayerBundle {
  source: {
    id: string;
    spec: {
      type: "geojson";
      data: FeatureCollection;
      promoteId: "id";
    };
  };
  layers: Array<Record<string, unknown>>;
}

export function zonesToFeatureCollection(
  zones: TerritoryZone[],
  stateByZoneId: ReadonlyMap<string, TerritoryMapLibreState> = new Map()
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones.map((zone): Feature => {
      const state = stateByZoneId.get(zone.id);
      const properties: TerritoryMapLibreFeatureProperties = {
        ...zone.properties,
        id: zone.id,
        datasetId: zone.datasetId,
        level: zone.level,
        ...(zone.parentId ? { parentId: zone.parentId } : {}),
        ...(state?.faction ? { faction: state.faction } : {}),
        ...(state?.selected !== undefined ? { selected: state.selected } : {}),
        ...(state?.score !== undefined ? { score: state.score } : {})
      };

      return {
        type: "Feature",
        id: zone.id,
        geometry: zone.geometry,
        properties
      };
    })
  };
}

export function createTerritoryMapLibreLayers(
  zones: TerritoryZone[],
  options: TerritoryMapLibreLayerOptions = {}
): TerritoryMapLibreLayerBundle {
  const sourceId = options.sourceId ?? "territory-kit-zones";
  const fillLayerId = options.fillLayerId ?? "territory-kit-zones-fill";
  const lineLayerId = options.lineLayerId ?? "territory-kit-zones-line";

  return {
    source: {
      id: sourceId,
      spec: {
        type: "geojson",
        data: zonesToFeatureCollection(zones),
        promoteId: "id"
      }
    },
    layers: [
      {
        id: fillLayerId,
        type: "fill",
        source: sourceId,
        paint: {
          "fill-color": [
            "case",
            ["boolean", ["get", "selected"], false],
            "#f97316",
            ["==", ["get", "faction"], "blue"],
            "#2563eb",
            ["==", ["get", "faction"], "red"],
            "#dc2626",
            options.fillColor ?? "#1f8a70"
          ],
          "fill-opacity": options.fillOpacity ?? 0.35
        }
      },
      {
        id: lineLayerId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": options.lineColor ?? "#0f172a",
          "line-width": options.lineWidth ?? 1.25
        }
      }
    ]
  };
}

export function createTerritoryMapLibreAdapter(
  options: TerritoryMapLibreAdapterOptions
): TerritoryMapLibreAdapter {
  const sourceId = options.sourceId ?? "territory-kit-zones";
  const fillLayerId = options.fillLayerId ?? "territory-kit-zones-fill";
  const lineLayerId = options.lineLayerId ?? "territory-kit-zones-line";
  let map: TerritoryMapLibreMap | undefined;
  let zones = [...options.zones];
  let stateByZoneId = options.stateByZoneId ?? new Map<string, TerritoryMapLibreState>();

  const clickListener = (event: unknown): void => {
    dispatchZoneEvent(event, options.onZoneClick);
  };
  const hoverListener = (event: unknown): void => {
    dispatchZoneEvent(event, options.onZoneHover);
  };
  const leaveListener = (event: unknown): void => {
    dispatchZoneEvent(event, options.onZoneLeave);
  };

  function currentBundle(): TerritoryMapLibreLayerBundle {
    return createTerritoryMapLibreLayers(zones, {
      sourceId,
      fillLayerId,
      lineLayerId,
      ...(options.fillColor === undefined ? {} : { fillColor: options.fillColor }),
      ...(options.fillOpacity === undefined ? {} : { fillOpacity: options.fillOpacity }),
      ...(options.lineColor === undefined ? {} : { lineColor: options.lineColor }),
      ...(options.lineWidth === undefined ? {} : { lineWidth: options.lineWidth })
    });
  }

  function dispatchZoneEvent(
    event: unknown,
    callback: ((event: TerritoryMapLibreZoneEvent) => void) | undefined
  ): void {
    if (!callback) {
      return;
    }

    const feature = readFirstFeature(event);
    const zoneId = readFeatureZoneId(feature);

    if (!zoneId) {
      return;
    }

    callback({
      zoneId,
      ...(feature ? { feature } : {}),
      originalEvent: event
    });
  }

  return {
    attach(nextMap) {
      map = nextMap;
      const bundle = currentBundle();

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, bundle.source.spec);
      }

      for (const layer of bundle.layers) {
        const layerId = String(layer.id);

        if (!map.getLayer(layerId)) {
          map.addLayer(layer);
        }
      }

      map.on?.("click", fillLayerId, clickListener);
      map.on?.("mousemove", fillLayerId, hoverListener);
      map.on?.("mouseleave", fillLayerId, leaveListener);
    },

    detach() {
      if (!map) {
        return;
      }

      map.off?.("click", fillLayerId, clickListener);
      map.off?.("mousemove", fillLayerId, hoverListener);
      map.off?.("mouseleave", fillLayerId, leaveListener);

      for (const layerId of [lineLayerId, fillLayerId]) {
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
      }

      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }

      map = undefined;
    },

    updateData(nextZones, nextStateByZoneId = stateByZoneId) {
      zones = [...nextZones];
      stateByZoneId = nextStateByZoneId;
      map?.getSource(sourceId)?.setData(zonesToFeatureCollection(zones, stateByZoneId));
    },

    updateTheme(theme) {
      if (!map?.setPaintProperty) {
        return;
      }

      if (theme.fillColor !== undefined) {
        map.setPaintProperty(fillLayerId, "fill-color", theme.fillColor);
      }

      if (theme.fillOpacity !== undefined) {
        map.setPaintProperty(fillLayerId, "fill-opacity", theme.fillOpacity);
      }

      if (theme.lineColor !== undefined) {
        map.setPaintProperty(lineLayerId, "line-color", theme.lineColor);
      }

      if (theme.lineWidth !== undefined) {
        map.setPaintProperty(lineLayerId, "line-width", theme.lineWidth);
      }
    }
  };
}

function readFirstFeature(event: unknown): Feature | undefined {
  if (!isRecord(event) || !Array.isArray(event.features)) {
    return undefined;
  }

  return event.features[0] as Feature | undefined;
}

function readFeatureZoneId(feature: Feature | undefined): string | undefined {
  if (!feature) {
    return undefined;
  }

  if (typeof feature.id === "string" || typeof feature.id === "number") {
    return String(feature.id);
  }

  if (isRecord(feature.properties)) {
    const id = feature.properties.id;

    if (typeof id === "string" || typeof id === "number") {
      return String(id);
    }
  }

  return undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
