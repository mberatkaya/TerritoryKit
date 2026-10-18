# Playable rescue pilot previews (local-only)

MapLibre `*-after.geojson` / `*-after.html` files visualize **effective gameplay zones** built from OSM road/water barrier extracts (Geofabrik Turkey). They are engineering calibration aids, not official administrative boundaries.

## Git policy

Until TerritoryKit project approval for ODbL redistribution, coordinate-bearing preview artifacts are **gitignored** and must not be committed. Reproduce them locally with:

```bash
pnpm --filter @territory-kit/generators build
node scripts/tr-playable-rescue-pilot.mjs
```

Committed QA lives in `../pilot-metrics.json` (coordinate-free metrics) and `../pilot-metrics.sha256`.

## Input sets

- **Istanbul local calibration** when `datasets/generated/countries/TR/dataset.json` and `.territory/sprint-6/calibration/barriers` exist (Fatih, Adalar, Çatalca).
- **National-blocker fixtures** in CI when local calibration is absent (İskenderun, Ağrı merkez, Erbaa).
