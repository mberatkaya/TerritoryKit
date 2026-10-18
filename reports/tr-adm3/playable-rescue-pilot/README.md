# Sprint 1 playable rescue pilot

Coordinate-free QA for the adaptive playable rescue engine. Regenerate with `node scripts/tr-playable-rescue-pilot.mjs` after `pnpm --filter @territory-kit/generators build`.

## Çatalca trade-off (Istanbul local calibration)

Organic rescue vs prior network-first baseline (Sprint 1 measurement):

| Metric                           | Before | After |
| -------------------------------- | -----: | ----: |
| Largest zone area share          |  0.368 | 0.104 |
| Longest unsupported straight (m) |   7802 | 10102 |

Zone balance improved at the cost of a longer unsupported straight segment. No additional watershed routing experiment in this sprint; quality gates unchanged.
