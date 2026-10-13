# Sprint 3 — nihai karar

**İncelenen commit:** a0c71d88341de2207a5f5e886b97e408f815b70f  
**origin/main:** 2c03e1b870272191cf8ddddf3313fe9d3cb147ba  
**Candidate:** .territory/sprint-6/final/candidate

## Özet

| Alan                     | Sonuç                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| Artifact envanteri       | REAL_ARTIFACT_VERIFIED                                                                      |
| Ulusal kapsam (973 ilçe) | REAL_ARTIFACT_VERIFIED                                                                      |
| Shard bütünlüğü          | REAL_ARTIFACT_VERIFIED                                                                      |
| MVT örnekleme            | MVT_SOURCE_LAYER_VERIFIED_DISTRICT_EVIDENCE_LIMITED (sourceLayer: PASS, fullDelivery: FAIL) |
| Consumer replay (yerel)  | LOCAL_CONSUMER_VERIFIED                                                                     |
| Hosted teslimat          | NOT_ASSESSED / BLOCKED                                                                      |
| Kaynak kilidi rc.7       | UNCHANGED_FROM_RC7                                                                          |

## GO / NO-GO

- **Araştırma/validation PR merge:** GO
- **Production dataset yayını:** NO-GO (fullMvtDeliveryReady, insan onayı ve hosted doğrulama gerekir)

## Komutlar (bu oturum)

- `pnpm turkey:v2:national:validate` → PASS
- `pnpm turkey:v2:national:validate:publish-ready` → PASS teknik (yasal onay ayrı)
- `pnpm data:tr:sprint3:national-rc` → rapor üretimi
