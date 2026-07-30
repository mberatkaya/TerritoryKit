# Turkey ADM3 Ingestion

Turkey ADM3 ingestion is province-scoped and catalog-driven. It is designed to add verified
neighbourhood or compatible lower-administrative polygon sources without claiming nationwide ADM3
coverage.

## Build Flow

1. Add or update the candidate row in `datasets/registry/tr-adm3-sources.json`.
2. Promote the source into `datasets/sources/TR/adm3-catalog.json` only after it is approved.
3. Keep raw source files outside Git unless they are tiny fixtures.
4. Create a source lock:

```bash
territory country source lock TR \
  --levels ADM0,ADM1,ADM2,ADM3 \
  --adm3-provinces <approved-codes> \
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

The production catalog currently contains no approved live ADM3 province sources. The historical
Gaziantep pilot remains useful as a parser/build fixture and as committed partial artifact
provenance, but the referenced download host did not resolve during the 2026-07-30 source inventory
review. It is therefore tracked as `inaccessible` in `datasets/registry/tr-adm3-sources.json`
instead of being promoted as a current production catalog entry.

National blockers remain: no redistributable nationwide official ADM3 source is locked, not every
province has reviewed license metadata, and municipality/locality source models still need semantic
review before they can be mapped.
