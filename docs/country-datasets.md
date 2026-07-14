# Country Datasets

Sprint 5 adds a pilot country dataset pipeline for five ADM0/ADM1/ADM2 countries:

| Country       | Codes        | Loader package           | Source provider |
| ------------- | ------------ | ------------------------ | --------------- |
| Germany       | `DE` / `DEU` | `@territory-kit/data-de` | geoBoundaries   |
| Indonesia     | `ID` / `IDN` | `@territory-kit/data-id` | geoBoundaries   |
| Japan         | `JP` / `JPN` | `@territory-kit/data-jp` | geoBoundaries   |
| Turkiye       | `TR` / `TUR` | `@territory-kit/data-tr` | geoBoundaries   |
| United States | `US` / `USA` | `@territory-kit/data-us` | geoBoundaries   |

The loader packages do not embed geometry. They expose descriptors and resolver-driven loaders for
artifacts produced by the generator pipeline.

## Artifact Layout

`territory country build` writes a directory with:

```text
manifest.json
checksums.json
sources.lock.json
identity-map.json
hierarchy-report.json
quality-report.json
build-report.json
dataset.json
attribution.txt
levels/ADM0/dataset.json
levels/ADM1/dataset.json
levels/ADM2/dataset.json
adjacency/ADM1/adjacency.json
adjacency/ADM2/adjacency.json
```

`dataset.json` keeps the combined hierarchy. `levels/<ADM>/dataset.json` files are standalone
valid datasets for that level. Adjacency artifacts are generated per level and validated against
the published level dataset fingerprint.

## Build Flow

```sh
territory country source lock TR \
  --levels ADM0,ADM1,ADM2 \
  --output ./dist/tr/sources.lock.json

territory country source verify ./dist/tr/sources.lock.json

territory country build TR \
  --source-lock ./dist/tr/sources.lock.json \
  --output ./dist/tr \
  --build-adjacency \
  --strict

territory country validate ./dist/tr --strict
territory country inspect ./dist/tr
```

The build is publish-ready only when required levels are available, source checksums match,
licenses and attribution are present, geometry quality is clean, hierarchy is resolved, and
identity fallback stays below the country policy threshold.

## Pilot Pages

- [Germany](./datasets/de.md)
- [Indonesia](./datasets/id.md)
- [Japan](./datasets/jp.md)
- [Turkiye](./datasets/tr.md)
- [United States](./datasets/us.md)
