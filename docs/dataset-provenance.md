# Dataset Provenance

Provenance is mandatory for global datasets. Consumers must be able to answer where the data came
from, when it was sourced, what license applies, and how attribution should be shown.

## Dataset-Level Provenance

The manifest records provenance for the artifact as a whole:

```json
{
  "datasetId": "world-countries",
  "datasetVersion": "0.1.0",
  "schemaVersion": "territory-schema@1",
  "countryCodes": ["tr", "us"],
  "adminLevels": ["ADM0"],
  "sourceProvider": "Natural Earth",
  "sourceDate": "2025-01-01",
  "buildDate": "2026-07-14",
  "license": "Public domain",
  "attribution": "Made with Natural Earth",
  "crs": "EPSG:4326",
  "geometryDetail": "medium",
  "geometryHash": "sha256:...",
  "artifactChecksum": "sha256:...",
  "boundaryPolicy": "source-represented",
  "worldview": "international",
  "disputedAreaPolicy": "documented-by-source"
}
```

`sourceDate` is the source snapshot date. `buildDate` is when TerritoryKit generated the artifact.
`geometryHash` covers normalized zone geometries. `artifactChecksum` covers the serialized artifact
that users download.

## Zone-Level Provenance

Use zone-level source metadata when a dataset mixes providers, releases, or licenses:

```ts
import type { TerritoryGlobalMetadata } from "@territory-kit/dataset";

const metadata: TerritoryGlobalMetadata = {
  adminLevel: "ADM1",
  localType: "province",
  source: {
    provider: "Example mapping authority",
    sourceId: "ADM1-34",
    sourceUrl: "https://example.gov/boundaries",
    sourceDate: "2026-01-01",
    importedAt: "2026-07-14",
    license: "Example Open Data License",
    attribution: "Example mapping authority"
  }
};
```

## Required Fields

Global dataset manifests require:

- source provider;
- source date;
- build date;
- license;
- attribution;
- CRS;
- geometry detail;
- geometry hash;
- artifact checksum;
- boundary, worldview, and disputed-area policies.

`validateGlobalDatasetManifest` enforces dataset-level requirements. `validateTerritoryGlobalMetadata`
enforces source metadata when validating a `properties.territory` object.

## Rebuilds

A rebuild from the same source files and options should produce the same territory IDs and geometry
hashes. `buildDate` and artifact checksums may change when serialization metadata changes. Import
pipelines should report these fields separately.
