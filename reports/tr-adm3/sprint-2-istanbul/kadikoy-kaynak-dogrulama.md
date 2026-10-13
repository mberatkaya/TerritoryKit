# Kadıköy — resmî SHP bundle doğrulama

## CKAN kaydı

- Dataset: [Kadıköy mahalle sınırları](https://acikveri.kadikoy.bel.tr/tr/dataset/kadikoy-ilcesindeki-mahalle-sinirlari)
- Resource: `c7a8a9dc-c78f-417a-9e2c-42ec4d3436e7`
- Beklenen kayıt: **21** mahalle poligonu

## Bağımsız doğrulama

| Kontrol                                                               | Sonuç                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `.shp` tek başına 21 kayıt (audit)                                    | `HISTORICAL_AUDIT_ONLY`                                                                            |
| `.shx/.dbf/.prj/.cpg` ayrı bayt imzası                                | **BAŞARISIZ** — acquisition kaydı: tüm companion URL'ler aynı SHA-256 (`kadikoy-acquisition.json`) |
| Yerel companion dosyaları (`.territory/quality-source-audit/kadikoy`) | **`MISSING_LOCAL_FILE`** — placeholder bayt kullanılmaz                                            |
| `inspectTurkeyMunicipalShapefileCompanionBundle`                      | Yapısal doğrulama ayrı; duplicate acquisition → `BLOCKED_DUPLICATE_RESPONSE` / `NOT_ELIGIBLE`      |
| Ingestion / resmî gameplay ID değişimi                                | **Yapılmadı**                                                                                      |

## Pilot durumu

**`BLOCKED_BY_SOURCE`** — Tam, bağımsız doğrulanmış SHP+SHX+DBF+PRJ paketi olmadan resmî-tahmini karşılaştırma üretilmez (`BLOCKED_BY_MISSING_SOURCE`).

Tahmini gameplay: **28 zone** (`istanbul-district-diagnostics.json`); yasal mahalle sınırı değildir.
