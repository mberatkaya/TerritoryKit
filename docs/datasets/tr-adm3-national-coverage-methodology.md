# Turkey ADM3 National Coverage Methodology

Turkey ADM3 coverage is measured from built geometry, not registry records.

Each district is measured in square kilometers with geodesic area. Source geometries are clipped to the ADM2 district and applied in priority order so overlapping sources are not double-counted:

```text
officialEffective = official clipped to district
runtimeEffective = runtime clipped to district minus officialEffective
osmEffective = osm clipped to district minus official/runtime coverage
generatedEffective = generated clipped to district minus real coverage
```

The national report aggregates district area, source area, generated area, final covered area, source polygon counts, districts above 99.99%, gaps, and geometry-quality counters.

`reports/tr-adm3/national-coverage.json` currently reports:

- Real ADM3 coverage: 0.000000%
- Generated fallback coverage: 99.999305%
- Final usable ADM3-like coverage: 99.999305%

Those values come from the generated national build in `.territory/build/TR/ADM3`. Official municipal ingestion and OSM PBF extraction are still reported as `not-built`, so their provider records do not contribute spatial coverage.
