# TerritoryKit Errors

`@territory-kit/dataset` exports the shared error model:

- `TerritoryErrorCode`
- `TerritoryError`
- `TerritoryErrorDetails`
- `TerritoryErrorOptions`
- `isTerritoryError`
- `serializeTerritoryError`
- `deserializeTerritoryError`

## Stable Codes

Core/domain:

- `ZONE_NOT_FOUND`
- `INVALID_COORDINATE`
- `INVALID_BOUNDS`
- `INVALID_LEVEL`
- `INVALID_NEIGHBOR_DISTANCE`
- `ENGINE_STATE_INVALID`

Dataset:

- `DATASET_INVALID`
- `DATASET_SCHEMA_UNSUPPORTED`
- `DATASET_VERSION_UNSUPPORTED`
- `GEOMETRY_INVALID`

Registry/artifact:

- `DATASET_NOT_FOUND`
- `ARTIFACT_NOT_FOUND`
- `CHECKSUM_MISMATCH`
- `ARTIFACT_CORRUPTED`
- `CACHE_CORRUPTED`
- `DOWNLOAD_TIMEOUT`
- `REQUEST_ABORTED`

Runtime/adapter:

- `RUNTIME_DISPOSED`
- `RUNTIME_NOT_READY`
- `RUNTIME_CONFIGURATION_INVALID`
- `CAPABILITY_UNSUPPORTED`
- `ADAPTER_NOT_ATTACHED`
- `ADAPTER_DISPOSED`
- `ADAPTER_TARGET_INVALID`

`UNKNOWN` is used when serializing or wrapping errors that do not expose a TerritoryKit code.

## Policy

- Return `null` for normal no-match lookup results, such as `latLngToZone` outside any zone.
- Return an empty array for valid queries with no result, such as no visible zones or no neighbors.
- Throw `TerritoryError` for invalid configuration, invalid lifecycle calls, corruption,
  unsupported capabilities, registry misses, and checksum failures.
- Throw subclassed `TerritoryError` types when a package already has a compatibility error class,
  such as `TerritoryDatasetValidationError` or `TerritoryZoneNotFoundError`.
- Keep programmer errors explicit. Do not convert the full SDK to a `Result` model in this package
  line.

Serialization omits stack traces and redacts detail keys containing token, secret, password,
cookie, or authorization. Unknown errors serialize as `UNKNOWN` with a generic message unless they
are real `Error` instances.
