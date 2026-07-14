# Generic GeoJSON Source

The `geojson` adapter converts user-provided GeoJSON `FeatureCollection` files into TerritoryKit
datasets through explicit property mapping.

```sh
territory import geojson \
  --input ./regions.geojson \
  --output ./dist/custom-regions \
  --country TR \
  --admin-level ADM2 \
  --id-property region.code \
  --name-property region.name \
  --parent-property region.parent \
  --local-type district \
  --license "CC BY 4.0" \
  --attribution "Example Municipality Open Data"
```

## Mapping

Supported geometry types are `Polygon` and `MultiPolygon`.

Property paths support simple dot notation against feature properties. Unknown source properties are
not copied by default; only explicitly mapped values enter the artifact.

## ID Strategy

IDs are chosen in this order:

1. `--id-property`;
2. `--source-id-property`;
3. feature id or `properties.id`;
4. deterministic content fallback.

Fallback IDs produce warnings and become failures in `--strict` mode. IDs never depend on feature
array index.

## Parent Mapping

`--parent-property` builds parent references only when a matching imported source id exists. Missing
parents produce warnings. Geometry containment is not checked in this sprint.

## Attribution

Generic sources should pass `--license` and `--attribution`. Missing values are warnings by default
and errors in strict mode.
