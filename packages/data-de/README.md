# @territory-kit/data-de

Thin loader package for Germany pilot country artifacts. The package does not embed dataset geometry; pass a resolver that reads artifacts produced by `territory country build`.

```ts
import { loadGermanyDataset } from "@territory-kit/data-de";

const handle = await loadGermanyDataset({
  resolveArtifact: (path) => fetch(`/territory/de/${path}`).then((response) => response.text()),
  verifyChecksums: true,
  loadAdjacency: true
});
```
