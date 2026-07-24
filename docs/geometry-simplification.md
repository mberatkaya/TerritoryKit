# Geometry Simplification

`territory geometry simplify` creates build-time geometry tiers:

```bash
territory geometry simplify ./dist/tr/levels/ADM2/dataset.json \
  --strategy topology-safe \
  --detail high,medium,low \
  --output ./dist/tr/levels/ADM2/simplified \
  --report ./dist/tr/levels/ADM2/simplification-report.json
```

The TypeScript backend performs deterministic ring simplification and audits shared segments before
and after simplification. A tier is omitted when its geometry hash matches the source hash, so the
build never publishes fake `medium` or `low` variants.

Runtime packages do not depend on Python or GEOS. A future GEOS/topojson backend can implement the
same report contract for stricter shared-arc simplification at national scale.
