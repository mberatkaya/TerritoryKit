# Natural Earth Source

The `natural-earth` adapter supports local or direct-URL GeoJSON `FeatureCollection` input for ADM0
world-country boundaries.

```sh
territory import natural-earth \
  --input ./natural-earth.geojson \
  --output ./dist/world-countries \
  --source-version 5.1.2 \
  --source-sha256 <sha256>
```

The backward-compatible curated build command remains:

```sh
territory dataset build world-countries \
  --source ./natural-earth.geojson \
  --output ./dist/world-countries
```

## License and Attribution

Natural Earth data is public domain. Generated artifacts preserve `Made with Natural Earth` in the
manifest, zone source metadata, and `attribution.txt`.

## Details

The adapter supports `low`, `medium`, and `high`. `high` preserves source geometry; `medium` and
`low` currently use deterministic local simplification. Future work may map Natural Earth's native
10m, 50m, and 110m scales.

## Boundary Caveat

TerritoryKit does not make legal boundary decisions. Disputed areas follow the selected Natural
Earth source representation.
