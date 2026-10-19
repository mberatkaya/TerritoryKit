# Mahalle-first ADM3 program

Bu dizin, **gerçek mahalle kaynaklarını önceleyen** ulusal ADM3 programının keşif ve İstanbul v2 pilot kanıtlarını tutar.

| Dosya                                   | Açıklama                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `gap-analysis.md` / `gap-analysis.json` | Repo keşfi, governance delta, modül boşlukları (`pnpm data:tr:mahalle-first:gap-analysis`)          |
| `istanbul-v2-pilot-baseline.json`       | rc.7 salt okunur shard metrikleri — 8 İstanbul ilçesi (`pnpm data:tr:mahalle-first:istanbul-pilot`) |
| `sprint-2b4-architecture-decision.md`   | Alternatif A/B mimari değerlendirme + bağımsız sınır QA                                             |
| `sprint-2b4-decision.md`                | Fatih impl-rev4 hybrid GO/NO-GO (`pnpm data:tr:mahalle-first:fatih-hybrid-pilot`)                   |
| `fatih-v17-rev3-boundary-qa.json`       | v1.7 replay vs impl-rev3 kenar envanteri (uzunluk ağırlıklı)                                        |
| `fatih-v2-impl-rev4-comparison.json`    | impl-rev4 hybrid metrikleri vs v1.7 / impl-rev3                                                     |

**Yasaklar:** rc.7/rc.8 candidate üzerine yazma; lisansı bilinmeyen mahalle verisini public artefaktlara koyma; Sprint 2 kabulü olmadan 973 ilçe build.
