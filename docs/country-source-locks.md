# Country Source Locks

Country source locks make boundary imports reproducible. A lock records the resolved source URL or
local source path, SHA-256, byte size, license, attribution, source version, release type, boundary
source class, license gate state, source snapshot checksum, and a stable content hash.

## Resolve

```sh
territory country source lock DE \
  --release-type gbOpen \
  --levels ADM0,ADM1,ADM2 \
  --output ./dist/de/sources.lock.json
```

The resolver accepts geoBoundaries metadata from the live metadata endpoint, `--metadata-url`, or a
local `--metadata` JSON file. Local metadata is useful for tests and reviewed data drops. Turkey's
default `hdx-cod-ab` resolver uses reviewed HDX/OCHA COD-AB metadata for ADM0-ADM2 and records
ADM3/ADM4 as unavailable until a redistributable national source exists.

Supported source artifact transports are local paths, `file:`, `http:`, and `https:`. Source URLs
may also reference a ZIP member with `archive.zip#member.geojson`; the lock stores the extracted
member checksum and byte size. Unsupported protocols fail before download.

Turkey national example:

```sh
territory country source lock TR \
  --levels ADM0,ADM1,ADM2,ADM3,ADM4 \
  --output ./dist/tr/sources.lock.json
```

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

## Boundary Governance Fields

New source locks should preserve these fields when a boundary can be published:

- `boundarySourceClass`: `official-national`, `official-local`, `osm-administrative`,
  `smart-derived`, or `synthetic-test`.
- `licenseState`: `approved`, `pending`, `restricted`, or `unknown`.
- `sourceSnapshotChecksum`: checksum of the exact source snapshot used to build the geometry.

For ordinary country ADM0-ADM2 locks, reviewed national sources are recorded as
`boundarySourceClass: "official-national"`. Turkey province-scoped ADM3 locks record each approved
municipal/province source as `official-local`, while the synthetic top-level ADM3 summary carries a
deterministic checksum over the province source-lock extension. Missing Turkey ADM3 sources remain
unavailable in the lock and coverage reports; they are not replaced with fake ADM3 geometry.
