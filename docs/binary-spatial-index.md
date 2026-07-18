# Binary Spatial Index

Sprint 13 adds a browser-safe binary spatial index format for prebuilt viewport lookup.
The current format is intentionally simple and versioned: it stores level-partitioned bbox records
with packed Flatbush tree buffers and a zone ordinal table. Flatbush remains the default runtime
build fallback when no prebuilt index is provided.

## Format

- magic bytes: `TKSI`
- schema version: `1`
- byte order: little-endian
- metadata JSON: dataset id, dataset version, geometry hash, index hash
- level records: `level`, `start`, `count`, `treeOffset`, `treeByteLength`
- bbox records: `level`, `zoneOrdinal`, `west`, `south`, `east`, `north`
- Flatbush tree section: one serialized tree buffer per level
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
- invalid metadata JSON, wrapped as `ARTIFACT_CORRUPTED`
- count/length combinations that would point outside the artifact before allocating tables
- truncated level, bbox, Flatbush tree, or zone ordinal records
- duplicate levels, duplicate ordinals, duplicate zone ids, unknown zone ordinals, and trailing bytes
- non-finite, reversed, or out-of-domain longitude/latitude bbox records
- level tables that do not exactly match bbox record partitions or tree byte ranges

The core engine validates both `ArrayBuffer` artifacts and decoded
`TerritoryBinarySpatialIndex` objects against the loaded dataset before using them. Metadata,
zone id sets, ordinals, levels, bboxes, and the index hash must match the dataset. Decoded object
inputs are rebuilt into a trusted in-memory Flatbush search structure after validation, so caller
provided `search()` implementations are never trusted.

The query path restores Flatbush with the package's `Flatbush.from(index.data)` serialization
contract. Runtime complexity is therefore the same indexed bbox lookup path as a runtime-built
Flatbush engine, while engine startup can avoid rebuilding the tree when a prebuilt artifact is
available.

## CLI

```bash
territory index build dataset.json --output dataset.tksi
territory index inspect dataset.tksi
territory index validate dataset.tksi --dataset dataset.json
```

`territory index <dataset.json>` remains as a compatibility metadata summary command.
