# geoBoundaries Source

The `geoboundaries` adapter converts local geoBoundaries-style GeoJSON into TerritoryKit datasets.

```sh
territory import geoboundaries \
  --input ./geoBoundaries-TUR-ADM1.geojson \
  --country TR \
  --admin-level ADM1 \
  --release-type gbOpen \
  --output ./dist/tr-adm1
```

Supported levels are `ADM0` through `ADM4`, but the adapter does not invent levels absent from the
source file.

## Mapping

The first implementation reads common geoBoundaries properties:

- `shapeID` as the stable source id;
- `shapeName` as the display name;
- `shapeGroup` as the source country code check;
- `shapeType` as local boundary type metadata.

Output IDs use the Sprint 0 global ID model.

## Release Type

`--release-type` accepts:

- `gbOpen`;
- `gbHumanitarian`;
- `gbAuthoritative`.

## License

The adapter records `CC BY 4.0` license metadata and attribution in the manifest and zone source
metadata.

## Remote API

Direct `--url` fetch is supported through the shared HTTP transport and source cache. Full
geoBoundaries API metadata resolution is intentionally deferred; tests use local fixtures and mock
HTTP only.

The dataset is not an official boundary decision.
