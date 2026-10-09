# Çatalca — kırsal üretim kalitesi

**Kaynak:** `istanbul-district-diagnostics.json`

| Metrik                            | Değer |
| --------------------------------- | ----: |
| Zone                              |    19 |
| Güven                             |   low |
| En uzun desteklenmeyen zincir (m) | ~7802 |
| Locality seed                     |   248 |
| Sentetik oran                     | ~0.20 |

`classifyTurkeyRuralGeneratorQuality` gerekçe kodları:

- `LOW_ROAD_DENSITY` (kırsal ağ)
- `LONG_UNSUPPORTED_CHAIN`
- `LOW_NETWORK_FACE_COVERAGE` (replay benzeri profil)

**Karar:** Semantik `estimated` / `administrative: false` korunur; resmî mahalle icat edilmedi. Yeterli coğrafi ayrıcı olmadığı için düşük güven bilinçli olarak kalır.
