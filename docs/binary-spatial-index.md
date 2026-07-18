# Binary Spatial Index

Sprint 13 adds a browser-safe binary spatial index format for prebuilt viewport lookup.
The current format is intentionally simple and versioned: it stores level-partitioned bbox records
and a zone ordinal table. Flatbush remains the default runtime build fallback when no prebuilt
index is provided.

## Format

- magic bytes: `TKSI`
- schema version: `1`
- byte order: little-endian
- metadata JSON: dataset id, dataset version, geometry hash, index hash
- level records: `level`, `start`, `count`
- bbox records: `level`, `zoneOrdinal`, `west`, `south`, `east`, `north`
- zone ordinal table: length-prefixed UTF-8 zone ids
- checksum: FNV-1a style 32-bit checksum over the full artifact with the checksum field zeroed

The public contract is exposed from `@territory-kit/core`:

```ts
import {
  encodeTerritoryBinarySpatialIndex,
  decodeTerritoryBinarySpatialIndex,
  validateTerritoryBinarySpatialIndex,
  createTerritoryEngine
} from "@territory-kit/core";

const buffer = encodeTerritoryBinarySpatialIndex(dataset);
const index = decodeTerritoryBinarySpatialIndex(buffer, {
  datasetId: dataset.manifest.datasetId,
  datasetVersion: dataset.manifest.datasetVersion,
  geometryHash: dataset.manifest.geometryHash
});

const engine = createTerritoryEngine({ dataset, spatialIndex: index });
```

## Validation

The decoder rejects:

- corrupt or missing magic bytes
- unsupported schema versions
- unsupported byte order
- checksum mismatch
- dataset id, dataset version, geometry hash, or index hash mismatch
- truncated level, bbox, or zone ordinal records
- records that reference unknown zone ordinals

The core engine validates the binary index metadata against the loaded dataset before using it.
If validation fails, the artifact is rejected instead of silently rebuilding from JSON.

## CLI

```bash
territory index build dataset.json --output dataset.tksi
territory index inspect dataset.tksi
territory index validate dataset.tksi --dataset dataset.json
```

`territory index <dataset.json>` remains as a compatibility metadata summary command.
