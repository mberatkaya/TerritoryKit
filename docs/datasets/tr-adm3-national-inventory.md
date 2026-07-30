# Turkey ADM3 National Source Inventory

This audit records province-level source decisions for a future Turkey ADM3 / mahalle expansion.
It does not add new mahalle geometries to the production source catalog. The production ADM3
catalog remains limited to the existing Gaziantep pilot until each additional province has license,
download, checksum, parent mapping, stable ID, and geometry quality evidence.

Machine-readable inventory:

- `datasets/registry/tr-adm3-source-inventory.json`
- `datasets/registry/tr-adm3-source-inventory.schema.json`

## Scope

Reviewed source tiers, in priority order:

1. NVI MAKS or another national official authority source.
2. Ministry / ULASAV official open data discovery.
3. Metropolitan and municipal open data portals.
4. Official WFS, ArcGIS Feature Service, GeoJSON, KML, or Shapefile sources.
5. OSM only as a separate fallback candidate, not as an approved official source.

The audit intentionally excludes extraction from Google, Apple, Yandex, or other commercial map
products. Mahalle name lists, population tables, area tables, PDFs, JPEG/PNG maps, and screenshots are
not treated as usable mahalle geometry.

## Existing ADM3 Pilot

Gaziantep remains the only production ADM3 pilot in
`datasets/sources/TR/adm3-catalog.json`. The existing ingestion path uses:

- `kml-description-table` adapter
- `AD` as mahalle name
- `KIMLIKNO` as source-native ID
- `ILCEID` as parent source field
- reviewed `ILCEID -> TerritoryKit ADM2 ID` mappings
- deterministic IDs built from country, province, parent context, and source ID
- geometry gates for invalid polygons, Turkey extent, missing parents, containment, duplicates, and
  overlaps
- artifact budget checks through `pnpm data:tr:adm3:artifact-policy`

This sprint does not change that production catalog.

## Decision Counts

| Decision group | Provinces | Notes                                                                                                         |
| -------------- | --------: | ------------------------------------------------------------------------------------------------------------- |
| approved       |         4 | Source, license, geometry format, fields, and feature count were verified enough for future source-lock work. |
| candidate      |         3 | Source and license signals are promising, but adapter, CRS, download, or parent review remains.               |
| blocked        |        74 | License, access, geometry, quality, or authority-request blockers prevent use.                                |

Approved provinces:

- Bursa
- Gaziantep
- Kayseri
- Ordu

Candidate provinces:

- Denizli
- Sakarya
- Sivas

## Key Source Evidence

| Province  | Evidence                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bursa     | `https://acikyesil.bursa.bel.tr/dataset/mahalle-sinirlari`, `https://acikyesil.bursa.bel.tr/license`                                                           |
| Denizli   | `https://acikveri.denizli.bel.tr/dataset/denizli-ili-mahalle-sinirlari`, `https://adres.denizli.bel.tr/arcgis/rest/services/yayinlar/ilce_mahalle/MapServer/0` |
| Gaziantep | `https://ulasav.csb.gov.tr/dataset/27-mahalle-sinir-alanlari`, `https://creativecommons.org/licenses/by/4.0/`                                                  |
| Kayseri   | `https://ulasav.csb.gov.tr/dataset/38-kayseri-mahalle-siniri`, `https://acikveri.kayseri.bel.tr/sayfa/lisans/19`                                               |
| Ordu      | `https://acikveri.ordu.bel.tr/dataset/ordu-ilindeki-mahallelerin-alan-buyukluklerine-gore-siralamasi`, `https://acikveri.ordu.bel.tr/license`                  |
| Sakarya   | `https://veri.sakarya.bel.tr/dataset/92`, `https://veri.sakarya.bel.tr/license`                                                                                |
| Sivas     | `https://ulasav.csb.gov.tr/dataset/58-sivas-mahalle-siniri-haritasi`, `https://acikveri.sivas.bel.tr/license`                                                  |
| İzmir     | `https://kentrehberi.izmir.bel.tr/arcgis/rest/services/Rehber/CbsRehberGeoSB/MapServer/177`                                                                    |
| Muğla     | `https://cbs.mugla.bel.tr/blog/mahalleler-vektor-verisi`                                                                                                       |
| NVI MAKS  | `https://maks.nvi.gov.tr/`                                                                                                                                     |

## Open Data Findings

The best immediate sources are municipal open-data portals:

- Bursa publishes GeoJSON in EPSG:4326 with `AD`, `KIMLIKNO`, and `ILCEID`; 1,074 features.
- Kayseri publishes GeoJSON with `ADI`, `CBNO`, and `ILCE_CBNO`; 711 features; CC BY 4.0.
- Ordu publishes GeoJSON with `MAHALLE ADI`, `MAHALLE KODU`, and `ILCE ADI`; 772 features.
- Gaziantep is already locked as the production pilot with 786 KML features and CC BY 4.0.

Promising but not yet approved:

- Sakarya has open license and 677 GeoJSON features, but the source CRS is EPSG:5254. Current ADM3
  ingestion accepts EPSG:4326 unless a reprojection adapter is added.
- Denizli has open KML/SHP sources and 620 KML placemarks. The KML sample exposes `AD` and `FID`,
  while the municipal ArcGIS layer exposes `KIMLIKNO` and `ILCEID`; adapter/source selection needs
  review.
- Sivas has an open-data/ULASAV SHP entry, but the download endpoint timed out during audit, so
  fields, CRS, checksum, and feature count remain unverified.

Blocked but notable:

- İzmir has a technically strong official ArcGIS layer with 1,311 features and useful fields
  (`ADINUMARASI`, `UAVTID`, `ILCEID`), but the layer is not published with verified open-data
  redistribution and commercial-use terms.
- Konya publishes GeoJSON under CC BY 4.0, but the sampled 2024 file exposes only `ADI_NUMARA`;
  missing source-native ID and parent fields block stable ADM3 ingestion.
- Muğla publishes a MAKS-derived SHP/RAR page, but the page says the data is informational only and
  not for official transactions; redistribution and commercial use are not cleared.

## Batch Plan

Exact same municipality/provider, format, and license groups of 3-5 provinces do not exist in the
publicly discoverable sources. The following batches therefore group by provider family and adapter
shape, and each batch still requires per-provider source locks before production catalog promotion.

| Branch                                   | Provinces                              | Provider family                                      | Format/license family                                                  | Adapter                                                                              |
| ---------------------------------------- | -------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `audit/tr-adm3-open-geojson-batch-01`    | Bursa, Kayseri, Ordu, Sakarya          | official municipal open data portals                 | GeoJSON; municipal open data / CC BY-compatible rights                 | `geojson-property-map`; Sakarya needs EPSG:5254 reprojection                         |
| `audit/tr-adm3-open-file-batch-02`       | Denizli, Gaziantep, Sivas              | official municipal open data portals / ULASAV        | KML/SHP file-based vector; open-data / CC BY-compatible rights visible | `kml-description-table`, `shapefile-zip-property-map`, or ArcGIS export after review |
| `audit/tr-adm3-license-unblock-batch-03` | İstanbul, İzmir, Konya, Muğla          | official municipal GIS/open-data pages with blockers | vector traces with incomplete rights or fields                         | no ingestion until legal/field blockers clear                                        |
| `audit/tr-adm3-maks-authority-batch-04`  | Adana, Adıyaman, Ağrı, Amasya, Antalya | NVI MAKS authority path                              | authority export format/license TBD                                    | `authority-export-geojson-property-map`                                              |
