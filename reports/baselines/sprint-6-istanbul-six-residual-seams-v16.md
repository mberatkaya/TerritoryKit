# Istanbul residual seam baseline, smart-derived-v1.6

This is the direct Network candidate before the residual coalescence change. Source: local locked OSM barrier artifacts and `scripts/sprint-6-network-debug.mjs`. All six candidates had valid complete geometry and failed geographic realism. Nearest feature distance is spatial evidence only; it does not prove a connected usable path.

| District   | Residual % | Longest seam m | Start → end (lon, lat)                                      | Owner areas km² | Max area km² | Nearest major feature    | Route evidence        | Direct merge  |
| ---------- | ---------: | -------------: | ----------------------------------------------------------- | --------------: | -----------: | ------------------------ | --------------------- | ------------- |
| Beykoz     |      64.13 |         2836.4 | 29.1974335773, 41.1385352469 → 29.1642317448, 41.1334971334 |    65.1 + 134.7 |        155.8 | roads (secondary), 778 m | NO_ROUTE              | exceeds limit |
| Çatalca    |      89.08 |         2371.7 | 28.4172059557, 41.2889710419 → 28.398515112, 41.2729196768  |   407.2 + 603.6 |        851.1 | water (stream), 51 m     | NO_ROUTE              | exceeds limit |
| Çekmeköy   |      57.28 |         3099.8 | 29.2292246, 41.0493742 → 29.1945270497, 41.0397664506       |       7.1 + 8.3 |         76.0 | roads (motorway), 163 m  | final routing not run | within limit  |
| Eyüpsultan |      76.19 |         3356.3 | 28.8598315377, 41.253679934 → 28.8244253567, 41.2394543818  |    117.4 + 44.1 |        123.5 | water (stream), 345 m    | NO_ROUTE              | exceeds limit |
| Sarıyer    |      55.64 |         2808.4 | 28.9846131464, 41.2172797268 → 28.9678191565, 41.1954107379 |     70.3 + 27.2 |         87.8 | water (stream), 151 m    | NO_ROUTE              | exceeds limit |
| Silivri    |      85.59 |         2943.0 | 28.2971528067, 41.2295118171 → 28.3180319245, 41.2508196229 |   521.9 + 220.4 |        572.4 | water (stream), 75 m     | NO_ROUTE              | exceeds limit |

Five direct merges exceed configured maximum territory area. Çekmeköy had enough area headroom, but its 3.1 km chord carried about 70.7 m of weak source alignment, narrowly above the old 2% coalescence cutoff; the new 5% residual-only criterion also forbids removing any strong road, railway, or water support. With final routing enabled on high-residual monolithic candidates, Çekmeköy is accepted with 20 zones and a 2,158 m longest unsupported chain. The other five still need geographically meaningful residual cuts and remain rejected. No quality threshold was relaxed.

Residual-only partition adequacy after the coalescence change:

| District   | Largest residual territory share | Effective residual count | Minimum useful count | Adequate |
| ---------- | -------------------------------: | -----------------------: | -------------------: | -------- |
| Beykoz     |                            0.674 |                    1.785 |                    3 | No       |
| Çatalca    |                            0.597 |                    1.927 |                    5 | Yes      |
| Çekmeköy   |                            0.315 |                    5.650 |                    3 | Yes      |
| Eyüpsultan |                            0.667 |                    1.946 |                    3 | Yes      |
| Sarıyer    |                            0.719 |                    1.681 |                    3 | No       |
| Silivri    |                            0.703 |                    1.717 |                    5 | No       |

The residual adequacy metric is diagnostic at this stage. The five remaining candidates already fail geographic realism; do not treat this table as approval to accept them.
