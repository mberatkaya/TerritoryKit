# Render Query Compatibility

Render and query artifacts are compatible when dataset id, dataset version, dataset content hash,
identity map hash, and render feature `territoryId` values match the query artifact.

```bash
territory render compare ./dist/tr/levels/ADM1/dataset.json ./dist/tr-render
```

Compatibility failures are treated as build failures for render artifacts. Render simplification may
change geometry shape, but it must not change identity.
