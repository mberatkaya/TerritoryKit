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
