# Turkey Build

Create a source lock:

```bash
territory country source lock TR \
  --levels ADM0,ADM1,ADM2,ADM3,ADM4 \
  --output ./dist/tr/sources.lock.json
```

ADM3 and ADM4 currently resolve as unavailable unless an approved source catalog entry is added.

Build available artifacts:

```bash
territory country build TR \
  --source-lock ./dist/tr/sources.lock.json \
  --levels ADM0,ADM1,ADM2,ADM3,ADM4 \
  --output ./dist/tr \
  --build-adjacency \
  --build-query-artifacts \
  --build-render-artifacts \
  --build-binary-index \
  --strict \
  --allow-partial
```

The build writes source locks, identity maps, identity diff reports, hierarchy reports, validation
reports, adjacency artifacts, query artifacts, optional MVT render artifacts, and binary spatial
indexes. Large geometry outputs should stay in `dist`, release artifacts, a registry, or operator
data storage, not npm packages.
