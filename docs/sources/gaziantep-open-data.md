# Gaziantep Open Data ADM3 Source

Gaziantep Büyükşehir Belediyesi publishes "Mahalle Sınır Alanları" through the Ulusal Akıllı Şehir
Açık Veri Platformu. TerritoryKit uses it as the first official Turkey `ADM3 -> neighbourhood /
Mahalle` production pilot.

- Source page: <https://ulasav.csb.gov.tr/dataset/27-mahalle-sinir-alanlari>
- Download URL:
  <https://acikveri.gaziantep.bel.tr/dataset/5fac9bc5-8cc0-4883-8805-1f71149319db/resource/df82c9ce-f69d-4cc2-bf57-d4a36ed1c144/download/mahalle_sinirlari-1.kml>
- Publisher: Gaziantep Büyükşehir Belediyesi
- License: CC BY 4.0
- Source update date: `2026-02-18T13:52:03Z`
- Locked SHA-256: `f145ae9edd2db7a341634e14d59060a535258461794d361c3f49bdec2bcbfa9a`
- Locked size: `7439237` bytes

The artifact covers the nine Gaziantep ADM2 parents and intentionally reports `coverageStatus:
partial`. All other Turkey ADM2 parents remain uncovered by this pilot.

The generator parses KML `Placemark` entries, reads `AD`, `KIMLIKNO`, and `ILCEID` from the
description table, and maps each reviewed `ILCEID` to the existing TerritoryKit Turkey ADM2 parent.
Stable ADM3 IDs use:

```text
tr:adm3:27:<adm2-id-without-prefix>:<KIMLIKNO>
```

Geometry normalization uses GEOS/Shapely `make_valid`, six-decimal coordinate precision, and
sub-epsilon polygon/hole removal. The transformed artifact records this in `repair-report.json`.
No source feature may be rejected in a publishable build.

Use:

```bash
pnpm data:tr:adm3:validate
pnpm data:tr:adm3:build
```

For source refreshes, fetch into the local cache only after reviewing upstream license metadata:

```bash
pnpm data:tr:adm3:update --fetch --approve-unexpected-source
```
