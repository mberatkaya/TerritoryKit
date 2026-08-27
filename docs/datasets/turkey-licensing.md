# Turkey Licensing

Turkey ADM0-ADM2 uses the HDX/OCHA COD-AB package license recorded as `cc-by-igo` by HDX. TerritoryKit
records this as `CC BY-IGO` with attribution:

```text
OCHA Common Operational Dataset: Türkiye Administrative Boundaries
```

The source lock stores the package URL, download URL, ZIP member checksum, source date, byte size,
license, attribution, redistribution status, and commercial-use status.

Local municipal sources have independent licenses. They can be ingested only when redistribution,
commercial use, modification, attribution, source URL, download URL, checksum, and source date are
known.

ADM3 source discovery keeps authority separate from redistribution. An official MAKS, TUCBS, or
municipal source can be authoritative while still having `licenseState: review-required`,
`restricted`, or `unknown`. TerritoryKit only marks a discovered ADM3 source as production-eligible
when it is authoritative, has approved license evidence, and explicitly allows redistribution.
