# Turkey ADM3 Quality Gates

ADM3 ingestion runs source-level and country-build quality checks before artifacts are considered
publishable.

Blocking checks include:

- invalid `Polygon` or `MultiPolygon`
- self-intersection
- empty geometry
- unsupported CRS or coordinates outside lon/lat range
- geometry outside the expected Turkey extent
- missing parent reference
- unmapped parent district
- parent containment failure
- duplicate geometry
- excessive same-parent overlap

Warnings include suspiciously small areas and repair normalization details. A strict build fails on
blocking issues. With `--allow-partial`, unavailable provinces become ADM2 fallback coverage entries,
but built provinces still must pass their own blocker checks.

Generated reports:

- `adm3-quality-gates.json`: ADM3-specific source quality blockers and warnings
- `hierarchy-report.json`: parent-child matching and containment results
- `quality-report.json`: standard TerritoryKit geometry checks
- `coverage.json`: province status, feature count, source/license/checksum, and fallback metadata
- `adm3-source-provenance-report.json`: source freshness and provider provenance
