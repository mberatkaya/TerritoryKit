# @territory-kit/data-id

Thin loader package for Indonesia pilot country artifacts. The package does not embed dataset geometry; pass a resolver that reads artifacts produced by `territory country build`.

```ts
import { loadIndonesiaDataset } from "@territory-kit/data-id";

const handle = await loadIndonesiaDataset({
  resolveArtifact: (path) => fetch(`/territory/id/${path}`).then((response) => response.text()),
  verifyChecksums: true,
  loadAdjacency: true
});
```
