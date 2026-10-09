# Üsküdar kıyı ve Adalar ada güvenliği

## Üsküdar

| Metrik (audit)                    | Değer |
| --------------------------------- | ----: |
| Zone                              |    40 |
| Güven                             |  high |
| En uzun desteklenmeyen zincir (m) |     0 |
| Topoloji                          |  PASS |

**Sonuç:** Audit replay ve mevcut geometri QA ile kıyıya taşma veya açık su üstü poligon **doğrulanmadı**. `inspectTurkeyGeneratedCoastlineSpill` fixture testleri CI'da çalışır; tam İstanbul bariyer replay bu ortamda eksik (`.territory/sprint-6` yok).

## Adalar (Prince Islands)

| Metrik                            |                Değer |
| --------------------------------- | -------------------: |
| Zone                              |                   14 |
| Güven                             | low (ada politikası) |
| En uzun desteklenmeyen zincir (m) |                    0 |
| Canonical geometry eşleşmesi      |        14/14 (audit) |

**Sonuç:** Cross-island sentetik köprü audit'te **reprodüklenmedi**. `inspectTurkeyIslandMultipolygonSafety` geçerli çok bileşenli adaları korur; dar yapay köprü fixture'ı reddeder.
