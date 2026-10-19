# Sprint 2B.4 — Fatih hybrid (impl-rev4)

## Decision

- **Status:** NO-GO
- **Reason:** Hybrid Pareto miss: weighted barrier 0.5047 (target 0.8907), seed coverage 0.2394 (floor 0.5352).
- **National expansion:** NO-GO

## Quality gates

| Gate                       | Target   | impl-rev4     |
| -------------------------- | -------- | ------------- |
| Weighted barrier alignment | ≥ 0.8907 | 0.5047 (miss) |
| Seed coverage              | ≥ 0.5352 | 0.2394 (miss) |
| Determinism                | PASS     | PASS          |
| Validation                 | PASS     | PASS          |

## Metrics snapshot

| Metric                     | v1.7 replay | impl-rev3 (historical) | impl-rev4 hybrid |
| -------------------------- | ----------: | ---------------------: | ---------------: |
| ADM3 zones                 |          30 |                     47 |               48 |
| Weighted barrier alignment |      0.8907 |                 0.7521 |           0.5047 |
| Seed coverage ratio        |      0.1408 |                 0.5352 |           0.2394 |
| Pathology findings         |          13 |                     25 |               12 |

## Commands

```sh
pnpm data:tr:mahalle-first:fatih-hybrid-pilot
pnpm --filter @territory-kit/generators test turkey-smart-derived-v2-pilot turkey-seed-watershed
```
