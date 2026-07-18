# Dataset Coverage

Generated: 2026-07-15T00:00:00.000Z

This registry reports explicit source/artifact lifecycle state, not a claim that every level has a committed artifact.
Administrative availability is represented with ADM0 through ADM5 only. Municipality, neighbourhood, and similar meanings are stored as semantic metadata on the corresponding ADM record.

| Metric                                   | Count |
| ---------------------------------------- | ----: |
| totalIsoCountriesOrAreas                 |   249 |
| countriesWithBuiltAdm0                   |   228 |
| countriesWithAdm0SourceAvailableNotBuilt |     0 |
| countriesWithNoAdm0Source                |    20 |
| countriesWithAdm0ValidationFailure       |     0 |
| countriesWithAnyOptionalLevelUnavailable |     0 |
| countriesWithReviewedAdm1                |     5 |
| countriesWithReviewedAdm2                |     5 |
| countriesWithReviewedAdm3                |     1 |

| Level | Built | Partial | Source available | Source unavailable | Validation failed | Performance deferred | Not reviewed | License restricted |
| ----- | ----: | ------: | ---------------: | -----------------: | ----------------: | -------------------: | -----------: | -----------------: |
| ADM0  |   228 |       0 |                0 |                 20 |                 0 |                    1 |            0 |                  0 |
| ADM1  |     5 |       0 |                0 |                  0 |                 0 |                    0 |          244 |                  0 |
| ADM2  |     5 |       0 |                0 |                  0 |                 0 |                    0 |          244 |                  0 |
| ADM3  |     0 |       1 |                0 |                  0 |                 0 |                    0 |          248 |                  0 |
| ADM4  |     0 |       0 |                0 |                  0 |                 0 |                    0 |          249 |                  0 |
| ADM5  |     0 |       0 |                0 |                  0 |                 0 |                    0 |          249 |                  0 |

Pilot countries with reviewed ADM1/ADM2 mappings: DE, ID, JP, TR, US. Turkey also has reviewed ADM3 semantics for neighbourhood / Mahalle and a partial Gaziantep ADM3 artifact, without claiming nationwide ADM3 source coverage.

Sources:

- Natural Earth ADM0 source metadata is tracked as Public Domain with attribution.
- geoBoundaries source metadata is tracked as CC BY 4.0.
- Non-pilot ADM1-ADM5 mappings require country-specific review before publishing artifacts.
