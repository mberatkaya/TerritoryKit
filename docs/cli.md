# CLI

The CLI is JSON-first so import pipelines can parse every command.

```sh
territory validate dataset.json
territory index dataset.json
territory adjacency build ./dist/regions --output ./dist/regions-adjacency
territory adjacency validate ./dist/regions ./dist/regions-adjacency
territory adjacency inspect ./dist/regions-adjacency tr:adm2:fatih --type shared-border --json
territory import source.geojson --dataset-id demo --source-date 2026-07
territory source list
territory source info natural-earth
territory import natural-earth --input ./natural-earth.geojson --output ./dist/world-countries
territory import geoboundaries --input ./geoBoundaries-TUR-ADM1.geojson --country TR --admin-level ADM1 --output ./dist/tr-adm1
territory import geojson --input ./regions.geojson --country TR --admin-level ADM2 --name-property region.name --output ./dist/regions
territory country list
territory country source lock TR --output ./dist/tr/sources.lock.json
territory country source verify ./dist/tr/sources.lock.json
territory country build TR --source-lock ./dist/tr/sources.lock.json --output ./dist/tr --build-adjacency --strict
territory country validate ./dist/tr --strict
territory country inspect ./dist/tr
territory geometry validate ./dist/regions --checks full --report ./geometry-report.json
territory geometry repair ./dist/regions --checks basic --output ./dist/regions-repaired --report ./repair-report.json
territory simplify dataset.json
territory generate --kind grid --dataset-id demo --rows 10 --columns 10
territory generate --kind weighted-voronoi --dataset-id demo
territory dataset build world-countries --source ./sources/ne-admin0.geojson --output ./dist/world-countries
```

Every command returns:

```json
{
  "ok": true,
  "command": "index",
  "data": {}
}
```

Errors use `issues`; GeoJSON import issues include `featureId`, `sourcePath`, and
`repairSuggestion` when available.

`territory import` recomputes `manifest.geometryHash` before printing the imported dataset,
even when the manifest flag used `import-pending`.

`territory import <source-id>` uses the source adapter pipeline. Common options are `--input`,
`--url`, `--output`, `--source-version`, `--source-date`, `--source-sha256`, `--strict`, `--force`,
`--refresh`, `--no-cache`, `--cache-dir`, and `--build-date`.

`territory generate` rejects invalid grid dimensions, invalid cell sizes, invalid levels, and
unordered weighted-voronoi bounds using the same JSON-first error shape.

`territory geometry validate` reads either a `dataset.json` file or a dataset directory. It writes
the optional report file and exits `0` for valid data, `1` for validation errors, and `2` for
CLI/input errors.

`territory geometry repair` is explicit opt-in. It applies only safe repairs, writes an audited
repair report, revalidates the output, and exits `3` if any repair is rejected or revalidation
fails. The implemented backend is `--backend typescript`.

`territory adjacency build` reads either a `dataset.json` file or dataset directory and writes a
separate adjacency artifact. Directory outputs contain `adjacency.json`, `build-report.json`, and
`checksums.json`. Bounding boxes are used only as a candidate prefilter; final `shared-border` and
`point-touch` relations use exact polygon boundary checks. Use `--include-point-touches`,
`--minimum-shared-boundary-meters`, `--overrides`, `--build-date`, and `--strict` to tune builds.
`territory adjacency <dataset.json>` remains a legacy bbox helper for fixture work.

`territory dataset build world-countries` builds Natural Earth ADM0 artifacts from a local GeoJSON
source. It writes `manifest.json`, `attribution.txt`, `checksums.json`, `build-report.json`, and
detail-specific `dataset.json` files. Use `--source-sha256` to verify the source before parsing,
`--build-date` or `SOURCE_DATE_EPOCH` for reproducible output, `--strict` to fail on warnings, and
`--force` to replace an existing output directory.

`territory country` builds pilot ADM0/ADM1/ADM2 country artifacts. `source lock` resolves and
checksums source artifacts, `source verify` re-validates a lock, `build` writes country manifests,
quality reports, hierarchy reports, identity maps, level datasets, and optional ADM1/ADM2 adjacency
artifacts, `validate` checks artifact checksums and dataset validity, and `inspect` prints a compact
summary.
