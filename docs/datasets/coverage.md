# Dataset Coverage

Generated: 2026-07-14T23:07:18.051Z

This registry reports explicit source/artifact lifecycle state, not a claim that every level has a committed artifact.
Missing municipality and neighbourhood data is marked unavailable rather than substituted with ADM2.

| Metric                             | Count |
| ---------------------------------- | ----: |
| Total ISO countries/areas          |   249 |
| License-restricted countries       |     0 |
| Countries with missing source      |   249 |
| Countries with validation failures |     0 |

| Level         | Built | Source available | Source unavailable | Validation failed | Not reviewed | License restricted |
| ------------- | ----: | ---------------: | -----------------: | ----------------: | -----------: | -----------------: |
| ADM0          |    40 |              200 |                  9 |                 0 |            0 |                  0 |
| ADM1          |     5 |                0 |                  0 |                 0 |          244 |                  0 |
| ADM2          |     5 |                0 |                  0 |                 0 |          244 |                  0 |
| ADM3          |     0 |                0 |                  0 |                 0 |          249 |                  0 |
| municipality  |     0 |                0 |                249 |                 0 |            0 |                  0 |
| neighbourhood |     0 |                0 |                249 |                 0 |            0 |                  0 |

Pilot countries with reviewed ADM1/ADM2 mappings: DE, ID, JP, TR, US.

Sources:

- Natural Earth ADM0 source metadata is tracked as Public Domain with attribution.
- geoBoundaries source metadata is tracked as CC BY 4.0.
- Non-pilot ADM1/ADM2 mappings require country-specific review before publishing artifacts.
