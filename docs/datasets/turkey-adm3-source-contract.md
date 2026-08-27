# Turkey ADM3 Source Contract

`datasets/sources/TR/adm3/source-registry.json` uses
`territorykit-tr-adm3-source-registry@1` and is the production source of truth for Turkey ADM3
provider eligibility. `datasets/sources/TR/adm3-catalog.json` still uses
`territorykit-tr-adm3-source-catalog@1` as a technical sidecar for source-lock mechanics. Each
province entry is independent, so one failed province does not invalidate already verified
provinces when `--allow-partial` is used.

Registry eligibility:

- `boundarySourceClass: "official-local"` or `"official-national"`
- `lifecycle: "approved"`
- `license.state: "approved"`
- `license.redistribution: "allowed"`
- `access.type: "public-download"` or `"public-api"`
- `access.geometryAvailable: true`
- `productionEligible: true`

Technical source-lock metadata:

- `provinceCode`, `provinceName`, `providerId`, `providerName`, `sourceId`
- `sourceUrl`, optional `downloadUrl` or `sourcePath`
- `sourceDate`, optional `sourceVersion`, optional `retrievedAt`
- `license`, optional `licenseUrl`, `attribution`
- `licenseState: "approved"` for production ADM3 publication
- `boundarySourceClass: "official-local"` unless a reviewed national ADM3 source is added
- `redistributionStatus: "allowed"` for production builds
- `crs: "EPSG:4326"`, `"OGC:CRS84"`, or `"EPSG:3857"`
- `format: "GeoJSON"`, `"JSON"`, `"KML"`, `"KMZ"`, `"ArcGIS REST"`,
  `"ArcGIS FeatureServer"`, `"ArcGIS MapServer"`, `"WFS"`, `"Shapefile"`, or
  `"Shapefile ZIP"`
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

`json-feature-map` reads a JSON array path and configured geometry property:

- `featureArrayPath`
- `geometryProperty`
- `nameProperty`
- `sourceIdProperty`
- `parentProperty`
- optional `parentMappings`

`wfs-geojson-property-map` reads WFS GeoJSON responses with the same property mapping contract as
`geojson-property-map`.

`arcgis-rest-json` reads ArcGIS REST/FeatureServer/MapServer query JSON:

- `nameField`
- `sourceIdField`
- `parentField`
- optional `attributesProperty`, defaulting to `attributes`
- optional `geometryProperty`, defaulting to `geometry`
- optional `parentMappings`

`kml-description-table` reads KML placemark description table fields and requires:

- `nameField`
- `sourceIdField`
- `parentField`
- `defaultSemanticType`
- `defaultLocalType`
- `parentMappings`

`kmz-kml-description-table` reads `doc.kml` or the first `.kml` member from a KMZ archive, then
uses the same field contract as `kml-description-table`.

`shapefile-zip-property-map` reads a ZIP containing `.shp` and `.dbf`, plus optional `.prj`.
Polygon, PolygonZ, and PolygonM records are supported. The ZIP reader rejects unsafe member names
and excessive member/uncompressed sizes.

The adapter must emit real ADM3 semantics: neighbourhood, village, locality, or compatible
administrative unit. Unsupported semantics produce a blocker instead of silently transforming the
source model.

## Geometry And CRS

The importer preserves provider Polygon and MultiPolygon geometry without simplification. Rings are
closed when safe; holes and multipart polygons are carried forward. Invalid topology is handled by
the normal audited geometry repair stage, and rejected geometry remains a blocker.

CRS is detected from GeoJSON metadata, ArcGIS spatial references, Shapefile PRJ, or fixed KML lon/lat
semantics. `EPSG:4326` and `OGC:CRS84` pass through. `EPSG:3857` is reprojected to lon/lat.
Unsupported, unknown, or conflicting CRS metadata blocks the province source.

## Source Lock

`territory country source lock TR --adm3-provinces ...` writes ADM3 details under
`extensions.turkeyAdm3`. The top-level `ADM3` lock level is a synthetic summary; verification reads
the extension and checks each available province source independently.

Each available province source-lock entry preserves `licenseState`, `boundarySourceClass`, and
`sourceSnapshotChecksum`, plus registry entry ID, dataset identifier, evidence URLs, importer
version, source snapshot SHA-256, and byte size. The built ADM3 features copy those values into
`zone.properties.territory` together with `boundaryKind: "administrative"`,
`confidence: "authoritative"`, `administrative: true`, provider/source IDs, attribution, license,
source date when known, and original/effective geometry hashes. A province whose official source is
missing, restricted, review-required, access-blocked, checksum-invalid, or CRS-invalid is
represented as unavailable coverage, not as generated or synthetic ADM3.
