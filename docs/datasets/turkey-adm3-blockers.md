# Turkey ADM3 Blockers

Turkey ADM3 coverage is not nationwide. The current source inventory blocks production expansion
until legal, technical, and hierarchy requirements are satisfied province by province.

## Numeric Blockers

| Category                    | Province count | Notes                                                                      |
| --------------------------- | -------------: | -------------------------------------------------------------------------- |
| No verified geometry source |             76 | No province-wide licensed ADM3 polygon source was verified in this sprint. |
| Candidate technical blocker |              3 | Bursa checksum instability, Sakarya CRS, Trabzon missing parent field.     |
| Current source inaccessible |              1 | Gaziantep metadata page is reachable but download host did not resolve.    |
| License unclear             |              1 | Muğla page is official but redistribution license was not verified.        |

Approved province count: `0`

Candidate province count: `3`

Blocked province count: `78`

Built province count in this sprint: `0`

Metadata-only province count: `5`

## Largest Blocker

The largest blocker is absence of a redistributable, province-wide, official ADM3 polygon source for
most provinces. A complete national build needs an authoritative nationwide MAKS-compatible
neighbourhood/village polygon source or independently approved province/municipality sources for all
81 provinces, with redistribution rights and stable source locks.

## Candidate-Specific Blockers

| Province  | Blocker                                                         | Required next step                                                                                              |
| --------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Bursa     | raw source checksum changes across repeated downloads           | obtain a byte-stable resource URL or add a reviewed canonicalization/checksum contract before catalog promotion |
| Sakarya   | GeoJSON declares EPSG:5254                                      | implement and test a reprojection adapter, then review parent name mapping                                      |
| Trabzon   | GeoJSON lacks district parent field                             | obtain parent mapping source or provider metadata before hierarchy build                                        |
| Gaziantep | download host DNS failure                                       | restore/replace source URL and refresh source lock checksum                                                     |
| Muğla     | no redistribution license; informational-only notice; EPSG:5253 | obtain explicit license and official-use clarification; add reprojection support                                |

## Production Rule

Do not mark a province source as approved unless source lock creation can validate the current
artifact checksum and byte size. Historical checksums are useful provenance, but they are not enough
when the current download URL is inaccessible.
