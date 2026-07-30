# Turkey ADM3 Authority Request

Use this note when requesting official Turkey ADM3 / mahalle polygon data from NVI MAKS, a ministry
authority, ULASAV, a metropolitan municipality, or a provincial GIS authority.

## Request Goals

TerritoryKit needs a redistributable, machine-readable ADM3 source for Turkey mahalle and compatible
lower administrative units. A source can be considered for ingestion only when the authority confirms:

- source URL or delivery channel;
- download or service URL;
- data date/version;
- license text and attribution requirement;
- redistribution permission;
- commercial-use permission;
- modification permission;
- CRS;
- format;
- feature count;
- mahalle name field;
- source-native stable ID field;
- ilce parent field;
- whether the source represents mahalle, koy/village, OSB, or another local administrative class;
- whether there are known disputed, inactive, or transitional boundaries.

## Email Template

Subject: Mahalle sinir verisi icin resmi kaynak ve lisans teyidi talebi

Merhaba,

TerritoryKit projesinde Turkiye idari sinir veri setleri icin kaynak ve lisans denetimi yapiyoruz.
Amacimiz mahalle / koy gibi ADM3 seviyesindeki poligon verilerini yalnizca resmi kaynagi, lisansi,
yeniden dagitim izni, ticari kullanim izni, kaynak tarihi, parent ilce alanlari ve geometri kalitesi
dogrulandiktan sonra kataloglamak.

Asagidaki bilgileri paylasmaniz mumkun mudur?

1. Mahalle/koy poligon verisi icin resmi kaynak sayfasi veya servis URL'si.
2. Indirilebilir GeoJSON, KML, Shapefile, WFS veya ArcGIS Feature Service URL'si.
3. Veri tarihi veya surumu.
4. Lisans metni ve atif ifadesi.
5. Yeniden dagitim izni.
6. Ticari kullanim izni.
7. Degistirme / turev veri olusturma izni.
8. Koordinat sistemi.
9. Mahalle adi alani.
10. Source-native kalici ID alani.
11. Ilce parent alani.
12. Beklenen feature sayisi.
13. Verinin resmi islerde kullanima uygun olup olmadigi veya sadece bilgilendirme amacli olup olmadigi.

Veri acik veri portali uzerinden yayinlanmiyorsa, yazili izin veya veri paylasim protokolu ile
paylasilabilecek kosullari da iletebilir misiniz?

Tesekkurler.

## Requested Export Shape

Preferred formats:

- GeoJSON FeatureCollection in EPSG:4326.
- KML in EPSG:4326 with table-like attributes.
- Shapefile ZIP with `.prj`, `.dbf`, `.shp`, and `.shx`.
- WFS or ArcGIS Feature Service with query/export enabled.

Required attributes:

| Field type       | Example field names                                      |
| ---------------- | -------------------------------------------------------- |
| Mahalle name     | `AD`, `ADI`, `MAHALLE_ADI`, `ADINUMARASI`                |
| Source-native ID | `KIMLIKNO`, `MAHALLE_KODU`, `UAVTID`, `CBNO`, `GLOBALID` |
| District parent  | `ILCEID`, `ILCE_CBNO`, `ILCE_ADI`, `COUNTYID`            |

## First Request Batches

These are small 3-5 province batches to keep authority follow-up manageable:

| Branch                                   | Provinces                                 | Provider path                     | Adapter target                                |
| ---------------------------------------- | ----------------------------------------- | --------------------------------- | --------------------------------------------- |
| `audit/tr-adm3-maks-authority-batch-04`  | Adana, Adıyaman, Ağrı, Amasya, Antalya    | NVI MAKS                          | `authority-export-geojson-property-map`       |
| `audit/tr-adm3-maks-authority-batch-05`  | Aydın, Balıkesir, Bilecik, Bingöl, Bitlis | NVI MAKS                          | `authority-export-geojson-property-map`       |
| `audit/tr-adm3-maks-authority-batch-06`  | Bolu, Burdur, Çanakkale, Çankırı, Çorum   | NVI MAKS                          | `authority-export-geojson-property-map`       |
| `audit/tr-adm3-license-unblock-batch-03` | İstanbul, İzmir, Konya, Muğla             | municipal authority clarification | adapter depends on license and field response |

## Promotion Criteria

Do not add any response to `datasets/sources/TR/adm3-catalog.json` until:

- license permits redistribution and commercial use;
- source-native ID and parent fields are present or an explicitly reviewed fallback exists;
- CRS is EPSG:4326 or a reprojection adapter exists;
- checksum, byte size, source date, and feature count are locked;
- ADM2 parent mapping is reviewed;
- geometry quality gates pass without blockers;
- source attribution is recorded.
