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

`turkeyV2NationalDatasetDescriptor.datasetId` is `territory-kit-tr-v2-playable`. It still does not
embed large geometry in this package; use artifacts from `territory tr v2 national build` or a
hosted registry.
