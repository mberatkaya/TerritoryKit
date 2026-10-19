# Pilot visual comparison (local-only)

Kadıköy, Fatih, and Adalar MapLibre previews compare rc.8 gameplay geometry with **OSM administrative research** polygons (74 features across the three pilots).

## Git policy

Until TerritoryKit project approval for ODbL redistribution, `*-comparison.geojson` and `*-comparison.html` are **gitignored** and must not be committed. They may still be generated locally for engineering review.

## Regenerate locally

```bash
pnpm data:tr:sprint2:final-closeout
```

Outputs (gitignored):

- `kadikoy-comparison.geojson` / `.html` (21 OSM research polygons)
- `fatih-comparison.geojson` / `.html` (48)
- `adalar-comparison.geojson` / `.html` (5)

## Historical public git exposure

Earlier commits on PR #125 briefly tracked these files (and a full 228-feature research GeoJSON). See `../osm-geometry-historical-git-distribution.json`. Git history is not rewritten; downstream consumers should treat prior public revisions as **license review required**.
