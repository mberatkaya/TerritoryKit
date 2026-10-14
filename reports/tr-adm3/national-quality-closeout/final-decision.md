# Ulusal ADM2–ADM3 kalite kapanışı — nihai karar

**İncelenen commit:** 26d5a746ee235b03c412f134848890bc8577a597  
**origin/main:** 26d5a746ee235b03c412f134848890bc8577a597  
**Candidate:** .territory/sprint-6/final/candidate  
**Sınıflandırma:** REAL_ARTIFACT_VERIFIED

## 20 soru — özet cevaplar

| # | Soru | Cevap |
| --- | --- | --- |
| 1 | 81 il kapsanıyor mu? | Evet (envanter) |
| 2 | 973 ilçe denetlendi mi? | Evet |
| 3 | Resmî geometri kapsaması | 4.9975% alan (rc.7 ölçümü) |
| 4 | Tahmini geometri bölgeleri | 17049 zone |
| 5 | Mahalle kimlik eşleşmesi | Yalnız lisanslı resmî illerde; ayrıntı `neighborhood-identity-audit.json` |
| 6 | Düşük güven düzeltilen ilçe | 0 (rc.7 baytları yeniden üretilmedi; #108 kodu rebuild gerektirir) |
| 7 | Düşük güven devam | 631 ilçe |
| 8 | 577 gerçekçilik uyarısı kapatıldı | 0 (kayıtlı smart-coverage; yeniden üretim yok) |
| 9 | Yeni uyarı | Hayır (ölçüm yenilenmedi) |
| 10 | Kaynak yetersizliği | 62 il metadata engelli |
| 11 | Hukuki izin bekleyen | `human-approvals-required.json` + Path A/B |
| 12 | Değişen polygon | rc.7 baseline ile aynı geometry hash → değişiklik yok |
| 13 | Stable ID kaybı | Hayır (kimlik haritası 1:1) |
| 14 | Replacement-map | Tamamlandı (`replacement-map.json`) |
| 15 | Yeni ulusal candidate | **Hayır** — rc.7 korundu |
| 16 | MVT/shard doğrulama | Sprint 3 raporları + yerel validate: standard=SKIP, publish-ready=SKIP |
| 17 | GitHub CI | Bu PR push sonrası doğrulanacak |
| 18 | Rush&Claim Sprint 4 | **CONDITIONAL GO** — tüketici sözleşmesi hazır; canlı veri yok |
| 19 | Production engeller | Hosted delivery, full MVT gate, lisans onayı, düşük güven havuzu |
| 20 | Kullanıcı onayı | Path A/B, yayın, Kadıköy kaynağı, production promote |

## Önce / sonra (rc.7 baseline ↔ aynı candidate)

| Metrik | Baseline (rc.7) | Gözlem |
| --- | ---: | ---: |
| ADM3 zone | 20392 | 20392 |
| Resmî zone | 3343 | 3343 |
| Smart-generated zone | 17049 | 17049 |
| Düşük güven ilçe | 631 | 631 |
| Uyarı ilçe (closeout sınıfı) | — | 631 |
| Resmî polygon içeren ilçe | — | 61 |

## GO / NO-GO

| Karar | Sonuç |
| --- | --- |
| National QA closeout | **CONDITIONAL GO** |
| Release candidate technical readiness | **CONDITIONAL GO** (rc.7 yerel doğrulama) |
| Rush&Claim integration preparation | **CONDITIONAL GO** |
| Production dataset promotion | **NO-GO** |

## Komutlar

```sh
pnpm data:tr:national-quality-closeout
pnpm turkey:v2:national:validate
pnpm data:tr:adm3:audit:test
```
