# Sprint 2C — Fatih mahalle identity layer

## Decision

- **Technical pilot:** GO_WITH_REVIEW
- **Production release:** NO_GO

## Fatih metrics

| Metric                     | Value |
| -------------------------- | ----: |
| Gameplay zones             |    30 |
| Ambiguous zones            |    15 |
| Single-seed zones          |    10 |
| Unseeded zones             |     5 |
| Distinct seeds represented |    71 |

## Immutability

- Zone ID set SHA-256: `334ba60d9e4bf65c2acfce7d3724e7bf430ec082ad897459a902c19d3660852f`
- Geometry hash set SHA-256: `3b4c2dd9214f6aa1023277a3426e100bd9c2902f5c06e4a49b2478e462866645`
- Identity layer checksum: `fnv1a32:c85fa5eb`
- Determinism verified: **true**

## Alternative B preview comparison

Ambiguous Δ 0, distinct seeds Δ 0. Counts match preview within dedupe/boundary policy.

## Consumer contract

Use `createSettlementIdentityLookup` from `@territory-kit/core` with artifacts under `reports/tr-adm3/mahalle-identity-layer/`. Do not treat gameplay polygon edges as official mahalle boundaries.

## Map preview

Serve `examples/web-maplibre-turkey` with `MAHALLE_IDENTITY_PREVIEW=1` or open the mahalle identity preview entry.
