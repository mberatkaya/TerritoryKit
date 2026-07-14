# World Countries ADM0 Dataset

`world-countries` converts a local Natural Earth Admin 0 GeoJSON source into TerritoryKit
`territory-schema@1` artifacts with stable global ADM0 IDs.

The dataset contains countries and dependent territories only. It does not include city, province,
district, municipality, neighborhood, or other internal administrative boundaries.

## Source

The build command expects a local GeoJSON `FeatureCollection` derived from Natural Earth Admin 0
countries.

```sh
territory dataset build world-countries \
  --source ./sources/ne-admin0.geojson \
  --output ./dist/world-countries \
  --source-version 5.1.2 \
  --source-sha256 <sha256> \
  --build-date 2026-01-01T00:00:00.000Z
```

Natural Earth states that its data is public domain. Generated artifacts preserve the attribution
text `Made with Natural Earth` and include an `attribution.txt` file. TerritoryKit is not the
official source for any boundary.

## Detail Levels

The build emits three detail levels by default:

```text
low/
medium/
high/
```

`high` preserves source coordinates. `medium` and `low` use a conservative deterministic ring
thinning pass for local-source builds in this sprint. The same territory ID is used across all
detail levels; only geometry and geometry hashes may differ.

Future source-adapter work can map Natural Earth's native scales as:

```text
110m -> low
50m  -> medium
10m  -> high
```

## Artifacts

The output directory contains:

```text
world-countries/
├── manifest.json
├── attribution.txt
├── checksums.json
├── build-report.json
├── low/
│   └── dataset.json
├── medium/
│   └── dataset.json
└── high/
    └── dataset.json
```

`manifest.json` follows the global manifest standard and records source provider, source version,
source URL, source date, build date, CRS, detail levels, license, attribution, worldview, boundary
policy, disputed-area policy, geometry hash, and artifact checksum.

`checksums.json` records SHA-256 checksums for every generated file except itself.
`build-report.json` records feature counts, skipped records, warning/error counts, fallback ID
counts, detail metrics, artifact sizes, source SHA-256, output checksums, and structured issues.

## Reproducible Builds

Use `--build-date` for explicit reproducibility:

```sh
territory dataset build world-countries \
  --source ./sources/ne-admin0.geojson \
  --output ./dist/world-countries \
  --build-date 2026-01-01T00:00:00.000Z
```

CI may instead use `SOURCE_DATE_EPOCH`:

```sh
SOURCE_DATE_EPOCH=1767225600 territory dataset build world-countries \
  --source ./sources/ne-admin0.geojson \
  --output ./dist/world-countries
```

The artifact build report normalizes `buildDurationMs` to `0` so two builds with the same source,
source metadata, detail options, and build date can be byte-for-byte identical.

## Checksums

When `--source-sha256` is provided, the source file is verified before parsing. A mismatch stops the
build before any output is written.

Generated artifact checksums can be verified from `checksums.json`:

```json
{
  "algorithm": "sha256",
  "files": {
    "manifest.json": "...",
    "low/dataset.json": "..."
  }
}
```

## Data Quality

The importer reports structured issues for invalid JSON, invalid GeoJSON roots, missing or null
geometry, unsupported geometry types, empty coordinates, missing usable country codes, duplicate
country codes, duplicate TerritoryKit IDs, missing names, and unsupported property shapes.

Warnings are allowed by default and are recorded in `build-report.json`. `--strict` turns warnings
into failures.

## Boundary Policy

The generated manifest uses:

```json
{
  "boundaryPolicy": "natural-earth-source-represented",
  "worldview": "natural-earth-international",
  "disputedAreaPolicy": "natural-earth-disputed-boundaries-not-authoritative"
}
```

These artifacts must not be treated as legal boundary decisions. Disputed areas follow the source
representation and should be accompanied by product-specific caveats where appropriate.

## Known Limitations

- This sprint does not add automatic source download or cache behavior.
- Large Natural Earth source files and generated artifacts are not committed to the repository.
- `low` and `medium` are deterministic local simplifications, not separate Natural Earth native
  scale downloads yet.
- Geometry quality checks rely on existing TerritoryKit validation; advanced repair and topology
  pipelines are deferred.
- Features without a usable alpha-2 code need a stable alpha-2 fallback field such as `ISO_A2_EH`;
  otherwise they are reported as errors.
