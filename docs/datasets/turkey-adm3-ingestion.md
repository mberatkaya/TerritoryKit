# Turkey ADM3 Ingestion

Turkey ADM3 ingestion is province-scoped and catalog-driven. It is designed to add verified
neighbourhood or compatible lower-administrative polygon sources without claiming nationwide ADM3
coverage.

## Build Flow

1. Add or update a province entry in `datasets/sources/TR/adm3-catalog.json`.
2. Keep raw source files outside Git unless they are tiny fixtures.
3. Create a source lock:

```bash
territory country source lock TR \
  --levels ADM0,ADM1,ADM2,ADM3 \
  --adm3-provinces 27,34,54 \
  --adm3-catalog datasets/sources/TR/adm3-catalog.json \
  --output ./dist/tr/sources.lock.json
```

4. Build with explicit partial coverage when not every requested province is available:

```bash
territory country build TR \
  --source-lock ./dist/tr/sources.lock.json \
  --levels ADM0,ADM1,ADM2,ADM3 \
  --allow-partial \
  --output ./dist/tr/artifact
```

The artifact writes `coverage.json`, `adm3-quality-gates.json`,
`adm3-source-provenance-report.json`, `identity-map.json`, `identity-diff-report.json`,
`hierarchy-report.json`, and normal country checksum files.

## Adding A Province Source

1. Confirm the source represents neighbourhoods (`Mahalle`), villages, or an explicitly compatible
   ADM3 administrative unit. Do not convert municipalities or other source models into fake ADM
   levels.
2. Record publisher, source URL, download URL or local source path, source date/version, license,
   attribution, redistribution status, CRS, expected SHA-256, byte size, and expected feature count.
3. Choose an adapter:
   `geojson-property-map` for GeoJSON properties or `kml-description-table` for KML placemark
   description tables.
4. Map each source parent district value to the current TerritoryKit ADM2 ID or source code.
5. Run source lock creation and inspect blocked/warning issues.
6. Run `territory country build TR ... --allow-partial` and inspect coverage, hierarchy, quality,
   and identity reports.
7. Only promote the source after license, parent mapping, geometry quality, and provenance reports
   are reviewed.

## Current State

Gaziantep is migrated into the generic catalog as province `27`. The old pilot builder remains for
compatibility, but the generic `country source lock` plus `country build` path can process the same
KML shape through a `kml-description-table` adapter.

National blockers remain: no redistributable nationwide official ADM3 source is locked, not every
province has reviewed license metadata, and municipality/locality source models still need semantic
review before they can be mapped.
