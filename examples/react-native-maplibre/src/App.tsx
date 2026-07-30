import { useEffect, useMemo, useState } from "react";
import { AppState, SafeAreaView, Text, View } from "react-native";
import {
  Camera,
  FillLayer,
  LineLayer,
  MapView,
  VectorSource
} from "@maplibre/maplibre-react-native";
import {
  createMobileTerritoryRuntime,
  type MobileTerritoryStorageAdapter
} from "@territory-kit/react-native";
import {
  createTerritoryMapLibreNativeMvtBundle,
  createTerritoryMapLibreNativeRendererAdapter
} from "@territory-kit/react-native/maplibre";

const REGISTRY_URL = "https://datasets.example/registry.json";
const STYLE_URL = "https://demotiles.maplibre.org/style.json";

export function App({
  storageAdapter
}: {
  readonly storageAdapter: MobileTerritoryStorageAdapter;
}) {
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string>();
  const renderer = useMemo(
    () =>
      createTerritoryMapLibreNativeRendererAdapter({
        onTerritoryPress(event) {
          setSelectedTerritoryId(event.territoryId);
        }
      }),
    []
  );
  const runtime = useMemo(
    () =>
      createMobileTerritoryRuntime({
        registryUrl: REGISTRY_URL,
        storageAdapter,
        cachePolicy: {
          memoryMaxBytes: 4 * 1024 * 1024,
          backgroundMemoryMaxBytes: 512 * 1024,
          fallbackToInstalledOnNetworkError: true
        }
      }),
    [storageAdapter]
  );
  const bundle = useMemo(
    () =>
      renderer.createMvtBundle({
        sourceId: "territory-kit-tr",
        sourceLayer: "territory",
        tileUrlTemplate: "https://datasets.example/tr/1.0.0/render/tiles/{z}/{x}/{y}.mvt"
      }),
    [renderer]
  );

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      runtime.setAppState(state);
    });

    void runtime.cleanupPartialDownloads();
    void runtime.installDataset({
      datasetId: "territory-kit-tr",
      version: "1.0.0",
      levels: ["ADM0", "ADM1", "ADM2"]
    });

    return () => {
      appStateSubscription.remove();
      renderer.dispose();
      runtime.dispose();
    };
  }, [renderer, runtime]);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <MapView style={{ flex: 1 }} mapStyle={STYLE_URL}>
        <Camera zoomLevel={6} centerCoordinate={[32.85, 39.93]} />
        <VectorSource {...bundle.source} onPress={renderer.handlePress}>
          {bundle.fillLayers.map((layer) => (
            <FillLayer key={layer.id} {...layer} />
          ))}
          {bundle.lineLayers.map((layer) => (
            <LineLayer key={layer.id} {...layer} />
          ))}
        </VectorSource>
      </MapView>
      {selectedTerritoryId ? (
        <View style={{ padding: 12 }}>
          <Text>{selectedTerritoryId}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
