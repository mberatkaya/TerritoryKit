# Üsküdar kıyı ve Adalar ada güvenliği

## Üsküdar

| Metrik (audit)                    | Değer |
| --------------------------------- | ----: |
| Zone                              |    40 |
| Güven                             |  high |
| En uzun desteklenmeyen zincir (m) |     0 |
| Topoloji (audit)                  |  PASS |

**Doğrulama sınıfı:** `HISTORICAL_AUDIT_ONLY` (10 ilçe diagnostik) + canlı replay yalnızca 3 ilçe (`istanbul-replay.json`).

**Kıyı/su:** `inspectTurkeyGeneratedCoastlineSpill` yalnızca **doğrulanmış su alanı poligonları** (`verifiedWaterAreas` / `waterSourceFeatures` içindeki Polygon/MultiPolygon) ile birleşim sonrası `polygon-clipping` kesişimi ölçer. `waterway` çizgileri ve `waterBarriers` hattı su alanına dönüştürülmez. Verified water olmadan durum **`NOT_ASSESSED`**; kesişim hatasında **`NOT_ASSESSED`** (fail-closed).

**Fixture:** `FIXTURE_TESTED` — gerçek overlap, ayrık su, delikli poligon, eksik coastline ve eksik water senaryoları CI'da.

## Adalar (Prince Islands)

| Metrik                            |                Değer |
| --------------------------------- | -------------------: |
| Zone                              |                   14 |
| Güven                             | low (ada politikası) |
| En uzun desteklenmeyen zincir (m) |                    0 |
| Canonical geometry eşleşmesi      |        14/14 (audit) |

**Ada güvenliği:** `inspectTurkeyIslandMultipolygonSafety` uzak `MultiPolygon` bileşenlerini **korur**. Dar boyun yalnızca bbox yaklaşık genişlik ile **`SUSPECTED`** (`narrowNeckBboxApprox`); tam su/ada ayırımı **`crossWaterComponentSeparation: NOT_ASSESSED`**. Global `ok=true` yalnızca her iki kapsam netleştiğinde mümkün; şu an çoğu pilot **`NOT_ASSESSED`**.

**Sonuç:** Audit'te cross-island sentetik köprü **reprodüklenmedi** (`HISTORICAL_AUDIT_ONLY`). Sprint 2'de üretim poligonları değiştirilmedi — **`NO_GEOMETRY_CHANGE`**.
