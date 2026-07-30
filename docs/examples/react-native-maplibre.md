# React Native MapLibre Example

MapLibre React Native is optional. Install it in the application when native maps are needed:

```sh
pnpm add @territory-kit/react-native @maplibre/maplibre-react-native
```

Map style URLs and tokens belong to the application. The TerritoryKit package only prepares source
and layer props.

## MVT Source And Layers

```tsx
import {
  Camera,
  FillLayer,
  LineLayer,
  MapView,
  VectorSource
} from "@maplibre/maplibre-react-native";
import {
  createTerritoryMapLibreNativeMvtBundle,
  selectTerritoryMapLibreNativeLayerForZoom
} from "@territory-kit/react-native/maplibre";

const bundle = createTerritoryMapLibreNativeMvtBundle({
  sourceId: "territory-kit-tr",
  sourceLayer: "territory",
  tileUrlTemplate: "https://datasets.example/tr/1.0.0/render/tiles/{z}/{x}/{y}.mvt",
  onTerritoryPress(event) {
    setSelectedTerritoryId(event.territoryId);
  }
});

export function TerritoryMap() {
  return (
    <MapView style={{ flex: 1 }} mapStyle={styleUrl}>
      <Camera zoomLevel={6} centerCoordinate={[32.85, 39.93]} />
      <VectorSource {...bundle.source}>
        {bundle.fillLayers.map((layer) => (
          <FillLayer key={layer.id} {...layer} />
        ))}
        {bundle.lineLayers.map((layer) => (
          <LineLayer key={layer.id} {...layer} />
        ))}
      </VectorSource>
    </MapView>
  );
}
```

The helper creates ADM1 layers for zoom 5-8 and ADM2 layers for zoom 8-14. Use
`selectTerritoryMapLibreNativeLayerForZoom(zoom)` when UI state needs to know which administrative
level is currently dominant.

## Selection

`VectorSource.onPress` receives MapLibre features from loaded vector tiles. TerritoryKit reads
`properties.territoryId` first and falls back to `properties.id`.

```ts
import { createTerritoryMapLibreNativeRendererAdapter } from "@territory-kit/react-native/maplibre";

const renderer = createTerritoryMapLibreNativeRendererAdapter({
  onTerritoryPress(event) {
    renderer.setSelectedTerritoryId(event.territoryId);
  }
});
```

Dispose renderer state when the React component unmounts:

```ts
useEffect(() => () => renderer.dispose(), [renderer]);
```

## Native Build Notes

MapLibre React Native wraps MapLibre Native for Android and iOS. Follow its platform setup for
Pods, Gradle, Expo config plugins, and new-architecture compatibility. CI should typecheck imports
and runtime contracts, but simulator/device rendering should stay in a separate native validation
job.

The official MapLibre React Native documentation describes `VectorSource` as the component for MVT
or TileJSON vector sources and exposes `tiles`, `url`, and `onPress` props.
