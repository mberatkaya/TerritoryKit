# Turkey Smart Fallback Boundary Engine

The Turkey smart fallback boundary engine creates deterministic ADM3 playable zones when neither a
reviewed official ADM3 polygon nor a usable OSM administrative ADM3 polygon is available for an
ADM2 district. It is a derived fallback. It does not create official mahalle or köy records.

Published smart fallback zones are labeled:

- `sourceClass: "generated"`
- `boundaryKind: "estimated"`
- `boundarySourceClass: "smart-derived"`
- `semanticType: "generated-zone"`
- `administrative: false`
- `official: false`
- `generated: true`
- `algorithmVersion: "smart-derived-v1"`

## Source Priority

Turkey V2 keeps the same resolver order:

1. reviewed official ADM3 polygons
2. OSM administrative ADM3 polygons, where explicitly built and license-approved
3. smart-derived generated fallback
4. legacy generated-zone fallback when smart quality gates reject the result

Lower-priority geometry is clipped by higher-priority geometry. Smart fallback is only allowed to
fill the remaining missing ADM2 area.

## Barrier Inputs

The engine accepts provider-neutral GeoJSON `FeatureCollection` inputs for:

- roads
- railways
- water
- landuse
- parks
- optional locality seeds

It reads common OSM-style tags such as `highway`, `railway`, `waterway`, `natural`, `landuse`, and
`leisure`, but the algorithm does not require the source files to be live OSM downloads. Major
roads, rivers, railways, coastlines, forests, and parks can become split candidates. Service roads,
driveways, parking aisles, paths, and other weak tags are ignored or scored too low to publish a
multi-territory result by themselves.

Production Turkey builds can now get those provider-neutral inputs from the OSM barrier snapshot
pipeline instead of hand-authored fixtures:

```text
Geofabrik Turkey PBF
  -> SHA-256 source lock
  -> deterministic road/rail/water/park/landuse extraction
  -> ADM2 clipping
  -> reusable barrier artifact
  -> smart fallback input
```

See [Turkey OSM barrier snapshots](./turkey-osm-barrier-snapshots.md). This snapshot pipeline is
the production path for OSM-derived barriers; live Overpass remains a development/debugging tool,
not a production build dependency.

## Profiles

Profiles tune target zone density and quality expectations:

- `dense-urban`
- `urban`
- `suburban`
- `rural`
- `auto`
- `custom`

`auto` uses ADM2 area, barrier density, and locality seed count to select a concrete profile.
Locality seeds are hints, not a hard target-zone floor. Dense and urban profiles require compact
ADM2 parent area as well as density signals, so large rural districts with many OSM place nodes do
not accidentally become dense-urban builds. Custom builds can set target count, target area,
min/max area, barrier strength, synthetic split limits, and quality gate thresholds.

## Quality Gates

A smart fallback result is publishable only when all gates pass:

- coverage of the missing ADM2 geometry
- invalid geometry count
- sibling overlap
- spill outside the ADM2 parent
- real barrier sufficiency for multi-territory results
- mean quality score
- mean barrier alignment
- synthetic split limit

Synthetic splits are a last resort and default to a rejected result when used. This prevents a weak
or empty barrier network from silently becoming a publishable grid.

## Diagnostics

`quality-report.json` carries both gate-level metrics and raw evidence:

- `inputDiagnostics` records raw and normalized road, major-road, rail, water, park, landuse, and
  locality seed counts, plus parent-edge barriers ignored before generation.
- `coverageComputation` records whether aggregate union succeeded, the raw covered/uncovered/spill
  and overlap areas, and the small parent-area-capped topology tolerance used to normalize clipping
  noise before gates.
- `meanBarrierAlignment` is the global internal-boundary real-barrier ratio. It is computed in
  meters with projected interval overlap against real OSM-style barrier segments.
- `meanZoneBarrierAlignment`, `meanRealBarrierRatio`, `meanSyntheticBoundaryRatio`,
  `totalInternalBoundaryLengthKm`, and `barrierAlignedBoundaryLengthKm` explain how much of the
  generated internal boundary is supported by real barriers.

Rejected smart attempts now emit explicit issue codes for each failing gate, including
`SMART_FALLBACK_ALIGNMENT_TOO_LOW`, `SMART_FALLBACK_COVERAGE_TOO_LOW`,
`SMART_FALLBACK_SPILL_TOO_HIGH`, `SMART_FALLBACK_GEOMETRY_INVALID`,
`SMART_FALLBACK_COORDINATE_ORDER_INVALID`, and `SMART_FALLBACK_QUALITY_REJECTED`.

Sprint 5.1 calibrated the diagnostics on a locked real Fatih artifact from the Geofabrik Turkey
snapshot `5ec68ce5e0b2be55b2c34ee7cd1ff91b6b3d8db8acab5a6be2fa7beb633eaedc`
(`2026-08-27T20:21:06.000Z`). The old Fatih smart attempt produced 105 zones with `coverage=0`,
`spill=16.362399 km2`, `meanBarrierAlignment=0.000824`, and `meanQuality=0.38882`. After the
calibration, Fatih produces 47 smart-derived zones with `coverage=99.999548`,
`outsideSpill=0`, `overlap=0`, `meanBarrierAlignment=0.266414`, and `meanQuality=0.622904`
without lowering quality thresholds.

## CLI

```bash
territory tr adm3 generate \
  --strategy smart \
  --district ./district.json \
  --roads ./roads.geojson \
  --water ./water.geojson \
  --railways ./railways.geojson \
  --locality-seeds ./seeds.json \
  --profile auto \
  --output ./.territory/smart-fallback \
  --force
```

Smart builds write the normal generated artifacts plus:

- `manifest.json`
- `comparison.json`

Use `--dry-run` or `--plan` to inspect the resolved configuration and normalized barrier summary
without writing artifacts. Use `--no-legacy-comparison` to skip the comparison artifact.

## Reproducibility

The manifest records input hashes for the ADM2 parent geometry, barrier layers, and locality seeds.
Zone IDs include the smart fallback algorithm version and deterministic generation seed, so a future
algorithm change can coexist with existing generated-zone IDs.

If OSM-derived barriers are used, output metadata keeps ODbL attribution. If non-OSM provider
snapshots are supplied, pass `--source-provider`, `--source-dataset-id`, `--source-url`,
`--license`, and `--attribution` so provenance and redistribution policy remain auditable.
When OSM barrier artifacts are used, smart provenance links the generated geometry hash back to the
barrier artifact checksum, OSM snapshot checksum, provider URL, and ODbL attribution.
