# @territory-kit/data-tr

Thin loader package for Turkey/Turkiye pilot country artifacts. The package does not embed dataset geometry; pass a resolver that reads artifacts produced by `territory country build`.

```ts
import { loadTurkeyDataset } from "@territory-kit/data-tr";

const handle = await loadTurkeyDataset({
  resolveArtifact: (path) => fetch(`/territory/tr/${path}`).then((response) => response.text()),
  verifyChecksums: true,
  loadAdjacency: true
});
```

Hosted registries work through the same resolver contract:

```ts
const installed = await registry.installDataset({ datasetId: "territory-kit-tr" });
const handle = await loadTurkeyDataset({ registry, verifyChecksums: true });
```

`supportedLevels` includes `ADM0` through `ADM4` so clients can request national artifacts,
partial fixtures, or future reviewed lower-admin layers through the same resolver contract.
`defaultLevels` remains `["ADM0", "ADM1", "ADM2"]` because only those levels currently have a
reviewed national HDX/OCHA COD-AB source path.

Use `turkeyNationalCoverage` to distinguish verified national ADM0-ADM2 from blocked ADM3/ADM4.
Use `turkeyAdm3NeighbourhoodCoverage` or `isTurkeyAdm3ParentCovered(parentId)` before requesting
ADM3 data for a district. Covered parent IDs are the nine Gaziantep ADM2 districts in
`datasets/generated/countries/TR/levels/ADM3/coverage.json`; this is partial Gaziantep coverage,
not nationwide Turkey neighbourhood coverage.

Turkey V2 national playable artifacts are exposed through a separate resolver descriptor:

```ts
import { loadTurkeyV2NationalDataset, resolveTurkeyDataset } from "@territory-kit/data-tr";

const selection = resolveTurkeyDataset({ includePlayableAdm3: true });
const handle = await loadTurkeyV2NationalDataset({
  levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
  registry,
  verifyChecksums: true
});
```

`turkeyV2NationalDatasetDescriptor.datasetId` is `territory-kit-tr-v2-playable`, and the stable
target dataset version is `2.0.0`. It still does not embed large geometry in this package; use
artifacts from `territory tr v2 national publish-ready` or a hosted registry.

The historical 2026-08-22 stable publish-ready rebuild verifies 1 ADM0, 81 ADM1 provinces, 973 ADM2
districts, and nationwide ADM3 playable coverage through the external artifact resolver. Generated
ADM3 fallback remains explicitly non-official; `@territory-kit/data-tr` exposes resolver metadata,
not the large national geometry payload.

Sprint 5 adds a production OSM barrier snapshot supply for Turkey ADM3 smart fallback builds. Raw
Geofabrik/OpenStreetMap `.osm.pbf` snapshots stay in `.territory/cache`, normalized
ADM2 barrier artifacts stay in local or hosted artifact storage, and this package remains a thin
resolver descriptor. Smart-derived ADM3 output produced from those barriers is still generated,
estimated, non-administrative gameplay coverage, not official mahalle or koy geometry.
Sprint 5.1 adds smart fallback calibration diagnostics to those external artifacts; hybrid quality
reports can expose `smartAttempt` so clients can audit whether a district used accepted smart
geometry or explicit rejection. Sprint 6 adds organic low-confidence Smart and disables legacy
grid selection in normal national production. The historical `2.0.0` descriptor remains unchanged;
the `2.1.0-rc.1` candidate requires an explicit registry version and migration review.

Organic Smart geographic calibration treats Voronoi cells as coarse ownership, then routes shared
boundaries along real OSM road, rail and water corridors under unchanged topology gates. These
remain geography-aware estimated gameplay boundaries. Quality reports measure barrier-following
length and long unsupported straight chains at every angle.

The current `2.1.0-rc.2` calibration candidate is **not publish-ready**: 949/973 districts pass,
24 fail and seven are unavailable. Two precision exceptions omit 58 approved polygons.
See [the complete calibration evidence](../../reports/baselines/sprint-6-geographic-calibration.json).

## Sprint 6 final acceptance work

The `2.1.0-rc.2` figures above are the preserved calibration baseline. The separate
`2.1.0-rc.3` candidate uses `smart-derived-v1.3`, retains accepted official/OSM
geometry when generated gap fill fails, and evaluates Standard and Organic realism.
The 39-district Istanbul report and final national acceptance must pass before this
candidate can be merged. Generated territories remain estimated gameplay boundaries.
