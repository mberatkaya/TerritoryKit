# Global Datasets

Global datasets extend `territory-schema@1` without changing its required runtime shape. Existing
loaders still read `{ manifest, zones }`; global datasets add stricter manifest metadata and store
zone metadata under `zone.properties.territory`.

## Manifest Contract

Global manifests must include:

- `datasetId`
- `datasetVersion`
- `schemaVersion`
- `countryCodes`
- `adminLevels`
- `sourceProvider`
- `sourceDate`
- `buildDate`
- `license`
- `attribution`
- `crs`
- `geometryDetail`
- `geometryHash`
- `artifactChecksum`
- `boundaryPolicy`
- `worldview`
- `disputedAreaPolicy`

Example:

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

Use `validateGlobalDatasetManifest` when a dataset is intended for the global standard:

```ts
import { validateGlobalDatasetManifest } from "@territory-kit/dataset";

const result = validateGlobalDatasetManifest(manifest);

if (!result.ok) {
  console.error(result.issues);
}
```

## Zone Metadata

Global zone metadata lives in `zone.properties.territory` to preserve schema-v1 compatibility.

```json
{
  "id": "tr:adm2:fatih",
  "datasetId": "turkey-admin",
  "level": 2,
  "properties": {
    "territory": {
      "adminLevel": "ADM2",
      "localType": "district",
      "codes": {
        "iso3166_1": "TR",
        "official": "3410",
        "source": "official-3410"
      },
      "names": {
        "default": "Fatih",
        "tr": "Fatih"
      },
      "source": {
        "provider": "Example national statistics office",
        "sourceId": "3410",
        "sourceUrl": "https://example.gov/data",
        "sourceDate": "2026-01-01",
        "importedAt": "2026-07-14",
        "license": "Example Open Data License",
        "attribution": "Example national statistics office"
      }
    }
  }
}
```

`level` remains the numeric engine hierarchy. `adminLevel` is the global semantic level:

```text
level 0 -> ADM0
level 1 -> ADM1
level 2 -> ADM2
level 3 -> ADM3
level 4 -> ADM4
```

## Query and Display Artifacts

The canonical query dataset should preserve stable IDs, hierarchy, source metadata, and geometry
hashes. Future display artifacts may be simplified or tiled for rendering. Display artifacts must
reference the canonical manifest and keep the same territory IDs.

## Artifact Policy

Large global datasets should not be embedded in npm packages. Publish build code, manifests,
checksums, attribution files, and small fixtures in the repository. Publish large generated
artifacts separately and verify them with `artifactChecksum`.

## Boundary Policy

No dataset should imply that disputed borders have one universal answer. Each global manifest must
document:

- the selected worldview;
- whether boundaries come directly from the source or are reconciled;
- how disputed areas are represented;
- whether downstream map display should show caveats.
