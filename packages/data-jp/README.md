# @territory-kit/data-jp

Thin loader package for Japan pilot country artifacts. The package does not embed dataset geometry; pass a resolver that reads artifacts produced by `territory country build`.

```ts
import { loadJapanDataset } from "@territory-kit/data-jp";

const handle = await loadJapanDataset({
  resolveArtifact: (path) => fetch(`/territory/jp/${path}`).then((response) => response.text()),
  verifyChecksums: true,
  loadAdjacency: true
});
```
