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
- Global datasets keep `territory-schema@1` and add stricter opt-in metadata through
  `countryCodes`, `adminLevels`, `sourceProvider`, `buildDate`, `license`, `attribution`, `crs`,
  `geometryDetail`, `artifactChecksum`, `boundaryPolicy`, `worldview`, and `disputedAreaPolicy`.

## Real-World Imports

Administrative GeoJSON must use RFC 7946 coordinate order: `[longitude, latitude]`.
`Polygon` and `MultiPolygon` are accepted; `Point`, `LineString`, and `GeometryCollection`
are rejected for territory zones. Holes and island MultiPolygons are valid, but source data
must be normalized to EPSG:4326 before import.

Validation issues expose `featureId`, `sourcePath`, and `repairSuggestion` where possible so
CLI and import pipelines can point back to the dirty source feature.

Load-time validation rejects stale `bbox` and `center` metadata when they no longer match the
geometry. Non-reciprocal `neighborIds` are warnings so legacy datasets can still load while
import pipelines repair adjacency lists.

Global zone metadata is stored under `zone.properties.territory` so schema-v1 consumers can keep
loading datasets without a new required zone field.
