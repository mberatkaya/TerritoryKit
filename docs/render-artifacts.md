# Render Artifacts

Render artifacts are optimized for maps and mobile clients. They carry stable `territoryId`,
`adminLevel`, minimal style properties, zoom metadata, and simplified or tiled geometry.

```bash
territory render build ./dist/tr/levels/ADM1/dataset.json \
  --output ./dist/tr-render \
  --format mvt \
  --min-zoom 0 \
  --max-zoom 6 \
  --build-date 2026-01-01T00:00:00.000Z
```

Sprint 7 supports real MVT directory output and GeoJSON render artifacts. PMTiles remains a
registry-compatible future format and is not exposed as a supported builder format yet.

Country builds can emit render artifacts directly:

```bash
territory country build TR \
  --source-lock ./dist/tr/sources.lock.json \
  --output ./dist/tr \
  --build-render-artifacts \
  --allow-partial
```

Turkey's default render policy maps available levels to ADM0 z0-z4, ADM1 z5-z7, ADM2 z8-z11,
ADM3 z12-z14, and ADM4 z15-z17. Only levels present in the source lock are emitted.
