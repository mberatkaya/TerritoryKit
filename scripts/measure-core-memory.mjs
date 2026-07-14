import { createTerritoryEngine } from "../packages/core/dist/index.mjs";
import { createSyntheticGridDataset } from "../packages/shared-testkit/dist/index.mjs";

const sample = measureGridMemory({
  rows: 100,
  columns: 100,
  cellSize: 0.01
});

console.log(JSON.stringify(sample, null, 2));

if (sample.totalHeapBytes <= 0 || sample.engineHeapBytes <= 0) {
  console.error("Memory benchmark did not record a positive heap delta.");
  process.exit(1);
}

function measureGridMemory(options) {
  collectGarbage();
  const beforeDataset = process.memoryUsage().heapUsed;
  const dataset = createSyntheticGridDataset({
    ...options,
    withNeighbors: true
  });
  collectGarbage();
  const afterDataset = process.memoryUsage().heapUsed;
  const engine = createTerritoryEngine({ dataset });
  collectGarbage();
  const afterEngine = process.memoryUsage().heapUsed;

  return {
    fixture: `${options.rows}x${options.columns}`,
    features: dataset.zones.length,
    availableLevels: engine.availableLevels,
    datasetHeapBytes: afterDataset - beforeDataset,
    engineHeapBytes: afterEngine - afterDataset,
    totalHeapBytes: afterEngine - beforeDataset
  };
}

function collectGarbage() {
  if (globalThis.gc) {
    globalThis.gc();
  }
}
