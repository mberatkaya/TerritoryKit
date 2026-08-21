# ADR 0014: Turkey V2 National Playable Artifacts

## Status

Accepted.

## Context

Turkey now has a reviewed national ADM0-ADM2 source path and a deterministic Turkey V2 hybrid ADM3
pipeline. KapRota-style gameplay needs a continuous national territory layer, but nationwide
official ADM3 neighbourhood/village source coverage is still fragmented.

Bundling a full national ADM3 geometry artifact in `@territory-kit/data-tr` would increase package
size and blur the difference between official administrative records and generated playable zones.

## Decision

TerritoryKit will publish Turkey V2 as `territory-kit-tr-v2-playable` through resolver/registry
artifacts, not embedded npm geometry. The build uses:

- HDX/OCHA COD-AB for ADM0, ADM1, and ADM2.
- Reviewed official ADM3 artifacts when locally available.
- OSM ADM3 artifacts when explicitly built and supplied.
- TerritoryKit generated zones for remaining ADM2 gaps.

The priority is fixed as:

```text
official > osm > generated
```

Generated zones are marked with `sourceClass: "generated"` and `semanticType: "generated-zone"`.
They are playable coverage only and must not be presented as official mahalle or koy records.

`@territory-kit/data-tr` exposes `turkeyV2NationalDatasetDescriptor`,
`loadTurkeyV2NationalDataset()`, and `resolveTurkeyDataset({ includePlayableAdm3: true })`. It still
requires a resolver or registry for geometry.

Publish-ready national output is stricter than diagnostic output. A strict Turkey V2 national
release must contain exactly 1 ADM0 country, 81 ADM1 provinces, and 973 ADM2 districts; all 973
districts must build successfully, have at least one ADM3 playable zone, and reach at least 99.99%
final coverage. Source-lock expected and actual ADM0/ADM1/ADM2 counts must match those report
counts. Outputs built with `--max-districts`, smoke runs, and benchmark runs are marked partial and
must not be presented as publish-ready.

Artifact metadata is built in a deterministic non-circular order:

1. Build the dataset, level datasets, query artifact, optional adjacency artifact, and optional
   render artifacts.
2. Serialize the core artifact payloads and compute their SHA-256 checksums and byte sizes.
3. Build a preliminary registry over non-quality release artifacts and validate registry/checksum
   consistency without filesystem placeholders.
4. Produce `quality-report.json`, including real artifact integrity error counts for that
   preliminary registry.
5. Compute the quality report checksum.
6. Build the final registry and artifact plan using real checksums for every listed artifact.
7. Build the final checksums manifest for the produced artifacts, excluding `checksums.json` itself
   to avoid self-hashing.
8. `validate` rechecks the final directory against the registry with streaming SHA-256 and byte-size
   checks.

The registry must not contain placeholder `sha256: ""` or `sizeBytes: 0` entries. Optional artifacts
are omitted when they are not produced: `--no-render` removes render registry entries, and
`--no-adjacency` removes adjacency registry entries.

## Consequences

- Applications can opt into national playable ADM3 coverage without downloading geometry at package
  install time.
- Source locks, provenance, attribution, licenses, coverage, quality, registry entry, artifact plan,
  and checksums are emitted as build/report artifacts.
- `build` can emit diagnostic artifacts when gates fail, while `publish-ready` blocks release on hard
  quality failures.
- `quality.ok` continues to describe diagnostic artifact health; `quality.publishReady` records the
  strict national release decision.
- Registry integrity failures are hard quality failures, and strict CLI validation compares registry
  metadata against real files on disk.
- Future official or OSM coverage can replace generated gaps without changing the loader contract.
