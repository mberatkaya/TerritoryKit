# Üretilmiş-only şekil patolojisi

**Modül:** `inspectTurkeyGeneratedZonePathology`  
**Şema:** `territorykit-tr-adm3-generated-pathology@1`

## Kapsam

Yalnızca `sourceClass: generated` veya `boundarySourceClass: smart-derived` ve `administrative !== true` zone'lar. `skippedOfficialZoneCount` yalnızca resmî/idari (`official` / `administrative`) zone'ları sayar; OSM veya diğer sınıflar sessizce atlanmaz.

## Tespit kategorileri

| Kod                           | Açıklama                                                                 |
| ----------------------------- | ------------------------------------------------------------------------ |
| SLIVER                        | Alan eşiği altı                                                          |
| EXCESSIVE_ASPECT_RATIO        | Bbox en-boy oranı                                                        |
| THIN_CORRIDOR                 | `bboxApproxMinWidthMeters` — yaklaşık; kanıtlanmış minimum koridor değil |
| SPIKE                         | Kapalı halkada tüm köşeler (ilk vertex dahil)                            |
| DETACHED_MICRO_COMPONENT      | MultiPolygon mikro parça                                                 |
| UNSUPPORTED_STRAIGHT_BOUNDARY | Bariyer hizası diagnostik (parent+barrier gerekir)                       |
| LOW_BARRIER_ADHERENCE         | Düşük bariyer takibi                                                     |

## Fatih

Audit replay: **30 zone, high confidence, 0 m** desteklenmeyen zincir; topoloji PASS (`HISTORICAL_AUDIT_ONLY`).  
Yerel dataset artifact'inden salt okunur yükleme varsa patoloji **`READONLY_STORED_GEOMETRY`**; aksi halde **`NOT_ASSESSED`**. Kozmetik repair uygulanmaz; **`NO_GEOMETRY_CHANGE`**.
