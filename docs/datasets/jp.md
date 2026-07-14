# Japan Pilot Dataset

- Codes: `JP` / `JPN`
- Loader: `@territory-kit/data-jp`
- Source provider: geoBoundaries
- Default release type: `gbOpen`
- Requested levels: `ADM0`, `ADM1`, `ADM2`
- Adjacency levels: `ADM1`, `ADM2`

```sh
territory country source lock JP --output ./dist/jp/sources.lock.json
territory country build JP --source-lock ./dist/jp/sources.lock.json --output ./dist/jp --build-adjacency --strict
```

`territory country inspect ./dist/jp` prints a compact manifest, hierarchy, quality, identity, and
adjacency summary.
