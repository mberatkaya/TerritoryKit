# Turkey ADM3 Real Build Pipeline

`territory tr adm3 build` now writes real geometry artifacts instead of a provider-resolution plan.

The build reads the national Turkey ADM2 dataset, optionally loads ADM3 source artifacts, applies source priority, fills missing district geometry with generated zones, measures spatial coverage, and writes:

- `dataset.json`
- `coverage.json`
- `geometry-quality.json`
- `build-summary.json`
- `district-coverage.json`
- `adjacency/adjacency.json`
- `adjacency/build-report.json`
- `query/query-artifact.json`
- `render/`
- `provinces/<plate-code>/`
- `national/manifest.json`

Source priority is:

```text
official
runtime
osm
generated
```

Runtime sources stay disabled unless `--allow-runtime` is provided. Official, runtime, and OSM geometry is counted only when an artifact is actually supplied to the build. Provider availability alone is not coverage.

Useful commands:

```bash
pnpm turkey:adm3:production:smoke
pnpm data:tr:adm3:national:build
```

Current local production run status, generated on 2026-08-07:

- Official source artifact: loaded from `.territory/build/TR/ADM3/official/levels/ADM3/dataset.json`
- Official municipal polygons in final artifact: 3,338
- OSM PBF artifact: requested but not built (`sourceStatus.osm = "not-built"`)
- Generated fallback polygons in final artifact: 14,201
- Final zones: 17,539
- Final measured coverage: 99.985715%
- Coverage target met: no
- Geometry quality passed: no
- Final overlap count: 0
- Gap count: 162
- Parent containment errors: 11
- Validation issues: 751

The generated fill supports Polygon and MultiPolygon ADM2 geometry, holes, concave boundaries, disconnected pieces, and deterministic IDs/hashes.

The 2026-08-07 output is an evidence artifact, not a production approval. The largest remaining
coverage blockers are Gaziantep, Kayseri, Ordu, and Aksaray; see
`.territory/build/TR/ADM3/build-summary.json`, `.territory/build/TR/ADM3/coverage.json`, and
`.territory/build/TR/ADM3/geometry-quality.json` for the machine-readable blocker state.
