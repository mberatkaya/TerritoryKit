import { TerritoryError } from "@territory-kit/dataset";
import type {
  TerritoryRegistryArtifact,
  TerritoryRegistryResolvedArtifact
} from "@territory-kit/registry";

export type TerritoryMapLibreNativeAdminLayer = "ADM1" | "ADM2";

export interface TerritoryMapLibreNativeVectorSourceProps {
  readonly id: string;
  readonly url?: string;
  readonly tiles?: readonly string[];
  readonly minzoom?: number;
  readonly maxzoom?: number;
  readonly attribution?: string;
  readonly onPress?: (event: unknown) => void;
}

export interface TerritoryMapLibreNativeLayerProps {
  readonly id: string;
  readonly sourceID: string;
  readonly sourceLayerID: string;
  readonly minZoomLevel?: number;
  readonly maxZoomLevel?: number;
  readonly style: Readonly<Record<string, unknown>>;
}

export interface TerritoryMapLibreNativeMvtSourceOptions {
  readonly sourceId?: string;
  readonly sourceLayer?: string;
  readonly artifact?: TerritoryRegistryResolvedArtifact;
  readonly tileUrlTemplate?: string;
  readonly tileJsonUrl?: string;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly attribution?: string;
  readonly onTerritoryPress?: (event: TerritoryMapLibreNativeTerritoryPressEvent) => void;
}

export interface TerritoryMapLibreNativeMvtBundle {
  readonly source: TerritoryMapLibreNativeVectorSourceProps;
  readonly sourceLayer: string;
  readonly fillLayers: readonly TerritoryMapLibreNativeLayerProps[];
  readonly lineLayers: readonly TerritoryMapLibreNativeLayerProps[];
}

export interface TerritoryMapLibreNativeTerritoryPressEvent {
  readonly territoryId: string;
  readonly feature: Readonly<Record<string, unknown>>;
  readonly originalEvent: unknown;
}

export interface TerritoryMapLibreNativeRendererAdapter {
  readonly disposed: boolean;
  readonly selectedTerritoryId: string | undefined;
  createMvtBundle(
    options: TerritoryMapLibreNativeMvtSourceOptions
  ): TerritoryMapLibreNativeMvtBundle;
  setSelectedTerritoryId(territoryId: string | undefined): void;
  handlePress(event: unknown): TerritoryMapLibreNativeTerritoryPressEvent | undefined;
  dispose(): void;
}

export function createTerritoryMapLibreNativeMvtBundle(
  options: TerritoryMapLibreNativeMvtSourceOptions
): TerritoryMapLibreNativeMvtBundle {
  const sourceId = options.sourceId ?? "territory-kit-mobile";
  const sourceLayer = options.sourceLayer ?? inferSourceLayer(options.artifact?.artifact);
  const tiles = options.tileUrlTemplate ?? readArtifactTileTemplate(options.artifact);
  const onPress = options.onTerritoryPress
    ? (event: unknown) => {
        const parsed = readTerritoryPressEvent(event);

        if (parsed) {
          options.onTerritoryPress?.(parsed);
        }
      }
    : undefined;
  const source: TerritoryMapLibreNativeVectorSourceProps = {
    id: sourceId,
    ...(options.tileJsonUrl ? { url: options.tileJsonUrl } : {}),
    ...(!options.tileJsonUrl && tiles ? { tiles: [tiles] } : {}),
    ...(options.minZoom !== undefined ? { minzoom: options.minZoom } : {}),
    ...(options.maxZoom !== undefined ? { maxzoom: options.maxZoom } : {}),
    ...(options.attribution ? { attribution: options.attribution } : {}),
    ...(onPress ? { onPress } : {})
  };

  if (!source.url && !source.tiles) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      "MapLibre React Native MVT source requires tileJsonUrl, tileUrlTemplate, or a render artifact with tileUrlTemplate."
    );
  }

  return {
    source,
    sourceLayer,
    fillLayers: createTerritoryMapLibreNativeFillLayers({ sourceId, sourceLayer }),
    lineLayers: createTerritoryMapLibreNativeLineLayers({ sourceId, sourceLayer })
  };
}

export function createTerritoryMapLibreNativeRendererAdapter(
  input: {
    readonly onTerritoryPress?: (event: TerritoryMapLibreNativeTerritoryPressEvent) => void;
  } = {}
): TerritoryMapLibreNativeRendererAdapter {
  let disposed = false;
  let selectedTerritoryId: string | undefined;

  function assertUsable(): void {
    if (disposed) {
      throw new TerritoryError("ADAPTER_DISPOSED", "MapLibre Native renderer adapter is disposed.");
    }
  }

  return {
    get disposed() {
      return disposed;
    },
    get selectedTerritoryId() {
      return selectedTerritoryId;
    },
    createMvtBundle(options) {
      assertUsable();
      const onTerritoryPress = options.onTerritoryPress ?? input.onTerritoryPress;
      return createTerritoryMapLibreNativeMvtBundle({
        ...options,
        ...(onTerritoryPress ? { onTerritoryPress } : {})
      });
    },
    setSelectedTerritoryId(territoryId) {
      assertUsable();
      selectedTerritoryId = territoryId;
    },
    handlePress(event) {
      assertUsable();
      const parsed = readTerritoryPressEvent(event);

      if (parsed) {
        selectedTerritoryId = parsed.territoryId;
        input.onTerritoryPress?.(parsed);
      }

      return parsed;
    },
    dispose() {
      disposed = true;
      selectedTerritoryId = undefined;
    }
  };
}

