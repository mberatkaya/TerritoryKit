# ADM0–ADM2 lisans ve attribution kanıt matrisi

**Makine okunur:** [licensing-evidence-matrix.json](licensing-evidence-matrix.json)  
**Hukuki durum:** `legalReviewStatus: PENDING_REVIEW` (teknik derleme, hukuki onay değildir)

## Ayrım tablosu

| Boyut                                               | ADM0                                                                      | ADM1                                                               | ADM2                                                               | HDX ulusal katalog                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------- |
| Orijinal kaynak lisansı (source-lock)               | CC BY-SA 2.0                                                              | CC BY-SA 2.0                                                       | ODbL 1.0                                                           | CC BY-IGO (COD-AB paket)                                  |
| geoBoundaries dağıtım lisansı (adapter varsayılanı) | CC BY 4.0                                                                 | CC BY 4.0                                                          | CC BY 4.0                                                          | —                                                         |
| Web/API metadata                                    | [gbOpen ADM0](https://www.geoboundaries.org/api/current/gbOpen/TUR/ADM0/) | [ADM1](https://www.geoboundaries.org/api/current/gbOpen/TUR/ADM1/) | [ADM2](https://www.geoboundaries.org/api/current/gbOpen/TUR/ADM2/) | [cod-ab-tur](https://data.humdata.org/dataset/cod-ab-tur) |
| Sabitlenmiş release                                 | `9469f095…`                                                               | aynı                                                               | aynı                                                               | ZIP SHA katalogda                                         |
| Ticari kullanım                                     | İnceleme gerekli                                                          | İnceleme gerekli                                                   | İnceleme gerekli                                                   | Katalog metadata: `commercialUseAllowed: true`            |
| Türev / değişiklik yükümlülükleri                   | İnceleme gerekli                                                          | İnceleme gerekli                                                   | ODbL SA riski — inceleme gerekli                                   | Katalog metadata: `modificationAllowed: true`             |
| Türkiye resmî idari sınır iddiası                   | Hayır                                                                     | Hayır                                                              | Hayır                                                              | OCHA operasyonel veri; resmî NVI/MAKS değildir            |

Kaynak satırları: `reports/tr-adm3/provenance/geoboundaries/source-candidates.json`, `datasets/sources/TR/national.json`.

## Çözülmemiş sorular (insan / hukuk)

1. CC BY-SA 2.0 ve ODbL 1.0 kilit dizeleri ile geoBoundaries CC BY 4.0 dağıtım koşulları TerritoryKit yeniden dağıtımı için uyumlu mu?
2. ADM2 ODbL, üretilen ulusal oyun dataset'i için share-alike yükümlülük getirir mi?
3. Tüm upstream zincirlerde ticari ürün kullanımı açıkça izinli mi?
4. MAKS/TUCBS ve belediye WFS erişimi ayrı Türkiye kamu verisi izni gerektirir mi?
5. Herkese açık bir GIS uç noktasına erişim, polygon artifact yeniden dağıtım yetkisi midir? (**Hayır** varsayımıyla işaretlenmeli; kanıtlanmış yazılı izin gerekir.)

## Yasaklar (bu sprint)

- Uydurma yazılı izin veya `legalReviewStatus: APPROVED` ataması yapılmadı.
- Veri sahiplerine otomatik başvuru yapılmadı.
- Path B veya Path A migrasyonu uygulanmadı.
