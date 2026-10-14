# National geometry remediation — interim decision

**Dataset baseline:** `territory-kit-tr-v2-playable@2.1.0-rc.7` (`.territory/sprint-6/final/candidate`, unchanged)  
**Candidate target:** `2.1.0-rc.8` → `.territory/national-geometry-remediation/candidate-rc8-impl-rev1` (clean; not started)  
**Git HEAD:** `9366fdd` (checkpoint @5 + implementation revision)  
**Branch:** `feat/tr-national-geometry-remediation`

## Decision matrix (interim)

| Gate                                                   | Verdict            | Notes                                                                                                |
| ------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------- |
| Three-overlap remediation (Vitest / rc.7 smart replay) | **PASS**           | `turkey-national-blocker-districts-hybrid.test.ts` (TS source)                                       |
| Three-overlap remediation (CLI real hybrid preflight)  | **FAIL**           | `preflight-real-hybrid-rc8-impl-rev1.json` — `SIBLING_GEOMETRY_OVERLAP` ×3                           |
| Checkpoint @5 / implementation revision                | **PASS**           | `9366fdd`; CI run [38568299623](https://github.com/mberatkaya/TerritoryKit/actions/runs/38568299623) |
| National geometry improvement (rc.8 vs rc.7)           | **BLOCKED**        | FAZ B failed; FAZ C not started                                                                      |
| New candidate integrity                                | **PENDING**        | rc.8 artefakt doğrulaması build sonrası                                                              |
| Stable ID and migration readiness                      | **PENDING**        | `stable-id-diff.json` build + migration planner sonrası                                              |
| Rush&Claim Sprint 4 technical readiness                | **CONDITIONAL GO** | Geometri motoru düzeltmesi; rc.8 ve migration kanıtı eksik                                           |
| Production dataset promotion                           | **NO-GO**          | Yetkisiz                                                                                             |

## Kök neden (üç overlap)

Smart-derived bölümlerde ham kardeş çakışması `topologyNoiseToleranceKm2` ile sıfırlanıp overlap kapısı geçiliyordu; hybrid `prevalidatedPartition` yolu local mask ile yeniden kesmeyi atlıyordu. Ulusal doğrulama ham >1 m² çakışmayı hâlâ `SIBLING_GEOMETRY_OVERLAP` olarak raporluyordu.

## Kalan engeller

- **FAZ B:** CLI `tr adm3 hybrid build` gerçek veri preflight — üç ilçede `validateGeometryDataset` sibling overlap hâlâ 1 (rc.7 ile aynı zone çiftleri); ulusal build başlatılmadı
- rc.8 tam ulusal build ve karşılaştırma metrikleri (FAZ C, FAZ B sonrası)
- 631 düşük güvenli ilçe: motor düzeltmesi sonrası yeniden ölçüm (closeout matrisi referans)
- Hukuki / kaynak: PR #110 `blockers.json` (geoBoundaries, Kadıköy SHP, Path A/B)
- CI: PR açıldıktan sonra GitHub Actions

## Test komutları (bu oturum)

```bash
pnpm --filter @territory-kit/generators test turkey-national-sibling-overlap-regression.test.ts
pnpm --filter @territory-kit/generators test turkey-smart-fallback.test.ts
```
