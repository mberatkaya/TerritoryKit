# Sprint 2 — İstanbul ADM3 pilot özeti

- **Baseline main SHA:** `70aab395b0ed5eb7d0d9870a81362524c365827d`
- **Kadıköy resmî bundle:** BLOCKED_BY_SOURCE (`BLOCKED_DUPLICATE_RESPONSE`)
- **Determinizm (audit replay):** bilinmiyor

## Pilot ilçe tablosu

| İlçe | Zone | Güven | En uzun desteklenmeyen (m) | Replay | Not |
| --- | ---: | --- | ---: | --- | --- |
| Fatih | 30 | — | 0 | audit | — |
| Kadıköy | — | — | — | eksik | BLOCKED_BY_SOURCE |
| Üsküdar | — | — | — | eksik | — |
| Adalar | 14 | — | 0 | audit | — |
| Eyüpsultan | 19 | — | 3611.46062 | audit | ORGANIC_ROUTE_NO_PATH |
| Çatalca | — | — | — | eksik | — |

## Eyüpsultan NO_ROUTE

Koridor içinde bağlı bariyer grafiği yolu bulunamadı; OSM ağ bileşenleri parçalı ve yüzey kapsamı düşük.

## Kadıköy kaynak doğrulama

Companion SHA-256 benzersizliği: **1**. Durum: **BLOCKED_DUPLICATE_RESPONSE**.

## Kısıtlar

- .territory/sprint-6 barrier bundle bu ortamda yok; tam canlı İstanbul replay fixture dışı doğrulamaya kapalı.
- rc.7 ulusal artifact'leri değiştirilmedi; karşılaştırma audit replay kanıtına dayanır.
