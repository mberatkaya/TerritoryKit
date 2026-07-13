import { createTerritoryEngine } from "@territory-kit/core";
import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";

const engine = createTerritoryEngine({ dataset: createSampleTerritoryDataset() });
const zoneId = engine.latLngToZone({ lat: 41.01, lng: 28.95 }, { level: 3 });

console.log({ zoneId, parent: zoneId ? engine.zoneToParent(zoneId) : null });
