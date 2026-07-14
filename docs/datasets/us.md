# United States Pilot Dataset

- Codes: `US` / `USA`
- Loader: `@territory-kit/data-us`
- Source provider: geoBoundaries
- Default release type: `gbOpen`
- Requested levels: `ADM0`, `ADM1`, `ADM2`
- Adjacency levels: `ADM1`, `ADM2`

```sh
territory country source lock US --output ./dist/us/sources.lock.json
territory country build US --source-lock ./dist/us/sources.lock.json --output ./dist/us --build-adjacency --strict
```

Use the generated `identity-map.json` to review source-id and name changes across source updates.
