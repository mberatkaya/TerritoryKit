# Geometry Quality Pipeline

TerritoryKit geometry quality checks run on any `TerritoryDataset`. The pipeline is independent
from source adapters, NestJS, and PostGIS. Source imports may call it, but the validator itself
lives in `@territory-kit/dataset`.

## Programmatic API

```ts
import { validateGeometryDataset, repairGeometryDataset } from "@territory-kit/dataset";

const report = validateGeometryDataset(dataset, {
  mode: "validate-only",
  strict: true,
  checks: "full"
});

const repaired = repairGeometryDataset(dataset, {
  checks: "basic",
  maximumAreaDeltaRatio: 0.000001
});
```

`checks: "basic"` runs structural coordinate, ring, and bbox checks. `checks: "full"` adds
self-intersection, hole, antimeridian, center, parent-containment, and sibling-overlap checks.
Object-form checks can enable a narrower subset.

## CLI

```sh
territory geometry validate ./dataset --checks full --report ./geometry-report.json
territory geometry repair ./dataset --checks basic --output ./repaired-dataset --report ./repair-report.json
```

Exit codes are stable:

- `0`: valid dataset or successful repair.
- `1`: geometry validation errors.
- `2`: CLI/input error.
- `3`: repair rejected or repaired dataset failed revalidation.

## Reports

Reports include `ok`, `mode`, selected checks, backend id, issue list, summary counts, and
candidate/exact comparison counters. Repair reports additionally include per-feature audit records
with original/repaired geometry hashes, operations, area before/after, area delta, and acceptance.

## Source Pipeline

`runTerritorySourcePipeline` accepts `geometryQuality: "none" | "basic" | "full"`. The default is
`"basic"` so source imports catch structural geometry defects without making full topology checks a
mandatory cost. Generic build reports include a compact `geometryQuality` summary. Source-owned
artifact plans, such as Natural Earth world-countries checksummed files, keep their existing file
content stable; the full report remains available on `result.transform.geometryQuality`.
