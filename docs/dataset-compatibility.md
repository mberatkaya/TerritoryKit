# Dataset Compatibility

TerritoryKit datasets are versioned separately from package releases. The runtime reads
`manifest.datasetVersion`, `manifest.schemaVersion`, `manifest.sourceDate`, and
`manifest.geometryHash` before loading zones.

## Policy

- `schemaVersion` describes the JSON shape. The initial value is `territory-schema@1`.
- `datasetVersion` follows SemVer for the published dataset artifact.
- `sourceDate` records the authority/source snapshot date, not the package publish date.
- `geometryHash` must change when any zone geometry changes.
- `compatibility.minCoreVersion` can be used when a dataset requires a newer engine behavior.

## Real-World Imports

Administrative GeoJSON must use RFC 7946 coordinate order: `[longitude, latitude]`.
`Polygon` and `MultiPolygon` are accepted; `Point`, `LineString`, and `GeometryCollection`
are rejected for territory zones. Holes and island MultiPolygons are valid, but source data
must be normalized to EPSG:4326 before import.

Validation issues expose `featureId`, `sourcePath`, and `repairSuggestion` where possible so
CLI and import pipelines can point back to the dirty source feature.
