# Sprint 2 — İstanbul ADM3 pilot özeti

- **Baseline main SHA:** `70aab395b0ed5eb7d0d9870a81362524c365827d`
- **HEAD SHA:** `8623082248ee0f599db717270736b140f74942ca`
- **Kadıköy resmî bundle:** BLOCKED_BY_SOURCE (`BLOCKED_DUPLICATE_RESPONSE`, FIXTURE_TESTED)
- **Determinizm kapsamı:** 3 ilçe replay (audit); 6 pilot ilçe için genel determinizm iddiası yok

## Pilot ilçe tablosu

| İlçe | Zone | Güven | Replay | Patoloji | Kıyı/su | Ada güvenliği | Geometri |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| Fatih | 30 | high | REAL_REPLAY_VERIFIED | REAL_REPLAY_VERIFIED | NOT_ASSESSED | SUSPECTED | NO_GEOMETRY_CHANGE |
| Kadıköy | 28 | high | NOT_ASSESSED | REAL_REPLAY_VERIFIED | NOT_ASSESSED | ASSESSED_CLEAR | NO_GEOMETRY_CHANGE |
| Üsküdar | 40 | high | NOT_ASSESSED | REAL_REPLAY_VERIFIED | NOT_ASSESSED | ASSESSED_CLEAR | NO_GEOMETRY_CHANGE |
| Adalar | 14 | low | REAL_REPLAY_VERIFIED | REAL_REPLAY_VERIFIED | NOT_ASSESSED | ASSESSED_CLEAR | NO_GEOMETRY_CHANGE |
| Eyüpsultan | 19 | low | REAL_REPLAY_VERIFIED | REAL_REPLAY_VERIFIED | NOT_ASSESSED | SUSPECTED | NO_GEOMETRY_CHANGE |
| Çatalca | 19 | low | NOT_ASSESSED | REAL_REPLAY_VERIFIED | NOT_ASSESSED | ASSESSED_CLEAR | NO_GEOMETRY_CHANGE |

## Eyüpsultan NO_ROUTE

Koridor içinde bağlı bariyer grafiği yolu bulunamadı; OSM ağ bileşenleri parçalı ve yüzey kapsamı düşük.

## Kadıköy kaynak doğrulama

Companion yerel durumu: **0** eksik dosya. Bundle: **BLOCKED_DUPLICATE_RESPONSE**.

## Kısıtlar

- Canlı İstanbul bariyer replay (.territory/sprint-6/calibration/barriers) CI ortamında genelde yok; kıyı/su diagnostikleri verified water polygon olmadan NOT_ASSESSED.
- rc.7 ulusal artifact'leri değiştirilmedi; geometri karşılaştırması yalnızca mevcut yerel replay artifact'lerine dayanır.
- Sprint 2 çıktısı diagnostik ve kanıt düzeltmesidir; üretim poligon onayı veya rc.7 promote içermez.
