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
