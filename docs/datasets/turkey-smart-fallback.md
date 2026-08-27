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

## Profiles

Profiles tune target zone density and quality expectations:

- `dense-urban`
- `urban`
- `suburban`
- `rural`
- `auto`
- `custom`

`auto` uses ADM2 area, barrier density, and locality seed count to select a concrete profile. Custom
builds can set target count, target area, min/max area, barrier strength, synthetic split limits, and
quality gate thresholds.

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
