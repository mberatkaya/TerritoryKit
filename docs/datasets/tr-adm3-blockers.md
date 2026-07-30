# Turkey ADM3 Blockers

This audit does not approve sources with unclear license, missing geometry, blocked access, missing
parent fields, missing source-native IDs, or only tabular/name-list evidence.

## Summary

| Status                     | Count | Meaning                                                                                 |
| -------------------------- | ----: | --------------------------------------------------------------------------------------- |
| license-blocked            |     3 | Geometry-like source exists, but redistribution/commercial-use rights are not verified. |
| access-blocked             |     2 | Source/service was discoverable but not accessible enough to verify.                    |
| geometry-unavailable       |     6 | Source is a map, PDF, list, table, empty layer, or otherwise not polygon geometry.      |
| quality-blocked            |     1 | Geometry exists, but missing fields block stable ADM3 identity or parent mapping.       |
| requires-authority-request |    62 | No public redistributable source found; request official MAKS/authority export.         |

Total blocked provinces: 74.

## License Blockers

| Province | Source                                    | Blocker                                                                                                                             |
| -------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| İstanbul | IBB Şehir Haritası / ArcGIS traces        | Official map layer is visible, but no verified open-data download/license was found. Non-official ArcGIS copies are not acceptable. |
| İzmir    | İzmir Kent Rehberi ArcGIS `Mahalle` layer | 1,311-feature official layer has useful fields, but copyright/license metadata is empty.                                            |
| Muğla    | Muğla CBS blog MAKS-derived SHP/RAR       | Page says data is informational only and not for official transactions; redistribution and commercial use are unclear.              |

## Access Blockers

| Province | Source                                                              | Blocker                                               |
| -------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| Ankara   | ASKI ArcGIS `MAHALLE SINIRI` search-indexed layer                   | Live REST requests returned service-not-found errors. |
| Artvin   | Artvin Il Ozel Idaresi ArcGIS `Mahalle Siniri` search-indexed layer | Live requests returned empty/404 responses.           |

## Geometry-Unavailable Blockers

| Province       | Source                                                    | Blocker                                                      |
| -------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| Afyonkarahisar | ULASAV city map/list result                               | PDF/JPEG map/list is not vector polygon geometry.            |
| Erzincan       | Erzincan Il Ozel Idaresi ArcGIS `Mahalle Sinirlari` layer | Layer metadata exists, but feature count query returned 0.   |
| Mersin         | Yenisehir area/population tables                          | District tabular data is not province-wide polygon geometry. |
| Tekirdağ       | Çorlu area tables                                         | District tabular data is not province-wide polygon geometry. |
| Uşak           | Muhtar/name list                                          | Name list is not polygon geometry.                           |
| Van            | District PDF maps and XLS name lists                      | Maps/name lists are not vector polygon geometry.             |

## Quality Blockers

| Province | Source             | Blocker                                                                                                                   |
| -------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Konya    | Konya 2024 GeoJSON | Sampled properties expose only `ADI_NUMARA`; missing source-native ID and parent field block stable IDs and ADM2 mapping. |

## Authority-Request Blockers

For 62 provinces, no redistributable public provincial polygon source was found during this audit.
Use the request template in `docs/datasets/tr-adm3-authority-request.md` to request either:

- a national MAKS export with clear redistribution and commercial-use rights, or
- a province-specific official open data package with source-native ID and ADM2 parent fields.

Affected province codes:

`01`, `02`, `04`, `05`, `07`, `09`, `10`, `11`, `12`, `13`, `14`, `15`, `17`, `18`, `19`,
`21`, `22`, `23`, `25`, `26`, `28`, `29`, `30`, `31`, `32`, `36`, `37`, `39`, `40`, `41`,
`43`, `44`, `45`, `46`, `47`, `49`, `50`, `51`, `53`, `55`, `56`, `57`, `60`, `61`, `62`,
`63`, `66`, `67`, `68`, `69`, `70`, `71`, `72`, `73`, `74`, `75`, `76`, `77`, `78`, `79`,
`80`, `81`.
