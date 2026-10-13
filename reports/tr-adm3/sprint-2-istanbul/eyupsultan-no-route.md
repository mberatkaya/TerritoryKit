# Eyüpsultan — NO_ROUTE ve düşük güven

| Alan                          | Değer                                           |
| ----------------------------- | ----------------------------------------------- |
| Replay kanıtı                 | `REAL_REPLAY_VERIFIED` (`istanbul-replay.json`) |
| Zone                          | 19                                              |
| Güven                         | low                                             |
| En uzun desteklenmeyen zincir | ~3611 m                                         |
| `longestUnroutedReason`       | `NO_ROUTE`                                      |
| Graf bileşen sayısı           | 368                                             |
| Ağ yüzey kapsamı              | ~23.8%                                          |

**Kök neden özeti:** Paylaşılan sınır için güvenli bariyer rotası bulunamadı; OSM ağ grafiği parçalı ve yüzey kapsamı düşük (`summarizeTurkeyNetworkRouteRootCause`).

**Pilot durumu:** Güvenli otomatik geometri düzeltmesi **yok** — low confidence korunur. Sprint 2 yalnızca diagnostik ve kanıt bütünlüğü sağlar; poligon promote edilmedi.
