# Turkey V2 Game-Zone Generator

Turkey V2 game zones are deterministic ADM3 generated zones for KapRota-style route scoring. They
fill ADM2 district area that is not already covered by usable real neighbourhood or village
polygons.

Generated game zones are not official mahalle or köy records. They always carry:

- `sourceClass: "generated"`
- `official: false`
- `generated: true`
- `semanticType: "generated-zone"`
- `algorithmVersion: "tr-adm3-game-zone-v2"`

This sprint adds the generator and representative validation. It does not commit a final national
81-province/973-district Turkey production artifact and does not merge official, OSM, and generated
coverage nationally.

## Public API

```ts
import {
  buildTurkeyGameZones,
  buildTurkeyGameZonesWithAdjacency,
  resolveTurkeyGameZoneConfiguration
} from "@territory-kit/generators/turkey-adm3";

const result = await buildTurkeyGameZonesWithAdjacency({
  district,
  provinceCode: "34",
  districtCode: "003",
  profile: "auto",
  seed: "kaprota-v2"
});
```

Profiles:

- `urban`: smaller target zones for dense central districts.
- `suburban`: medium zones for ordinary settlement patterns.
- `rural`: larger zones for broad sparse districts.
- `auto`: deterministic profile selection from density hints when present, otherwise geometry.
- `custom`: explicit target/min/max area, target count, max zones, seed, compactness, minimum
  width, and fragment strategy controls.

Invalid custom combinations report machine-readable issues such as `INVALID_AREA_ORDERING`,
`INVALID_TARGET_AREA`, `INVALID_MAXIMUM_ZONE_COUNT`, `EMPTY_SEED`, and
`UNSUPPORTED_ALGORITHM_VERSION`.

## Algorithm

`tr-adm3-game-zone-v2` uses deterministic recursive spatial partitioning rather than H3. It
normalizes the district geometry, subtracts optional occupied real zones, recursively splits the
remaining target geometry with seed-derived bbox cuts, clips every piece back to the target
geometry, and merges small fragments by deterministic nearest-neighbour selection.

Stable ordering uses bbox, representative spatial keys, and canonical geometry hashes. Stable IDs
use Sprint 1 `createTurkeyV2Adm3TerritoryId`; array index alone is never the identity source.

## Quality Gates

The quality report is `territorykit-tr-adm3-game-zone-quality@1` and includes:

- district, target, and generated union area
- final coverage percent
- gap, overlap, invalid, empty, duplicate, sliver, and containment counts
- min/max/mean/median area and area standard deviation
- compactness min/mean/median
- thin-zone, MultiPolygon, and disconnected-zone counts
- selected profile, algorithm version, seed hash, and deterministic output hash

Default hard gates require:

- final coverage >= 99.99%
- invalid geometry = 0
- duplicate geometry = 0
- sibling overlap beyond tolerance = 0
- parent containment error beyond tolerance = 0
- empty geometry = 0
- zone count <= `maxZonesPerDistrict`
- generated metadata errors = 0
- stable ID collisions = 0

## CLI

```sh
territory tr adm3 generate \
  --dataset ./adm2-dataset.json \
  --district-id tr:adm2:example \
  --profile auto \
  --seed kaprota-v2 \
  --output ./dist/generated
```

Options include `--profile`, `--seed`, `--target-area`, `--target-zone-count`, `--min-area`,
`--max-area`, `--max-zones`, `--min-fragment-area`, `--fragment-strategy`,
`--population-density`, `--urbanity-hint`, `--dry-run`, and `--force`.

The command writes:

- `dataset.json`
- `full.geojson`
- `coverage.json`
- `quality-report.json`
- `adjacency.json`
- `build-summary.json`
- `configuration.json`
- `checksums.json`

Existing output paths are protected unless `--force` is passed.

## Fragment, Hole, and Island Policy

Holes are preserved and are not filled with game zones. MultiPolygon districts are supported. Small
fragments default to `merge-nearest`; disconnected island geometry is preserved as real geometry
requires and is reported through MultiPolygon/disconnected metrics. No artificial corridor is added
to connect islands.

## Benchmark Summary

Run:

```sh
pnpm turkey:adm3:generator:smoke
pnpm turkey:adm3:generator:benchmark
```

The benchmark report is written to `reports/tr-adm3/game-zone-benchmark.json`. On the local
2026-08-13 run, all scenarios reached 100% coverage with zero overlap, zero invalid geometry, and
zero parent containment errors. The 100-district synthetic batch produced 3,300 zones in 387 ms on
Node v24.14.0 arm64.

## Migration Impact

V1 generated IDs use `tr-adm3-generated-zone-v1`; V2 generated IDs use
`tr-adm3-game-zone-v2`. Because algorithm version participates in stable identity, consumers must
map old generated IDs to new generated IDs before migrating persisted game ownership or scores.
