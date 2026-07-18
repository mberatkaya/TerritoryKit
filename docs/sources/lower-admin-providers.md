# Lower-Admin Providers

The `geoboundaries` and `geojson` adapters accept `ADM0` through `ADM5`. Adapter support means the
pipeline can parse and transform that level; it does not mean a source exists for every country and
level.

Use `territory sources inspect --provider geoboundaries --country TR --level ADM3 --json` to inspect
provider capability without downloading data. Supported-but-missing sources report
`source-unavailable`, not `provider-unsupported`.

Strict official/open-data manifests must include:

- provider
- countryCode
- adminLevel
- sourceUrl
- downloadUrl when the transformed artifact is built from a downloadable file
- sourceDate
- license
- attribution
- redistributionStatus
- commercialUseStatus
- modificationStatus
- checksum when publishing or locking artifacts

Strict production imports reject missing or incompatible redistribution metadata.

## Turkey ADM3 Source Research

The Gaziantep ADM3 pilot selected an official municipal KML source because it was reproducibly
downloadable and explicitly licensed as CC BY 4.0:

- Selected: Gaziantep Büyükşehir Belediyesi / Ulusal Akıllı Şehir Açık Veri Platformu,
  "Mahalle Sınır Alanları", KML, updated `2026-02-18T13:52:03Z`.
  Source: <https://ulasav.csb.gov.tr/dataset/27-mahalle-sinir-alanlari>
- Rejected: TUCBS national services. Official, but the inspected portal flow was service/search
  oriented and not a reproducible direct public download for a publishable artifact.
  Source: <https://ucbp.tucbs.gov.tr/veri-arama>
- Rejected: İstanbul Büyükşehir Belediyesi "Muhtarlık Adres Bilgileri". Machine-readable and
  official, but it is an address/point dataset, not neighbourhood boundary polygons.
  Source:
  <https://data.ibb.gov.tr/api/3/action/package_search?q=mahalle%20s%C4%B1n%C4%B1rlar%C4%B1>
- Rejected: Sivas Belediyesi "Sivas Mahalle Sınırı Haritası". License metadata was acceptable, but
  bounded reproducibility checks timed out against the SHP endpoint.
  Source: <https://ulasav.csb.gov.tr/dataset/58-sivas-mahalle-siniri-haritasi>
- Rejected: Kırıkkale and Kocasinan neighbourhood boundary pages where the catalog reported no
  license.

The selected source and all rejected candidates are recorded in
`datasets/generated/countries/TR/levels/ADM3/source-evaluation.json`.
