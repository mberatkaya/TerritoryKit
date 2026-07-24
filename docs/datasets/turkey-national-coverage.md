# Turkey National Coverage

Current national production source coverage:

| Level | Coverage status |                          Feature count | Notes                          |
| ----- | --------------- | -------------------------------------: | ------------------------------ |
| ADM0  | verified source |                                      1 | HDX/OCHA COD-AB                |
| ADM1  | verified source |                                     81 | Province / İl                  |
| ADM2  | verified source |                                    973 | District / İlçe                |
| ADM3  | partial         | 786 committed Gaziantep pilot features | No nationwide source lock      |
| ADM4  | not applicable  |                                      0 | Requires reviewed source model |

`verified source` means the source URL, license, checksum, byte size, and feature count are recorded.
Publish readiness still depends on a successful local build, hierarchy report, adjacency report, and
geometry quality report for the generated artifact.

Turkey is not marked `nationwide complete` for ADM3 or ADM4. A complete national lower-admin claim
requires all provinces, parent-child links, source checksums, compatible license metadata, stable
IDs, and strict geometry quality gates.
