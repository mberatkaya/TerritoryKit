# Üsküdar kıyı ve Adalar ada güvenliği

## Üsküdar

| Metrik (audit)                    | Değer |
| --------------------------------- | ----: |
| Zone                              |    40 |
| Güven                             |  high |
| En uzun desteklenmeyen zincir (m) |     0 |
| Topoloji (audit)                  |  PASS |

**Doğrulama sınıfı:** `HISTORICAL_AUDIT_ONLY` (10 ilçe diagnostik) + canlı replay yalnızca 3 ilçe (`istanbul-replay.json`).

**Kıyı/su:** `inspectTurkeyGeneratedCoastlineSpill` yalnızca **kapalı `water` bariyer poligonları** ile gerçek `polygon-clipping` kesişim alanı ölçer. Coastline çizgileri su poligonuna dönüştürülmez. Verified water olmadan durum **`NOT_ASSESSED`**; `ok=true` kıyı güvenliği kanıtı değildir.

**Fixture:** `FIXTURE_TESTED` — gerçek overlap, ayrık su, delikli poligon, eksik coastline ve eksik water senaryoları CI'da.

## Adalar (Prince Islands)

| Metrik                            |                Değer |
| --------------------------------- | -------------------: |
| Zone                              |                   14 |
| Güven                             | low (ada politikası) |
| En uzun desteklenmeyen zincir (m) |                    0 |
| Canonical geometry eşleşmesi      |        14/14 (audit) |

**Ada güvenliği:** `inspectTurkeyIslandMultipolygonSafety` uzak `MultiPolygon` bileşenlerini **korur** (centroid/alan köprü heuristiği kaldırıldı). Dar boyun yalnızca ölçülebilir bbox yaklaşık genişlik ile **`SUSPECTED`** olarak işaretlenir; verified water maskesi olmadan connector iddiası **`NOT_ASSESSED`**.

**Sonuç:** Audit'te cross-island sentetik köprü **reprodüklenmedi** (`HISTORICAL_AUDIT_ONLY`). Sprint 2'de üretim poligonları değiştirilmedi — **`NO_GEOMETRY_CHANGE`**.
