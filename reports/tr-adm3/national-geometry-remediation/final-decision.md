# National geometry remediation — interim decision

**Dataset baseline:** `territory-kit-tr-v2-playable@2.1.0-rc.7` (`.territory/sprint-6/final/candidate`, unchanged)  
**Candidate target:** `2.1.0-rc.8` → `.territory/national-geometry-remediation/candidate-rc8-impl-rev1`  
**Implementation revision:** `national-hybrid-sibling-gate-v2`  
**Branch:** `feat/tr-national-geometry-remediation`

## Decision matrix (interim)

| Gate                                                  | Verdict            | Notes                                                                              |
| ----------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| Three-overlap remediation (Vitest + dataset ADM3)     | **PASS**           | `turkey-national-blocker-districts-hybrid.test.ts`                                 |
| Three-overlap remediation (CLI real hybrid preflight) | **PASS**           | `preflight-real-hybrid-rc8-impl-rev1.json` — strict `SIBLING_GEOMETRY_OVERLAP` = 0 |
| Checkpoint @5 / implementation revision               | **PASS**           | `national-hybrid-sibling-gate-v2`                                                  |
| National geometry improvement (rc.8 vs rc.7)          | **IN_PROGRESS**    | `build-impl-rev1.log` / `candidate-rc8-impl-rev1`                                  |
| New candidate integrity                               | **PENDING**        | Build completion + validate                                                        |
| Stable ID and migration readiness                     | **PENDING**        | `migration-plan.json` after build                                                  |
| Rush&Claim Sprint 4 technical readiness               | **CONDITIONAL GO** | rc.8 metrics pending                                                               |
| Production dataset promotion                          | **NO-GO**          | Yetkisiz                                                                           |

## Kök neden (üç overlap — çözüldü)

1. Hybrid `effectiveSiblingOverlap` kapısı `validateGeometryDataset` uyarılarını polygon-clipping alanı > `overlapToleranceKm2` ile süzüyordu; bağımsız validator aynı çiftleri hâlâ `SIBLING_GEOMETRY_OVERLAP` olarak işaretliyordu (`qualityOk=true` / gate true / validator fail).
2. Preflight `generatedZoneCount=0` sayacı `boundarySourceClass: smart-derived` zone'ları saymıyordu (`generated-zone` / `sourceKind` aranıyordu).
3. `tr adm3 hybrid build` OSM seçenekleri ulusal build ile hizalı değildi (`maxTerritories` eksik, `fallbackToLegacyOnSmartFailure` varsayılan true).

## Düzeltme

- `countStrictSiblingGeometryOverlaps` — kapı ve `prevalidatedPartition` re-carve tetikleyicisi ulusal validator ile hizalı.
- CLI `resolveOsmBarrierGeneratedOptions` — ulusal `maxTerritories` + `fallbackToLegacyOnSmartFailure: false`.
- `implementationRevision` → `national-hybrid-sibling-gate-v2` (eski `@5` checkpoint'ler restore edilmez).

## Test komutları

```bash
node scripts/tr-rc8-three-district-preflight.mjs
pnpm --filter @territory-kit/generators test turkey-national-blocker-districts-hybrid.test.ts
pnpm verify
```
