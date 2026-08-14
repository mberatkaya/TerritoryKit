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

## Consequences

- Applications can opt into national playable ADM3 coverage without downloading geometry at package
  install time.
- Source locks, provenance, attribution, licenses, coverage, quality, registry entry, artifact plan,
  and checksums are emitted as build/report artifacts.
- `build` can emit diagnostic artifacts when gates fail, while `publish-ready` blocks release on hard
  quality failures.
- Future official or OSM coverage can replace generated gaps without changing the loader contract.
