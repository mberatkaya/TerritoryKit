# Country Source Locks

Country source locks make boundary imports reproducible. A lock records the resolved source URL or
local source path, SHA-256, byte size, license, attribution, source version, release type, and a
stable content hash.

## Resolve

```sh
territory country source lock DE \
  --release-type gbOpen \
  --levels ADM0,ADM1,ADM2 \
  --output ./dist/de/sources.lock.json
```

The resolver accepts geoBoundaries metadata from the live metadata endpoint, `--metadata-url`, or a
local `--metadata` JSON file. Local metadata is useful for tests and reviewed data drops.

Supported source artifact transports are local paths, `file:`, `http:`, and `https:`. Unsupported
protocols fail before download.

## Verify

```sh
territory country source verify ./dist/de/sources.lock.json
```

Verification re-reads or re-fetches every available source artifact and compares the recorded
SHA-256. It does not mutate the lock.

## Metadata Fields

The resolver recognizes common geoBoundaries-style keys:

- Country: `countryCodeAlpha3`, `boundaryISO`, `shapeGroup`, or `country`
- Level: `adminLevel`, `boundaryType`, `shapeType`, or `admLevel`
- URL: `sourceUrl`, `downloadURL`, `gjDownloadURL`, `downloadUrl`, or `url`
- License: `license`, `sourceLicense`, or `licenseType`
- Attribution: `attribution`, `sourceAttribution`, or `boundarySource`
- Checksum: `sha256`, `checksum`, or `sourceSha256`

Available levels without license, attribution, or checksum metadata are rejected by source-lock
validation.
