# Turkiye Dataset

- Codes: `TR` / `TUR`
- Loader: `@territory-kit/data-tr`
- Source provider: HDX/OCHA COD-AB for national ADM0-ADM2
- Default release type: `hdx-cod-ab`
- Requested levels: `ADM0`, `ADM1`, `ADM2`, `ADM3`, `ADM4`
- Adjacency levels: `ADM1`, `ADM2`

```sh
territory country source lock TR --levels ADM0,ADM1,ADM2 --output ./dist/tr/sources.lock.json
territory country build TR --source-lock ./dist/tr/sources.lock.json --output ./dist/tr/artifact --levels ADM0,ADM1,ADM2 --build-adjacency --build-query-artifacts --build-render-artifacts --build-binary-index --strict --profile --phase-timeout-ms 300000
```

The generated artifact records source attribution, source lock hash, identity stability summary,
hierarchy summary, geometry quality summary, and per-level adjacency edge counts.

Current national source coverage is verified for ADM0, ADM1, and ADM2 only. ADM3 remains partial
through the Gaziantep neighbourhood pilot, and ADM4 is not production-mapped until a reviewed source
model exists.

ADM3 ingestion is now catalog-driven by province. Use
`territory country source lock TR --adm3-provinces <codes> --adm3-catalog <catalog>` and build with
`--allow-partial` when coverage is intentionally incomplete.

See:

- [Turkey administrative model](./turkey-administrative-model.md)
- [Turkey sources](./turkey-sources.md)
- [Turkey national coverage](./turkey-national-coverage.md)
- [Turkey build](./turkey-build.md)
- [Turkey licensing](./turkey-licensing.md)
- [Turkey ADM3 ingestion](./turkey-adm3-ingestion.md)