export function createTerritoryMapLibreNativeFillLayers(input: {
  readonly sourceId: string;
  readonly sourceLayer: string;
  readonly selectedTerritoryId?: string;
}): readonly TerritoryMapLibreNativeLayerProps[] {
  return [
    {
      id: "territory-kit-adm1-fill",
      sourceID: input.sourceId,
      sourceLayerID: input.sourceLayer,
      minZoomLevel: 5,
      maxZoomLevel: 8,
      style: createFillStyle("#2563eb", input.selectedTerritoryId)
    },
    {
      id: "territory-kit-adm2-fill",
      sourceID: input.sourceId,
      sourceLayerID: input.sourceLayer,
      minZoomLevel: 8,
      maxZoomLevel: 14,
      style: createFillStyle("#16a34a", input.selectedTerritoryId)
    }
  ];
}

export function createTerritoryMapLibreNativeLineLayers(input: {
  readonly sourceId: string;
  readonly sourceLayer: string;
}): readonly TerritoryMapLibreNativeLayerProps[] {
  return [
    {
      id: "territory-kit-adm1-line",
      sourceID: input.sourceId,
      sourceLayerID: input.sourceLayer,
      minZoomLevel: 5,
      maxZoomLevel: 8,
      style: {
        lineColor: "#1e3a8a",
        lineWidth: 1.4,
        lineOpacity: 0.85
      }
    },
    {
      id: "territory-kit-adm2-line",
      sourceID: input.sourceId,
      sourceLayerID: input.sourceLayer,
      minZoomLevel: 8,
      maxZoomLevel: 14,
      style: {
        lineColor: "#14532d",
        lineWidth: 1,
        lineOpacity: 0.8
      }
    }
  ];
}

export function selectTerritoryMapLibreNativeLayerForZoom(
  zoom: number
): TerritoryMapLibreNativeAdminLayer {
  return zoom < 8 ? "ADM1" : "ADM2";
}

export function readTerritoryPressEvent(
  event: unknown
): TerritoryMapLibreNativeTerritoryPressEvent | undefined {
  const feature = readFirstFeature(event);
  const properties = readRecord(feature?.properties);
  const territoryId = readString(properties?.territoryId) ?? readString(properties?.id);

  if (!feature || !territoryId) {
    return undefined;
  }

  return {
    territoryId,
    feature,
    originalEvent: event
  };
}

function createFillStyle(
  color: string,
  selectedTerritoryId: string | undefined
): Readonly<Record<string, unknown>> {
  return {
    fillColor: selectedTerritoryId
      ? ["case", ["==", ["get", "territoryId"], selectedTerritoryId], "#f97316", color]
      : color,
    fillOpacity: selectedTerritoryId
      ? ["case", ["==", ["get", "territoryId"], selectedTerritoryId], 0.82, 0.42]
      : 0.42,
    fillOutlineColor: "#0f172a"
  };
}

function inferSourceLayer(artifact: TerritoryRegistryArtifact | undefined): string {
  const layer = readString(artifact?.layer) ?? readString(artifact?.sourceLayer);
  return layer ?? "territory";
}

function readArtifactTileTemplate(
  artifact: TerritoryRegistryResolvedArtifact | undefined
): string | undefined {
  const template = readString(artifact?.artifact.tileUrlTemplate);

  if (!template) {
    return undefined;
  }

  if (!artifact) {
    return template;
  }

  return /^[a-z][a-z0-9+.-]*:/i.test(template)
    ? template
    : new URL(template, artifact.url).toString();
}

function readFirstFeature(event: unknown): Record<string, unknown> | undefined {
  const record = readRecord(event);
  const nativeEvent = readRecord(record?.nativeEvent);
  const payload = readRecord(nativeEvent?.payload) ?? readRecord(record?.payload);
  const features =
    readArray(payload?.features) ?? readArray(nativeEvent?.features) ?? readArray(record?.features);
  const first = features?.[0];

  return readRecord(first);
}

function readString(input: unknown): string | undefined {
  return typeof input === "string" && input.length > 0 ? input : undefined;
}

function readArray(input: unknown): readonly unknown[] | undefined {
  return Array.isArray(input) ? input : undefined;
}

function readRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}
