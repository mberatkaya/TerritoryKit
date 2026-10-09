# Üretilmiş-only şekil patolojisi

**Modül:** `inspectTurkeyGeneratedZonePathology`  
**Şema:** `territorykit-tr-adm3-generated-pathology@1`

## Kapsam

Yalnızca `sourceClass: generated` veya `boundarySourceClass: smart-derived` ve `administrative !== true` zone'lar.

## Tespit kategorileri

| Kod                           | Açıklama                   |
| ----------------------------- | -------------------------- |
| SLIVER                        | Alan eşiği altı            |
| EXCESSIVE_ASPECT_RATIO        | Bbox en-boy oranı          |
| THIN_CORRIDOR                 | Tahmini minimum genişlik   |
| SPIKE                         | Dar iç açı + kısa kenarlar |
| DETACHED_MICRO_COMPONENT      | MultiPolygon mikro parça   |
| UNSUPPORTED_STRAIGHT_BOUNDARY | Bariyer hizası diagnostik  |
| LOW_BARRIER_ADHERENCE         | Düşük bariyer takibi       |

## Fatih

Audit replay: **30 zone, high confidence, 0 m** desteklenmeyen zincir; topoloji PASS.  
**Onaylı mevcut kusur yok** — yeni diagnostik yalnızca export/ölçüm; kozmetik repair uygulanmaz.
