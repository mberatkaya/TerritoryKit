# Lower-Admin Providers

The `geoboundaries` and `geojson` adapters accept `ADM0` through `ADM5`. Adapter support means the
pipeline can parse and transform that level; it does not mean a source exists for every country and
level.

Use `territory sources inspect --provider geoboundaries --country TR --level ADM3 --json` to inspect
provider capability without downloading data. Supported-but-missing sources report
`source-unavailable`, not `provider-unsupported`.

Strict official/open-data manifests must include:

- provider
- countryCode
- adminLevel
- sourceUrl
- sourceDate
- license
- attribution
- redistributionStatus
- checksum when publishing or locking artifacts

Strict production imports reject missing or incompatible redistribution metadata.
