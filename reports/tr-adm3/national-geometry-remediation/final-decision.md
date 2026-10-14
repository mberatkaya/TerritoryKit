# National geometry remediation — interim decision

**Dataset baseline:** `territory-kit-tr-v2-playable@2.1.0-rc.7` (`.territory/sprint-6/final/candidate`, unchanged)  
**Candidate target:** `2.1.0-rc.8` → `.territory/national-geometry-remediation/candidate-rc8`  
**Git base:** `bd2b1e6b0a2092af694603363cba2fb5ee191798` (PR #110 merged)  
**Branch:** `feat/tr-national-geometry-remediation`

## Decision matrix (interim)

| Gate                                                 | Verdict            | Notes                                                                       |
| ---------------------------------------------------- | ------------------ | --------------------------------------------------------------------------- |
| Three-overlap remediation (code + rc.7 smart replay) | **PASS**           | Regresyon testleri; `three-district-overlap-results.json`                   |
| National geometry improvement (rc.8 vs rc.7)         | **PENDING**        | Ulusal build devam ediyor / tamamlanınca `national-quality-comparison.json` |
| New candidate integrity                              | **PENDING**        | rc.8 artefakt doğrulaması build sonrası                                     |
| Stable ID and migration readiness                    | **PENDING**        | `stable-id-diff.json` build + migration planner sonrası                     |
| Rush&Claim Sprint 4 technical readiness              | **CONDITIONAL GO** | Geometri motoru düzeltmesi; rc.8 ve migration kanıtı eksik                  |
| Production dataset promotion                         | **NO-GO**          | Yetkisiz                                                                    |

## Kök neden (üç overlap)

Smart-derived bölümlerde ham kardeş çakışması `topologyNoiseToleranceKm2` ile sıfırlanıp overlap kapısı geçiliyordu; hybrid `prevalidatedPartition` yolu local mask ile yeniden kesmeyi atlıyordu. Ulusal doğrulama ham >1 m² çakışmayı hâlâ `SIBLING_GEOMETRY_OVERLAP` olarak raporluyordu.

## Kalan engeller

- rc.8 tam ulusal build ve karşılaştırma metrikleri
- 631 düşük güvenli ilçe: motor düzeltmesi sonrası yeniden ölçüm (closeout matrisi referans)
- Hukuki / kaynak: PR #110 `blockers.json` (geoBoundaries, Kadıköy SHP, Path A/B)
- CI: PR açıldıktan sonra GitHub Actions

## Test komutları (bu oturum)

```bash
pnpm --filter @territory-kit/generators test turkey-national-sibling-overlap-regression.test.ts
pnpm --filter @territory-kit/generators test turkey-smart-fallback.test.ts
```
