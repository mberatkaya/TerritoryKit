# Turkey Sources

The default national source catalog lives in `datasets/sources/TR`.

| Level | Provider                                | Source                                                     | License   | Features | Status                          |
| ----- | --------------------------------------- | ---------------------------------------------------------- | --------- | -------: | ------------------------------- |
| ADM0  | HDX/OCHA COD-AB                         | `tur_admin0.geojson` in `tur_admin_boundaries.geojson.zip` | CC BY-IGO |        1 | verified source                 |
| ADM1  | HDX/OCHA COD-AB                         | `tur_admin1.geojson` in `tur_admin_boundaries.geojson.zip` | CC BY-IGO |       81 | verified source                 |
| ADM2  | HDX/OCHA COD-AB                         | `tur_admin2.geojson` in `tur_admin_boundaries.geojson.zip` | CC BY-IGO |      973 | verified source                 |
| ADM3  | Local official portals, where available | varies                                                     | varies    |        0 | no live approved catalog source |
| ADM4  | none locked                             | none                                                       | none      |        0 | not applicable pending review   |

Source URL: <https://data.humdata.org/dataset/cod-ab-tur>

Download URL:
<https://data.humdata.org/dataset/d74086a0-f398-4474-9e12-1b9a70907bd0/resource/470bd810-2240-4ce0-b5c4-17434112ce41/download/tur_admin_boundaries.geojson.zip>

ZIP SHA-256:
`6d45f15de76d53da057312dfaedb60248141a1828ce6a5c7cbfeedc7f51714c3`

ADM3 examples such as Bursa, Sakarya, Trabzon, Muğla, and the historical Gaziantep source remain
province/local candidates or blockers. They must not be merged into a nationwide layer until every
province has compatible license, checksum, parent mapping, and geometry quality evidence.

The 81-province ADM3 source inventory is recorded in
`datasets/registry/tr-adm3-sources.json`. Only approved live sources may be copied into
`datasets/sources/TR/adm3-catalog.json` and locked under `extensions.turkeyAdm3` by
`territory country source lock TR --adm3-provinces ...`. See
[Turkey ADM3 source inventory](./turkey-adm3-source-inventory.md),
[Turkey ADM3 source contract](./turkey-adm3-source-contract.md), and
[Turkey ADM3 ingestion](./turkey-adm3-ingestion.md).
