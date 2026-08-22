# Geometry Simplification

`territory geometry simplify` creates build-time geometry tiers:

```bash
territory geometry simplify ./dist/tr/levels/ADM2/dataset.json \
  --strategy topology-safe \
  --detail high,medium,low \
  --output ./dist/tr/levels/ADM2/simplified \
  --report ./dist/tr/levels/ADM2/simplification-report.json
```

The TypeScript backend represents shared polygon boundaries as canonical topology arcs and
simplifies each arc once. Adjacent polygons then reuse the same simplified coordinates, reversing
the arc when they traverse the boundary in the opposite direction, so shared boundaries do not
independently diverge during simplification.

A tier is omitted when its geometry hash matches the source hash, so the build never publishes fake
`medium` or `low` variants. Runtime packages do not depend on Python or GEOS.
