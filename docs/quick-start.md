# Quick Start

```ts
import { createTerritoryEngine } from "@territory-kit/core";
import { loadTerritoryDataset } from "@territory-kit/dataset";

const dataset = loadTerritoryDataset(rawDataset);
const engine = createTerritoryEngine({ dataset });

const zoneId = engine.latLngToZone({ lat: 41.0082, lng: 28.9784 }, { level: 3 });
const boundary = zoneId ? engine.zoneToBoundary(zoneId) : null;
```

GeoJSON coordinates always use `[longitude, latitude]`. Public coordinate inputs use
`{ lat, lng }` for clarity.
