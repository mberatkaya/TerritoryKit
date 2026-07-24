# ADR-006: Turkey National Administrative Sources

## Status

Accepted

## Context

Turkey needs a production-oriented source model without treating synthetic or incomplete lower
administrative data as nationwide coverage. The repository already supports geoBoundaries pilot
country builds, but Turkey ADM2 feature counts and lower-level semantics require a reviewed national
source decision.

## Decision

Use the HDX/OCHA Common Operational Dataset administrative boundaries package
`cod-ab-tur` as the default Turkey national source for ADM0, ADM1, and ADM2. The locked source is the
GeoJSON ZIP resource, with each ADM level represented by a named ZIP member:

- ADM0: `tur_admin0.geojson`
- ADM1: `tur_admin1.geojson`
- ADM2: `tur_admin2.geojson`

The source lock records the ZIP member URL, member checksum, source date, license, attribution,
feature count, and source package URL. ADM3 and ADM4 remain unavailable until a redistributable
nationwide official source is reviewed and locked.

Source precedence for overlapping Turkey sources is:

1. official national redistributable source,
2. official local redistributable source,
3. newer source date,
4. higher geometry-quality result,
5. open compatible license,
6. deterministic provider id ordering.

## Consequences

- `territory country source lock TR` defaults to `hdx-cod-ab`.
- The Turkey build can verify ADM0-ADM2 source checksums without committing large geometry.
- Local municipal ADM3 datasets can be tracked as partial candidates but cannot promote Turkey ADM3
  to nationwide coverage.
- ADM4 is a technical target only; it is not applicable until a reviewed source model identifies a
  real lower unit below the chosen ADM3 semantics.
