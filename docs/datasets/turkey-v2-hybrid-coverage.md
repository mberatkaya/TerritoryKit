# Turkey V2 Hybrid Coverage Pipeline

Turkey V2 hybrid coverage builds one playable ADM3-like layer per ADM2 district while preserving
real administrative polygons where they are available.

The source priority is fixed:

```text
official ADM3
  -> OSM administrative ADM3
  -> OSM barrier snapshot input
  -> smart-derived generated fallback
  -> legacy generated fallback
```

`sourceClass` remains `official`, `osm`, or `generated`; the OSM barrier snapshot is an input to
smart fallback, not an ADM3 polygon source. This reusable single-district and batch pipeline is the
merge engine used by the 81-province/973-district Turkey V2 national playable build.

## Public API

```ts
import {
  buildTurkeyV2HybridBatch,
  buildTurkeyV2HybridDistrict
} from "@territory-kit/generators/turkey-adm3";

const result = await buildTurkeyV2HybridDistrict({
  district,
  provinceCode: "34",
  districtCode: "003",
  officialZones,
  osmZones,
  generated: {
    enabled: true,
    profile: "auto",
    seed: "kaprota-v2"
  },
  buildDate: "2026-08-13T00:00:00.000Z"
});
```

`buildTurkeyV2HybridBatch` accepts a deterministic district list plus per-district official/OSM
sources. Districts are sorted by stable ID, duplicate district IDs are rejected, and partial builds
require `continueOnError`.

## Geometry Flow

For each district:

1. Official candidates are clipped to the ADM2 geometry.
2. Same-source official overlaps are reported and resolved deterministically by stable/source key.
3. OSM candidates are clipped to the ADM2 geometry.
4. Official effective coverage is removed from OSM.
5. Official plus effective OSM coverage becomes the real mask.
6. Missing geometry is computed as `district - realMask`.
7. If a verified OSM barrier artifact is available and eligible, it is adapted into smart fallback
   input for that missing geometry.
8. Smart-derived output is accepted only when its quality gates pass; otherwise legacy generated
   zones fill the remaining geometry when fallback is enabled.
9. Final official, OSM administrative, and generated zones are validated and used to build
   adjacency.

Generated zones never replace or cover real polygons. OSM zones never cover official effective
geometry. OSM road, rail, water, park, landuse, and locality seed artifacts are not promoted to OSM
administrative ADM3 zones.

## Source And Provider Classes

Final zone `sourceClass` is always one of:

- `official`
- `osm`
- `generated`

`providerClass` remains separate. A runtime-only municipality source can be represented as
`providerClass: "runtime"` with final `sourceClass: "official"` and
`redistributionPolicy: "runtime-only"`. Experimental sources are excluded by default and require
explicit opt-in.

## Identity

Official and OSM zones preserve their TerritoryKit ID and `sourceNativeId` when clipping changes
geometry inside the same parent district. Generated zones use Sprint 2
`tr-adm3-game-zone-v2` metadata and stable IDs. Array index alone is not used as an identity source.

If a future source update forces replacement, split, merge, parent change, or source-class change,
the migration plan records evidence instead of applying ownership or score transfers.

## Reports And Artifacts

The district result includes:

- `dataset.json`
- `full.geojson`
- `coverage.json`
- `quality-report.json`
- `provenance.json`
- `rejection-report.json`
- `migration-plan.json`
- `attribution.json`
- `attribution.txt`
- `licenses.json`
- `distribution-policy.json`
- `adjacency/adjacency.json`
- `adjacency/build-report.json`
- `configuration.json`
- `source-lock-summary.json`
- `checksums.json`

The batch result also writes `batch-summary.json`, `failed-districts.json`, and per-district report
folders.

When a district attempts smart fallback, `quality-report.json` includes `smartAttempt`:

- `accepted` and `selectedFallback` show whether smart output was published or legacy generated
  fallback was selected.
- `metrics` mirrors the smart quality report: coverage, spill, overlap, quality distribution,
  real-barrier alignment, split/merge counts, and barrier counts.
- `gates`, `errorCodes`, and `reasonCodes` make rejection causes machine-readable.
- `inputDiagnostics` and `coverageComputation` expose raw OSM layer counts and raw topology areas
  used by the smart fallback gate decision.

District build summaries also include `selectedFallback`; batch summaries include smart-attempt,
smart-accepted, and smart-to-legacy fallback counts.

## Licensing

The hybrid dataset manifest uses `license: "mixed"`. Per-zone provenance and attribution preserve
the real source license. OSM polygons keep `ODbL-1.0` and OpenStreetMap attribution. Generated
zones are marked as TerritoryKit-generated and do not inherit official or OSM data licenses.
Smart-derived zones that use OSM barrier artifacts carry OSM snapshot attribution in provenance,
but still remain generated, estimated, and non-administrative.

## Quality Gates

Publish-ready district output requires:

- final coverage >= 99.99%
- effective sibling overlap = 0 beyond tolerance
- real/generated overlap = 0 beyond tolerance
- parent containment errors = 0
- invalid final geometry = 0
- empty final geometry = 0
- duplicate stable IDs = 0
- missing required provenance = 0
- generated metadata errors = 0
- strict Turkey V2 validation errors = 0
- adjacency integrity errors = 0

Raw source issues are not hidden. Rejected candidates are recorded with reason, area accounting,
source identity, provider, severity, and manual-review status.

## CLI

```sh
territory tr adm3 hybrid build \
  --district ./adm2-dataset.json \
  --district-id tr:adm2:example \
  --official ./official-adm3.json \
  --osm ./osm-adm3.json \
  --profile auto \
  --seed kaprota-v2 \
  --build-date 2026-08-13T00:00:00.000Z \
  --output ./dist/tr-v2-hybrid
```

`territory tr adm3 build --hybrid ...` routes to the same implementation. Use `--batch` with a
dataset containing multiple ADM2 zones. Existing output paths are protected unless `--force` is
passed.

## Benchmarks

Run:

```sh
pnpm turkey:adm3:hybrid:smoke
pnpm turkey:adm3:hybrid:benchmark
```

The representative 2026-08-13 benchmark writes `reports/tr-adm3/hybrid-benchmark.json`. It covers
official-only, generated-only, official+generated, official+OSM+generated, complex MultiPolygon,
10-district batch, and 100-district batch scenarios. These are deterministic fixtures, not a final
national source build. Use `pnpm turkey:v2:national:benchmark` for the national CLI benchmark and
see [Turkey V2 national playable dataset](./turkey-v2-national-playable.md) for full-build reports.
