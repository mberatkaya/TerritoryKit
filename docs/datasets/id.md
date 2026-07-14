# Indonesia Pilot Dataset

- Codes: `ID` / `IDN`
- Loader: `@territory-kit/data-id`
- Source provider: geoBoundaries
- Default release type: `gbOpen`
- Requested levels: `ADM0`, `ADM1`, `ADM2`
- Adjacency levels: `ADM1`, `ADM2`

```sh
territory country source lock ID --output ./dist/id/sources.lock.json
territory country build ID --source-lock ./dist/id/sources.lock.json --output ./dist/id --build-adjacency --strict
```

The geometry quality pipeline accepts valid `MultiPolygon` country geometry and records polygon and
multi-polygon counts in `build-report.json`.
