# Eyüpsultan — NO_ROUTE kök neden incelemesi

**Kaynak:** `reports/tr-adm3/audit/istanbul-replay.json` (kilitli bariyer replay, `smart-derived-v1.7`)

## Ölçülen durum (baseline = güncel replay)

| Metrik | Değer |
| --- | ---: |
| Zone sayısı | 19 |
| Güven | low |
| En uzun desteklenmeyen dikiş (m) | 3611.46 |
| `finalRouting.longestUnroutedReason` | NO_ROUTE |
| Graf bileşen sayısı | 368 |
| Ağ yüz kapsamı (%) | 23.81 |
| Residual alan (%) | 76.19 |

## Kök neden sınıflandırması

Kod: `summarizeTurkeyNetworkRouteRootCause` (`packages/generators/src/turkey-istanbul-geometry-diagnostics.ts`)

1. **ORGANIC_ROUTE_NO_PATH** — Paylaşılan sınır koridorunda bağlı bariyer grafiği üzerinden güvenli rota bulunamadı.
2. **NETWORK_GRAPH_FRAGMENTED** — At-grade kesişim bazlı graf 368 bileşene ayrılmış; en büyük bileşen tüm segmentlerin küçük bir kesiti.
3. **LOW_NETWORK_FACE_COVERAGE** — Yüzeyleştirilmiş ağ yüzleri ilçe alanının ~%24'ünü kapsıyor; kalan residual organic aşamada uzun sentetik kenarlar üretiyor.
4. **LONG_UNSUPPORTED_SEAM_REMAINS** — Desteklenmeyen dikiş > 3000 m eşiği.

## Güvenli düzeltme kararı

Bu sprintte **ulusal üretici geometrisi değiştirilmedi**. Mevcut OSM/bariyer kanıtı, kopuk bileşenleri yapay olarak birleştirmeyi desteklemiyor; eşik manipülasyonu yapılmadı.

**Durum:** LOW confidence korunur; Sprint 3'te aynı kilitli girdilerle ulusal RC doğrulaması ve olası koridor genişletme politikası ayrı değerlendirilir.
