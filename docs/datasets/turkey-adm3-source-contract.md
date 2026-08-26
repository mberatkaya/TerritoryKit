# Turkey ADM3 Source Contract

`datasets/sources/TR/adm3-catalog.json` uses
`territorykit-tr-adm3-source-catalog@1`. Each province entry is independent, so one failed province
does not invalidate already verified provinces when `--allow-partial` is used.

Required metadata:

- `provinceCode`, `provinceName`, `providerId`, `providerName`, `sourceId`
- `sourceUrl`, optional `downloadUrl` or `sourcePath`
- `sourceDate`, optional `sourceVersion`, optional `retrievedAt`
- `license`, optional `licenseUrl`, `attribution`
- `licenseState: "approved"` for production ADM3 publication
- `boundarySourceClass: "official-local"` unless a reviewed national ADM3 source is added
- `redistributionStatus: "allowed"` for production builds
- `crs: "EPSG:4326"` unless a reprojection adapter is added
- `format: "GeoJSON"` or `"KML"`
- `expectedSha256`, `expectedByteSize`, and `expectedFeatureCount`
- `adapter`

## Adapters

`geojson-property-map` reads a GeoJSON `FeatureCollection` and requires:

- `nameProperty`
- `sourceIdProperty`
- `parentProperty`
- optional `semanticTypeProperty`
- optional `localTypeProperty`
- optional `parentMappings`

`kml-description-table` reads KML placemark description table fields and requires:

- `nameField`
- `sourceIdField`
- `parentField`
- `defaultSemanticType`
- `defaultLocalType`
- `parentMappings`

The adapter must emit real ADM3 semantics: neighbourhood, village, locality, or compatible
administrative unit. Unsupported semantics produce a blocker instead of silently transforming the
source model.

## Source Lock

`territory country source lock TR --adm3-provinces ...` writes ADM3 details under
`extensions.turkeyAdm3`. The top-level `ADM3` lock level is a synthetic summary; verification reads
the extension and checks each available province source independently.

Each available province source-lock entry preserves `licenseState`, `boundarySourceClass`, and
`sourceSnapshotChecksum`. The built ADM3 features copy those values into
`zone.properties.territory` together with `boundaryKind: "administrative"`,
`confidence: "authoritative"`, `administrative: true`, provider/source IDs, attribution, license,
source date when known, and the effective geometry hash. A province whose official source is
missing, restricted, or checksum-invalid is represented as unavailable coverage, not as generated or
synthetic ADM3.
