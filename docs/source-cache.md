# Source Cache

The source cache stores raw fetched source artifacts only. It is separate from any future dataset
artifact registry cache.

Default locations are platform cache directories:

```text
macOS:   ~/Library/Caches/TerritoryKit/sources
Linux:   ~/.cache/territory-kit/sources
Windows: %LOCALAPPDATA%/TerritoryKit/Cache/sources
```

Use CLI options to control it:

```sh
territory import geojson --url https://example.test/regions.geojson --output ./dist/regions
territory import geojson --url https://example.test/regions.geojson --refresh --output ./dist/regions
territory import geojson --url https://example.test/regions.geojson --no-cache --output ./dist/regions
territory import geojson --url https://example.test/regions.geojson --cache-dir ./.territory/cache/sources --output ./dist/regions
```

## Cache Key

The cache key includes provider id, normalized URL or input identity, source version, and expected
checksum. Provider ids and cache keys are sanitized before paths are created.

## Corruption

Cached metadata and artifact SHA-256 are verified before reuse. Corrupt entries are removed and
reported as structured warnings or errors. Expected checksum mismatch stops before parse.

## Security Notes

The HTTP transport allows only `http:` and `https:` and rejects protocols such as `ftp:`, `data:`,
and `javascript:`. It enforces redirect limits, timeouts, maximum size checks, temporary-file
cleanup, and SHA-256 verification. This is not a complete SSRF defense.
