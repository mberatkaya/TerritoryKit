# Sprint 2 — İstanbul ADM3 pilot özeti

- **Baseline main SHA:** `70aab395b0ed5eb7d0d9870a81362524c365827d`
- **HEAD SHA:** `39d6ff045a9ae8a94af466e1dc26d10e5ee650f6`
- **Kadıköy resmî bundle:** BLOCKED_BY_SOURCE (`BLOCKED_DUPLICATE_RESPONSE`, FIXTURE_TESTED)
- **Determinizm kapsamı:** 3 ilçe replay (audit); 6 pilot ilçe için genel determinizm iddiası yok

## Pilot ilçe tablosu

| İlçe       | Zone | Güven | Replay                     | Patoloji                 | Kıyı/su      | Ada güvenliği | Geometri           |
| ---------- | ---: | ----- | -------------------------- | ------------------------ | ------------ | ------------- | ------------------ |
| Fatih      |   30 | high  | HISTORICAL_RECORDED_REPLAY | READONLY_STORED_GEOMETRY | NOT_ASSESSED | SUSPECTED     | NO_GEOMETRY_CHANGE |
| Kadıköy    |   28 | high  | NOT_ASSESSED               | READONLY_STORED_GEOMETRY | NOT_ASSESSED | NOT_ASSESSED  | NO_GEOMETRY_CHANGE |
| Üsküdar    |   40 | high  | NOT_ASSESSED               | READONLY_STORED_GEOMETRY | NOT_ASSESSED | NOT_ASSESSED  | NO_GEOMETRY_CHANGE |
| Adalar     |   14 | low   | HISTORICAL_RECORDED_REPLAY | READONLY_STORED_GEOMETRY | NOT_ASSESSED | NOT_ASSESSED  | NO_GEOMETRY_CHANGE |
| Eyüpsultan |   19 | low   | HISTORICAL_RECORDED_REPLAY | READONLY_STORED_GEOMETRY | NOT_ASSESSED | SUSPECTED     | NO_GEOMETRY_CHANGE |
| Çatalca    |   19 | low   | NOT_ASSESSED               | READONLY_STORED_GEOMETRY | NOT_ASSESSED | NOT_ASSESSED  | NO_GEOMETRY_CHANGE |

## Eyüpsultan NO_ROUTE

Koridor içinde bağlı bariyer grafiği yolu bulunamadı; OSM ağ bileşenleri parçalı ve yüzey kapsamı düşük.

## Kadıköy kaynak doğrulama

Companion yerel durumu: **0** eksik dosya. Bundle: **BLOCKED_DUPLICATE_RESPONSE**.

## Kısıtlar

- Canlı İstanbul bariyer replay (.territory/sprint-6/calibration/barriers) CI ortamında genelde yok; kıyı/su diagnostikleri verified water polygon olmadan NOT_ASSESSED.
- rc.7 ulusal artifact'leri değiştirilmedi; geometri karşılaştırması yalnızca mevcut yerel replay artifact'lerine dayanır.
- Sprint 2 çıktısı diagnostik ve kanıt düzeltmesidir; üretim poligon onayı veya rc.7 promote içermez.
