# Turkiye Pilot Dataset

- Codes: `TR` / `TUR`
- Loader: `@territory-kit/data-tr`
- Source provider: geoBoundaries
- Default release type: `gbOpen`
- Requested levels: `ADM0`, `ADM1`, `ADM2`
- Adjacency levels: `ADM1`, `ADM2`

```sh
territory country source lock TR --output ./dist/tr/sources.lock.json
territory country build TR --source-lock ./dist/tr/sources.lock.json --output ./dist/tr --build-adjacency --strict
```

The generated artifact records source attribution, source lock hash, identity stability summary,
hierarchy summary, geometry quality summary, and per-level adjacency edge counts.
