# @territory-kit/data-us

Thin loader package for United States pilot country artifacts. The package does not embed dataset geometry; pass a resolver that reads artifacts produced by `territory country build`.

```ts
import { loadUnitedStatesDataset } from "@territory-kit/data-us";

const handle = await loadUnitedStatesDataset({
  resolveArtifact: (path) => fetch(`/territory/us/${path}`).then((response) => response.text()),
  verifyChecksums: true,
  loadAdjacency: true
});
```
