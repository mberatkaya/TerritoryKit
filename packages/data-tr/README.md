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

`supportedLevels` includes `ADM3` because TerritoryKit now publishes a partial Gaziantep
neighbourhood pilot. `defaultLevels` remains `["ADM0", "ADM1", "ADM2"]` so callers do not
accidentally assume nationwide neighbourhood coverage.

Use `turkeyAdm3NeighbourhoodCoverage` or `isTurkeyAdm3ParentCovered(parentId)` before requesting
ADM3 data for a district. Covered parent IDs are the nine Gaziantep ADM2 districts in
`datasets/generated/countries/TR/levels/ADM3/coverage.json`.
