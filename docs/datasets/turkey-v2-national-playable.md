# Turkey V2 National Playable Dataset

Turkey V2 national playable artifacts are built by:

```bash
pnpm turkey:v2:national:build
pnpm turkey:v2:national:validate
```

The build target is `territory-kit-tr-v2-playable@2.0.0-rc.1`. It keeps the canonical Turkey
ADM0-ADM2 hierarchy from HDX/OCHA COD-AB and fills ADM3 gameplay coverage per district with the
Turkey V2 hybrid priority:

```text
official > osm > generated
```

Generated fallback zones are playable game zones only. They are never official mahalle, koy, or
administrative records.

## Scope

| Level | Scope                       | Source policy                                |
| ----- | --------------------------- | -------------------------------------------- |
| ADM0  | 1 country                   | HDX/OCHA COD-AB                              |
| ADM1  | 81 provinces                | HDX/OCHA COD-AB                              |
| ADM2  | 973 canonical districts     | HDX/OCHA COD-AB                              |
| ADM3  | playable per-district zones | official/OSM where built, generated fallback |

The local build uses reviewed official ADM3 artifacts when they are present at
`.territory/build/TR/ADM3/official/levels/ADM3/dataset.json`. OSM is reported as `not-built` unless
an OSM artifact is provided with `--osm-artifact`.

## CLI

```bash
territory tr v2 national plan

territory tr v2 national build \
  --output .territory/build/TR/V2-national \
  --reports-output reports/tr-v2-national \
  --force

territory tr v2 national publish-ready \
  --output .territory/build/TR/V2-national \
  --reports-output reports/tr-v2-national \
  --force

territory tr v2 national validate \
  --output .territory/build/TR/V2-national
```

Useful smoke and benchmark scripts:

```bash
pnpm turkey:v2:national:smoke
pnpm turkey:v2:national:benchmark
```

## Artifacts

The local artifact directory includes:

- `manifest.json`
- `source-lock.json`
- `build-summary.json`
- `coverage.json`
- `quality-report.json`
- `hierarchy-report.json`
- `provenance.json`
- `attribution.json`
- `attribution.txt`
- `licenses.json`
- `distribution-policy.json`
- `migration-plan.json`
- `registry-entry.json`
- `artifact-plan.json`
- `checksums.json`
- `levels/ADM0/dataset.json`
- `levels/ADM1/dataset.json`
- `levels/ADM2/dataset.json`
- `levels/ADM3/dataset.json`
- `levels/ADM3/full.geojson`
- `query/query-artifact.json`
- optional `levels/ADM3/adjacency/adjacency.json`
- optional `render/**` MVT artifacts

Large geometry, render, and binary/query assets are local or registry artifacts. They are not
embedded in `@territory-kit/data-tr`.

## Loader

```ts
import { loadTurkeyV2NationalDataset, resolveTurkeyDataset } from "@territory-kit/data-tr";

const selection = resolveTurkeyDataset({ includePlayableAdm3: true });

const handle = await loadTurkeyV2NationalDataset({
  levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
  registry,
  verifyChecksums: true
});
```

The descriptor is `turkeyV2NationalDatasetDescriptor`. It advertises `ADM0` through `ADM3`, defaults
to `ADM0` through `ADM2`, and requires a resolver or hosted registry.

## Gates

The publish-ready gate requires:

- ADM0 count = 1
- ADM1 count = 81
- every ADM2 district built successfully
- every district final coverage >= 99.99%
- national final coverage >= 99.99%
- no orphan/cycle/duplicate stable ID failures
- strict Turkey V2 validation passes
- provenance, license, and attribution metadata is present
- registry/checksum metadata is present
- adjacency integrity passes when adjacency is built

`build` writes artifacts and reports even when a gate fails. `publish-ready` exits non-zero when a
hard gate fails.
