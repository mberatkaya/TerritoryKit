# Turkey ADM3 Ingestion

Turkey ADM3 ingestion is province-scoped and registry-driven. It is designed to add verified
neighbourhood or compatible lower-administrative polygon sources without claiming nationwide ADM3
coverage. `datasets/sources/TR/adm3/source-registry.json` is the production source of truth; the
legacy catalog is now a technical sidecar for source paths, checksums, adapter details, and parent
mappings while the registry carries authority, lifecycle, access, evidence, and license status.

## Build Flow

1. Add or update a province source in `datasets/sources/TR/adm3/source-registry.json`.
   Production ingestion requires an official-local or official-national source with approved
   lifecycle, approved license, allowed redistribution, public download/API access, and geometry
   availability.
2. Add or update the matching technical entry in `datasets/sources/TR/adm3-catalog.json` when the
   registry source needs a local path, checksum, explicit adapter config, or parent mappings.
3. Keep raw source files outside Git unless they are tiny fixtures.
4. Create a source lock:

```bash
territory country source lock TR \
  --levels ADM0,ADM1,ADM2,ADM3 \
  --adm3-provinces 27,34,54 \
  --adm3-registry datasets/sources/TR/adm3/source-registry.json \
  --adm3-catalog datasets/sources/TR/adm3-catalog.json \
  --output ./dist/tr/sources.lock.json
```

5. Build with explicit partial coverage when not every requested province is available:

```bash
territory country build TR \
  --source-lock ./dist/tr/sources.lock.json \
  --levels ADM0,ADM1,ADM2,ADM3 \
  --allow-partial \
  --output ./dist/tr/artifact
```

The artifact writes `coverage.json`, `adm3-import-report.json`,
`adm3-unresolved-report.json`, `adm3-repair-report.json`, `adm3-quality-gates.json`,
`adm3-source-provenance-report.json`, `identity-map.json`, `identity-diff-report.json`,
`hierarchy-report.json`, and normal country checksum files.

## Adding A Province Source

1. Confirm the source represents neighbourhoods (`Mahalle`), villages, or an explicitly compatible
   ADM3 administrative unit. Do not convert municipalities or other source models into fake ADM
   levels.
2. Record publisher, source URL, access type, format, geometry availability, source date, license,
   lifecycle, production eligibility, attribution/evidence URLs, and registry fields.
3. Record technical source-lock data: download URL or local source path, CRS, expected SHA-256,
   byte size, expected feature count, adapter config, and parent mappings.
4. Choose an adapter:
   `geojson-property-map`, `json-feature-map`, `wfs-geojson-property-map`,
   `arcgis-rest-json`, `kml-description-table`, `kmz-kml-description-table`, or
   `shapefile-zip-property-map`.
5. Use `EPSG:4326` or `OGC:CRS84` when already lon/lat, or `EPSG:3857` when explicit
   reprojection is required. Unknown/conflicting CRS metadata blocks the import.
6. Map each source parent district value to the current TerritoryKit ADM2 ID or source code, unless
   a unique ADM2 parent can be resolved by normalized district name or spatial containment.
7. Run source lock creation and inspect blocked/warning issues.
8. Run `territory country build TR ... --allow-partial` and inspect import, unresolved, repair,
   coverage, hierarchy, quality, provenance, and identity reports.
9. Only promote the source after license, parent mapping, geometry quality, and provenance reports
   are reviewed.

## Current State

Gaziantep is migrated into the generic multi-provider pipeline as province `27`. The old pilot
builder remains for compatibility, but the generic `country source lock` plus `country build` path
can process the same KML shape through a `kml-description-table` adapter.

National blockers remain: no redistributable nationwide official ADM3 source is locked, not every
province has reviewed license metadata, and municipality/locality source models still need semantic
review before they can be mapped.
