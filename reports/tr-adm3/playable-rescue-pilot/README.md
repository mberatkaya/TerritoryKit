# Sprint 2 geographic realism pilot (playable rescue)

Coordinate-free QA for adaptive playable rescue after Sprint 2 natural-boundary improvements. Regenerate with `node scripts/tr-playable-rescue-pilot.mjs` after `pnpm --filter @territory-kit/generators build`.

Local Istanbul calibration runs six districts (Fatih, Adalar, Çatalca, Eyüpsultan, Kadıköy, Üsküdar). CI uses three national-blocker fixtures when local bytes are absent.

## Çatalca (organic rescue, local calibration)

| Metric                           | Pre–Sprint 1 (network-first baseline) | Sprint 1 (organic) | Sprint 2 (organic + routing v2) |
| -------------------------------- | ------------------------------------: | -----------------: | ------------------------------: |
| Playable zones                   |                                    19 |                 18 |                              16 |
| Largest zone area share          |                                 0.368 |              0.104 |                           0.123 |
| Barrier-following ratio          |                                 0.804 |              0.326 |                           0.433 |
| Longest unsupported straight (m) |                                  7802 |              10102 |                            8850 |

Sprint 2 shortens the longest unsupported straight segment by ~12% versus Sprint 1 while keeping cell balance far below the pre–Sprint 1 mega-cell (0.37 share). MapLibre previews under `previews/` are gitignored when they contain OSM-derived coordinates; metrics above are safe to commit.
