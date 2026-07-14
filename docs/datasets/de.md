# Germany Pilot Dataset

- Codes: `DE` / `DEU`
- Loader: `@territory-kit/data-de`
- Source provider: geoBoundaries
- Default release type: `gbOpen`
- Requested levels: `ADM0`, `ADM1`, `ADM2`
- Adjacency levels: `ADM1`, `ADM2`

```sh
territory country source lock DE --output ./dist/de/sources.lock.json
territory country build DE --source-lock ./dist/de/sources.lock.json --output ./dist/de --build-adjacency --strict
```

Per-level datasets are standalone valid datasets; use the combined `dataset.json` for full
cross-level hierarchy traversal.
