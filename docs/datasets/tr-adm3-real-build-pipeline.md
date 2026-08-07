# Turkey ADM3 Real Build Pipeline

`territory tr adm3 build` now writes real geometry artifacts instead of a provider-resolution plan.

The build reads the national Turkey ADM2 dataset, optionally loads ADM3 source artifacts, applies source priority, fills missing district geometry with generated zones, measures spatial coverage, and writes:

- `dataset.json`
- `coverage.json`
- `geometry-quality.json`
- `build-summary.json`

Source priority is:

```text
official
runtime
osm
generated
```

Runtime sources stay disabled unless `--allow-runtime` is provided. Official, runtime, and OSM geometry is counted only when an artifact is actually supplied to the build. Provider availability alone is not coverage.

Current checked-in report status:

- Official source artifacts: not built
- OSM PBF artifact: not built
- Generated fill: built from real ADM2 geometry
- Final measured coverage: 99.999305%

The generated fill supports Polygon and MultiPolygon ADM2 geometry, holes, concave boundaries, disconnected pieces, and deterministic IDs/hashes.
